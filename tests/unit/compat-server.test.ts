import { describe, it, expect } from 'vitest';
import {
  toolkitNetworkToCaip2,
  caip2ToToolkitNetwork,
  toolkitAssetToAddress,
  addressToToolkitAsset,
  humanDecimalToAtomicUnits,
  atomicUnitsToHumanDecimal,
  challengeToPaymentRequired,
  paymentRequiredToChallenge,
  coinbasePayloadToProofHeader,
  proofHeaderToCoinbasePayload,
  extractProofHeader,
} from 'x402-tool-server/compat';
import type {
  CoinbasePaymentRequired,
  CoinbasePaymentPayload,
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

describe('toolkitNetworkToCaip2', () => {
  it('maps known networks', () => {
    expect(toolkitNetworkToCaip2('base-sepolia')).toBe('eip155:84532');
    expect(toolkitNetworkToCaip2('base')).toBe('eip155:8453');
    expect(toolkitNetworkToCaip2('mock')).toBe('mock:1');
  });

  it('passes through unknown as-is', () => {
    expect(toolkitNetworkToCaip2('custom-net')).toBe('custom-net');
  });
});

describe('caip2ToToolkitNetwork', () => {
  it('maps known CAIP-2 back', () => {
    expect(caip2ToToolkitNetwork('eip155:8453')).toBe('base');
    expect(caip2ToToolkitNetwork('eip155:84532')).toBe('base-sepolia');
    expect(caip2ToToolkitNetwork('mock:1')).toBe('mock');
  });

  it('passes through unknown as-is', () => {
    expect(caip2ToToolkitNetwork('eip155:99999')).toBe('eip155:99999');
  });
});

describe('toolkitAssetToAddress', () => {
  it('maps USDC on base', () => {
    expect(toolkitAssetToAddress('USDC', 'eip155:8453')).toBe(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    );
  });

  it('returns symbol for unknown network', () => {
    expect(toolkitAssetToAddress('USDC', 'eip155:99999')).toBe('USDC');
  });
});

describe('addressToToolkitAsset', () => {
  it('reverse maps contract to symbol', () => {
    expect(
      addressToToolkitAsset('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'eip155:8453'),
    ).toBe('USDC');
  });

  it('returns address for unknown', () => {
    expect(addressToToolkitAsset('0xUNKNOWN', 'eip155:8453')).toBe('0xUNKNOWN');
  });
});

describe('humanDecimalToAtomicUnits', () => {
  it('0.001 with 6 decimals', () => {
    expect(humanDecimalToAtomicUnits('0.001', 6)).toBe('1000');
  });

  it('1.0 with 6 decimals', () => {
    expect(humanDecimalToAtomicUnits('1.0', 6)).toBe('1000000');
  });

  it('0 with 6 decimals', () => {
    expect(humanDecimalToAtomicUnits('0', 6)).toBe('0');
  });

  it('integer without decimal point', () => {
    expect(humanDecimalToAtomicUnits('5', 6)).toBe('5000000');
  });
});

describe('atomicUnitsToHumanDecimal', () => {
  it('1000 with 6 decimals', () => {
    expect(atomicUnitsToHumanDecimal('1000', 6)).toBe('0.001000');
  });

  it('1000000 with 6 decimals', () => {
    expect(atomicUnitsToHumanDecimal('1000000', 6)).toBe('1.000000');
  });

  it('0 with 6 decimals', () => {
    expect(atomicUnitsToHumanDecimal('0', 6)).toBe('0.000000');
  });
});

describe('challengeToPaymentRequired', () => {
  it('converts full challenge', () => {
    const challenge = makeChallenge();
    const result = challengeToPaymentRequired(challenge, '/weather');

    expect(result.x402Version).toBe(1);
    expect(result.error).toBe('Payment Required');
    expect(result.resource.url).toBe('/weather');
    expect(result.accepts).toHaveLength(1);
    expect(result.accepts[0].scheme).toBe('exact');
    expect(result.accepts[0].network).toBe('mock:1');
    expect(result.accepts[0].asset).toBe('USDC');
    expect(result.accepts[0].amount).toBe('1000');
    expect(result.accepts[0].payTo).toBe('0xTEST');
  });

  it('nonce and requestHash in extra', () => {
    const challenge = makeChallenge();
    const result = challengeToPaymentRequired(challenge, '/test');
    expect(result.accepts[0].extra['nonce']).toBe(challenge.nonce);
    expect(result.accepts[0].extra['requestHash']).toBe(challenge.requestHash);
  });

  it('expiresAt to maxTimeoutSeconds', () => {
    const challenge = makeChallenge({
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const result = challengeToPaymentRequired(challenge, '/test');
    expect(result.accepts[0].maxTimeoutSeconds).toBeGreaterThanOrEqual(298);
    expect(result.accepts[0].maxTimeoutSeconds).toBeLessThanOrEqual(301);
  });

  it('description in resource', () => {
    const challenge = makeChallenge({ description: 'Weather data' });
    const result = challengeToPaymentRequired(challenge, '/test');
    expect(result.resource.description).toBe('Weather data');
  });
});

describe('paymentRequiredToChallenge', () => {
  it('converts full PaymentRequired', () => {
    const pr: CoinbasePaymentRequired = {
      x402Version: 1,
      resource: { url: '/weather', description: 'Weather data' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: {
            nonce: 'test-nonce',
            requestHash: 'a'.repeat(64),
          },
        },
      ],
    };
    const challenge = paymentRequiredToChallenge(pr);
    expect(challenge.version).toBe(1);
    expect(challenge.scheme).toBe('exact');
    expect(challenge.network).toBe('mock');
    expect(challenge.asset).toBe('USDC');
    expect(challenge.recipient).toBe('0xTEST');
  });

  it('extracts nonce from extra', () => {
    const pr: CoinbasePaymentRequired = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'extracted-nonce', requestHash: 'b'.repeat(64) },
        },
      ],
    };
    expect(paymentRequiredToChallenge(pr).nonce).toBe('extracted-nonce');
  });

  it('extracts requestHash from extra', () => {
    const pr: CoinbasePaymentRequired = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n', requestHash: 'c'.repeat(64) },
        },
      ],
    };
    expect(paymentRequiredToChallenge(pr).requestHash).toBe('c'.repeat(64));
  });

  it('maxTimeoutSeconds to expiresAt', () => {
    const pr: CoinbasePaymentRequired = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n', requestHash: 'a'.repeat(64) },
        },
      ],
    };
    const challenge = paymentRequiredToChallenge(pr);
    const expiresMs = new Date(challenge.expiresAt).getTime();
    const expectedMs = Date.now() + 300_000;
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(2000);
  });

  it('selects specific accept index', () => {
    const pr: CoinbasePaymentRequired = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xFIRST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n1', requestHash: 'a'.repeat(64) },
        },
        {
          scheme: 'exact',
          network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amount: '2000',
          payTo: '0xSECOND',
          maxTimeoutSeconds: 600,
          extra: { nonce: 'n2', requestHash: 'b'.repeat(64) },
        },
      ],
    };
    const challenge = paymentRequiredToChallenge(pr, 1);
    expect(challenge.recipient).toBe('0xSECOND');
    expect(challenge.network).toBe('base');
    expect(challenge.asset).toBe('USDC');
  });

  it('defaults to first accept', () => {
    const pr: CoinbasePaymentRequired = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xFIRST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n', requestHash: 'a'.repeat(64) },
        },
      ],
    };
    expect(paymentRequiredToChallenge(pr).recipient).toBe('0xFIRST');
  });
});

