import { describe, it, expect } from 'vitest';
import {
  challengeToPaymentRequired,
  paymentRequiredToChallenge,
  coinbasePayloadToProofHeader,
  proofHeaderToCoinbasePayload,
  toolkitNetworkToCaip2,
  caip2ToToolkitNetwork,
  toolkitAssetToAddress,
  addressToToolkitAsset,
  humanDecimalToAtomicUnits,
  atomicUnitsToHumanDecimal,
} from 'x402-tool-server/compat';
import type { X402Challenge } from 'x402-tool-server';

function makeChallenge(overrides: Partial<X402Challenge> = {}): X402Challenge {
  return {
    version: 1,
    scheme: 'exact',
    price: '0.001',
    asset: 'USDC',
    network: 'mock',
    recipient: '0xTEST',
    nonce: '550e8400-e29b-41d4-a716-446655440000',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    requestHash: 'a'.repeat(64),
    description: 'Test endpoint',
    ...overrides,
  };
}

describe('Round-trip: challenge ↔ PaymentRequired', () => {
  it('challenge → PaymentRequired → challenge preserves fields', () => {
    const original = makeChallenge();
    const pr = challengeToPaymentRequired(original, '/weather');
    const roundTripped = paymentRequiredToChallenge(pr);

    expect(roundTripped.scheme).toBe(original.scheme);
    expect(roundTripped.asset).toBe(original.asset);
    expect(roundTripped.network).toBe(original.network);
    expect(roundTripped.recipient).toBe(original.recipient);
    expect(roundTripped.nonce).toBe(original.nonce);
    expect(roundTripped.requestHash).toBe(original.requestHash);
    expect(roundTripped.description).toBe(original.description);
  });
});

describe('Round-trip: proof ↔ CoinbasePayload', () => {
  it('proof → CoinbasePayload → proof preserves fields', () => {
    const challenge = makeChallenge();
    const proof = {
      version: 1,
      nonce: challenge.nonce,
      requestHash: challenge.requestHash,
      payer: 'mock://0x0001',
      timestamp: '2025-01-01T00:00:00.000Z',
      expiresAt: challenge.expiresAt,
      signature: 'sig-abc-123',
    };
    const proofHeader = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
    const coinbasePayload = proofHeaderToCoinbasePayload(proofHeader, challenge);
    const roundTrippedHeader = coinbasePayloadToProofHeader(coinbasePayload);

    const roundTripped = JSON.parse(
      Buffer.from(roundTrippedHeader, 'base64url').toString('utf8'),
    );
    expect(roundTripped.nonce).toBe(proof.nonce);
    expect(roundTripped.requestHash).toBe(proof.requestHash);
    expect(roundTripped.payer).toBe(proof.payer);
    expect(roundTripped.signature).toBe(proof.signature);
  });
});

describe('Amount precision', () => {
  it('no floating-point errors for 0.001', () => {
    const atomic = humanDecimalToAtomicUnits('0.001', 6);
    expect(atomic).toBe('1000');
    const back = atomicUnitsToHumanDecimal(atomic, 6);
    expect(back).toBe('0.001000');
  });

  it('no floating-point errors for 99999.999999', () => {
    const atomic = humanDecimalToAtomicUnits('99999.999999', 6);
    expect(atomic).toBe('99999999999');
    const back = atomicUnitsToHumanDecimal(atomic, 6);
    expect(back).toBe('99999.999999');
  });

  it('handles 18 decimals (ETH)', () => {
    const atomic = humanDecimalToAtomicUnits('1.0', 18);
    expect(atomic).toBe('1000000000000000000');
    const back = atomicUnitsToHumanDecimal(atomic, 18);
    expect(back).toBe('1.000000000000000000');
  });
});

describe('Mapping bijectivity', () => {
  it('network mapping is bijective for all known networks', () => {
    const networks = ['base', 'base-sepolia', 'ethereum', 'polygon', 'solana', 'solana-devnet', 'mock'];
    for (const net of networks) {
      const caip2 = toolkitNetworkToCaip2(net);
      const back = caip2ToToolkitNetwork(caip2);
      expect(back).toBe(net);
    }
  });

  it('asset mapping is bijective for all known assets', () => {
    const cases: Array<[string, string]> = [
      ['USDC', 'eip155:8453'],
      ['USDC', 'eip155:84532'],
      ['USDC', 'mock:1'],
      ['MOCK', 'mock:1'],
    ];
    for (const [asset, network] of cases) {
      const addr = toolkitAssetToAddress(asset, network);
      const back = addressToToolkitAsset(addr, network);
      expect(back).toBe(asset);
    }
  });
});
