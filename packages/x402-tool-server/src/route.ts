/**
 * pricedRoute / pricedHandler — helpers for annotating Fastify routes with pricing.
 *
 * Usage (pricedRoute):
 *   fastify.route(pricedRoute({
 *     method: 'GET',
 *     url: '/weather',
 *     pricing: { price: '0.001', asset: 'USDC', recipient: '0xABC' },
 *     handler: async (req, reply) => reply.send({ sun: true }),
 *   }));
 *
 * Usage (pricedHandler — attach pricing to existing route options):
 *   fastify.get('/weather', pricedHandler({ price: '0.001', asset: 'USDC', recipient: '0xABC' }), handler);
 */
import type {
  RouteOptions,
  RouteShorthandOptions,
  FastifyRequest,
  FastifyReply,
  HTTPMethods,
} from 'fastify';
import type { PricingConfig } from './types.js';

export interface PricedRouteOptions {
  method: HTTPMethods | HTTPMethods[];
  url: string;
  pricing: PricingConfig;
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  schema?: RouteOptions['schema'];
  preHandler?: RouteOptions['preHandler'];
}

/**
 * Returns a full `RouteOptions` object with `config.x402Pricing` set.
 * Pass the result directly to `fastify.route(...)`.
 */
export function pricedRoute(options: PricedRouteOptions): RouteOptions {
  return {
    method: options.method,
    url: options.url,
    schema: options.schema,
    preHandler: options.preHandler,
    config: { x402Pricing: options.pricing },
    handler: options.handler,
  };
}

/**
 * Returns `RouteShorthandOptions` with `config.x402Pricing` set.
 * Use with fastify.get/post/etc.:
 *
 *   fastify.get('/weather', pricedHandler({ price: '0.001', ... }), myHandler);
 */
export function pricedHandler(pricing: PricingConfig): RouteShorthandOptions {
  return { config: { x402Pricing: pricing } };
}
