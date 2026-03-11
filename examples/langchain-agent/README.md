# langchain-agent example

A working example of a LangChain ReAct agent that calls a priced x402 endpoint using `X402Tool`.

## Prerequisites

- Node.js >= 18
- `OPENAI_API_KEY` environment variable (for full agent mode)

## What it does

1. Starts a local Fastify server with a priced `/weather` endpoint (requires mock payment)
2. Creates an `X402Tool` that wraps the endpoint
3. Runs a LangChain ReAct agent with `gpt-4o-mini` to answer "What is the weather in Tokyo?"
4. The agent automatically calls the tool, which handles the 402→pay→retry flow
5. If no `OPENAI_API_KEY` is set, falls back to standalone tool invocation demo

## Run

```bash
# From the repo root
pnpm install

# Set your OpenAI API key (optional — falls back to direct tool invoke)
export OPENAI_API_KEY=sk-...

# Run the example
cd examples/langchain-agent
pnpm start
```

## Key concepts

- `X402Tool` extends LangChain's `StructuredTool` — works with any LangChain agent
- Payment is handled transparently via `MockPayer` (swap for `SolanaUSDCPayer` in production)
- The tool validates input against the Zod schema before making any network calls
