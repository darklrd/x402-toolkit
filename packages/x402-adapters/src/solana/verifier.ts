import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  USDC_DEVNET_MINT,
  USDC_DECIMALS,
  DEFAULT_RPC_URL,
  DEFAULT_COMMITMENT,
  MEMO_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
} from './constants.js';

interface PricingConfig {
  price: string;
  asset: string;
  recipient: string;
  network?: string;
}

interface VerifierInterface {
  verify(proofHeader: string, requestHash: string, pricing: PricingConfig): Promise<boolean>;
}

interface PaymentProof {
  version: number;
  nonce: string;
  requestHash: string;
  payer: string;
  timestamp: string;
  expiresAt: string;
  signature: string;
}

// Typed shape of a parsed SPL token transferChecked instruction
interface ParsedTransferChecked {
  type: 'transferChecked';
  info: {
    authority: string;
    destination: string;
    mint: string;
    source: string;
    tokenAmount: {
      amount: string;
      decimals: number;
    };
  };
}

export interface SolanaUSDCVerifierOptions {
  rpcUrl?: string;
  commitment?: 'confirmed' | 'finalized';
  amountTolerance?: bigint;
}

function priceToMicroUnits(price: string): bigint {
  const [intPart, fracPart = ''] = price.split('.');
  const frac = fracPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(intPart) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac);
}

function isTransferCheckedParsed(parsed: unknown): parsed is ParsedTransferChecked {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  if (p['type'] !== 'transferChecked') return false;
  const info = p['info'];
  if (typeof info !== 'object' || info === null) return false;
  const i = info as Record<string, unknown>;
  return (
    typeof i['destination'] === 'string' &&
    typeof i['mint'] === 'string' &&
    typeof i['authority'] === 'string' &&
    typeof i['source'] === 'string' &&
    typeof i['tokenAmount'] === 'object' &&
    i['tokenAmount'] !== null &&
    typeof (i['tokenAmount'] as Record<string, unknown>)['amount'] === 'string'
  );
}

export class SolanaUSDCVerifier implements VerifierInterface {
  private readonly connection: Connection;
  private readonly commitment: 'confirmed' | 'finalized';
  private readonly amountTolerance: bigint;

  constructor(options: SolanaUSDCVerifierOptions = {}) {
    this.connection = new Connection(options.rpcUrl ?? DEFAULT_RPC_URL, options.commitment ?? DEFAULT_COMMITMENT);
    this.commitment = options.commitment ?? DEFAULT_COMMITMENT;
    this.amountTolerance = options.amountTolerance ?? 0n;
  }

  async verify(proofHeader: string, requestHash: string, pricing: PricingConfig): Promise<boolean> {
    let proof: PaymentProof;
    try {
      const decoded = Buffer.from(proofHeader, 'base64url').toString('utf8');
      proof = JSON.parse(decoded) as PaymentProof;
    } catch {
      return false;
    }

    // Basic sanity checks
    if (proof.requestHash !== requestHash) return false;
    const expiry = new Date(proof.expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) return false;
    if (proof.version !== 1) return false;

    // Fetch the on-chain transaction
    let tx: Awaited<ReturnType<Connection['getParsedTransaction']>>;
    try {
      tx = await this.connection.getParsedTransaction(proof.signature, {
        commitment: this.commitment,
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      return false;
    }

    if (!tx) return false;

    const instructions = tx.transaction.message.instructions;
    const expectedAmount = priceToMicroUnits(pricing.price);

    // Derive expected recipient ATA to compare against transfer destination
    let expectedRecipientATA: PublicKey;
    try {
      expectedRecipientATA = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, new PublicKey(pricing.recipient));
    } catch {
      return false;
    }

    let transferOk = false;
    let memoOk = false;

    for (const ix of instructions) {
      // Check for SPL token transferChecked
      if (ix.programId.equals(SPL_TOKEN_PROGRAM_ID) && 'parsed' in ix) {
        const parsed: unknown = ix.parsed;
        if (isTransferCheckedParsed(parsed)) {
          const { mint, destination, tokenAmount } = parsed.info;
          if (
            mint === USDC_DEVNET_MINT.toBase58() &&
            destination === expectedRecipientATA.toBase58() &&
            BigInt(tokenAmount.amount) >= expectedAmount - this.amountTolerance
          ) {
            transferOk = true;
          }
        }
      }

      // Check for Memo instruction
      if (ix.programId.equals(MEMO_PROGRAM_ID) && 'parsed' in ix) {
        const parsed: unknown = ix.parsed;
        if (typeof parsed === 'string' && parsed === `${proof.nonce}|${proof.requestHash}`) {
          memoOk = true;
        }
      }
    }

    if (!transferOk || !memoOk) return false;

    // Check tx blockTime is within the challenge window and not stale
    const blockTime = tx.blockTime;
    if (blockTime === null || blockTime === undefined) return false;

    const expiresAtSec = expiry.getTime() / 1000;
    if (blockTime > expiresAtSec) return false;

    const MAX_AGE_SECONDS = 600;
    if (blockTime < Date.now() / 1000 - MAX_AGE_SECONDS) return false;

    return true;
  }
}
