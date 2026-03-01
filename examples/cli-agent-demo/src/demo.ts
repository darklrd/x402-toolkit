/**
 * cli-agent-demo — shows the full 402 → pay → retry flow in the terminal.
 *
 * Run (after starting paid-weather-tool server):
 *   pnpm --filter cli-agent-demo start
 *
 * Or start everything at once:
 *   pnpm dev
 *
 * Environment variables:
 *   PAYMENT_MODE=mock    (default) — use MockPayer with MOCK_SECRET
 *   PAYMENT_MODE=solana            — use SolanaUSDCPayer; requires SOLANA_PRIVATE_KEY
 *   MOCK_SECRET          shared HMAC secret (mock mode only)
 *   SOLANA_PRIVATE_KEY   base58 or JSON-array private key (solana mode only)
 *   SOLANA_RPC_URL       override Solana RPC endpoint (solana mode only)
 */
import { x402Fetch, createTool } from 'x402-agent-client';
import { MockPayer } from 'x402-adapters';
import { SolanaUSDCPayer } from 'x402-adapters/solana';

const BASE_URL = process.env['SERVER_URL'] ?? 'http://127.0.0.1:3000';
const PAYMENT_MODE = process.env['PAYMENT_MODE'] ?? 'mock';

function buildPayer(): MockPayer | SolanaUSDCPayer {
  if (PAYMENT_MODE === 'solana') {
    const privateKey = process.env['SOLANA_PRIVATE_KEY'];
    if (!privateKey) {
      throw new Error('SOLANA_PRIVATE_KEY env var is required when PAYMENT_MODE=solana');
    }
    const payer = new SolanaUSDCPayer({
      privateKey,
      rpcUrl: process.env['SOLANA_RPC_URL'],
    });
    console.log(`[solana] Payer wallet: ${payer.publicKey.toBase58()}\n`);
    return payer;
  }

  return new MockPayer({ secret: process.env['MOCK_SECRET'] ?? 'mock-secret' });
}

const payer = buildPayer();

function divider(title: string) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

// ── Demo 1: Manual x402Fetch ──────────────────────────────────────────────────
divider('Demo 1 — x402Fetch (manual 402 → pay → retry)');

{
  const city = 'London';
  const url = `${BASE_URL}/weather?city=${encodeURIComponent(city)}`;

  console.log(`\n→ GET ${url}`);
  console.log('  (no payment proof — expecting 402…)');

  const response = await x402Fetch(url, {}, { payer, maxRetries: 1 });

  if (response.ok) {
    const data = await response.json();
    console.log('\n✅ Payment accepted — response:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    const body = await response.text();
    console.error(`\n❌ Unexpected ${response.status}:`, body);
    process.exit(1);
  }
}

// ── Demo 2: createTool agent wrapper ─────────────────────────────────────────
divider('Demo 2 — createTool (agent-friendly wrapper)');

const weatherTool = createTool({
  name: 'get_weather',
  description: 'Fetch current weather for a city (priced: 0.001 USDC)',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name (e.g. Paris, Tokyo)' },
    },
    required: ['city'],
  },
  endpoint: `${BASE_URL}/weather`,
  method: 'GET',
  fetchOptions: { payer, maxRetries: 1 },
});

const cities = ['Paris', 'Tokyo', 'Sydney'];
for (const city of cities) {
  console.log(`\n→ weatherTool.invoke({ city: '${city}' })`);
  const result = await weatherTool.invoke({ city });

  if (result.ok) {
    const d = result.data as { temp: number; condition: string; humidity: number };
    console.log(`✅ ${city}: ${d.temp}°C, ${d.condition}, humidity ${d.humidity}%`);
  } else {
    console.error(`❌ Failed for ${city}:`, result);
  }
}

// ── Demo 3: Idempotency ───────────────────────────────────────────────────────
divider('Demo 3 — Idempotency-Key header');

{
  const city = 'New York';
  const idemKey = `demo-idem-${Date.now()}`;
  const url = `${BASE_URL}/weather?city=${encodeURIComponent(city)}`;

  console.log(`\n→ First call with Idempotency-Key: ${idemKey}`);
  const r1 = await x402Fetch(
    url,
    { headers: { 'idempotency-key': idemKey } },
    { payer, maxRetries: 1 },
  );
  const d1 = await r1.json() as { city: string; temp: number };
  console.log(`✅ Response (status ${r1.status}): ${d1.city} ${d1.temp}°C`);
  console.log(`   x-idempotent-replay: ${r1.headers.get('x-idempotent-replay') ?? 'false'}`);

  console.log(`\n→ Second call with same Idempotency-Key (should replay, no new charge)`);
  const r2 = await x402Fetch(
    url,
    { headers: { 'idempotency-key': idemKey } },
    { payer, maxRetries: 1 },
  );
  const d2 = await r2.json() as { city: string; temp: number };
  console.log(`✅ Response (status ${r2.status}): ${d2.city} ${d2.temp}°C`);
  console.log(`   x-idempotent-replay: ${r2.headers.get('x-idempotent-replay') ?? 'false'}`);
}

divider('All demos passed ✅');
console.log('');
