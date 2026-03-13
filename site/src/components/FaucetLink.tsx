export default function FaucetLink() {
  return (
    <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-4 text-sm">
      <p className="font-medium text-amber-300">Need devnet tokens?</p>
      <div className="mt-2 flex flex-wrap gap-4">
        <a
          href="https://faucet.solana.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 hover:text-amber-300"
        >
          Get devnet SOL →
        </a>
        <a
          href="https://spl-token-faucet.com/?token-name=USDC"
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 hover:text-amber-300"
        >
          Get devnet USDC →
        </a>
      </div>
    </div>
  );
}
