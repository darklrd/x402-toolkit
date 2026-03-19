import { useState } from 'react';
import type { EnrichedFlowStep, FlowStepType } from '../lib/flow-types';
import FlowStepRow from './FlowStepRow';

interface FlowInspectorProps {
  steps: EnrichedFlowStep[];
}

type PillStatus = 'pending' | 'active' | 'done' | 'error';

const pillOrder: FlowStepType[] = ['request', '402', 'signing', 'signed', 'retry', 'success'];

const pillStatusClasses: Record<PillStatus, string> = {
  pending: 'bg-slate-800 text-slate-600',
  active: 'bg-accent-900 text-accent-400 animate-pulse',
  done: 'bg-green-950 text-green-500',
  error: 'bg-red-950 text-red-400',
};

const pillLabels: Record<FlowStepType, string> = {
  request: 'REQ',
  '402': '402',
  signing: 'SIGN',
  signed: 'SIGNED',
  retry: 'RETRY',
  success: '200',
  error: 'ERR',
};

function getPillStatus(pillType: FlowStepType, steps: EnrichedFlowStep[]): PillStatus {
  const reachedTypes = new Set(steps.map((s) => s.type));
  const hasError = steps.some((s) => s.type === 'error');

  if (pillType === 'success' && hasError) return 'error';
  if (reachedTypes.has(pillType)) return 'done';

  const stepIdx = pillOrder.indexOf(pillType);
  const lastReachedIdx = Math.max(...pillOrder.map((k, i) => (reachedTypes.has(k) ? i : -1)));

  if (stepIdx === lastReachedIdx + 1 && !hasError) return 'active';
  return 'pending';
}

export default function FlowInspector({ steps }: FlowInspectorProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (steps.length === 0) return null;

  const lastStepType = steps[steps.length - 1].type;
  const isStepActive = (step: EnrichedFlowStep): boolean => {
    if (step !== steps[steps.length - 1]) return false;
    return lastStepType !== 'success' && lastStepType !== 'error';
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
        <span className="text-sm font-semibold text-slate-300">🔍 Flow Inspector</span>
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="text-slate-500 hover:text-slate-300 text-sm"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-slate-800/50">
        {pillOrder.map((type) => {
          const status = getPillStatus(type, steps);
          return (
            <span
              key={type}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${pillStatusClasses[status]}`}
              data-testid={`pill-${type}`}
              data-status={status}
            >
              {pillLabels[type]}
            </span>
          );
        })}
      </div>
      {!collapsed && (
        <div data-testid="step-list">
          {steps.map((step, i) => (
            <FlowStepRow
              key={step.id}
              step={step}
              isActive={isStepActive(step)}
              isLast={i === steps.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
