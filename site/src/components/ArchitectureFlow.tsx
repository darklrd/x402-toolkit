import { useState, useEffect, useCallback, useMemo } from 'react';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

interface Step {
  from: 'agent' | 'server' | 'solana';
  to: 'agent' | 'server' | 'solana';
  label: string;
  sublabel: string;
  color: string;
  glowColor: string;
}

const STEPS: Step[] = [
  { from: 'agent', to: 'server', label: 'GET /api/weather', sublabel: 'Initial request', color: '#818cf8', glowColor: '#6366f1' },
  { from: 'server', to: 'agent', label: '402 Payment Required', sublabel: 'nonce, price, recipient', color: '#f87171', glowColor: '#ef4444' },
  { from: 'agent', to: 'solana', label: 'Send Payment', sublabel: 'USDC transfer via x402-agent-client', color: '#fb923c', glowColor: '#f97316' },
  { from: 'solana', to: 'agent', label: 'Tx Confirmed ✅', sublabel: 'Transaction signature', color: '#4ade80', glowColor: '#22c55e' },
  { from: 'agent', to: 'server', label: 'GET + X-Payment-Proof', sublabel: 'Retry with proof header', color: '#818cf8', glowColor: '#6366f1' },
  { from: 'server', to: 'agent', label: '200 OK', sublabel: '{ weather: "sunny" }', color: '#4ade80', glowColor: '#22c55e' },
];

const STEP_DURATION = 1800;
const PAUSE_DURATION = 2500;

const NODE_POSITIONS = {
  agent: { x: 120, y: 100 },
  server: { x: 400, y: 100 },
  solana: { x: 680, y: 100 },
} as const;

type NodeId = keyof typeof NODE_POSITIONS;

function getArrowPath(from: NodeId, to: NodeId): { x1: number; y1: number; x2: number; y2: number } {
  const f = NODE_POSITIONS[from];
  const t = NODE_POSITIONS[to];
  const offsetX = f.x < t.x ? 52 : -52;
  return { x1: f.x + offsetX, y1: f.y, x2: t.x - offsetX, y2: t.y };
}

function NodeBox({ id, label, icon, isActive, glowColor }: {
  id: string;
  label: string;
  icon: string;
  isActive: boolean;
  glowColor: string;
}) {
  const pos = NODE_POSITIONS[id as NodeId];
  return (
    <g>
      {isActive && (
        <rect
          x={pos.x - 56}
          y={pos.y - 42}
          width={112}
          height={84}
          rx={16}
          fill="none"
          stroke={glowColor}
          strokeWidth={2}
          opacity={0.6}
          className="animate-pulse"
        />
      )}
      <rect
        x={pos.x - 50}
        y={pos.y - 36}
        width={100}
        height={72}
        rx={12}
        fill={isActive ? 'rgba(99,102,241,0.15)' : 'rgba(30,27,75,0.5)'}
        stroke={isActive ? glowColor : '#334155'}
        strokeWidth={isActive ? 2 : 1}
        style={{
          filter: isActive ? `drop-shadow(0 0 12px ${glowColor}40)` : 'none',
          transition: 'all 0.4s ease',
        }}
      />
      <text
        x={pos.x}
        y={pos.y - 6}
        textAnchor="middle"
        fontSize={22}
        style={{ transition: 'transform 0.3s ease' }}
      >
        {icon}
      </text>
      <text
        x={pos.x}
        y={pos.y + 20}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill={isActive ? '#e0e7ff' : '#94a3b8'}
        style={{ transition: 'fill 0.3s ease' }}
      >
        {label}
      </text>
    </g>
  );
}

