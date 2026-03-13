# x402 Playground Site

Interactive demo site for the x402 payment protocol. Connect a Solana wallet, call a paid API, and watch the x402 flow in real time.

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_DEMO_SERVER_URL` | URL of the x402 demo server (e.g. `https://your-demo-server.railway.app`) |

Copy `.env.example` to `.env` and fill in your values. The demo section shows a "not configured" message if the variable is missing.

## Run Locally

```bash
pnpm install
pnpm --filter x402-playground-site dev
```

Opens at `http://localhost:5173/x402-toolkit/`.

## Build

```bash
pnpm --filter x402-playground-site build
```

Output goes to `site/dist/`. The Vite `base` is set to `/x402-toolkit/` for GitHub Pages.

## GitHub Pages Deployment

The site is deployed via GitHub Actions on push to `main`. The workflow builds the site and publishes `site/dist/` to the `gh-pages` branch.
