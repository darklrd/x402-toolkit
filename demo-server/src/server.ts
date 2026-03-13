import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { SolanaUSDCVerifier } from 'x402-adapters/solana';
import { weatherHandler, priceHandler } from './tools.js';

const RECIPIENT = process.env.RECIPIENT_WALLET ?? '';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const PORT = parseInt(process.env.PORT ?? '3402', 10);

if (!RECIPIENT) {
  console.error('RECIPIENT_WALLET env var is required');
  process.exit(1);
}

const verifier = new SolanaUSDCVerifier({ rpcUrl: RPC_URL });

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: ['https://darklrd.github.io', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-payment-proof', 'idempotency-key'],
  exposedHeaders: ['x-payment-proof'],
});

await fastify.register(createX402Middleware({ verifier }));

const pricing = {
  price: '0.001',
  asset: 'USDC',
  recipient: RECIPIENT,
  network: 'solana-devnet',
};

fastify.route(
  pricedRoute({
    method: 'GET',
    url: '/weather',
    pricing,
    handler: weatherHandler,
  }),
);

fastify.route(
  pricedRoute({
    method: 'GET',
    url: '/price',
    pricing,
    handler: priceHandler,
  }),
);

fastify.get('/health', async () => ({ status: 'ok' }));

await fastify.listen({ port: PORT, host: '0.0.0.0' });
