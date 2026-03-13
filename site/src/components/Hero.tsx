export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-indigo-950 via-slate-900 to-slate-950 py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
          x402 — HTTP 402 Micropayments
          <br />
          <span className="text-accent-400">for AI Agents</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
          Pay-per-call tools. One protocol. Every LLM framework.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://github.com/darklrd/x402-toolkit"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
          >
            ⭐ Star on GitHub
          </a>
          <a
            href="#demo"
            className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-500"
          >
            Try the Demo ↓
          </a>
        </div>
      </div>
    </section>
  );
}
