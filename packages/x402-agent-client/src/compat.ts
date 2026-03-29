import type { X402Challenge, PaymentProof } from './types.js';

export interface CoinbasePaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, string>;
  }>;
  extensions?: Record<string, string>;
}

const CAIP2_TO_NETWORK: Record<string, string> = {
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  'eip155:1': 'ethereum',
  'eip155:137': 'polygon',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'solana',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'solana-devnet',
  'mock:1': 'mock',
};

const NETWORK_TO_CAIP2: Record<string, string> = Object.fromEntries(
  Object.entries(CAIP2_TO_NETWORK).map(([k, v]) => [v, k]),
);

const REVERSE_ASSET_MAP: Record<string, Record<string, string>> = {
  'eip155:8453': {
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 'USDC',
  },
  'eip155:84532': {
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e': 'USDC',
  },
  'mock:1': {
    'USDC': 'USDC',
    'MOCK': 'MOCK',
  },
};

const ASSET_MAP: Record<string, Record<string, string>> = {
  'eip155:8453': {
    'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  'eip155:84532': {
    'USDC': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  'mock:1': {
    'USDC': 'USDC',
    'MOCK': 'MOCK',
  },
};

function atomicUnitsToHumanDecimal(amount: string, decimals: number): string {
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  return `${intPart}.${fracPart}`;
}

function humanDecimalToAtomicUnits(price: string, decimals: number): string {
  const dotIndex = price.indexOf('.');
  if (dotIndex === -1) {
    return (BigInt(price) * BigInt(10) ** BigInt(decimals)).toString();
  }
  const intPart = price.slice(0, dotIndex);
  let fracPart = price.slice(dotIndex + 1);
  if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  } else {
    fracPart = fracPart.padEnd(decimals, '0');
  }
  const combined = (intPart === '' || intPart === '0' ? '' : intPart) + fracPart;
  return BigInt(combined === '' ? '0' : combined).toString();
}

export function detectChallengeFormat(
  response: Response,
): 'toolkit' | 'coinbase' | 'unknown' {
  if (response.headers.get('payment-required')) {
    return 'coinbase';
  }
  return 'unknown';
}

export function parseCoinbasePaymentRequired(
  headerValue: string,
): X402Challenge | null {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    const pr = JSON.parse(decoded) as CoinbasePaymentRequired;
    if (!pr.accepts || pr.accepts.length === 0) return null;

    const req = pr.accepts[0];
    const network = CAIP2_TO_NETWORK[req.network] ?? req.network;
    const asset = REVERSE_ASSET_MAP[req.network]?.[req.asset] ?? req.asset;
    const price = atomicUnitsToHumanDecimal(req.amount, 6);
    const expiresAt = new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString();

    return {
      version: 1,
      scheme: req.scheme,
      price,
      asset,
      network,
      recipient: req.payTo,
      nonce: req.extra['nonce'] ?? '',
      expiresAt,
      requestHash: req.extra['requestHash'] ?? '',
      description: pr.resource.description,
    };
  } catch {
    return null;
  }
}

export function encodeCoinbasePaymentSignature(
  proof: PaymentProof,
  challenge: X402Challenge,
): string {
  const caip2 = NETWORK_TO_CAIP2[challenge.network] ?? challenge.network;
  const assetAddress = ASSET_MAP[caip2]?.[challenge.asset] ?? challenge.asset;
  const amount = humanDecimalToAtomicUnits(challenge.price, 6);
  const expiresMs = new Date(challenge.expiresAt).getTime();
  const nowMs = Date.now();
  const maxTimeoutSeconds = Math.max(0, Math.round((expiresMs - nowMs) / 1000));

  const extra: Record<string, string> = {};
  if (challenge.nonce) extra['nonce'] = challenge.nonce;
  if (challenge.requestHash) extra['requestHash'] = challenge.requestHash;

  const payload = {
    x402Version: 1,
    accepted: {
      scheme: challenge.scheme,
      network: caip2,
      asset: assetAddress,
      amount,
      payTo: challenge.recipient,
      maxTimeoutSeconds,
      extra,
    },
    payload: {
      signature: proof.signature,
      nonce: proof.nonce,
      requestHash: proof.requestHash,
      payer: proof.payer,
      timestamp: proof.timestamp,
      expiresAt: proof.expiresAt,
    },
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}
