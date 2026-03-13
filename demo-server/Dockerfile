FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/ packages/
COPY demo-server/ demo-server/
RUN pnpm install --frozen-lockfile --filter x402-demo-server...
RUN pnpm -r --filter './packages/*' run build
RUN pnpm --filter x402-demo-server run build

FROM node:20-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app .
EXPOSE 3402
CMD ["node", "demo-server/dist/server.js"]
