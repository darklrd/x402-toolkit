import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { USDC_DEVNET_MINT, USDC_DECIMALS, MEMO_PROGRAM_ID } from './constants';

export interface X402Challenge {
  version: number;
  nonce: string;
  expiresAt: string;
  requestHash: string;
  price: string;
  recipient: string;
}

export interface PaymentProof {
  version: number;
  nonce: string;
  requestHash: string;
  payer: string;
  timestamp: string;
  expiresAt: string;
  signature: string;
}

export interface RequestContext {
  url: string;
  method: string;
}

interface WalletAdapter {
  publicKey: PublicKey | null;
  signTransaction: (<T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>) | undefined;
}

function priceToMicroUnits(price: string): bigint {
  const [intPart, fracPart = ''] = price.split('.');
  const frac = fracPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(intPart) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac);
}

function createMemoInstruction(memo: string): TransactionInstruction {
  const encoded = new TextEncoder().encode(memo);
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(encoded),
  });
}

export class BrowserSolanaUSDCPayer {
  constructor(
    private readonly wallet: WalletAdapter,
    private readonly connection: Connection,
  ) {}

  async pay(challenge: X402Challenge, _context: RequestContext): Promise<PaymentProof> {
    const pubkey = this.wallet.publicKey;
    if (!pubkey) throw new Error('Wallet not connected');
    if (!this.wallet.signTransaction) throw new Error('Wallet does not support signTransaction');

    const { nonce, requestHash, expiresAt, version, price, recipient } = challenge;
    const amount = priceToMicroUnits(price);
    const recipientPubkey = new PublicKey(recipient);

    const fromATA = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, pubkey);
    const toATA = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, recipientPubkey);

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        fromATA,
        USDC_DEVNET_MINT,
        toATA,
        pubkey,
        amount,
        USDC_DECIMALS,
      ),
      createMemoInstruction(`${nonce}|${requestHash}`),
    );

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = pubkey;

    const signed = await this.wallet.signTransaction(tx);
    const rawTx = signed.serialize();
    const signature = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    return {
      version,
      nonce,
      requestHash,
      payer: pubkey.toBase58(),
      timestamp: new Date().toISOString(),
      expiresAt,
      signature,
    };
  }
}
