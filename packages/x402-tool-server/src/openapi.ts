import type { FastifyPluginAsync, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import type { PricingConfig } from './types.js';
import type { WireFormat } from './compat.js';

export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
  includeAllRoutes?: boolean;
  wireFormat?: WireFormat;
}

interface OpenApiSchema {
  type?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  $ref?: string;
  format?: string;
  [key: string]: OpenApiSchema | string | boolean | number | string[] | undefined;
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema: OpenApiSchema;
}

interface OpenApiResponse {
  description: string;
  content?: { 'application/json': { schema: OpenApiSchema } };
}

interface OpenApiOperation {
  summary?: string;
  parameters?: Array<OpenApiParameter>;
  requestBody?: {
    required?: boolean;
    content: { 'application/json': { schema: OpenApiSchema } };
  };
  responses: Record<string, OpenApiResponse>;
  'x-x402-price'?: string;
  'x-x402-asset'?: string;
  'x-x402-network'?: string;
  'x-x402-recipient'?: string;
  'x-x402-scheme'?: string;
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchema> };
}

function buildQueryParameters(schema: OpenApiSchema): Array<OpenApiParameter> {
  const params: Array<OpenApiParameter> = [];
  if (schema.properties) {
    const requiredFields = schema.required ?? [];
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema === 'object' && propSchema !== null && !Array.isArray(propSchema)) {
        const param: OpenApiParameter = {
          name,
          in: 'query',
          schema: propSchema as OpenApiSchema,
        };
        if (requiredFields.includes(name)) {
          param.required = true;
        }
        params.push(param);
      }
    }
  }
  return params;
}

function buildComponentSchemas(): Record<string, OpenApiSchema> {
  return {
    X402ChallengeBody: {
      type: 'object',
      required: ['x402'],
      properties: {
        x402: { $ref: '#/components/schemas/X402Challenge' },
      },
    },
    X402Challenge: {
      type: 'object',
      required: [
        'version', 'scheme', 'price', 'asset', 'network',
        'recipient', 'nonce', 'expiresAt', 'requestHash',
      ],
      properties: {
        version: { type: 'integer' },
        scheme: { type: 'string' },
        price: { type: 'string' },
        asset: { type: 'string' },
        network: { type: 'string' },
        recipient: { type: 'string' },
        nonce: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        requestHash: { type: 'string' },
        description: { type: 'string' },
      },
    },
  };
}

const openApiPluginImpl: FastifyPluginAsync<OpenApiOptions> = async (
  fastify,
  opts,
) => {
  const collectedRoutes: Array<RouteOptions> = [];

  fastify.addHook('onRoute', (routeOptions) => {
    collectedRoutes.push(routeOptions as RouteOptions);
  });

  let cachedSpec: OpenApiSpec | undefined;

  fastify.get('/x402/openapi.json', async (_request, reply) => {
    if (cachedSpec) {
      return reply.type('application/json').send(cachedSpec);
    }

    const paths: Record<string, Record<string, OpenApiOperation>> = {};

    for (const route of collectedRoutes) {
      if (route.url.startsWith('/x402/')) continue;

      const pricing = route.config?.x402Pricing as PricingConfig | undefined;
      if (!pricing && !opts.includeAllRoutes) continue;

      const methods = Array.isArray(route.method) ? route.method : [route.method];

      for (const m of methods) {
        const method = m.toLowerCase();
        if (!paths[route.url]) paths[route.url] = {};

        const operation: OpenApiOperation = {
          responses: { '200': { description: 'Successful response' } },
        };

        if (pricing) {
          if (pricing.description) operation.summary = pricing.description;
          operation['x-x402-price'] = pricing.price;
          operation['x-x402-asset'] = pricing.asset;
          operation['x-x402-network'] = pricing.network ?? 'mock';
          operation['x-x402-recipient'] = pricing.recipient;
          if (pricing.scheme) operation['x-x402-scheme'] = pricing.scheme;

          const wf = opts.wireFormat ?? 'toolkit';
          if (wf === 'toolkit' || wf === 'dual') {
            operation.responses['402'] = {
              description: 'Payment required',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/X402ChallengeBody' },
                },
              },
            };
          } else {
            operation.responses['402'] = {
              description: 'Payment required (Coinbase x402 format via PAYMENT-REQUIRED header)',
            };
          }

          if (wf === 'coinbase' || wf === 'dual') {
            if (!operation.parameters) operation.parameters = [];
            operation.parameters.push(
              {
                name: 'PAYMENT-REQUIRED',
                in: 'header',
                schema: { type: 'string' },
              },
              {
                name: 'PAYMENT-SIGNATURE',
                in: 'header',
                schema: { type: 'string' },
              },
            );
          }
        }

        const routeSchema = route.schema as
          | { body?: OpenApiSchema; querystring?: OpenApiSchema; response?: Record<string, OpenApiSchema> }
          | undefined;

        if (routeSchema?.body) {
          operation.requestBody = {
            required: true,
            content: {
              'application/json': { schema: routeSchema.body },
            },
          };
        }

        if (routeSchema?.querystring) {
          operation.parameters = buildQueryParameters(routeSchema.querystring);
        }

        if (routeSchema?.response) {
          const resp200 = routeSchema.response['200'];
          if (resp200) {
            operation.responses['200'] = {
              description: 'Successful response',
              content: {
                'application/json': { schema: resp200 },
              },
            };
          }
        }

        paths[route.url][method] = operation;
      }
    }

    const spec: OpenApiSpec = {
      openapi: '3.0.3',
      info: {
        title: opts.title ?? 'x402 Tool Server',
        version: opts.version ?? '1.0.0',
        description: opts.description ?? 'Auto-generated OpenAPI spec for x402 priced endpoints',
      },
      paths,
      components: { schemas: buildComponentSchemas() },
    };

    if (opts.servers && opts.servers.length > 0) {
      spec.servers = opts.servers;
    }

    cachedSpec = spec;
    return reply.type('application/json').send(spec);
  });
};

export const openApiPlugin = fp(openApiPluginImpl, {
  fastify: '>=4.0.0',
  name: 'x402-openapi',
});
