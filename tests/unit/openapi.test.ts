import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { openApiPlugin, pricedRoute } from 'x402-tool-server';
import type { OpenApiOptions } from 'x402-tool-server';

const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xABC',
  description: 'Get current weather',
};

interface SpecResponse {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, {
    summary?: string;
    parameters?: Array<{ name: string; in: string; required?: boolean; schema: Record<string, string> }>;
    requestBody?: { required?: boolean; content: { 'application/json': { schema: Record<string, unknown> } } };
    responses: Record<string, { description: string; content?: { 'application/json': { schema: { $ref?: string } } } }>;
    'x-x402-price'?: string;
    'x-x402-asset'?: string;
    'x-x402-network'?: string;
    'x-x402-recipient'?: string;
    'x-x402-scheme'?: string;
  }>>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

async function buildSpecServer(
  routes: Array<{ method: string; url: string; pricing?: typeof PRICING; schema?: Record<string, unknown> }>,
  options?: OpenApiOptions,
) {
  const fastify = Fastify({ logger: false, exposeHeadRoutes: false });
  await fastify.register(openApiPlugin, options ?? {});

  for (const r of routes) {
    if (r.pricing) {
      fastify.route(
        pricedRoute({
          method: r.method as 'GET' | 'POST',
          url: r.url,
          pricing: r.pricing,
          schema: r.schema as Record<string, unknown> | undefined,
          handler: async () => ({ ok: true }),
        }),
      );
    } else {
      fastify.route({
        method: r.method as 'GET' | 'POST',
        url: r.url,
        schema: r.schema as Record<string, unknown> | undefined,
        handler: async () => ({ ok: true }),
      });
    }
  }

  await fastify.ready();
  return fastify;
}

async function getSpec(app: FastifyInstance): Promise<SpecResponse> {
  const res = await app.inject({ method: 'GET', url: '/x402/openapi.json' });
  return res.json() as SpecResponse;
}

describe('OpenAPI plugin', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('generates valid OpenAPI 3.0 spec', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/test', pricing: PRICING }]);
    const spec = await getSpec(app);
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
  });

