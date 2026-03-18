# @darklrd/x402-agent-client

Client library that auto-handles HTTP 402 payment challenges. Your AI agent makes a normal `fetch` call — the client intercepts 402 responses, pays via Solana USDC, and retries transparently.

## Install

```bash
pnpm add @darklrd/x402-agent-client x402-adapters
```

## Quick Start

### x402Fetch (drop-in fetch replacement)

```ts
import { x402Fetch } from '@darklrd/x402-agent-client';
import { MockPayer } from 'x402-adapters';

const payer = new MockPayer();
const res = await x402Fetch('http://api.example.com/weather?city=London', { payer });
const data = await res.json();
```

### createTool (structured tool wrapper)

```ts
import { createTool } from '@darklrd/x402-agent-client';
import { MockPayer } from 'x402-adapters';

const tool = createTool({
  name: 'weather',
  url: 'http://api.example.com/weather',
  method: 'GET',
  payer: new MockPayer(),
});

const result = await tool.invoke({ city: 'London' });
```

### OpenAI Function Calling

```ts
import { toOpenAITools, executeToolCall } from '@darklrd/x402-agent-client';

const tools = toOpenAITools(myToolDefinitions);
// Pass to OpenAI chat completion, then:
const result = await executeToolCall(toolCall, myToolDefinitions);
```

### Spend Budgets

Cap agent spending to prevent runaway costs:

```ts
import { x402Fetch, BudgetTracker } from '@darklrd/x402-agent-client';
import { MockPayer } from 'x402-adapters';

const budget = new BudgetTracker({ maxSpend: "0.05" });
const payer = new MockPayer();

await x402Fetch('http://api.example.com/weather', {}, { payer, budget });
// budget.spent === "0.001", budget.remaining === "0.049"

// Throws BudgetExceededError when limit is reached — no money leaves
budget.reset(); // start a new session
```

## Features

- Drop-in `fetch` replacement with automatic 402 handling
- Structured tool wrapper for agent frameworks
- OpenAI function calling adapter
- Agent spend budgets with `BudgetTracker`
- Pluggable payer interface (mock or real Solana USDC)

## Links

- [GitHub](https://github.com/darklrd/x402-toolkit)
- [Playground](https://darklrd.github.io/x402-toolkit/)
- [x402 Protocol](https://x402.org)
