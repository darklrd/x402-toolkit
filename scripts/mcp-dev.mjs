#!/usr/bin/env node
/**
 * mcp-dev.mjs — starts paid-mcp-server, waits for /health, then runs
 * paid-mcp-client end-to-end in mock mode (no wallet required).
 *
 * Spawns tsx directly (avoids pnpm error noise when the server is SIGTERM'd).
 */
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SERVER_PORT = 3402;
const HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/health`;
const MAX_WAIT_MS = 15_000;
const POLL_MS = 300;

const tsx = join(root, 'node_modules', '.bin', 'tsx');

function startServer() {
  const serverEntry = join(root, 'examples', 'paid-mcp-server', 'src', 'server.ts');
  const proc = spawn(tsx, [serverEntry], {
    stdio: 'inherit',
    cwd: join(root, 'examples', 'paid-mcp-server'),
    env: { ...process.env, PORT: String(SERVER_PORT), HOST: '127.0.0.1' },
  });
  proc.on('error', (err) => {
    console.error('[mcp-dev] Server process error:', err.message);
    process.exit(1);
  });
  return proc;
}

async function waitForServer() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Server did not become ready within ${MAX_WAIT_MS}ms`);
}

async function runDemo() {
  return new Promise((resolve, reject) => {
    const demoEntry = join(root, 'examples', 'paid-mcp-client', 'src', 'demo.ts');
    const proc = spawn(tsx, [demoEntry], {
      stdio: 'inherit',
      cwd: join(root, 'examples', 'paid-mcp-client'),
      env: { ...process.env, MCP_URL: `http://127.0.0.1:${SERVER_PORT}/mcp` },
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`Demo exited with code ${code}`));
    });
  });
}

(async () => {
  console.log('\n[mcp-dev] Starting paid-mcp-server…');
  const server = startServer();

  try {
    console.log('[mcp-dev] Waiting for server to be ready…');
    await waitForServer();
    console.log('[mcp-dev] Server is ready. Running paid-mcp-client…\n');
    await runDemo();
    console.log('\n[mcp-dev] Demo complete. ✅');
  } catch (err) {
    console.error('\n[mcp-dev] Error:', err instanceof Error ? err.message : err);
    server.kill();
    process.exit(1);
  }

  server.kill('SIGTERM');
  await sleep(200);
  process.exit(0);
})();
