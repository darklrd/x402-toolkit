# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **@darklrd/x402-agent-client**: `BudgetTracker` — agent spend budget with string-based decimal math, `reserve`/`release`/`reset` API, `BudgetExceededError` thrown before payment when limit is reached
- **x402-tool-server**: `openApiPlugin` — auto-generates OpenAPI 3.0 spec from priced routes at `GET /x402/openapi.json`, includes `x-x402-*` pricing extensions, 402 challenge response schemas, lazy-cached, customizable title/version/servers
- **x402-tool-server**: `rateLimitMiddleware` — in-memory fixed-window rate limiter, runs before payment gate, configurable `maxRequests`/`windowMs`/`keyExtractor`, returns 429 with `Retry-After`
- **@darklrd/x402-agent-client**: OpenAI adapter helpers — `toOpenAITool`, `toOpenAITools`, `parseToolCall`, `executeToolCall`, `serializeResult`
- **examples/openai-agent** — full OpenAI function calling loop with x402 tool use; fallback mode when `OPENAI_API_KEY` not set
- **x402-langchain** — LangChain `StructuredTool` adapter for x402 priced endpoints
  - `X402Tool` class: wraps any x402 endpoint as a LangChain-compatible tool
  - `createX402Tools()` factory for batch creation of multiple tools
  - Hand-rolled Zod→JSON Schema conversion supporting `string`, `number`, `boolean`, `enum`, `array`, `object`, `optional`
  - Peer deps: `@langchain/core >=0.3.0`, `zod >=3.22.0`
  - 7 unit tests + 4 integration E2E tests
- **examples/langchain-agent** — Working LangChain ReAct agent example with x402 tool calling
- Receipt endpoint: `GET /x402/receipts/:nonce` — retrieve payment receipts for audit/verification
  - `MemoryReceiptStore` — in-memory store with configurable TTL and automatic expiry sweep
  - `ReceiptStore` interface for custom backends (database, Redis, etc.)
  - Middleware auto-saves receipts after successful payment verification when `receiptStore` is provided
  - 5 new unit tests covering store save/retrieve/expiry and endpoint 200/404 flows

### Changed
- `X402MiddlewareOptions` now accepts optional `receiptStore` property

### Infrastructure
- Added `Dockerfile` and `docker-compose.yml` for one-click demo deployment
- Added `.github/ISSUE_TEMPLATE/` (bug report + feature request), `PULL_REQUEST_TEMPLATE.md`, and `FUNDING.yml`
- Overhauled root `README.md`: comparison table vs coinbase/x402, improved badges, cleaner quickstart

## [0.2.0] - 2026-03-01

### Added
- `x402-adapters/solana`: Real on-chain USDC payment adapter for Solana devnet
  - `SolanaUSDCPayer` — builds and sends SPL token transfer + memo tx; auto-detects private key format (base58 string or JSON array)
  - `SolanaUSDCVerifier` — fetches and validates on-chain tx: mint, recipient ATA, amount, memo binding, blockTime freshness
  - `constants.ts` — USDC devnet mint, program IDs, default RPC/commitment
  - Exported via `x402-adapters/solana` subpath to keep `@solana/web3.js` out of mock-only bundles
- `examples/paid-weather-tool`: `PAYMENT_MODE=solana` env-var switch selects `SolanaUSDCVerifier`
- `examples/cli-agent-demo`: `PAYMENT_MODE=solana` env-var switch selects `SolanaUSDCPayer`; prints payer wallet at startup
- `examples/.env.solana.example`: template for Solana devnet env vars
- `scripts/setup-devnet.ts`: checks SOL/USDC balances, detects missing ATAs, auto-detects key format
- 29 new unit tests covering `SolanaUSDCPayer` and `SolanaUSDCVerifier` (total: 77 tests)

### Security
- Solana memo binding: every payment tx includes `Memo("${nonce}|${requestHash}")` — an on-chain tx from a different request cannot be replayed even if it reaches the same recipient
- Amount check uses `bigint` to avoid floating-point precision errors

## [0.1.0] - 2024-01-01

### Added
- `x402-tool-server`: Fastify middleware for 402-based payment gates
  - `createX402Middleware` plugin
  - `pricedRoute` / `pricedHandler` route factories
  - SHA-256 `requestHash` canonicalization
  - In-memory idempotency store with `Idempotency-Key` header support
  - Nonce replay protection
- `@darklrd/x402-agent-client`: Client library
  - `x402Fetch` — 402 → pay → retry loop
  - `createTool` — agent-friendly tool wrapper
- `x402-adapters`: Mock adapter
  - `MockPayer` — deterministic HMAC-SHA256 proof
  - `MockVerifier` — validates HMAC proof, expiry, requestHash
- Examples: `paid-weather-tool`, `cli-agent-demo`
- Docs: `SEQUENCE.md`, `THREAT_MODEL.md`, `DESIGN.md`
- CI: GitHub Actions workflow
