# x402-adapters

Payer and verifier adapters for x402-toolkit. Includes a mock adapter for development and a real Solana USDC adapter for production.

## Install

```bash
pnpm add x402-adapters
```

## Adapters

### Mock (development)

```ts
import { MockPayer, MockVerifier } from 'x402-adapters';

const payer = new MockPayer();
const verifier = new MockVerifier();
```

Zero setup, no blockchain, works offline. Perfect for local development and testing.

### Solana USDC (production)

```ts
import { SolanaUSDCPayer, SolanaUSDCVerifier } from 'x402-adapters';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');

// Client-side (agent)
const payer = new SolanaUSDCPayer(keypair, connection);

// Server-side (API)
const verifier = new SolanaUSDCVerifier(connection);
```

Real on-chain USDC transfers on Solana devnet or mainnet.

## Pluggable Interface

Both adapters implement `PayerInterface` and `VerifierInterface`:

```ts
interface PayerInterface {
  pay(challenge: X402Challenge, context: RequestContext): Promise<PaymentProof>;
}

interface VerifierInterface {
  verify(proof: PaymentProof, expected: ExpectedPayment): Promise<VerifyResult>;
}
```

Build your own adapter for any blockchain or payment rail.

## Links

- [GitHub](https://github.com/darklrd/x402-toolkit)
- [Playground](https://darklrd.github.io/x402-toolkit/)
- [x402 Protocol](https://x402.org)
