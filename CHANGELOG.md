# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
