# x402 Demo Server

Express server that exposes paid API endpoints (weather, price) gated by x402 payment proofs on Solana devnet.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `RECIPIENT_WALLET` | Solana devnet wallet address to receive USDC payments | — |
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `PORT` | HTTP port | `3402` |

Copy `.env.example` to `.env` and fill in your values.

## Run Locally

```bash
pnpm install
pnpm --filter x402-demo-server run build
pnpm --filter x402-demo-server run start
```

The server listens on `http://localhost:3402`.

## Deploy to Railway

1. Connect your repo to [Railway](https://railway.app)
2. Set the root directory to the repo root (the Dockerfile handles workspace filtering)
3. Set environment variables in the Railway dashboard
4. Railway auto-detects the `demo-server/Dockerfile` — or point it manually
