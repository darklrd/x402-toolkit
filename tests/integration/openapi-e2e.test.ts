import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  createX402Middleware,
  pricedRoute,
  rateLimitMiddleware,
  openApiPlugin,
} from 'x402-tool-server';
import { MockVerifier } from 'x402-adapters';

const SECRET = 'openapi-e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xOPENAPI',
  description: 'Get current weather',
};

interface SpecResponse {
  openapi: string;
  paths: Record<string, Record<string, {
    'x-x402-price'?: string;
    'x-x402-recipient'?: string;
    responses: Record<string, { content?: { 'application/json': { schema: { $ref?: string } } } }>;
  }>>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

async function buildE2EServer() {
  const fastify = Fastify({ logger: false, exposeHeadRoutes: false });
  await fastify.register(openApiPlugin, {});

  fastify.get('/health', async () => ({ status: 'ok' }));

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city: string };
        return { city, temp: 20 };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('OpenAPI integration', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    ({ fastify, baseUrl } = await buildE2EServer());
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('GET /x402/openapi.json returns 200', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    expect(res.status).toBe(200);
  });

  it('response content-type is application/json', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('response body is valid JSON with openapi field', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.openapi).toMatch(/^3\.0/);
  });

  it('spec includes registered priced route', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/weather']).toBeDefined();
    expect(body.paths['/weather']['get']).toBeDefined();
  });

  it('priced route has correct x-x402-price', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/weather']['get']['x-x402-price']).toBe('0.001');
  });

  it('priced route has correct x-x402-recipient', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/weather']['get']['x-x402-recipient']).toBe('0xOPENAPI');
  });

  it('priced route has 402 response', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    const resp402 = body.paths['/weather']['get'].responses['402'];
    expect(resp402).toBeDefined();
    expect(resp402.content?.['application/json'].schema.$ref).toBe(
      '#/components/schemas/X402ChallengeBody',
    );
  });

  it('free routes are excluded from spec', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/health']).toBeUndefined();
  });

  it('spec includes components.schemas.X402ChallengeBody', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.components.schemas['X402ChallengeBody']).toBeDefined();
  });

  it('openapi endpoint itself is not in paths', async () => {
    const res = await fetch(`${baseUrl}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/x402/openapi.json']).toBeUndefined();
  });

  it('works alongside x402 middleware and rate limiter', async () => {
    const server = Fastify({ logger: false, exposeHeadRoutes: false });
    await server.register(rateLimitMiddleware, { maxRequests: 100, windowMs: 10_000 });
    await server.register(createX402Middleware({ verifier: new MockVerifier({ secret: SECRET }) }));
    await server.register(openApiPlugin, {});
    server.route(
      pricedRoute({
        method: 'GET',
        url: '/paid',
        pricing: PRICING,
        handler: async () => ({ ok: true }),
      }),
    );
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${url}/x402/openapi.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/paid']).toBeDefined();

    await server.close();
  });

  it('multiple priced routes all appear in spec', async () => {
    const server = Fastify({ logger: false, exposeHeadRoutes: false });
    await server.register(openApiPlugin, {});
    server.route(pricedRoute({ method: 'GET', url: '/a', pricing: PRICING, handler: async () => ({ ok: true }) }));
    server.route(pricedRoute({ method: 'GET', url: '/b', pricing: { ...PRICING, price: '0.002' }, handler: async () => ({ ok: true }) }));
    server.route(pricedRoute({ method: 'POST', url: '/c', pricing: { ...PRICING, price: '0.003' }, handler: async () => ({ ok: true }) }));
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${url}/x402/openapi.json`);
    const body = (await res.json()) as SpecResponse;
    expect(body.paths['/a']).toBeDefined();
    expect(body.paths['/b']).toBeDefined();
    expect(body.paths['/c']).toBeDefined();

    await server.close();
  });
});
