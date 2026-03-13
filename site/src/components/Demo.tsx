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
  }, [wallet, connection]);

  const handleToolSelect = useCallback((t: 'weather' | 'price') => {
    setTool(t);
    setInputValue(t === 'weather' ? 'London' : 'BTC');
  }, []);

  const handleCall = useCallback(async () => {
    if (!payer) return;

    setSteps([]);
    setResult(null);
    setError(null);
    setSignature(null);
    setDurationMs(null);
    setLoading(true);

    const param = tool === 'weather' ? 'city' : 'symbol';
    const url = `${DEMO_SERVER_URL}/${tool}?${param}=${encodeURIComponent(inputValue || (tool === 'weather' ? 'London' : 'BTC'))}`;

    const start = performance.now();

    try {
      const onStep = (step: FlowStep) => {
        setSteps((prev) => [...prev, step]);
        if (step.type === 'success') {
          setResult(step.data);
        }
        if (step.type === 'signing') {
          const signingStep = steps.find((s) => s.type === '402');
          if (signingStep && signingStep.type === '402') {
            setSignature(null);
          }
        }
      };

      await x402BrowserFetch(url, payer, onStep);

      const elapsed = Math.round(performance.now() - start);
      setDurationMs(elapsed);

      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.type === '402') {
        setSignature(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setSteps((prev) => [...prev, { type: 'error', message }]);
    } finally {
      setLoading(false);
    }
  }, [payer, tool, inputValue, steps]);

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
