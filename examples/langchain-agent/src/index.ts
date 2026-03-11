import Fastify from 'fastify';
import { z } from 'zod/v3';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { MockPayer, MockVerifier } from 'x402-adapters';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { X402Tool } from 'x402-langchain';

const SECRET = 'example-secret';
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
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city: string };
        return { city, temp: 22, condition: 'Sunny', humidity: 60 };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return { baseUrl, close: () => fastify.close() };
}

async function main(): Promise<void> {
  const { baseUrl, close } = await startServer();
  const payer = new MockPayer({ secret: SECRET });

  const weatherTool = new X402Tool({
    name: 'get_weather',
    description: 'Get current weather for a city. Returns temperature, condition, and humidity.',
    schema: z.object({
      city: z.string().describe('The city name to get weather for'),
    }),
    endpoint: `${baseUrl}/weather`,
    method: 'GET',
    fetchOptions: { payer, maxRetries: 1 },
  });

  console.log(`Server started at ${baseUrl}`);
  console.log('Registered tool:', weatherTool.name);

  try {
    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
    });

    const agent = createReactAgent({ llm, tools: [weatherTool] });

    console.log('\nRunning agent: "What is the weather in Tokyo?"');

    const result = await agent.invoke({
      messages: [new HumanMessage('What is the weather in Tokyo?')],
    });

    const lastMessage = result.messages[result.messages.length - 1];
    console.log('\nAgent response:', lastMessage.content);
  } catch (err) {
    if (err instanceof Error && err.message.includes('API key')) {
      console.log(
        '\nNote: OPENAI_API_KEY not set. To run the full agent example, set your API key:',
      );
      console.log('  export OPENAI_API_KEY=sk-...');
      console.log('  pnpm start');
      console.log('\nDemonstrating standalone tool usage instead:');

      const result = await weatherTool.invoke({ city: 'Tokyo' });
      console.log('Direct tool invoke result:', result);
    } else {
      throw err;
    }
  } finally {
    await close();
  }
}

main().catch(console.error);
