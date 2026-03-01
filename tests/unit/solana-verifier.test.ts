import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// ── Test constants ────────────────────────────────────────────────────────────

const USDC_DEVNET_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Deterministic test recipient — seed all-2s, never use in production
const RECIPIENT_KEYPAIR = Keypair.fromSeed(new Uint8Array(32).fill(2));
const TEST_RECIPIENT = RECIPIENT_KEYPAIR.publicKey.toBase58();
const RECIPIENT_ATA = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, RECIPIENT_KEYPAIR.publicKey);

const TEST_NONCE = 'test-nonce-uuid-1234';
const TEST_REQUEST_HASH = 'a'.repeat(64);
const VALID_MEMO = `${TEST_NONCE}|${TEST_REQUEST_HASH}`;

const TEST_PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'solana-devnet',
  recipient: TEST_RECIPIENT,
};

function makeProofHeader(overrides: Record<string, string | number> = {}): string {
  const proof = {
    version: 1,
    nonce: TEST_NONCE,
    requestHash: TEST_REQUEST_HASH,
    payer: Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58(),
    timestamp: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    signature: 'fake-solana-tx-sig',
    ...overrides,
  };
  return Buffer.from(JSON.stringify(proof)).toString('base64url');
}

function makeParsedTx(options: {
  destination?: string;
  mint?: string;
  amount?: string;
  memo?: string;
  blockTime?: number | null;
  includeTransfer?: boolean;
  includeMemo?: boolean;
} = {}) {
  const instructions = [];

  if (options.includeTransfer !== false) {
    instructions.push({
      programId: SPL_TOKEN_PROGRAM_ID,
      program: 'spl-token',
      parsed: {
        type: 'transferChecked',
        info: {
          authority: 'some-authority',
          destination: options.destination ?? RECIPIENT_ATA.toBase58(),
          mint: options.mint ?? USDC_DEVNET_MINT.toBase58(),
          source: 'some-source-ata',
          tokenAmount: {
            amount: options.amount ?? '1000',
            decimals: 6,
          },
        },
      },
    });
  }

  if (options.includeMemo !== false) {
    instructions.push({
      programId: MEMO_PROGRAM_ID,
      program: 'spl-memo',
      parsed: options.memo ?? VALID_MEMO,
    });
  }

  return {
    transaction: { message: { instructions } },
    blockTime: options.blockTime !== undefined ? options.blockTime : Math.floor(Date.now() / 1000) - 10,
    meta: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SolanaUSDCVerifier', () => {
  const verifier = new SolanaUSDCVerifier();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx());
  });

  it('returns true for a valid transaction', async () => {
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(true);
  });

  it('returns false when requestHash does not match proof', async () => {
    const result = await verifier.verify(makeProofHeader(), 'b'.repeat(64), TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when proof is expired', async () => {
    const header = makeProofHeader({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const result = await verifier.verify(header, TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when proof version is not 1', async () => {
    const header = makeProofHeader({ version: 2 });
    const result = await verifier.verify(header, TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when proofHeader is not valid base64url JSON', async () => {
    const result = await verifier.verify('not-valid-base64!!', TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when transaction is not found (null)', async () => {
    mocks.getParsedTransaction.mockResolvedValue(null);
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when RPC call throws', async () => {
    mocks.getParsedTransaction.mockRejectedValue(new Error('RPC unavailable'));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when transfer instruction is missing', async () => {
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ includeTransfer: false }));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when memo instruction is missing', async () => {
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ includeMemo: false }));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when memo does not match nonce|requestHash', async () => {
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ memo: 'wrong-nonce|wrong-hash' }));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when memo nonce is correct but requestHash is wrong', async () => {
    mocks.getParsedTransaction.mockResolvedValue(
      makeParsedTx({ memo: `${TEST_NONCE}|${'b'.repeat(64)}` }),
    );
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when transfer destination does not match recipient ATA', async () => {
    const wrongATA = getAssociatedTokenAddressSync(
      USDC_DEVNET_MINT,
      Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey,
    );
    mocks.getParsedTransaction.mockResolvedValue(
      makeParsedTx({ destination: wrongATA.toBase58() }),
    );
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when mint does not match USDC devnet mint', async () => {
    mocks.getParsedTransaction.mockResolvedValue(
      makeParsedTx({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), // USDC mainnet
    );
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when transfer amount is below required', async () => {
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ amount: '999' })); // 1 less than 1000
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns true when transfer amount exactly matches', async () => {
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ amount: '1000' }));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(true);
  });

  it('returns false when blockTime is null', async () => {
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ blockTime: null }));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when transaction is older than MAX_AGE_SECONDS (600s)', async () => {
    const staleBlockTime = Math.floor(Date.now() / 1000) - 601;
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ blockTime: staleBlockTime }));
    const result = await verifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('returns false when blockTime is after expiresAt', async () => {
    // blockTime 10 minutes after expiresAt
    const expiresAt = new Date(Date.now() + 300_000);
    const futureBlockTime = Math.floor(expiresAt.getTime() / 1000) + 600;
    const header = makeProofHeader({ expiresAt: expiresAt.toISOString() });
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ blockTime: futureBlockTime }));
    const result = await verifier.verify(header, TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(false);
  });

  it('respects amountTolerance option', async () => {
    const tolerantVerifier = new SolanaUSDCVerifier({ amountTolerance: 5n });
    mocks.getParsedTransaction.mockResolvedValue(makeParsedTx({ amount: '996' })); // 4 less than 1000, within tolerance of 5
    const result = await tolerantVerifier.verify(makeProofHeader(), TEST_REQUEST_HASH, TEST_PRICING);
    expect(result).toBe(true);
  });
});
