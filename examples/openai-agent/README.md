# openai-agent

Example: OpenAI function calling loop with x402 tool use.

Starts a local Fastify server with a priced `/secret` endpoint, then runs an OpenAI agent that discovers and calls the tool automatically.

## Modes

### With `OPENAI_API_KEY` set (full agent loop)

```sh
export OPENAI_API_KEY=sk-...
pnpm start
```

Example output:

```
Server started at http://127.0.0.1:XXXXX
Agent answer: The secret answer is "the answer is 42."
```

### Without `OPENAI_API_KEY` (fallback demo)

```sh
pnpm start
```

Example output:

```
Server started at http://127.0.0.1:XXXXX
OPENAI_API_KEY not set — running in fallback demo mode.
Direct tool result: {
  "secret": "the answer is 42"
}
```

## How it works

1. A Fastify server starts with `createX402Middleware` and a priced `/secret` route.
2. `createTool` wraps the endpoint into a `Tool` compatible with `x402-agent-client`.
3. `toOpenAITools` converts the tool into the OpenAI function-calling format.
4. The agent loop calls `chat.completions.create` with `tools`, then uses `parseToolCall` + `executeToolCall` to handle tool calls and feed results back into the conversation.
5. The loop exits when the model returns `finish_reason: "stop"`.
