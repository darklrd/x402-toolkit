# x402-langchain

LangChain `StructuredTool` adapter for x402 priced endpoints. Wrap any x402 API in a LangChain-compatible tool with automatic payment handling.

## Install

```bash
npm install x402-langchain @langchain/core zod
# or
pnpm add x402-langchain @langchain/core zod
```

## Quick start

### Standalone tool invoke (no LLM required)

```ts
import { X402Tool } from 'x402-langchain';
import { MockPayer } from 'x402-adapters';
import { z } from 'zod';

const weatherTool = new X402Tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  schema: z.object({
    city: z.string().describe('City name'),
  }),
  endpoint: 'http://localhost:3000/weather',
  method: 'GET',
  fetchOptions: { payer: new MockPayer({ secret: 'your-secret' }) },
});

const result = await weatherTool.invoke({ city: 'Tokyo' });
console.log(result);
// '{"city":"Tokyo","temp":22,"condition":"Sunny"}'
```

### With a LangChain agent

```ts
import { X402Tool } from 'x402-langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MockPayer } from 'x402-adapters';
import { z } from 'zod';

const payer = new MockPayer({ secret: 'your-secret' });

const weatherTool = new X402Tool({
  name: 'get_weather',
  description: 'Get current weather for a city. Costs 0.001 USDC per call.',
  schema: z.object({
    city: z.string().describe('City name'),
  }),
  endpoint: 'http://localhost:3000/weather',
  method: 'GET',
  fetchOptions: { payer },
});

const llm = new ChatOpenAI({ model: 'gpt-4o-mini' });
const agent = createReactAgent({ llm, tools: [weatherTool] });

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
});

console.log(result.messages.at(-1)?.content);
```

### Multiple tools via factory

```ts
import { createX402Tools } from 'x402-langchain';
import { z } from 'zod';

const tools = createX402Tools([
  {
    name: 'get_weather',
    description: 'Get weather',
    schema: z.object({ city: z.string() }),
    endpoint: 'http://localhost:3000/weather',
    method: 'GET',
    fetchOptions: { payer },
  },
  {
    name: 'do_action',
    description: 'Perform an action',
    schema: z.object({ action: z.string() }),
    endpoint: 'http://localhost:3000/action',
    method: 'POST',
    fetchOptions: { payer },
  },
]);
```

### With Solana USDC payer (production)

```ts
import { SolanaUSDCPayer } from 'x402-adapters/solana';

const payer = new SolanaUSDCPayer({
  privateKey: process.env.SOLANA_PRIVATE_KEY!,
});

const tool = new X402Tool({
  name: 'premium_api',
  description: 'Call a premium API',
  schema: z.object({ query: z.string() }),
  endpoint: 'https://api.example.com/search',
  method: 'POST',
  fetchOptions: { payer, maxRetries: 2 },
});
```

## API Reference

| Export | Type | Description |
|--------|------|-------------|
| `X402Tool` | class | LangChain `StructuredTool` backed by an x402 endpoint |
| `createX402Tools` | function | Factory to create multiple `X402Tool` instances |
| `X402ToolConfig` | interface | Configuration type for `X402Tool` |
| `ToolException` | class | Re-exported from `@langchain/core/tools` for error handling |

### `X402ToolConfig<T>`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Tool name used by the LLM for function calling |
| `description` | `string` | ✅ | Human-readable description of what the tool does |
| `schema` | `ZodObject<T>` | ✅ | Zod schema defining the tool's input |
| `endpoint` | `string` | ✅ | Full URL of the priced x402 endpoint |
| `method` | `string` | | HTTP method (default: `GET`) |
| `fetchOptions` | `X402FetchOptions` | ✅ | x402 fetch options including `payer` |
| `returnDirect` | `boolean` | | Return tool result directly without agent reasoning (default: `false`) |
