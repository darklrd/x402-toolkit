import { useState } from 'react';
import type { EnrichedFlowStep } from '../lib/flow-types';
import { formatTimestamp, stepColor, stepIcon, stepLabel } from '../lib/flow-types';
import StepDetail from './StepDetail';

interface FlowStepRowProps {
  step: EnrichedFlowStep;
  isActive: boolean;
  isLast: boolean;
}

function getSummary(step: EnrichedFlowStep): string {
  switch (step.type) {
    case 'request':
      return `GET ${step.url}`;
    case '402':
      return `402 Payment Required`;
    case 'signing':
      return 'Awaiting wallet signature...';
    case 'signed':
      return `sig: ${step.signature.slice(0, 8)}...`;
    case 'retry':
      return `GET ${step.url}`;
    case 'success':
      return `${step.status} OK`;
    case 'error':
      return step.message;
  }
}

export default function FlowStepRow({ step, isActive, isLast }: FlowStepRowProps) {
  const [expanded, setExpanded] = useState(isLast);
  const colors = stepColor(step.type);

  return (
    <div
      className="px-4 py-3 border-b border-slate-800/30 last:border-b-0 cursor-pointer hover:bg-slate-900/50 transition-colors"
      onClick={() => setExpanded((prev) => !prev)}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-2.5 h-2.5 rounded-full ${colors.bg} ${isActive ? 'animate-pulse ring-2 ring-offset-1 ring-offset-slate-950' : ''}`}
          data-testid="step-dot"
        />
        <span className="text-[10px] font-mono text-slate-600 w-12 text-right shrink-0">
          {formatTimestamp(step.timestampMs)}
        </span>
        <span className={`${colors.text} text-xs`}>{stepIcon(step.type)}</span>
        <span className={`${colors.text} text-xs font-semibold`}>{stepLabel(step.type)}</span>
        <span className="text-xs font-mono text-slate-400 truncate">{getSummary(step)}</span>
      </div>
      {expanded && <StepDetail step={step} />}
    </div>
  );
}
