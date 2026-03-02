import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { createMemoInstruction } from '@solana/spl-memo';
import bs58 from 'bs58';
import {
  USDC_DEVNET_MINT,
  USDC_DECIMALS,
  DEFAULT_RPC_URL,
  DEFAULT_COMMITMENT,
} from './constants.js';

interface X402Challenge {
  version: number;
  nonce: string;
  expiresAt: string;
  requestHash: string;
  price: string;
  recipient: string;
}

interface RequestContext {
  url: string;
  method: string;
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

interface PayerInterface {
  pay(challenge: X402Challenge, context: RequestContext): Promise<PaymentProof>;
}

export interface SolanaUSDCPayerOptions {
  privateKey: string;
  rpcUrl?: string;
  commitment?: 'confirmed' | 'finalized';
  /**
   * USDC mint address. Defaults to USDC devnet mint.
   * Pass USDC_MAINNET_MINT (or the mint address string) for mainnet.
   */
  mintAddress?: PublicKey | string;
}

function loadKeypair(privateKey: string): Keypair {
  // Auto-detect: JSON array (Phantom / solana-keygen export) or base58 string
  const trimmed = privateKey.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function priceToMicroUnits(price: string): bigint {
  // Multiply decimal string by 10^USDC_DECIMALS using integer arithmetic
  const [intPart, fracPart = ''] = price.split('.');
  const frac = fracPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(intPart) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac);
}

export class SolanaUSDCPayer implements PayerInterface {
  private readonly keypair: Keypair;
  private readonly connection: Connection;
  private readonly commitment: 'confirmed' | 'finalized';
  private readonly mint: PublicKey;

  constructor(options: SolanaUSDCPayerOptions) {
    this.keypair = loadKeypair(options.privateKey);
    this.connection = new Connection(options.rpcUrl ?? DEFAULT_RPC_URL, options.commitment ?? DEFAULT_COMMITMENT);
    this.commitment = options.commitment ?? DEFAULT_COMMITMENT;
    this.mint = options.mintAddress instanceof PublicKey
      ? options.mintAddress
      : new PublicKey(options.mintAddress ?? USDC_DEVNET_MINT);
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  async pay(challenge: X402Challenge, _context: RequestContext): Promise<PaymentProof> {
    const { nonce, requestHash, expiresAt, version, price, recipient } = challenge;
    const amount = priceToMicroUnits(price);
    const recipientPubkey = new PublicKey(recipient);

    // Resolve payer's ATA — throw if not found
    const fromATA = getAssociatedTokenAddressSync(this.mint, this.keypair.publicKey);
    await getAccount(this.connection, fromATA).catch(() => {
      throw new Error(
        `Payer has no USDC token account. Create an ATA for ${this.keypair.publicKey.toBase58()} first.`,
      );
    });

    // Resolve recipient's ATA — throw if not found (recipient must pre-create it)
    const toATA = getAssociatedTokenAddressSync(this.mint, recipientPubkey);
    await getAccount(this.connection, toATA).catch(() => {
      throw new Error(
        `Recipient has no USDC token account. The recipient (${recipient}) must pre-create their USDC ATA before receiving payments.`,
      );
    });

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        fromATA,
        this.mint,
        toATA,
        this.keypair.publicKey,
        amount,
        USDC_DECIMALS,
      ),
      createMemoInstruction(`${nonce}|${requestHash}`),
    );

    const txSignature = await sendAndConfirmTransaction(this.connection, tx, [this.keypair], {
      commitment: this.commitment,
    });

    return {
      version,
      nonce,
      requestHash,
      payer: this.keypair.publicKey.toBase58(),
      timestamp: new Date().toISOString(),
      expiresAt,
      signature: txSignature,
    };
  }
}
