import Fastify from 'fastify';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { MockPayer, MockVerifier } from 'x402-adapters';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import {
  createTool,
  toOpenAITools,
  parseToolCall,
  executeToolCall,
} from 'x402-agent-client';

const SECRET = 'openai-agent-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xEXAMPLE',
};

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/secret',
      pricing: PRICING,
      handler: async () => {
        return { secret: 'the answer is 42' };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${addr.port}`, close: () => fastify.close() };
}

async function main(): Promise<void> {
  const { baseUrl, close } = await startServer();
  const payer = new MockPayer({ secret: SECRET });

  const secretTool = createTool({
    name: 'get_secret',
    description: 'Retrieve the secret answer.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: `${baseUrl}/secret`,
    method: 'GET',
    fetchOptions: { payer, maxRetries: 1 },
  });

  console.log(`Server started at ${baseUrl}`);

  if (!process.env['OPENAI_API_KEY']) {
    console.log('OPENAI_API_KEY not set — running in fallback demo mode.');
    const result = await secretTool.invoke({});
    console.log('Direct tool result:', JSON.stringify(result.data, null, 2));
    await close();
    return;
  }

  const client = new OpenAI();
  const tools = toOpenAITools([secretTool]);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a helpful assistant. Use available tools to answer.' },
    { role: 'user', content: 'What is the secret answer?' },
  ];

  const MAX_ITERATIONS = 5;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
    });

    const choice = response.choices[0];
    if (!choice) break;

    if (choice.finish_reason === 'stop') {
      console.log('\nAgent answer:', choice.message.content);
      break;
    }

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push(choice.message);
      for (const toolCall of choice.message.tool_calls) {
        const parsed = parseToolCall(toolCall);
        const toolMessage = await executeToolCall(parsed, [secretTool]);
        messages.push(toolMessage);
      }
    }
  }

  await close();
}

main().catch(console.error);
