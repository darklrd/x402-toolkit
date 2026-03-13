import { useState } from 'react';
import { snippetMap, type SnippetKey } from '../data/snippets';

const tabs: SnippetKey[] = ['server', 'client', 'langchain', 'openai'];

export default function CodeSnippets() {
  const [active, setActive] = useState<SnippetKey>('server');

  return (
    <section className="bg-slate-900/50 py-16 sm:py-24" id="code">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="text-center text-3xl font-bold text-white">Quick Start</h2>
        <div className="mt-8 flex gap-1 overflow-x-auto rounded-t-lg bg-slate-800 p-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActive(tab)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                active === tab
                  ? 'bg-accent-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {snippetMap[tab].label}
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-b-lg bg-slate-950 p-6 text-sm leading-relaxed text-slate-300">
          <code>{snippetMap[active].code}</code>
        </pre>
      </div>
    </section>
  );
}
