import { describe, it, expect } from 'vitest';
import { canonicalJson, computeMcpRequestHash } from 'x402-mcp';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ x: [{ b: 1, a: 2 }, 'z'] })).toBe('{"x":[{"a":2,"b":1},"z"]}');
  });

  it('omits undefined object values and encodes null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });
});

describe('computeMcpRequestHash', () => {
  const base = { transportPath: '/mcp', toolName: 'get_weather', args: { city: 'London' } };

  it('produces a stable 64-char hex digest independent of JSON-RPC id', () => {
    // The function never takes the JSON-RPC `id` as input, so a retry with a
    // different id binds to the same hash.
    const h1 = computeMcpRequestHash({ ...base });
    const h2 = computeMcpRequestHash({ ...base });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable regardless of argument key order', () => {
    const h1 = computeMcpRequestHash({ transportPath: '/mcp', toolName: 't', args: { a: 1, b: 2 } });
    const h2 = computeMcpRequestHash({ transportPath: '/mcp', toolName: 't', args: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
  });

  it('changes when the tool name changes', () => {
    const h1 = computeMcpRequestHash({ ...base, toolName: 'get_weather' });
    const h2 = computeMcpRequestHash({ ...base, toolName: 'get_price' });
    expect(h1).not.toBe(h2);
  });

  it('changes when the arguments change', () => {
    const h1 = computeMcpRequestHash({ ...base, args: { city: 'London' } });
    const h2 = computeMcpRequestHash({ ...base, args: { city: 'Paris' } });
    expect(h1).not.toBe(h2);
  });

  it('changes when the transport path changes', () => {
    const h1 = computeMcpRequestHash({ ...base, transportPath: '/mcp' });
    const h2 = computeMcpRequestHash({ ...base, transportPath: '/rpc' });
    expect(h1).not.toBe(h2);
  });
});
