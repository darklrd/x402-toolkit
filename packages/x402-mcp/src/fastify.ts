/**
 * x402McpPlugin — Fastify plugin that paywalls MCP tools/call over Streamable
 * HTTP transport.
 *
 * Flow per request:
 *   1. Fastify parses the JSON-RPC body.
 *   2. For POST, the payment guard runs:
 *        - challenge / reject  -> respond directly (402 or JSON-RPC error)
 *        - passthrough / proceed -> forward to a fresh MCP transport
 *   3. Forwarding builds a fresh stateless StreamableHTTPServerTransport +
 *      Server (from the registry) and delegates via reply.hijack().
 *
 * Stateless mode (sessionIdGenerator: undefined) is used so each HTTP request
 * is independent — the SDK requires a fresh transport per stateless request,
 * which matches the gate-in-front design. Payment is bound to the canonical
 * MCP request hash, not to an MCP session.
 */
import fp from 'fastify-plugin';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpPaymentGuard } from './guard.js';
import { X402McpEventEmitter } from './events.js';
import type { X402McpPluginOptions } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    x402McpEvents: X402McpEventEmitter;
  }
}

export const x402McpPlugin = fp(
  async function x402McpPluginImpl(fastify, options: X402McpPluginOptions) {
    const events = new X402McpEventEmitter();
    if (!fastify.hasDecorator('x402McpEvents')) {
      fastify.decorate('x402McpEvents', events);
    }

    const guard = createMcpPaymentGuard({
      transportPath: options.path,
      registry: options.registry,
      verifier: options.verifier,
      wireFormat: options.wireFormat,
      defaultTtlSeconds: options.defaultTtlSeconds,
      allowUnpricedTools: options.allowUnpricedTools,
      rejectBatchRequests: options.rejectBatchRequests,
      receiptStore: options.receiptStore,
      events,
    });

    fastify.addHook('onClose', async () => {
      guard.dispose();
    });

    async function forward(
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ): Promise<void> {
      const server = options.registry.createMcpServer(options.serverInfo);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const cleanup = () => {
        void transport.close();
        void server.close();
      };
      reply.raw.on('close', cleanup);

      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    }

    fastify.route({
      method: ['POST', 'GET', 'DELETE'],
      url: options.path,
      handler: async (request, reply) => {
        // Stateless + JSON response mode: we never push server->client messages,
        // so there is no standalone SSE stream (GET) and no session to terminate
        // (DELETE). Per the MCP transport spec, answer 405 for both.
        if (request.method !== 'POST') {
          return reply.code(405).header('allow', 'POST').send({ error: 'Method Not Allowed' });
        }

        const sessionId = request.headers['mcp-session-id'] as string | undefined;
        const decision = await guard.evaluate({
          body: request.body,
          headers: request.headers,
          ip: request.ip,
          sessionId,
        });

        if (decision.action === 'challenge') {
          reply.code(decision.status);
          for (const [key, value] of Object.entries(decision.headers)) {
            reply.header(key, value);
          }
          return reply.send(decision.body);
        }

        if (decision.action === 'reject') {
          return reply.code(decision.status).send(decision.body);
        }

        await forward(request, reply);
      },
    });
  },
  { name: 'x402-mcp', fastify: '4.x' },
);
