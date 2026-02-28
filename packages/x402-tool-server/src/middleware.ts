/**
 * createX402Middleware — Fastify plugin that adds x402 payment gating.
 *
 * Uses fastify-plugin to escape Fastify's scope encapsulation so that
 * hooks apply to ALL routes, not just routes registered inside the plugin.
 *
 * Usage:
 *   fastify.register(createX402Middleware({ verifier }));
 *
 * Routes opt in via route config:
 *   fastify.get('/tool', { config: { x402Pricing: { … } } }, handler);
 *
 * or via the pricedRoute / pricedHandler helpers (see index.ts).
 */
import { randomUUID } from 'crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { Readable } from 'stream';
import { computeRequestHash } from './hash.js';
import { MemoryIdempotencyStore } from './idempotency.js';
import type {
  VerifierInterface,
  IdempotencyStore,
  X402Challenge,
  X402ChallengeBody,
  StoredResponse,
} from './types.js';

export interface X402MiddlewareOptions {
  /** Verifier instance — validates payment proofs */
  verifier: VerifierInterface;
  /** Idempotency store (defaults to in-memory) */
  idempotencyStore?: IdempotencyStore;
  /**
   * Default challenge TTL in seconds if not set per route.
   * Default: 300 (5 minutes).
   */
  defaultTtlSeconds?: number;
}

// Extend FastifyRequest to carry raw body bytes captured in preParsing.
declare module 'fastify' {
  interface FastifyRequest {
    _x402RawBody?: Buffer;
  }
}

const x402Plugin: (options: X402MiddlewareOptions) => FastifyPluginAsync =
  (options) =>
  fp(async function x402PluginImpl(fastify) {
    const idempotencyStore = options.idempotencyStore ?? new MemoryIdempotencyStore();
    const defaultTtl = options.defaultTtlSeconds ?? 300;

    // In-memory nonce store for replay protection.
    // Nonces are stored until their expiresAt + a 60-second grace period.
    const usedNonces = new Map<string, number>(); // nonce -> expiry epoch ms

    // Background cleanup of expired nonces (runs every 60 seconds).
    const nonceSweep = setInterval(() => {
      const now = Date.now();
      for (const [nonce, exp] of usedNonces) {
        if (now > exp) usedNonces.delete(nonce);
      }
    }, 60_000);
    if (nonceSweep.unref) nonceSweep.unref();

    // ── 1. Capture raw body bytes ──────────────────────────────────────────
    // Intercept in preParsing, buffer the stream, then re-feed a fresh
    // Readable so Fastify's body parser can still consume it normally.
    fastify.addHook('preParsing', async (request, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload as AsyncIterable<Buffer | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks);
      request._x402RawBody = raw;

      const readable = Readable.from(raw) as Readable & { receivedEncodedLength?: number };
      readable.receivedEncodedLength = raw.length;
      return readable;
    });

    // ── 2. Payment gate ────────────────────────────────────────────────────
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      // Read pricing from route config (set via pricedRoute / pricedHandler).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pricing = (request.routeOptions?.config as any)?.x402Pricing;
      if (!pricing) return; // Not a priced route — pass through.

      // Parse URL components for canonical hashing.
      const url = new URL(request.url, 'http://localhost');
      const rawBody = request._x402RawBody ?? Buffer.alloc(0);
      const requestHash = computeRequestHash(
        request.method,
        url.pathname,
        url.search.replace(/^\?/, ''),
        rawBody,
      );

      // ── Idempotency check ────────────────────────────────────────────────
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const stored = idempotencyStore.get(idempotencyKey);
        if (stored) {
          if (stored.requestHash === requestHash) {
            // Same key + same request → replay stored response; no new charge.
            reply
              .code(stored.statusCode)
              .headers({ ...stored.headers, 'x-idempotent-replay': 'true' })
              .send(stored.body);
            return;
          } else {
            // Same key, different request → 409 Conflict.
            reply.code(409).send({
              error: 'Idempotency key reused with a different request',
              idempotencyKey,
            });
            return;
          }
        }
      }

      // ── Payment proof check ───────────────────────────────────────────────
      const proofHeader = request.headers['x-payment-proof'] as string | undefined;

      if (!proofHeader) {
        // No proof — issue a 402 challenge.
        const ttl = (pricing.ttlSeconds as number | undefined) ?? defaultTtl;
        const nonce = randomUUID();
        const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

        const challenge: X402Challenge = {
          version: 1,
          scheme: (pricing.scheme as string | undefined) ?? 'exact',
          price: pricing.price as string,
          asset: pricing.asset as string,
          network: (pricing.network as string | undefined) ?? 'mock',
          recipient: pricing.recipient as string,
          nonce,
          expiresAt,
          requestHash,
          description: pricing.description as string | undefined,
        };

        const body: X402ChallengeBody = { x402: challenge };
        reply.code(402).send(body);
        return;
      }

      // Proof is present — verify it.
      const valid = await options.verifier.verify(proofHeader, requestHash, pricing);
      if (!valid) {
        reply.code(402).send({
          error: 'Invalid or expired payment proof',
          hint: 'Obtain a fresh challenge by calling this endpoint without X-Payment-Proof',
        });
        return;
      }

      // ── Replay protection: record nonce as used ──────────────────────────
      try {
        const decoded = Buffer.from(proofHeader, 'base64url').toString('utf8');
        const proof = JSON.parse(decoded) as { nonce?: string; expiresAt?: string };
        const nonce = proof.nonce;
        if (nonce) {
          if (usedNonces.has(nonce)) {
            reply.code(402).send({ error: 'Nonce already used (replay detected)' });
            return;
          }
          // Keep nonce until its expiry + 60s grace, then sweep can remove it.
          const expMs = proof.expiresAt
            ? new Date(proof.expiresAt).getTime() + 60_000
            : Date.now() + 360_000;
          usedNonces.set(nonce, expMs);
        }
      } catch {
        // Proof already passed verifier.verify() so JSON parse failure is a
        // corner case — we skip nonce tracking but allow the request through.
      }

      // ── Intercept response for idempotency storage ───────────────────────
      if (idempotencyKey) {
        const originalSend = reply.send.bind(reply);
        reply.send = function (payload?: unknown) {
          const stored: StoredResponse = {
            requestHash,
            statusCode: reply.statusCode,
            body: payload,
            headers: {},
          };
          idempotencyStore.set(idempotencyKey!, stored);
          return originalSend(payload);
        };
      }
    });
  });

/**
 * Returns a Fastify plugin (wrapped with fastify-plugin) that gates
 * priced routes with x402 payment verification.
 *
 * Must be registered before any priced routes.
 */
export const createX402Middleware = x402Plugin;
