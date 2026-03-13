export const serverSnippet = `import Fastify from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { SolanaUSDCVerifier } from 'x402-adapters/solana';

const verifier = new SolanaUSDCVerifier({ rpcUrl: '...' });
const app = Fastify();

await app.register(createX402Middleware({ verifier }));

app.route(pricedRoute({
  method: 'GET',
  url: '/weather',
  pricing: { price: '0.001', asset: 'USDC', recipient: '...' },
  handler: async (req, reply) => reply.send({ temp: 22 }),
}));`;

export const clientSnippet = `import { x402Fetch } from 'x402-agent-client';
import { SolanaUSDCPayer } from 'x402-adapters/solana';

const payer = new SolanaUSDCPayer({ keypair, rpcUrl: '...' });
const res = await x402Fetch('https://api.example.com/weather?city=London', payer);
const data = await res.json();
console.log(data); // { temp: 22 }`;

export const langchainSnippet = `import { X402Tool } from 'x402-langchain';
import { SolanaUSDCPayer } from 'x402-adapters/solana';

const tool = new X402Tool({
  name: 'weather',
  description: 'Get current weather for a city',
  url: 'https://api.example.com/weather',
  payer: new SolanaUSDCPayer({ keypair, rpcUrl: '...' }),
});

const result = await tool.invoke({ city: 'London' });`;

export const openaiSnippet = `import { createX402Tools } from 'x402-agent-client/openai';
import { SolanaUSDCPayer } from 'x402-adapters/solana';

const payer = new SolanaUSDCPayer({ keypair, rpcUrl: '...' });
const tools = createX402Tools([
  { url: 'https://api.example.com/weather', payer },
  { url: 'https://api.example.com/price', payer },
]);

// Use with OpenAI function calling
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  tools,
  messages: [{ role: 'user', content: 'Weather in London?' }],
});`;

export type SnippetKey = 'server' | 'client' | 'langchain' | 'openai';

export const snippetMap: Record<SnippetKey, { label: string; code: string }> = {
  server: { label: 'Server', code: serverSnippet },
  client: { label: 'Client', code: clientSnippet },
  langchain: { label: 'LangChain', code: langchainSnippet },
  openai: { label: 'OpenAI', code: openaiSnippet },
};
