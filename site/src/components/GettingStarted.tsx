import { useState } from 'react';

function CopyBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <div className="flex items-center justify-between gap-4">
        <code className="text-sm text-accent-300">{command}</code>
        <button
          onClick={copy}
          className="shrink-0 rounded bg-slate-800 px-3 py-1 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function GettingStarted() {
  return (
    <section className="bg-slate-950 py-16 sm:py-24" id="install">
      <div className="mx-auto max-w-3xl space-y-4 px-6">
        <h2 className="text-center text-3xl font-bold text-white">Install</h2>
        <div className="mt-8 space-y-4">
          <CopyBlock label="Server" command="pnpm add x402-tool-server x402-adapters" />
          <CopyBlock label="Client" command="pnpm add x402-agent-client x402-adapters" />
          <CopyBlock label="LangChain" command="pnpm add x402-langchain x402-adapters" />
        </div>
      </div>
    </section>
  );
}