function AnimatedArrow({ step, isActive }: { step: Step; isActive: boolean }) {
  const { x1, y1, x2, y2 } = getArrowPath(step.from as NodeId, step.to as NodeId);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const id = `arrow-${step.from}-${step.to}-${step.label.replace(/\s/g, '')}`;
  const isLeftToRight = x1 < x2;
  const labelY = midY - 18;
  const sublabelY = midY - 6;

  return (
    <g style={{ opacity: isActive ? 1 : 0, transition: 'opacity 0.4s ease' }}>
      <defs>
        <linearGradient id={`grad-${id}`} x1={isLeftToRight ? '0%' : '100%'} y1="0%" x2={isLeftToRight ? '100%' : '0%'} y2="0%">
          <stop offset="0%" stopColor={step.color} stopOpacity={0.2} />
          <stop offset="50%" stopColor={step.color} stopOpacity={1} />
          <stop offset="100%" stopColor={step.color} stopOpacity={0.2} />
        </linearGradient>
      </defs>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={`url(#grad-${id})`}
        strokeWidth={2}
        strokeDasharray="6 4"
        className={isActive ? 'architecture-flow-dash' : ''}
      />
      <polygon
        points={isLeftToRight
          ? `${x2 - 8},${y2 - 5} ${x2},${y2} ${x2 - 8},${y2 + 5}`
          : `${x2 + 8},${y2 - 5} ${x2},${y2} ${x2 + 8},${y2 + 5}`
        }
        fill={step.color}
        style={{ filter: `drop-shadow(0 0 4px ${step.glowColor})` }}
      />
      {isActive && (
        <circle r={4} fill={step.color} style={{ filter: `drop-shadow(0 0 6px ${step.color})` }}>
          <animateMotion
            dur="0.8s"
            repeatCount="indefinite"
            path={`M${x1},${y1} L${x2},${y2}`}
          />
        </circle>
      )}
      <rect
        x={midX - 80} y={labelY - 11}
        width={160} height={30}
        rx={6}
        fill="rgba(15,23,42,0.85)"
        stroke={step.color}
        strokeWidth={0.5}
        strokeOpacity={0.4}
      />
      <text x={midX} y={labelY + 1} textAnchor="middle" fontSize={10} fontWeight={700} fill={step.color} fontFamily="monospace">
        {step.label}
      </text>
      <text x={midX} y={sublabelY + 10} textAnchor="middle" fontSize={8.5} fill="#94a3b8">
        {step.sublabel}
      </text>
    </g>
  );
}

