/**
 * paid-weather-tool — example Fastify server with priced /weather endpoint
 *
 * Run: pnpm --filter paid-weather-tool dev
 *
 * Endpoints:
 *   GET /health          — health check (no payment required)
 *   GET /weather?city=… — priced: requires X-Payment-Proof header
 */
import Fastify from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { MockVerifier } from 'x402-adapters';

// Shared secret — must match MockPayer secret used by the client.
const MOCK_SECRET = process.env['MOCK_SECRET'] ?? 'mock-secret';
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '127.0.0.1';

// Mock weather data — simulates an expensive API call.
const WEATHER_DATA: Record<string, { temp: number; condition: string; humidity: number }> = {
  london: { temp: 15, condition: 'Cloudy', humidity: 72 },
  paris: { temp: 18, condition: 'Sunny', humidity: 55 },
  'new york': { temp: 22, condition: 'Partly Cloudy', humidity: 60 },
  tokyo: { temp: 26, condition: 'Humid', humidity: 85 },
  sydney: { temp: 20, condition: 'Clear', humidity: 50 },
};

async function build() {
  const fastify = Fastify({ logger: { level: 'info' } });

  // ── Register x402 middleware ──────────────────────────────────────────────
  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: MOCK_SECRET }),
    }),
  );

  // ── Health endpoint (free) ────────────────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Priced weather endpoint ───────────────────────────────────────────────
  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: {
        price: '0.001',
        asset: 'USDC',
        network: 'mock',
        recipient: '0x0000000000000000000000000000000000000002',
        description: 'Current weather data for the requested city',
        ttlSeconds: 300,
      },
      schema: {
        querystring: {
          type: 'object',
          required: ['city'],
          properties: {
            city: { type: 'string', description: 'City name' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              temp: { type: 'number' },
              condition: { type: 'string' },
              humidity: { type: 'number' },
              unit: { type: 'string' },
            },
          },
        },
      },
      handler: async (request, reply) => {
        const { city } = request.query as { city: string };
        const key = city.toLowerCase();
        const data = WEATHER_DATA[key];

        if (!data) {
          reply.code(404).send({
            error: 'City not found',
            availableCities: Object.keys(WEATHER_DATA),
          });
          return;
        }

        return {
          city: city.charAt(0).toUpperCase() + city.slice(1),
          temp: data.temp,
          condition: data.condition,
          humidity: data.humidity,
          unit: 'celsius',
        };
      },
    }),
  );

  return fastify;
}

// Start server when run directly.
const app = await build();
try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n✅ paid-weather-tool running at http://${HOST}:${PORT}`);
  console.log(`   GET /health        — free`);
  console.log(`   GET /weather?city= — priced (0.001 USDC mock)\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { build };
