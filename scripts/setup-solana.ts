/**
 * setup-solana.ts — verify Solana balances and ATA readiness before running the demo.
 *
 * Usage:
 *   SOLANA_PRIVATE_KEY=<key> RECIPIENT_WALLET=<pubkey> pnpm exec tsx scripts/setup-solana.ts
 *
 * Environment variables:
 *   SOLANA_PRIVATE_KEY   base58 or JSON-array private key (required)
 *   RECIPIENT_WALLET     base58 Solana public key (optional — skips recipient check if absent)
 *   SOLANA_CLUSTER       devnet (default) | mainnet
 *   SOLANA_RPC_URL       override RPC endpoint
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  USDC_DEVNET_MINT,
  USDC_MAINNET_MINT,
  DEFAULT_RPC_URL,
  DEFAULT_MAINNET_RPC_URL,
} from '../packages/x402-adapters/src/solana/constants.js';

const SOLANA_CLUSTER = process.env['SOLANA_CLUSTER'] ?? 'devnet';
const isMainnet = SOLANA_CLUSTER === 'mainnet';
const mint = isMainnet ? USDC_MAINNET_MINT : USDC_DEVNET_MINT;
const defaultRpc = isMainnet ? DEFAULT_MAINNET_RPC_URL : DEFAULT_RPC_URL;
const RPC_URL = process.env['SOLANA_RPC_URL'] ?? defaultRpc;
const connection = new Connection(RPC_URL, 'confirmed');

function loadKeypairFromEnv(): Keypair {
  const raw = process.env['SOLANA_PRIVATE_KEY'];
  if (!raw) {
    throw new Error('SOLANA_PRIVATE_KEY env var is not set');
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

async function checkWallet(label: string, pubkey: PublicKey): Promise<void> {
  console.log(`\n── ${label}: ${pubkey.toBase58()} ──`);

  const lamports = await connection.getBalance(pubkey);
  const sol = lamports / LAMPORTS_PER_SOL;
  console.log(`  SOL balance : ${sol.toFixed(4)} SOL`);
  if (sol < 0.01) {
    if (isMainnet) {
      console.log(`  ⚠️  Low SOL — fund this wallet with real SOL for transaction fees`);
    } else {
      console.log(`  ⚠️  Low SOL — request an airdrop:`);
      console.log(`      solana airdrop 2 ${pubkey.toBase58()} --url devnet`);
    }
  }

  const ata = getAssociatedTokenAddressSync(mint, pubkey);
  console.log(`  USDC ATA    : ${ata.toBase58()}`);
  try {
    const account = await getAccount(connection, ata);
    const usdcAmount = Number(account.amount) / 1_000_000;
    console.log(`  USDC balance: ${usdcAmount.toFixed(6)} USDC`);
    if (usdcAmount === 0) {
      if (isMainnet) {
        console.log(`  ⚠️  No USDC — transfer real USDC to this wallet from an exchange`);
      } else {
        console.log(`  ⚠️  No USDC — get devnet USDC from: https://faucet.circle.com`);
      }
    }
  } catch {
    console.log(`  ❌ No USDC token account found`);
    console.log(`  ℹ️  Create the ATA:`);
    console.log(`      spl-token create-account ${mint.toBase58()} \\`);
    console.log(`        --owner ${pubkey.toBase58()} --url ${isMainnet ? 'mainnet-beta' : 'devnet'}`);
    if (!isMainnet) {
      console.log(`      Then get devnet USDC from: https://faucet.circle.com`);
    }
  }
}

console.log(`\nSolana ${SOLANA_CLUSTER} setup check`);
console.log(`RPC: ${RPC_URL}`);

let payerKey: Keypair;
try {
  payerKey = loadKeypairFromEnv();
} catch (err) {
  console.error(`\n❌ ${(err as Error).message}`);
  process.exit(1);
}

await checkWallet('Payer (client)', payerKey.publicKey);

const recipientEnv = process.env['RECIPIENT_WALLET'];
if (recipientEnv) {
  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(recipientEnv);
  } catch {
    console.error(`\n❌ RECIPIENT_WALLET is not a valid base58 public key: ${recipientEnv}`);
    process.exit(1);
  }
  await checkWallet('Recipient (server)', recipientPubkey);
} else {
  console.log(`\n⚠️  RECIPIENT_WALLET not set — skipping recipient check`);
}

console.log('\n✅ Setup check complete\n');
