# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- `x402-agent-client`: Client library
  - `x402Fetch` — 402 → pay → retry loop
  - `createTool` — agent-friendly tool wrapper
- `x402-adapters`: Mock adapter
  - `MockPayer` — deterministic HMAC-SHA256 proof
  - `MockVerifier` — validates HMAC proof, expiry, requestHash
- Examples: `paid-weather-tool`, `cli-agent-demo`
- Docs: `SEQUENCE.md`, `THREAT_MODEL.md`, `DESIGN.md`
- CI: GitHub Actions workflow