  it('includes priced routes in paths', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec = await getSpec(app);
    expect(spec.paths['/weather']).toBeDefined();
    expect(spec.paths['/weather']['get']).toBeDefined();
  });

  it('excludes non-priced routes by default', async () => {
    app = await buildSpecServer([
      { method: 'GET', url: '/weather', pricing: PRICING },
      { method: 'GET', url: '/health' },
    ]);
    const spec = await getSpec(app);
    expect(spec.paths['/weather']).toBeDefined();
    expect(spec.paths['/health']).toBeUndefined();
  });

  it('includes non-priced routes when includeAllRoutes is true', async () => {
    app = await buildSpecServer(
      [
        { method: 'GET', url: '/weather', pricing: PRICING },
        { method: 'GET', url: '/health' },
      ],
      { includeAllRoutes: true },
    );
    const spec = await getSpec(app);
    expect(spec.paths['/weather']).toBeDefined();
    expect(spec.paths['/health']).toBeDefined();
  });

  it('maps PricingConfig to x-x402 extensions', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec = await getSpec(app);
    const op = spec.paths['/weather']['get'];
    expect(op['x-x402-price']).toBe('0.001');
    expect(op['x-x402-asset']).toBe('USDC');
    expect(op['x-x402-network']).toBe('mock');
    expect(op['x-x402-recipient']).toBe('0xABC');
  });

  it('includes x-x402-scheme when pricing has scheme', async () => {
    const pricing = { ...PRICING, scheme: 'exact' };
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing }]);
    const spec = await getSpec(app);
    expect(spec.paths['/weather']['get']['x-x402-scheme']).toBe('exact');
  });

  it('uses pricing.description as operation summary', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec = await getSpec(app);
    expect(spec.paths['/weather']['get'].summary).toBe('Get current weather');
  });

  it('includes 402 response with $ref on priced routes', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec = await getSpec(app);
    const resp402 = spec.paths['/weather']['get'].responses['402'];
    expect(resp402).toBeDefined();
    expect(resp402.content?.['application/json'].schema.$ref).toBe(
      '#/components/schemas/X402ChallengeBody',
    );
  });

  it('does not include 402 response on non-priced routes', async () => {
    app = await buildSpecServer(
      [{ method: 'GET', url: '/health' }],
      { includeAllRoutes: true },
    );
    const spec = await getSpec(app);
    expect(spec.paths['/health']['get'].responses['402']).toBeUndefined();
  });

  it('includes X402ChallengeBody and X402Challenge in components.schemas', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec = await getSpec(app);
    expect(spec.components.schemas['X402ChallengeBody']).toBeDefined();
    expect(spec.components.schemas['X402Challenge']).toBeDefined();
    const challenge = spec.components.schemas['X402Challenge'];
    expect(challenge['required']).toContain('version');
    expect(challenge['required']).toContain('nonce');
    expect(challenge['required']).toContain('requestHash');
  });

  it('maps route schema.body to requestBody', async () => {
    app = await buildSpecServer([{
      method: 'POST',
      url: '/action',
      pricing: PRICING,
      schema: {
        body: {
          type: 'object',
          properties: { action: { type: 'string' } },
          required: ['action'],
        },
      },
    }]);
    const spec = await getSpec(app);
    const op = spec.paths['/action']['post'];
    expect(op.requestBody).toBeDefined();
    expect(op.requestBody?.required).toBe(true);
    expect(op.requestBody?.content['application/json'].schema).toHaveProperty('properties');
  });

  it('maps route schema.querystring to parameters', async () => {
    app = await buildSpecServer([{
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      schema: {
        querystring: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    }]);
    const spec = await getSpec(app);
    const params = spec.paths['/weather']['get'].parameters;
    expect(params).toBeDefined();
    expect(params).toHaveLength(1);
    expect(params![0].name).toBe('city');
    expect(params![0].in).toBe('query');
    expect(params![0].required).toBe(true);
  });

  it('maps route schema.response.200 to responses.200', async () => {
    app = await buildSpecServer([{
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { temp: { type: 'number' } },
          },
        },
      },
    }]);
    const spec = await getSpec(app);
    const resp200 = spec.paths['/weather']['get'].responses['200'];
    expect(resp200.content).toBeDefined();
    expect(resp200.content?.['application/json'].schema).toHaveProperty('properties');
  });

  it('handles routes without any schema', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec = await getSpec(app);
    const op = spec.paths['/weather']['get'];
    expect(op.responses['200']).toBeDefined();
    expect(op['x-x402-price']).toBe('0.001');
    expect(op.requestBody).toBeUndefined();
    expect(op.parameters).toBeUndefined();
  });

  it('uses custom title, version, description from options', async () => {
    app = await buildSpecServer(
      [{ method: 'GET', url: '/test', pricing: PRICING }],
      { title: 'My API', version: '2.0.0', description: 'Custom desc' },
    );
    const spec = await getSpec(app);
    expect(spec.info.title).toBe('My API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBe('Custom desc');
  });

  it('uses default title, version, description when not provided', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/test', pricing: PRICING }]);
    const spec = await getSpec(app);
    expect(spec.info.title).toBe('x402 Tool Server');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.description).toBe('Auto-generated OpenAPI spec for x402 priced endpoints');
  });

  it('includes servers array when provided', async () => {
    app = await buildSpecServer(
      [{ method: 'GET', url: '/test', pricing: PRICING }],
      { servers: [{ url: 'https://api.example.com', description: 'Production' }] },
    );
    const spec = await getSpec(app);
    expect(spec.servers).toBeDefined();
    expect(spec.servers).toHaveLength(1);
    expect(spec.servers![0].url).toBe('https://api.example.com');
  });

  it('omits servers when not provided', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/test', pricing: PRICING }]);
    const spec = await getSpec(app);
    expect(spec.servers).toBeUndefined();
  });

  it('excludes internal /x402/* routes from paths', async () => {
    app = await buildSpecServer(
      [{ method: 'GET', url: '/weather', pricing: PRICING }],
      { includeAllRoutes: true },
    );
    const spec = await getSpec(app);
    expect(spec.paths['/x402/openapi.json']).toBeUndefined();
    const x402Paths = Object.keys(spec.paths).filter((p) => p.startsWith('/x402/'));
    expect(x402Paths).toHaveLength(0);
  });

  it('handles multiple HTTP methods on same URL', async () => {
    app = await buildSpecServer([
      { method: 'GET', url: '/resource', pricing: PRICING },
      { method: 'POST', url: '/resource', pricing: { ...PRICING, price: '0.005' } },
    ]);
    const spec = await getSpec(app);
    expect(spec.paths['/resource']['get']).toBeDefined();
    expect(spec.paths['/resource']['post']).toBeDefined();
    expect(spec.paths['/resource']['get']['x-x402-price']).toBe('0.001');
    expect(spec.paths['/resource']['post']['x-x402-price']).toBe('0.005');
  });

  it('caches spec across multiple requests', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/weather', pricing: PRICING }]);
    const spec1 = await getSpec(app);
    const spec2 = await getSpec(app);
    expect(spec1).toEqual(spec2);
  });

  it('handles server with zero priced routes', async () => {
    app = await buildSpecServer([{ method: 'GET', url: '/health' }]);
    const spec = await getSpec(app);
    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths)).toHaveLength(0);
  });
});
