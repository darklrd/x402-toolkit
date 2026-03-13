import type { FlowStep } from '../lib/x402-browser-fetch';

interface StepDef {
  key: string;
  icon: string;
  label: string;
}

const stepDefs: StepDef[] = [
  { key: 'request', icon: '→', label: 'Request' },
  { key: '402', icon: '←', label: '402' },
  { key: 'signing', icon: '⚡', label: 'Sign tx' },
  { key: 'retry', icon: '→', label: 'Retry' },
  { key: 'success', icon: '✅', label: '200' },
];

type StepStatus = 'pending' | 'active' | 'done' | 'error';

function getStepStatus(stepKey: string, steps: FlowStep[]): StepStatus {
  const reachedTypes = new Set(steps.map((s) => s.type));
  const hasError = steps.some((s) => s.type === 'error');

  if (stepKey === 'success' && hasError) return 'error';
  if (reachedTypes.has(stepKey as FlowStep['type'])) return 'done';

  const order = ['request', '402', 'signing', 'retry', 'success'];
  const stepIdx = order.indexOf(stepKey);
  const lastReachedIdx = Math.max(...order.map((k, i) => (reachedTypes.has(k as FlowStep['type']) ? i : -1)));

  if (stepIdx === lastReachedIdx + 1 && !hasError) return 'active';
  return 'pending';
}

const statusClasses: Record<StepStatus, string> = {
  pending: 'border-slate-700 bg-slate-900 text-slate-600',
  active: 'border-accent-500 bg-accent-950 text-accent-400 animate-pulse',
  done: 'border-green-600 bg-green-950 text-green-400',
  error: 'border-red-600 bg-red-950 text-red-400',
};

interface FlowVisualizerProps {
  steps: FlowStep[];
}

export default function FlowVisualizer({ steps }: FlowVisualizerProps) {
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-1">
      {stepDefs.map((def, i) => {
        const status = getStepStatus(def.key, steps);
        return (
          <div key={def.key} className="flex items-center gap-1 sm:flex-1">
            <div
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${statusClasses[status]}`}
            >
              <span>{def.icon}</span>
              <span>{def.label}</span>
            </div>
            {i < stepDefs.length - 1 && (
              <span className="hidden text-slate-600 sm:inline">›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
