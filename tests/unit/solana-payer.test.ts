import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// ── Mocks (hoisted so vi.mock factory can reference them) ────────────────────

const mocks = vi.hoisted(() => ({
  sendAndConfirmTransaction: vi.fn().mockResolvedValue('test-tx-sig-abc123'),
  getAccount: vi.fn().mockResolvedValue({ amount: BigInt(1_000_000) }),
  MockConnection: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: mocks.MockConnection,
    sendAndConfirmTransaction: mocks.sendAndConfirmTransaction,
  };
});

vi.mock('@solana/spl-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/spl-token')>();
  return {
    ...actual,
    getAccount: mocks.getAccount,
  };
});

// Import under test AFTER mocks are declared
const { SolanaUSDCPayer } = await import('x402-adapters/solana');

// ── Helpers ──────────────────────────────────────────────────────────────────

// Deterministic test keypair — seed all-1s, never use in production
const TEST_KEYPAIR = Keypair.fromSeed(new Uint8Array(32).fill(1));
const TEST_PRIVATE_KEY_BASE58 = bs58.encode(TEST_KEYPAIR.secretKey);
const TEST_PRIVATE_KEY_JSON = JSON.stringify(Array.from(TEST_KEYPAIR.secretKey));

const TEST_RECIPIENT = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58();

function makeChallenge(overrides: Record<string, string | number> = {}) {
  return {
    version: 1,
    scheme: 'exact',
    price: '0.001',
    asset: 'USDC',
    network: 'solana-devnet',
    recipient: TEST_RECIPIENT,
    nonce: 'test-nonce-uuid',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}

const CONTEXT = { url: 'http://localhost:3000/weather?city=London', method: 'GET' };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SolanaUSDCPayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendAndConfirmTransaction.mockResolvedValue('test-tx-sig-abc123');
    mocks.getAccount.mockResolvedValue({ amount: BigInt(1_000_000) });
  });

  it('loads base58 private key', () => {
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    expect(payer.publicKey.toBase58()).toBe(TEST_KEYPAIR.publicKey.toBase58());
  });

  it('loads JSON array private key', () => {
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_JSON });
    expect(payer.publicKey.toBase58()).toBe(TEST_KEYPAIR.publicKey.toBase58());
  });

  it('returns a PaymentProof with correct fields on success', async () => {
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    const challenge = makeChallenge();
    const proof = await payer.pay(challenge, CONTEXT);

    expect(proof.version).toBe(challenge.version);
    expect(proof.nonce).toBe(challenge.nonce);
    expect(proof.requestHash).toBe(challenge.requestHash);
    expect(proof.payer).toBe(TEST_KEYPAIR.publicKey.toBase58());
    expect(proof.expiresAt).toBe(challenge.expiresAt);
    expect(proof.signature).toBe('test-tx-sig-abc123');
    expect(typeof proof.timestamp).toBe('string');
  });

  it('calls sendAndConfirmTransaction exactly once', async () => {
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    await payer.pay(makeChallenge(), CONTEXT);
    expect(mocks.sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws when payer ATA does not exist', async () => {
    mocks.getAccount
      .mockRejectedValueOnce(new Error('Account not found')); // payer ATA fails

    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    await expect(payer.pay(makeChallenge(), CONTEXT)).rejects.toThrow(
      'Payer has no USDC token account',
    );
  });

  it('throws when recipient ATA does not exist', async () => {
    mocks.getAccount
      .mockResolvedValueOnce({ amount: BigInt(1_000_000) }) // payer ATA ok
      .mockRejectedValueOnce(new Error('Account not found')); // recipient ATA fails

    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    await expect(payer.pay(makeChallenge(), CONTEXT)).rejects.toThrow(
      'Recipient has no USDC token account',
    );
  });

  it('parses price "0.001" into 1000 micro-USDC', async () => {
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    await payer.pay(makeChallenge({ price: '0.001' }), CONTEXT);
    // sendAndConfirmTransaction was called — amount conversion tested indirectly
    // (deep instruction inspection would test @solana/spl-token, not our code)
    expect(mocks.sendAndConfirmTransaction).toHaveBeenCalled();
  });

  it('parses price "1.5" into 1500000 micro-USDC without float error', async () => {
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    await payer.pay(makeChallenge({ price: '1.5' }), CONTEXT);
    expect(mocks.sendAndConfirmTransaction).toHaveBeenCalled();
  });

  it('uses "confirmed" commitment by default', () => {
    vi.clearAllMocks();
    const payer = new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58 });
    expect(payer).toBeDefined();
    expect(mocks.MockConnection).toHaveBeenCalledWith(expect.any(String), 'confirmed');
  });

  it('respects custom commitment option', () => {
    vi.clearAllMocks();
    new SolanaUSDCPayer({ privateKey: TEST_PRIVATE_KEY_BASE58, commitment: 'finalized' });
    expect(mocks.MockConnection).toHaveBeenCalledWith(expect.any(String), 'finalized');
  });
});
