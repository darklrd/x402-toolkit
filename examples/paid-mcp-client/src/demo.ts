/**
 * paid-mcp-client — connects a real MCP client to the paid MCP server and
 * pays for tool calls with a MockPayer under a spend budget + policy.
 *
 *   pnpm --filter paid-mcp-client start
 *
 * Expects paid-mcp-server to be running (see scripts/mcp-dev.mjs which wires
 * both together: `pnpm dev:mcp`).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createX402McpHttpTransport } from 'x402-mcp';
import { MockPayer } from 'x402-adapters';
import { BudgetTracker } from '@darklrd/x402-agent-client';

const MCP_URL = process.env.MCP_URL ?? 'http://127.0.0.1:3402/mcp';
const SECRET = process.env.MOCK_SECRET ?? 'mock-secret';

const ALLOWED_TOOLS = new Set(['get_weather', 'get_price']);

const transport = createX402McpHttpTransport(MCP_URL, {
  payer: new MockPayer({ secret: SECRET }),
  budget: new BudgetTracker({ maxSpend: '0.01' }),
  // Policy runs in code before any payment is signed — never trust model text.
  policy: ({ toolName, challenge }) => {
    const allowed = ALLOWED_TOOLS.has(toolName) && challenge.network === 'mock';
    console.log(
      `  policy: ${toolName} @ ${challenge.price} ${challenge.asset} on ${challenge.network} -> ${
        allowed ? 'allow' : 'deny'
      }`,
    );
    return allowed;
  },
});

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content[0]?.text ?? '';
}

const client = new Client({ name: 'cli-mcp-demo', version: '0.1.0' });
await client.connect(transport);
console.log('connected to', MCP_URL);

const tools = await client.listTools();
console.log('free tools/list ->', tools.tools.map((t) => t.name).join(', '));

console.log('calling get_weather (paid)…');
const weather = await client.callTool({ name: 'get_weather', arguments: { city: 'London' } });
console.log('  get_weather ->', textOf(weather));

console.log('calling get_price (paid)…');
const price = await client.callTool({ name: 'get_price', arguments: { symbol: 'BTC' } });
console.log('  get_price ->', textOf(price));

await client.close();
console.log('done ✅');
