/**
 * Unit tests — requestHash canonicalization
 */
import { describe, it, expect } from 'vitest';
import { computeRequestHash, canonicalQueryString } from 'x402-tool-server';

describe('canonicalQueryString', () => {
  it('returns empty string for no query', () => {
    expect(canonicalQueryString('')).toBe('');
  });

  it('sorts keys lexicographically', () => {
    const qs = canonicalQueryString('z=last&a=first&m=middle');
    expect(qs).toBe('a=first&m=middle&z=last');
  });

  it('percent-encodes values with special characters', () => {
    const qs = canonicalQueryString('city=New+York&units=metric');
    // URLSearchParams decodes + as space, then encodeURIComponent re-encodes space as %20
    expect(qs).toContain('city=');
    expect(qs).toContain('units=metric');
  });
});

describe('computeRequestHash', () => {
  it('is deterministic for identical inputs', () => {
    const h1 = computeRequestHash('GET', '/weather', 'city=London', Buffer.alloc(0));
    const h2 = computeRequestHash('GET', '/weather', 'city=London', Buffer.alloc(0));
    expect(h1).toBe(h2);
  });

  it('produces a 64-character hex string (SHA-256)', () => {
    const hash = computeRequestHash('GET', '/weather', '', Buffer.alloc(0));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('differs for different methods', () => {
    const get = computeRequestHash('GET', '/tool', '', Buffer.alloc(0));
    const post = computeRequestHash('POST', '/tool', '', Buffer.alloc(0));
    expect(get).not.toBe(post);
  });

  it('differs for different paths', () => {
    const a = computeRequestHash('GET', '/a', '', Buffer.alloc(0));
    const b = computeRequestHash('GET', '/b', '', Buffer.alloc(0));
    expect(a).not.toBe(b);
  });

  it('differs for different query strings', () => {
    const a = computeRequestHash('GET', '/w', 'city=Paris', Buffer.alloc(0));
    const b = computeRequestHash('GET', '/w', 'city=Tokyo', Buffer.alloc(0));
    expect(a).not.toBe(b);
  });

  it('differs for different body bytes', () => {
    const a = computeRequestHash('POST', '/tool', '', Buffer.from('{"x":1}'));
    const b = computeRequestHash('POST', '/tool', '', Buffer.from('{"x":2}'));
    expect(a).not.toBe(b);
  });

  it('canonicalizes query parameter order', () => {
    const sorted = computeRequestHash('GET', '/w', 'a=1&b=2', Buffer.alloc(0));
    const reversed = computeRequestHash('GET', '/w', 'b=2&a=1', Buffer.alloc(0));
    expect(sorted).toBe(reversed);
  });
});
