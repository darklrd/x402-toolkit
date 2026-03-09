FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/x402-tool-server/package.json packages/x402-tool-server/
COPY packages/x402-agent-client/package.json packages/x402-agent-client/
COPY packages/x402-adapters/package.json packages/x402-adapters/
COPY examples/paid-weather-tool/package.json examples/paid-weather-tool/
COPY examples/cli-agent-demo/package.json examples/cli-agent-demo/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

EXPOSE 3000

CMD ["node", "scripts/dev.mjs"]
