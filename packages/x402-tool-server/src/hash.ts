/**
 * Canonical request hashing.
 *
 * requestHash = SHA-256(
 *   METHOD           + "\n" +
 *   PATHNAME         + "\n" +
 *   CANONICAL_QUERY  + "\n" +   ← query keys sorted lexicographically, percent-encoded
 *   RAW_BODY_BYTES
 * )
 *
 * This is documented in docs/DESIGN.md §requestHash.
 */
import { createHash } from 'crypto';

/**
 * Produce the canonical query string: keys sorted, values percent-encoded.
 * Returns empty string if there are no query parameters.
 */
export function canonicalQueryString(rawQuery: string): string {
  if (!rawQuery) return '';
  const params = new URLSearchParams(rawQuery);
  const pairs: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    pairs.push([k, v]);
  }
  pairs.sort(([a], [b]) => a.localeCompare(b));
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * Compute the requestHash for a given request.
 *
 * @param method      - HTTP method (uppercase, e.g. "GET")
 * @param pathname    - URL path without query string (e.g. "/weather")
 * @param rawQuery    - raw query string without leading "?" (may be empty)
 * @param rawBody     - raw body bytes (empty Buffer for GET)
 * @returns lowercase hex SHA-256 digest
 */
export function computeRequestHash(
  method: string,
  pathname: string,
  rawQuery: string,
  rawBody: Buffer,
): string {
  const canonical = `${method.toUpperCase()}\n${pathname}\n${canonicalQueryString(rawQuery)}\n`;
  const hash = createHash('sha256');
  hash.update(canonical, 'utf8');
  hash.update(rawBody);
  return hash.digest('hex');
}
