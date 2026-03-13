interface ResultPanelProps {
  data: Record<string, unknown> | null;
  error: string | null;
  signature: string | null;
  durationMs: number | null;
}

export default function ResultPanel({ data, error, signature, durationMs }: ResultPanelProps) {
  if (!data && !error) return null;

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <>
          <pre className="overflow-x-auto text-sm leading-relaxed text-slate-300">
            {JSON.stringify(data, null, 2)}
          </pre>
          {durationMs !== null && (
            <p className="mt-2 text-xs text-slate-500">Response time: {durationMs}ms</p>
          )}
          {signature && (
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-accent-400 hover:text-accent-300"
            >
              View transaction on Solana Explorer →
            </a>
          )}
        </>
      )}
    </div>
  );
}
