import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { rateLimitMiddleware } from 'x402-tool-server';
import type { RateLimitOptions } from 'x402-tool-server';

async function buildRateLimitedServer(opts: Partial<RateLimitOptions> = {}) {
  const fastify = Fastify({ logger: false });

  fastify.register(rateLimitMiddleware, {
    maxRequests: 3,
    windowMs: 10_000,
    ...opts,
  });

  fastify.get('/test', async () => ({ ok: true }));
  fastify.get('/test-a', async () => ({ route: 'a' }));
  fastify.get('/test-b', async () => ({ route: 'b' }));

  await fastify.ready();
  return fastify;
}

describe('Rate limit middleware', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('allows requests under the limit', async () => {
    app = await buildRateLimitedServer({ maxRequests: 3 });

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    app = await buildRateLimitedServer({ maxRequests: 3 });

    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/test' });
    }

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(429);
  });

  it('429 response body contains error and retryAfter', async () => {
    app = await buildRateLimitedServer({ maxRequests: 1 });

    await app.inject({ method: 'GET', url: '/test' });
    const res = await app.inject({ method: 'GET', url: '/test' });
    const body = res.json() as { error: string; retryAfter: number };

    expect(body.error).toBe('Too Many Requests');
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('429 response includes Retry-After header', async () => {
    app = await buildRateLimitedServer({ maxRequests: 1 });

    await app.inject({ method: 'GET', url: '/test' });
    const res = await app.inject({ method: 'GET', url: '/test' });

    const retryAfter = res.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('Retry-After value decreases as window progresses', async () => {
    vi.useFakeTimers();
    app = await buildRateLimitedServer({ maxRequests: 1, windowMs: 10_000 });

    await app.inject({ method: 'GET', url: '/test' });
    const res1 = await app.inject({ method: 'GET', url: '/test' });
    const retryAfter1 = Number(res1.headers['retry-after']);

    vi.advanceTimersByTime(5_000);

    const res2 = await app.inject({ method: 'GET', url: '/test' });
    const retryAfter2 = Number(res2.headers['retry-after']);

    expect(retryAfter2).toBeLessThan(retryAfter1);
  });

  it('window resets after windowMs elapses', async () => {
    vi.useFakeTimers();
    app = await buildRateLimitedServer({ maxRequests: 2, windowMs: 10_000 });

    await app.inject({ method: 'GET', url: '/test' });
    await app.inject({ method: 'GET', url: '/test' });

    const blocked = await app.inject({ method: 'GET', url: '/test' });
    expect(blocked.statusCode).toBe(429);

    vi.advanceTimersByTime(10_001);

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('different IPs are tracked independently', async () => {
    app = await buildRateLimitedServer({ maxRequests: 1 });

    const res1 = await app.inject({
      method: 'GET',
      url: '/test',
      remoteAddress: '10.0.0.1',
    });
    expect(res1.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'GET',
      url: '/test',
      remoteAddress: '10.0.0.1',
    });
    expect(blocked.statusCode).toBe(429);

    const res2 = await app.inject({
      method: 'GET',
      url: '/test',
      remoteAddress: '10.0.0.2',
    });
    expect(res2.statusCode).toBe(200);
  });

  it('custom keyExtractor uses provided function', async () => {
    app = await buildRateLimitedServer({
      maxRequests: 1,
      keyExtractor: (request) => request.headers['x-api-key'] as string ?? 'anonymous',
    });

    const res1 = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'key-a' },
    });
    expect(res1.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'key-a' },
    });
    expect(blocked.statusCode).toBe(429);

    const res2 = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'key-b' },
    });
    expect(res2.statusCode).toBe(200);
  });

  it('cleanup removes expired entries', async () => {
    vi.useFakeTimers();
    app = await buildRateLimitedServer({ maxRequests: 1, windowMs: 5_000 });

    await app.inject({ method: 'GET', url: '/test' });
    const blocked = await app.inject({ method: 'GET', url: '/test' });
    expect(blocked.statusCode).toBe(429);

    // Advance past window + cleanup interval (60s)
    vi.advanceTimersByTime(65_000);

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('cleanup does not remove active windows', async () => {
    vi.useFakeTimers();
    app = await buildRateLimitedServer({ maxRequests: 1, windowMs: 120_000 });

    // Exhaust limit for IP-A at t=0
    await app.inject({ method: 'GET', url: '/test', remoteAddress: '10.0.0.1' });

    // Advance 61s (past cleanup interval) and exhaust limit for IP-B
    vi.advanceTimersByTime(61_000);
    await app.inject({ method: 'GET', url: '/test', remoteAddress: '10.0.0.2' });

    // Advance another 61s — now t=122s, IP-A's 120s window has expired
    // but IP-B's window started at t=61s so it's still active (61s < 120s)
    vi.advanceTimersByTime(61_000);

    // Trigger cleanup by making a request
    const resA = await app.inject({ method: 'GET', url: '/test', remoteAddress: '10.0.0.1' });
    expect(resA.statusCode).toBe(200); // IP-A expired, allowed

    // IP-B still within its window → should still be blocked
    const resB = await app.inject({ method: 'GET', url: '/test', remoteAddress: '10.0.0.2' });
    expect(resB.statusCode).toBe(429);
  });

  it('maxRequests of 1 blocks second request', async () => {
    app = await buildRateLimitedServer({ maxRequests: 1 });

    const first = await app.inject({ method: 'GET', url: '/test' });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: '/test' });
    expect(second.statusCode).toBe(429);
  });

  it('different routes share the same rate limit counter', async () => {
    app = await buildRateLimitedServer({ maxRequests: 2 });

    const res1 = await app.inject({ method: 'GET', url: '/test-a' });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'GET', url: '/test-b' });
    expect(res2.statusCode).toBe(200);

    const res3 = await app.inject({ method: 'GET', url: '/test-a' });
    expect(res3.statusCode).toBe(429);
  });
});
