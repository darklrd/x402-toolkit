#!/usr/bin/env node
/**
 * dev.mjs — starts paid-weather-tool server, waits for /health, then runs cli-agent-demo.
 *
 * Spawns tsx directly (avoids pnpm error noise when the server is SIGTERM'd).
 */
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SERVER_PORT = 3000;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/health`;
const MAX_WAIT_MS = 15_000;
const POLL_MS = 300;

// Resolve tsx binary from root node_modules
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function startServer() {
  const serverEntry = join(root, 'examples', 'paid-weather-tool', 'src', 'server.ts');
  const proc = spawn(tsx, [serverEntry], {
    stdio: 'inherit',
    cwd: join(root, 'examples', 'paid-weather-tool'),
    env: { ...process.env, PORT: String(SERVER_PORT) },
  });
  proc.on('error', (err) => {
    console.error('[dev] Server process error:', err.message);
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
    const demoEntry = join(root, 'examples', 'cli-agent-demo', 'src', 'demo.ts');
    const proc = spawn(tsx, [demoEntry], {
      stdio: 'inherit',
      cwd: join(root, 'examples', 'cli-agent-demo'),
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`Demo exited with code ${code}`));
    });
  });
}

(async () => {
  console.log('\n[dev] Starting paid-weather-tool server…');
  const server = startServer();

  try {
    console.log('[dev] Waiting for server to be ready…');
    await waitForServer();
    console.log('[dev] Server is ready. Running cli-agent-demo…\n');
    await runDemo();
    console.log('\n[dev] Demo complete. ✅');
  } catch (err) {
    console.error('\n[dev] Error:', err instanceof Error ? err.message : err);
    server.kill();
    process.exit(1);
  }

  server.kill('SIGTERM');
  // Give the server a moment to clean up, then exit.
  await sleep(200);
  process.exit(0);
})();
