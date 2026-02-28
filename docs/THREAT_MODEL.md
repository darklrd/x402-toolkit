# Threat Model

## Assets

| Asset | Value |
|---|---|
| Tool responses | Prevent unpaid access |
| Payment proofs | Prevent forgery / reuse |
| Nonces | Ensure single-use |
| Idempotency store | Prevent double-charge |

---

## Threats & Mitigations

### T1 — Proof Replay

**Threat**: Attacker captures a valid `X-Payment-Proof` header and replays it to get free responses.

**Mitigations**:
1. **Nonce tracking** — the server stores every nonce it has seen (until the proof's `expiresAt` + grace period). A second request with the same nonce returns 402 immediately.
2. **requestHash binding** — the proof binds to the exact canonical request. Replaying against a different URL/body/query fails the `requestHash` check in `MockVerifier`.
3. **Short expiry** — challenges expire after 300 seconds (configurable). A captured proof is only usable during this window.

**Residual risk**: If the nonce store is lost (process restart, in-memory), nonces are forgotten. Mitigation for production: use a persistent nonce store (Redis with TTL).

---

### T2 — Nonce Reuse (client-side)

**Threat**: A buggy or malicious client reuses the same nonce for different requests.

**Mitigation**: The server-side nonce store rejects any request whose proof nonce has already been seen, regardless of the requestHash.

---

### T3 — Proof Theft (MITM)

**Threat**: An attacker intercepts the `X-Payment-Proof` header in transit.

**Mitigations**:
1. **Always use TLS in production** — proofs in transit must be encrypted.
2. **requestHash binding** — a stolen proof can only be replayed against the exact same request (URL, method, body, query). This limits the attack surface to the specific endpoint being called.
3. **Short expiry** — stolen proofs become invalid after 5 minutes.

---

### T4 — requestHash Collision

**Threat**: Attacker crafts a different request that produces the same SHA-256 requestHash, enabling proof reuse.

**Mitigation**: SHA-256 collision resistance. The probability of a meaningful collision is negligible (2^-128 for a chosen-prefix attack). No known practical attacks exist.

---

### T5 — Idempotency Abuse

**Threat**: Client reuses an `Idempotency-Key` with a different request to get a different response for free.

**Mitigation**: The server computes and stores `requestHash` alongside the idempotency key. If the stored `requestHash` differs from the new request, the server returns 409 Conflict. The second request is never executed and no payment is attempted.

---

### T6 — Clock Skew / Replay via Expired-Nonce Gap

**Threat**: Attacker holds a proof until the server's nonce store evicts it (TTL expiry), then replays.

**Mitigations**:
1. Nonces are stored until `proof.expiresAt + 60s grace`. After expiry, the proof's `expiresAt` check in `MockVerifier` also fails (independent of nonce store).
2. Both checks must pass independently, so evicting an expired nonce does not enable replay.

---

### T7 — Forged Proofs (Mock adapter)

**Threat**: Attacker forges a `MockPayer` proof by guessing the HMAC secret.

**Mitigations**:
1. Use a long, random secret (≥32 bytes) in production mock deployments.
2. HMAC-SHA256 is secure against brute-force with a strong secret.
3. In production, replace `MockVerifier` with an on-chain verifier that validates cryptographic signatures (e.g. EIP-712, Solana signatures).

---

### T8 — DoS via Large Nonce Store

**Threat**: Attacker floods the server with unique nonces, exhausting memory.

**Mitigation**: Nonces are evicted when their expiry passes. With a 5-minute TTL and a 300-second expiry, the maximum live nonces is bounded by the request rate × 300s. Rate limiting (not included in MVP) should be added in production.

---

## Out of Scope (MVP)

- Real on-chain payment verification
- Rate limiting
- Proof confidentiality (TLS assumed in production)
- Multi-tenant nonce stores (single-process in MVP; use Redis for multi-node)
