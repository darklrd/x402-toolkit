const packages = [
  {
    name: 'x402-tool-server',
    desc: 'Fastify middleware that gates routes with 402',
    path: 'packages/x402-tool-server',
  },
  {
    name: 'x402-agent-client',
    desc: 'Fetch wrapper + OpenAI adapter with auto-pay',
    path: 'packages/x402-agent-client',
  },
  {
    name: 'x402-adapters',
    desc: 'Solana USDC payer/verifier (devnet + mainnet)',
    path: 'packages/x402-adapters',
  },
  {
    name: 'x402-langchain',
    desc: 'LangChain StructuredTool with built-in 402',
    path: 'packages/x402-langchain',
  },
];

export default function PackageCards() {
  return (
    <section className="bg-slate-950 py-16 sm:py-24" id="packages">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold text-white">Packages</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {packages.map((pkg) => (
            <a
              key={pkg.name}
              href={`https://github.com/darklrd/x402-toolkit/tree/main/${pkg.path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-accent-500 hover:bg-slate-900"
            >
              <h3 className="font-mono text-sm font-semibold text-accent-400 group-hover:text-accent-300">
                {pkg.name}
              </h3>
              <p className="mt-2 text-sm text-slate-400">{pkg.desc}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
