import type { EnrichedFlowStep } from '../lib/flow-types';

interface StepDetailProps {
  step: EnrichedFlowStep;
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <span className="text-slate-500">{key}</span>
          <span className="text-slate-300 break-all">{value}</span>
        </div>
      ))}
    </div>
  );
}

function JsonBlock({ data }: { data: Record<string, string> }) {
  return (
    <pre className="overflow-x-auto whitespace-pre text-slate-300 leading-relaxed max-h-48 overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function StepDetail({ step }: StepDetailProps) {
  return (
    <div className="mt-2 ml-8 rounded bg-slate-900/80 border border-slate-800/50 p-3 font-mono text-xs">
      {step.type === 'request' && (
        <div className="space-y-2">
          <div className="text-slate-300">
            <span className="text-accent-400 font-semibold">{step.method}</span>{' '}
            {step.url}
          </div>
          <HeadersTable headers={step.headers} />
        </div>
      )}
      {step.type === '402' && (
        <div className="space-y-2">
          <div className="text-amber-400 font-semibold">402 Payment Required</div>
          <pre className="overflow-x-auto whitespace-pre text-slate-300 leading-relaxed max-h-48 overflow-y-auto">
            {JSON.stringify(step.challenge, null, 2)}
          </pre>
        </div>
      )}
      {step.type === 'signing' && (
        <div className="text-orange-400">Awaiting wallet signature...</div>
      )}
      {step.type === 'signed' && (
        <div className="space-y-1">
          <div className="text-slate-300 break-all">{step.signature}</div>
        </div>
      )}
      {step.type === 'retry' && (
        <div className="space-y-2">
          <div className="text-slate-300">
            <span className="text-accent-400 font-semibold">{step.method}</span>{' '}
            {step.url}
          </div>
          <HeadersTable headers={step.headers} />
        </div>
      )}
      {step.type === 'success' && (
        <div className="space-y-2">
          <div className="text-green-400 font-semibold">{step.status} OK</div>
          <JsonBlock data={step.data} />
        </div>
      )}
      {step.type === 'error' && (
        <div className="text-red-400">{step.message}</div>
      )}
    </div>
  );
}