function StepIndicator({ steps, activeStep }: { steps: Step[]; activeStep: number }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-2">
      {steps.map((step, i) => (
        <div
          key={i}
          className="flex items-center gap-2"
        >
          <div
            className="relative flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300"
            style={{
              backgroundColor: i === activeStep ? step.color : 'transparent',
              border: `2px solid ${i <= activeStep ? step.color : '#334155'}`,
              color: i === activeStep ? '#0f172a' : (i < activeStep ? step.color : '#475569'),
              boxShadow: i === activeStep ? `0 0 12px ${step.glowColor}60` : 'none',
            }}
          >
            {i + 1}
          </div>
          {i < steps.length - 1 && (
            <div
              className="h-0.5 w-4 rounded transition-colors duration-300"
              style={{ backgroundColor: i < activeStep ? steps[i + 1].color : '#334155' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StaticView() {
  return (
    <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-center">
      {[
        { icon: '🤖', name: 'AI Agent', desc: 'Sends request, handles payment' },
        { icon: '⚡', name: 'x402 Server', desc: '402 challenge + verification' },
        { icon: '◎', name: 'Solana', desc: 'On-chain USDC payment' },
      ].map((node, i) => (
        <div key={node.name} className="flex items-center gap-4">
          <div className="flex flex-col items-center rounded-xl border border-slate-700 bg-slate-900/60 px-6 py-4">
            <span className="text-2xl">{node.icon}</span>
            <span className="mt-1 text-sm font-semibold text-white">{node.name}</span>
            <span className="text-xs text-slate-400">{node.desc}</span>
          </div>
          {i < 2 && <span className="hidden text-slate-600 sm:block">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function ArchitectureFlow() {
  const reducedMotion = useReducedMotion();
  const [activeStep, setActiveStep] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);

  const totalSteps = STEPS.length;

  useEffect(() => {
    if (reducedMotion || isPaused) return;

    const timeout = setTimeout(() => {
      setActiveStep((prev) => {
        if (prev >= totalSteps - 1) return -1;
        return prev + 1;
      });
    }, activeStep === -1 ? PAUSE_DURATION : STEP_DURATION);

    return () => clearTimeout(timeout);
  }, [activeStep, isPaused, reducedMotion, totalSteps]);

  const handleMouseEnter = useCallback(() => setIsPaused(true), []);
  const handleMouseLeave = useCallback(() => setIsPaused(false), []);

  const activeNodes = useMemo(() => {
    if (activeStep < 0 || activeStep >= STEPS.length) return new Set<string>();
    const step = STEPS[activeStep];
    return new Set([step.from, step.to]);
  }, [activeStep]);

  const currentGlow = activeStep >= 0 && activeStep < STEPS.length
    ? STEPS[activeStep].glowColor
    : '#6366f1';

  return (
    <section className="bg-slate-950 py-16 sm:py-24" id="how-it-works">
      <style>{`
        @keyframes architecture-dash {
          to { stroke-dashoffset: -20; }
        }
        .architecture-flow-dash {
          animation: architecture-dash 0.6s linear infinite;
        }
      `}</style>
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold text-white">How It Works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-400">
          The HTTP 402 challenge-response flow — from request to payment to data.
        </p>

        {reducedMotion ? (
          <div className="mt-12">
            <StaticView />
          </div>
        ) : (
          <div
            className="mt-12"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Desktop SVG */}
            <div className="hidden sm:block">
              <svg
                viewBox="0 0 800 200"
                className="mx-auto w-full max-w-3xl"
                xmlns="http://www.w3.org/2000/svg"
              >
                <NodeBox id="agent" label="AI Agent" icon="🤖" isActive={activeNodes.has('agent')} glowColor={currentGlow} />
                <NodeBox id="server" label="x402 Server" icon="⚡" isActive={activeNodes.has('server')} glowColor={currentGlow} />
                <NodeBox id="solana" label="Solana" icon="◎" isActive={activeNodes.has('solana')} glowColor={currentGlow} />

                {STEPS.map((step, i) => (
                  <AnimatedArrow key={i} step={step} isActive={activeStep === i} />
                ))}
              </svg>
            </div>

            {/* Mobile layout */}
            <div className="flex flex-col items-center gap-6 sm:hidden">
              {activeStep >= 0 && activeStep < STEPS.length ? (
                <MobileStep step={STEPS[activeStep]} index={activeStep} />
              ) : (
                <div className="flex h-32 items-center text-sm text-slate-500">
                  Starting flow…
                </div>
              )}
            </div>

            <StepIndicator steps={STEPS} activeStep={activeStep} />

            {isPaused && (
              <p className="mt-3 text-center text-xs text-slate-500">
                ⏸ Paused — move cursor away to resume
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function MobileStep({ step, index }: { step: Step; index: number }) {
  const nodes: Record<string, { icon: string; label: string }> = {
    agent: { icon: '🤖', label: 'AI Agent' },
    server: { icon: '⚡', label: 'x402 Server' },
    solana: { icon: '◎', label: 'Solana' },
  };
  const from = nodes[step.from];
  const to = nodes[step.to];

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-xs font-medium text-slate-500">Step {index + 1} of {STEPS.length}</div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center">
          <span className="text-xl">{from.icon}</span>
          <span className="text-xs text-slate-400">{from.label}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-lg" style={{ color: step.color }}>→</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xl">{to.icon}</span>
          <span className="text-xs text-slate-400">{to.label}</span>
        </div>
      </div>
      <div className="text-center">
        <div className="font-mono text-xs font-bold" style={{ color: step.color }}>{step.label}</div>
        <div className="mt-0.5 text-xs text-slate-500">{step.sublabel}</div>
      </div>
    </div>
  );
}
