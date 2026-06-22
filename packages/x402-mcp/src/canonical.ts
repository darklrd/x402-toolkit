/**
 * Canonical MCP payment hash.
 *
 * A payment proof must bind to the intended MCP tool call. The hash excludes
 * the JSON-RPC `id` (clients may retry with a different id) but includes the
 * actual paid operation:
 *
 *   requestHash = SHA-256(
 *     "MCP\n" +
 *     transportPath + "\n" +
 *     "tools/call\n" +
 *     toolName + "\n" +
 *     canonicalJson(arguments)
 *   )
 *
 * canonicalJson sorts object keys recursively; arrays preserve order.
 */
import { createHash } from 'crypto';

/**
 * Deterministic JSON serialization: object keys are sorted recursively,
 * array order is preserved. Object entries whose value is `undefined` are
 * omitted (matching JSON.stringify semantics).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  const type = typeof value;

  if (type === 'number') {
    return Number.isFinite(value as number) ? String(value) : 'null';
  }
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bigint') return (value as bigint).toString();

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(',')}]`;
  }

  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      if (obj[key] === undefined) continue;
      entries.push(`${JSON.stringify(key)}:${serialize(obj[key])}`);
    }
    return `{${entries.join(',')}}`;
  }

  // Functions/symbols are not valid JSON — encode as null.
  return 'null';
}

export interface McpRequestHashInput {
  /** Fastify route path of the MCP transport, e.g. "/mcp". */
  transportPath: string;
  /** MCP tool name (params.name). */
  toolName: string;
  /** Tool arguments (params.arguments ?? {}). */
  args: unknown;
}

/**
 * Compute the canonical MCP request hash that a proof binds to.
 * Returns a lowercase hex SHA-256 digest.
 */
export function computeMcpRequestHash(input: McpRequestHashInput): string {
  const canonical =
    `MCP\n${input.transportPath}\ntools/call\n${input.toolName}\n` +
    canonicalJson(input.args ?? {});
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** SHA-256 hex of the canonical arguments (used for receipt argumentsHash). */
export function computeArgumentsHash(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args ?? {}), 'utf8').digest('hex');
}
