import { useState, useMemo, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { BrowserSolanaUSDCPayer } from '../lib/browser-payer';
import { x402BrowserFetch, type FlowStep } from '../lib/x402-browser-fetch';
import { DEMO_SERVER_URL } from '../lib/constants';
import ToolPicker from './ToolPicker';
import FlowVisualizer from './FlowVisualizer';
import ResultPanel from './ResultPanel';
import FaucetLink from './FaucetLink';

export default function Demo() {
  const wallet = useWallet();
  const { connection } = useConnection();

  const [tool, setTool] = useState<'weather' | 'price'>('weather');
  const [inputValue, setInputValue] = useState('London');
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const payer = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return new BrowserSolanaUSDCPayer(wallet, connection);
  }, [wallet.publicKey, wallet.signTransaction, connection]);

  const handleToolSelect = useCallback((t: 'weather' | 'price') => {
    setTool(t);
    setInputValue(t === 'weather' ? 'London' : 'BTC');
  }, []);

  const handleCall = useCallback(async () => {
    if (!payer || !DEMO_SERVER_URL) return;

    setSteps([]);
    setResult(null);
    setError(null);
    setSignature(null);
    setDurationMs(null);
    setLoading(true);

    const param = tool === 'weather' ? 'city' : 'symbol';
    const url = `${DEMO_SERVER_URL}/${tool}?${param}=${encodeURIComponent(inputValue || (tool === 'weather' ? 'London' : 'BTC'))}`;

    const start = performance.now();
    const localSteps: FlowStep[] = [];

    try {
      const onStep = (step: FlowStep) => {
        localSteps.push(step);
        setSteps([...localSteps]);
        if (step.type === 'success') {
          setResult(step.data);
        }
        if (step.type === 'signed') {
          setSignature(step.signature);
        }
      };

      await x402BrowserFetch(url, payer, onStep);

      const elapsed = Math.round(performance.now() - start);
      setDurationMs(elapsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      localSteps.push({ type: 'error', message });
      setSteps([...localSteps]);
    } finally {
      setLoading(false);
    }
  }, [payer, tool, inputValue]);

  if (!DEMO_SERVER_URL) {
    return (
      <section className="bg-gradient-to-b from-slate-950 to-slate-900 py-16 sm:py-24" id="demo">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white">Live Demo</h2>
          <p className="mt-4 text-sm text-slate-400">
            Demo server not configured. Set <code className="text-slate-300">VITE_DEMO_SERVER_URL</code> to enable.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-b from-slate-950 to-slate-900 py-16 sm:py-24" id="demo">
      <div className="mx-auto max-w-2xl px-6">
        <h2 className="text-center text-3xl font-bold text-white">Live Demo</h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          Connect your Solana wallet and call a paid tool on devnet
        </p>

        <div className="mt-8 space-y-6">
          <ToolPicker
            selected={tool}
            onSelect={handleToolSelect}
            inputValue={inputValue}
            onInputChange={setInputValue}
          />

          {wallet.connected && <FaucetLink />}

          <button
            onClick={handleCall}
            disabled={!wallet.connected || loading}
            className="w-full rounded-lg bg-accent-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {!wallet.connected
              ? 'Connect wallet first'
              : loading
                ? 'Processing...'
                : `Call ${tool === 'weather' ? 'Weather' : 'Price'} Tool (0.001 USDC)`}
          </button>

          <FlowVisualizer steps={steps} />
          <ResultPanel data={result} error={error} signature={signature} durationMs={durationMs} />
        </div>
      </div>
    </section>
  );
}
