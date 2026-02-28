/**
 * quick_eval.ts — performance and reliability eval
 *
 * Spins up the paid-weather-tool server, fires 50 mixed requests
 * (paid + free + idempotent), asserts >99% success rate, and prints
 * basic latency statistics.
 *
 * Run: npx tsx evals/quick_eval.ts
 */
import Fastify from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { x402Fetch } from 'x402-agent-client';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'eval-secret';
const TOTAL_CALLS = 50;

// ── Build server ──────────────────────────────────────────────────────────────

const fastify = Fastify({ logger: false });

fastify.register(
  createX402Middleware({
    verifier: new MockVerifier({ secret: SECRET }),
  }),
);

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.route(
  pricedRoute({
    method: 'GET',
    url: '/weather',
    pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: '0xEVAL' },
    handler: async (req) => {
      const { city } = req.query as { city: string };
      return { city, temp: Math.round(Math.random() * 30), unit: 'celsius' };
    },
  }),
);

await fastify.listen({ port: 0, host: '127.0.0.1' });
const addr = fastify.server.address() as { port: number };
const BASE_URL = `http://127.0.0.1:${addr.port}`;

const payer = new MockPayer({ secret: SECRET });

// ── Run eval ──────────────────────────────────────────────────────────────────

interface CallResult {
  type: 'paid' | 'free' | 'idempotent';
  status: number;
  ok: boolean;
  latencyMs: number;
}

const results: CallResult[] = [];
const cities = ['London', 'Paris', 'Tokyo', 'Sydney', 'Berlin'];

async function call(type: CallResult['type'], url: string, init: RequestInit = {}): Promise<CallResult> {
  const t0 = performance.now();
  let status = 0;
  let ok = false;

  try {
    const res = await x402Fetch(url, init, { payer, maxRetries: 1 });
    status = res.status;
    ok = res.ok;
  } catch (e) {
    console.error(`  [error] ${type}:`, e);
  }

  const latencyMs = performance.now() - t0;
  return { type, status, ok, latencyMs };
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  x402 Quick Eval — ${TOTAL_CALLS} calls`);
console.log(`  Server: ${BASE_URL}`);
console.log(`${'═'.repeat(60)}\n`);

// Mix: 30 paid, 10 free health checks, 10 idempotent
const tasks: Array<() => Promise<CallResult>> = [];

// 30 paid weather calls
for (let i = 0; i < 30; i++) {
  const city = cities[i % cities.length]!;
  tasks.push(() => call('paid', `${BASE_URL}/weather?city=${city}`));
}

// 10 free health checks (no payment needed)
for (let i = 0; i < 10; i++) {
  tasks.push(async () => {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/health`);
    return { type: 'free' as const, status: res.status, ok: res.ok, latencyMs: performance.now() - t0 };
  });
}

// 10 idempotent calls (5 pairs)
for (let i = 0; i < 5; i++) {
  const key = `eval-idem-${i}`;
  const city = cities[i % cities.length]!;
  const url = `${BASE_URL}/weather?city=${city}`;
  tasks.push(() => call('idempotent', url, { headers: { 'idempotency-key': key } }));
  tasks.push(() => call('idempotent', url, { headers: { 'idempotency-key': key } }));
}

// Shuffle and run all concurrently in batches of 10 to avoid port exhaustion
function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

const shuffled = shuffle(tasks);
const BATCH = 10;
for (let i = 0; i < shuffled.length; i += BATCH) {
  const batch = shuffled.slice(i, i + BATCH);
  const batchResults = await Promise.all(batch.map((fn) => fn()));
  results.push(...batchResults);
  process.stdout.write(`.`);
}

console.log('\n');

// ── Statistics ─────────────────────────────────────────────────────────────────

const total = results.length;
const successes = results.filter((r) => r.ok).length;
const failures = total - successes;
const successRate = (successes / total) * 100;

const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length * 0.5)]!;
const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
const p99 = latencies[Math.floor(latencies.length * 0.99)]!;
const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

const byType = {
  paid: results.filter((r) => r.type === 'paid'),
  free: results.filter((r) => r.type === 'free'),
  idempotent: results.filter((r) => r.type === 'idempotent'),
};

console.log(`Results:`);
console.log(`  Total calls    : ${total}`);
console.log(`  Successes      : ${successes} (${successRate.toFixed(1)}%)`);
console.log(`  Failures       : ${failures}`);
console.log();
console.log(`By type:`);
console.log(`  Paid           : ${byType.paid.filter((r) => r.ok).length}/${byType.paid.length} OK`);
console.log(`  Free           : ${byType.free.filter((r) => r.ok).length}/${byType.free.length} OK`);
console.log(`  Idempotent     : ${byType.idempotent.filter((r) => r.ok).length}/${byType.idempotent.length} OK`);
console.log();
console.log(`Latency (ms):`);
console.log(`  avg            : ${avg.toFixed(1)}`);
console.log(`  p50            : ${p50.toFixed(1)}`);
console.log(`  p95            : ${p95.toFixed(1)}`);
console.log(`  p99            : ${p99.toFixed(1)}`);

const REQUIRED_SUCCESS_RATE = 99;
if (successRate < REQUIRED_SUCCESS_RATE) {
  console.error(`\n❌ EVAL FAILED: success rate ${successRate.toFixed(1)}% < ${REQUIRED_SUCCESS_RATE}%`);
  if (failures > 0) {
    console.error('Failed calls:');
    results.filter((r) => !r.ok).forEach((r) => {
      console.error(`  type=${r.type} status=${r.status} latency=${r.latencyMs.toFixed(1)}ms`);
    });
  }
  await fastify.close();
  process.exit(1);
} else {
  console.log(`\n✅ EVAL PASSED: ${successRate.toFixed(1)}% success rate (required ≥${REQUIRED_SUCCESS_RATE}%)`);
}

await fastify.close();