describe('coinbasePayloadToProofHeader', () => {
  it('decodes and re-encodes as toolkit', () => {
    const payload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: {
        scheme: 'exact',
        network: 'mock:1',
        asset: 'USDC',
        amount: '1000',
        payTo: '0xTEST',
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {
        signature: 'sig123',
        nonce: 'test-nonce',
        requestHash: 'a'.repeat(64),
        payer: 'mock://0x0001',
        timestamp: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-01-01T00:05:00.000Z',
      },
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const proofHeader = coinbasePayloadToProofHeader(encoded);

    const decoded = JSON.parse(Buffer.from(proofHeader, 'base64url').toString('utf8'));
    expect(decoded.signature).toBe('sig123');
    expect(decoded.nonce).toBe('test-nonce');
    expect(decoded.version).toBe(1);
  });

  it('extracts nonce from payload', () => {
    const payload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: {
        scheme: 'exact',
        network: 'mock:1',
        asset: 'USDC',
        amount: '1000',
        payTo: '0xTEST',
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {
        signature: 'sig',
        nonce: 'extracted-nonce',
        requestHash: 'b'.repeat(64),
        payer: 'mock://0x0001',
        timestamp: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-01-01T00:05:00.000Z',
      },
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const proofHeader = coinbasePayloadToProofHeader(encoded);
    const decoded = JSON.parse(Buffer.from(proofHeader, 'base64url').toString('utf8'));
    expect(decoded.nonce).toBe('extracted-nonce');
  });
});

describe('proofHeaderToCoinbasePayload', () => {
  it('encodes toolkit proof as Coinbase', () => {
    const proof = {
      version: 1,
      nonce: 'test-nonce',
      requestHash: 'a'.repeat(64),
      payer: 'mock://0x0001',
      timestamp: '2025-01-01T00:00:00.000Z',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      signature: 'sig123',
    };
    const proofHeader = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
    const challenge = makeChallenge();
    const coinbaseHeader = proofHeaderToCoinbasePayload(proofHeader, challenge);

    const decoded = JSON.parse(
      Buffer.from(coinbaseHeader, 'base64').toString('utf8'),
    ) as CoinbasePaymentPayload;
    expect(decoded.x402Version).toBe(1);
    expect(decoded.payload['signature']).toBe('sig123');
    expect(decoded.accepted.network).toBe('mock:1');
  });
});

describe('extractProofHeader', () => {
  it('finds X-Payment-Proof', () => {
    const result = extractProofHeader({ 'x-payment-proof': 'proof-data' });
    expect(result).toEqual({ proof: 'proof-data', format: 'toolkit' });
  });

  it('finds PAYMENT-SIGNATURE', () => {
    const result = extractProofHeader({ 'payment-signature': 'coinbase-data' });
    expect(result).toEqual({ proof: 'coinbase-data', format: 'coinbase' });
  });

  it('prefers X-Payment-Proof when both present', () => {
    const result = extractProofHeader({
      'x-payment-proof': 'toolkit-proof',
      'payment-signature': 'coinbase-proof',
    });
    expect(result).toEqual({ proof: 'toolkit-proof', format: 'toolkit' });
  });

  it('returns null when neither present', () => {
    const result = extractProofHeader({ 'content-type': 'application/json' });
    expect(result).toBeNull();
  });
});
