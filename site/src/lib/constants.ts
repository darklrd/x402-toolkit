import { PublicKey } from '@solana/web3.js';

export const USDC_DEVNET_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const demoServerUrl = import.meta.env['VITE_DEMO_SERVER_URL'];
if (!demoServerUrl) throw new Error('VITE_DEMO_SERVER_URL is not set');
export const DEMO_SERVER_URL: string = demoServerUrl;
