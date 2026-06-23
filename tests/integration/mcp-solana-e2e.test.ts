/**
 * Solana adapter compatibility: the SolanaUSDCVerifier binds a payment to the
 * canonical MCP request hash (via the on-chain memo `nonce|requestHash`), just
 * like it does for HTTP requests. The Solana RPC connection is mocked, so this
 * runs in CI without devnet access.
 */
import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createPaidMcpRegistry, createMcpPaymentGuard } from 'x402-mcp';
import type { McpGuardDecision } from 'x402-mcp';
import type { X402Challenge } from '@darklrd/x402-agent-client';

const mocks = vi.hoisted(() => ({
  getParsedTransaction: vi.fn(),
}));

vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      getParsedTransaction: mocks.getParsedTransaction,
    })),
  };
});

const { SolanaUSDCVerifier } = await import('x402-adapters/solana');

const USDC_DEVNET_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const RECIPIENT_KEYPAIR = Keypair.fromSeed(new Uint8Array(32).fill(2));
const TEST_RECIPIENT = RECIPIENT_KEYPAIR.publicKey.toBase58();
const RECIPIENT_ATA = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, RECIPIENT_KEYPAIR.publicKey);
const PAYER = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58();

const TRANSPORT_PATH = '/mcp';
const pricing = {
  price: '0.001',
  asset: 'USDC',
  network: 'solana-devnet',
  recipient: TEST_RECIPIENT,
};

function buildRegistry() {
  const registry = createPaidMcpRegistry();
  registry.tool(
    {
      name: 'get_weather',
      description: 'weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      pricing,
    },
    async () => ({ content: [] }),
  );
  registry.tool(
    {
      name: 'get_price',
      description: 'price',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string' } } },
      pricing,
    },
    async () => ({ content: [] }),
  );
  return registry;
}

function callBody(name: string, args: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function asChallenge(decision: McpGuardDecision): X402Challenge {
  if (decision.action !== 'challenge') throw new Error(`expected challenge, got ${decision.action}`);
  return (decision.body as { x402: X402Challenge }).x402;
}

function mockTxFor(nonce: string, requestHash: string) {
  return {
    blockTime: Math.floor(Date.now() / 1000),
    transaction: {
      message: {
        instructions: [
          {
            programId: SPL_TOKEN_PROGRAM_ID,
            program: 'spl-token',
            parsed: {
              type: 'transferChecked',
              info: {
                authority: PAYER,
                destination: RECIPIENT_ATA.toBase58(),
                mint: USDC_DEVNET_MINT.toBase58(),
                source: 'some-source-ata',
                tokenAmount: { amount: '1000', decimals: 6 },
              },
            },
          },
          {
            programId: MEMO_PROGRAM_ID,
            program: 'spl-memo',
            parsed: `${nonce}|${requestHash}`,
          },
        ],
      },
    },
  };
}

function solanaProofHeader(challenge: X402Challenge): string {
  const proof = {
    version: 1,
    nonce: challenge.nonce,
    requestHash: challenge.requestHash,
    payer: PAYER,
    timestamp: new Date().toISOString(),
    expiresAt: challenge.expiresAt,
    signature: 'fake-solana-tx-signature',
  };
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

describe('x402-mcp Solana adapter compatibility', () => {
  it('SolanaUSDCVerifier accepts a proof bound to the MCP canonical hash', async () => {
    const guard = createMcpPaymentGuard({
      transportPath: TRANSPORT_PATH,
      registry: buildRegistry(),
      verifier: new SolanaUSDCVerifier({ mintAddress: USDC_DEVNET_MINT }),
    });

    const challenge = asChallenge(
      await guard.evaluate({ body: callBody('get_weather', { city: 'London' }), headers: {} }),
    );

    // The on-chain memo binds the payment to nonce|<MCP request hash>.
    mocks.getParsedTransaction.mockResolvedValueOnce(
      mockTxFor(challenge.nonce, challenge.requestHash),
    );

    const decision = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }),
      headers: { 'x-payment-proof': solanaProofHeader(challenge) },
    });
    expect(decision.action).toBe('proceed');
    guard.dispose();
  });

  it('rejects a Solana proof minted for a different tool', async () => {
    const guard = createMcpPaymentGuard({
      transportPath: TRANSPORT_PATH,
      registry: buildRegistry(),
      verifier: new SolanaUSDCVerifier({ mintAddress: USDC_DEVNET_MINT }),
    });

    const weatherChallenge = asChallenge(
      await guard.evaluate({ body: callBody('get_weather', { city: 'London' }), headers: {} }),
    );
    // Even if the chain confirmed a transfer, the memo is bound to the weather
    // hash; spending it on get_price recomputes a different hash -> reject.
    mocks.getParsedTransaction.mockResolvedValueOnce(
      mockTxFor(weatherChallenge.nonce, weatherChallenge.requestHash),
    );

    const decision = await guard.evaluate({
      body: callBody('get_price', { symbol: 'BTC' }),
      headers: { 'x-payment-proof': solanaProofHeader(weatherChallenge) },
    });
    expect(decision.action).toBe('reject');
    guard.dispose();
  });
});
