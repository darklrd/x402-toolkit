# Contributing

Thank you for your interest in contributing to x402-toolkit!

## Setup

```bash
git clone https://github.com/your-org/x402-toolkit
cd x402-toolkit
pnpm install
pnpm build
pnpm test
```

## Workflow

1. Fork the repo and create a feature branch.
2. Make your changes with tests.
3. Run `pnpm lint && pnpm test` — both must pass.
4. Open a PR with a clear description.

## Package structure

| Package | Purpose |
|---|---|
| `packages/x402-tool-server` | Fastify middleware (no mock logic) |
| `packages/x402-agent-client` | Client fetch wrapper + tool factory (no mock logic) |
| `packages/x402-adapters` | Payer/verifier implementations: `src/mock/` (HMAC, offline), `src/solana/` (real on-chain USDC) |

## Rules

- Keep public API surface small (see `index.ts` exports).
- No mock/adapter logic in core packages — adapters only.
- All PRs must include unit tests.
- Document deviations from the x402 spec in `docs/DESIGN.md`.
- New adapter implementations go in `packages/x402-adapters/src/<name>/` and are exported via a subpath (e.g. `x402-adapters/solana`) to avoid forcing heavy deps on users of other adapters.
