import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyExtractor?: (request: FastifyRequest) => string;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

const defaultKeyExtractor = (request: FastifyRequest): string =>
  request.ip;

const rateLimitPlugin: FastifyPluginAsync<RateLimitOptions> = async (
  fastify,
  opts,
) => {
  const {
    maxRequests,
    windowMs,
    keyExtractor = defaultKeyExtractor,
  } = opts;

  const store = new Map<string, WindowEntry>();
  let lastCleanup = Date.now();
  const CLEANUP_INTERVAL_MS = 60_000;

  const cleanup = (now: number): void => {
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    for (const [key, entry] of store) {
      if (now - entry.windowStart >= windowMs) {
        store.delete(key);
      }
    }
  };

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const now = Date.now();
      cleanup(now);

      const key = keyExtractor(request);
      let entry = store.get(key);

      if (!entry || now - entry.windowStart >= windowMs) {
        entry = { count: 0, windowStart: now };
        store.set(key, entry);
      }

      entry.count += 1;

      if (entry.count > maxRequests) {
        const retryAfterSeconds = Math.ceil(
          (entry.windowStart + windowMs - now) / 1000,
        );
        reply.header('Retry-After', String(retryAfterSeconds));
        return reply.status(429).send({
          error: 'Too Many Requests',
          retryAfter: retryAfterSeconds,
        });
      }
    },
  );
};

export const rateLimitMiddleware = fp(rateLimitPlugin, {
  fastify: '>=4.0.0',
  name: 'x402-rate-limit',
});
