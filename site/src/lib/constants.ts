import { PublicKey } from '@solana/web3.js';

export const USDC_DEVNET_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const demoServerUrl = (import.meta.env.VITE_DEMO_SERVER_URL ?? '').trim();
export const DEMO_SERVER_URL: string = demoServerUrl;
export const HAS_DEMO_SERVER_URL = demoServerUrl.length > 0;
