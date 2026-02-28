# x402 Payment Flow — Sequence Diagram

## Happy path (client pays, server accepts)

```
Client                        Server                         Payer
  │                              │                              │
  │── GET /weather?city=Paris ──▶│                              │
  │                              │  (route has x402Pricing)     │
  │                              │  compute requestHash         │
  │                              │  generate nonce, expiresAt   │
  │◀── 402 { x402: challenge } ──│                              │
  │                              │                              │
  │── payer.pay(challenge) ─────────────────────────────────────▶
  │◀─ PaymentProof ─────────────────────────────────────────────│
  │                              │                              │
  │── GET /weather?city=Paris ──▶│                              │
  │   X-Payment-Proof: <b64>     │  verifier.verify(proof,      │
  │                              │    requestHash, pricing)      │
  │                              │  check nonce not replayed     │
  │◀── 200 { city, temp, ... } ──│                              │
```

## Idempotency path (second call with same Idempotency-Key)

```
Client                        Server
  │                              │
  │── GET /weather?city=Paris ──▶│  Idempotency-Key: abc-123
  │   X-Payment-Proof: <proof>   │  → key not found, proceed
  │◀── 200 { ... }  ─────────────│  → store response under key abc-123
  │                              │
  │── GET /weather?city=Paris ──▶│  Idempotency-Key: abc-123
  │   X-Payment-Proof: <proof2>  │  → key found, requestHash matches
  │◀── 200 { ... }  ─────────────│    return stored response (no handler exec)
  │   X-Idempotent-Replay: true  │    no payment deducted
```

## Conflict path (Idempotency-Key reused with different request)

```
Client                        Server
  │                              │
  │── GET /weather?city=Paris ──▶│  Idempotency-Key: abc-123
  │◀── 200 ──────────────────────│  → store with requestHash(Paris)
  │                              │
  │── GET /weather?city=Tokyo ──▶│  Idempotency-Key: abc-123
  │◀── 409 { error: "reused" } ──│  → requestHash(Tokyo) ≠ stored hash
```

## Nonce replay attempt

```
Client                        Server
  │                              │
  │── GET /weather ─────────────▶│  → 402 with nonce=X
  │◀── 402 challenge ────────────│
  │                              │
  │── GET /weather ─────────────▶│  X-Payment-Proof: proof(nonce=X)
  │   X-Payment-Proof: proof(X)  │  verify OK, record nonce X as used
  │◀── 200 ──────────────────────│
  │                              │
  │── GET /weather ─────────────▶│  X-Payment-Proof: proof(nonce=X) (same!)
  │   X-Payment-Proof: proof(X)  │  nonce X already in usedNonces → reject
  │◀── 402 { replay detected } ──│
```

## requestHash canonicalization

```
requestHash = SHA-256(
  METHOD + "\n" +               // e.g. "GET\n"
  PATHNAME + "\n" +             // e.g. "/weather\n"
  CANONICAL_QUERY + "\n" +      // keys sorted, values percent-encoded
  RAW_BODY_BYTES                // empty Buffer for GET
)
```

Example for `GET /weather?city=Paris&units=metric`:

```
canonical_query = "city=Paris&units=metric"   (keys already sorted)
input = "GET\n/weather\ncity=Paris&units=metric\n"
hash  = sha256(input + empty_body) = "4a9f..."
```
