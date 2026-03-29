import type { X402Challenge } from './types.js';

export type WireFormat = 'toolkit' | 'coinbase' | 'dual';

export interface CoinbaseResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface CoinbasePaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, string>;
}

export interface CoinbasePaymentRequired {
  x402Version: number;
  error?: string;
  resource: CoinbaseResourceInfo;
  accepts: CoinbasePaymentRequirements[];
  extensions?: Record<string, string>;
}

export interface CoinbasePaymentPayload {
  x402Version: number;
  resource?: CoinbaseResourceInfo;
  accepted: CoinbasePaymentRequirements;
  payload: Record<string, string>;
  extensions?: Record<string, string>;
}

const NETWORK_TO_CAIP2: Record<string, string> = {
  'base': 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  'ethereum': 'eip155:1',
  'polygon': 'eip155:137',
  'solana': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'solana-devnet': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  'mock': 'mock:1',
};

const CAIP2_TO_NETWORK: Record<string, string> = Object.fromEntries(
  Object.entries(NETWORK_TO_CAIP2).map(([k, v]) => [v, k]),
);

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

const REVERSE_ASSET_MAP: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(ASSET_MAP).map(([network, assets]) => [
    network,
    Object.fromEntries(Object.entries(assets).map(([sym, addr]) => [addr, sym])),
  ]),
);

export function toolkitNetworkToCaip2(network: string): string {
  return NETWORK_TO_CAIP2[network] ?? network;
}

export function caip2ToToolkitNetwork(caip2: string): string {
  return CAIP2_TO_NETWORK[caip2] ?? caip2;
}

export function toolkitAssetToAddress(asset: string, caip2Network: string): string {
  return ASSET_MAP[caip2Network]?.[asset] ?? asset;
}

export function addressToToolkitAsset(address: string, caip2Network: string): string {
  return REVERSE_ASSET_MAP[caip2Network]?.[address] ?? address;
}

export function humanDecimalToAtomicUnits(price: string, decimals: number): string {
  const dotIndex = price.indexOf('.');
  if (dotIndex === -1) {
    return BigInt(price) * BigInt(10) ** BigInt(decimals) + '';
  }
  const intPart = price.slice(0, dotIndex);
  let fracPart = price.slice(dotIndex + 1);
  if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  } else {
    fracPart = fracPart.padEnd(decimals, '0');
  }
  const combined = (intPart === '' || intPart === '0' ? '' : intPart) + fracPart;
  const result = BigInt(combined === '' ? '0' : combined);
  return result.toString();
}

export function atomicUnitsToHumanDecimal(amount: string, decimals: number): string {
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  return `${intPart}.${fracPart}`;
}

export function challengeToPaymentRequired(
  challenge: X402Challenge,
  requestUrl: string,
  assetDecimals: number = 6,
): CoinbasePaymentRequired {
  const caip2 = toolkitNetworkToCaip2(challenge.network);
  const assetAddress = toolkitAssetToAddress(challenge.asset, caip2);
  const amount = humanDecimalToAtomicUnits(challenge.price, assetDecimals);

  const expiresMs = new Date(challenge.expiresAt).getTime();
  const nowMs = Date.now();
  const maxTimeoutSeconds = Math.max(0, Math.round((expiresMs - nowMs) / 1000));

  const extra: Record<string, string> = {};
  if (challenge.nonce) extra['nonce'] = challenge.nonce;
  if (challenge.requestHash) extra['requestHash'] = challenge.requestHash;

  const resource: CoinbaseResourceInfo = { url: requestUrl };
  if (challenge.description) resource.description = challenge.description;

  return {
    x402Version: 1,
    error: 'Payment Required',
    resource,
    accepts: [
      {
        scheme: challenge.scheme,
        network: caip2,
        asset: assetAddress,
        amount,
        payTo: challenge.recipient,
        maxTimeoutSeconds,
        extra,
      },
    ],
  };
}

export function paymentRequiredToChallenge(
  paymentRequired: CoinbasePaymentRequired,
  requirementIndex: number = 0,
): X402Challenge {
  const req = paymentRequired.accepts[requirementIndex];
  const network = caip2ToToolkitNetwork(req.network);
  const asset = addressToToolkitAsset(req.asset, req.network);
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
    description: paymentRequired.resource.description,
  };
}

export function coinbasePayloadToProofHeader(payloadHeader: string): string {
  const decoded = Buffer.from(payloadHeader, 'base64').toString('utf8');
  const payload = JSON.parse(decoded) as CoinbasePaymentPayload;

  const proof = {
    version: payload.x402Version,
    nonce: payload.payload['nonce'] ?? '',
    requestHash: payload.payload['requestHash'] ?? '',
    payer: payload.payload['payer'] ?? '',
    timestamp: payload.payload['timestamp'] ?? '',
    expiresAt: payload.payload['expiresAt'] ?? '',
    signature: payload.payload['signature'] ?? '',
  };

  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

export function proofHeaderToCoinbasePayload(
  proofHeader: string,
  challenge: X402Challenge,
  assetDecimals: number = 6,
): string {
  const decoded = Buffer.from(proofHeader, 'base64url').toString('utf8');
  const proof = JSON.parse(decoded) as {
    version: number;
    nonce: string;
    requestHash: string;
    payer: string;
    timestamp: string;
    expiresAt: string;
    signature: string;
  };

  const caip2 = toolkitNetworkToCaip2(challenge.network);
  const assetAddress = toolkitAssetToAddress(challenge.asset, caip2);
  const amount = humanDecimalToAtomicUnits(challenge.price, assetDecimals);
  const expiresMs = new Date(challenge.expiresAt).getTime();
  const nowMs = Date.now();
  const maxTimeoutSeconds = Math.max(0, Math.round((expiresMs - nowMs) / 1000));

  const extra: Record<string, string> = {};
  if (challenge.nonce) extra['nonce'] = challenge.nonce;
  if (challenge.requestHash) extra['requestHash'] = challenge.requestHash;

  const coinbasePayload: CoinbasePaymentPayload = {
    x402Version: proof.version,
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

  return Buffer.from(JSON.stringify(coinbasePayload), 'utf8').toString('base64');
}

export function extractProofHeader(
  headers: Record<string, string | string[] | undefined>,
): { proof: string; format: 'toolkit' | 'coinbase' } | null {
  const toolkitProof = headers['x-payment-proof'];
  if (toolkitProof) {
    const value = Array.isArray(toolkitProof) ? toolkitProof[0] : toolkitProof;
    if (value) return { proof: value, format: 'toolkit' };
  }

  const coinbaseProof = headers['payment-signature'];
  if (coinbaseProof) {
    const value = Array.isArray(coinbaseProof) ? coinbaseProof[0] : coinbaseProof;
    if (value) return { proof: value, format: 'coinbase' };
  }

  return null;
}
