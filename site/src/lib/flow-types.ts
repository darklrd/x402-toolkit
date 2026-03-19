import type { FlowStep } from './x402-browser-fetch';

interface FlowStepBase {
  id: number;
  timestampMs: number;
}

export interface RequestStep extends FlowStepBase {
  type: 'request';
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface ChallengeStep extends FlowStepBase {
  type: '402';
  status: 402;
  headers: Record<string, string>;
  challenge: {
    version: number;
    nonce: string;
    expiresAt: string;
    requestHash: string;
    price: string;
    recipient: string;
  };
}

export interface SigningStep extends FlowStepBase {
  type: 'signing';
}

export interface SignedStep extends FlowStepBase {
  type: 'signed';
  signature: string;
}

export interface RetryStep extends FlowStepBase {
  type: 'retry';
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface SuccessStep extends FlowStepBase {
  type: 'success';
  status: number;
  data: Record<string, string>;
}

export interface ErrorStep extends FlowStepBase {
  type: 'error';
  message: string;
}

export type EnrichedFlowStep =
  | RequestStep
  | ChallengeStep
  | SigningStep
  | SignedStep
  | RetryStep
  | SuccessStep
  | ErrorStep;

export type FlowStepType = EnrichedFlowStep['type'];

export function enrichFlowStep(
  step: FlowStep,
  id: number,
  startTime: number,
  url: string,
  proofHeader: string | null,
): EnrichedFlowStep {
  const timestampMs = Math.round(performance.now() - startTime);
  const base = { id, timestampMs };

  switch (step.type) {
    case 'request':
      return { ...base, type: 'request', url: step.url, method: 'GET', headers: {} };
    case '402':
      return {
        ...base,
        type: '402',
        status: 402 as const,
        headers: { 'content-type': 'application/json' },
        challenge: step.challenge,
      };
    case 'signing':
      return { ...base, type: 'signing' };
    case 'signed':
      return { ...base, type: 'signed', signature: step.signature };
    case 'retry':
      return {
        ...base,
        type: 'retry',
        url,
        method: 'GET',
        headers: proofHeader ? { 'x-payment-proof': proofHeader } : {},
      };
    case 'success':
      return { ...base, type: 'success', status: step.status, data: step.data as Record<string, string> };
    case 'error':
      return { ...base, type: 'error', message: step.message };
  }
}

export function formatTimestamp(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const colorMap: Record<FlowStepType, { text: string; border: string; bg: string }> = {
  request: { text: 'text-accent-400', border: 'border-l-accent-500', bg: 'bg-accent-500' },
  '402': { text: 'text-amber-400', border: 'border-l-amber-500', bg: 'bg-amber-500' },
  signing: { text: 'text-orange-400', border: 'border-l-orange-500', bg: 'bg-orange-500' },
  signed: { text: 'text-orange-400', border: 'border-l-orange-500', bg: 'bg-orange-500' },
  retry: { text: 'text-accent-400', border: 'border-l-accent-500', bg: 'bg-accent-500' },
  success: { text: 'text-green-400', border: 'border-l-green-500', bg: 'bg-green-500' },
  error: { text: 'text-red-400', border: 'border-l-red-500', bg: 'bg-red-500' },
};

export function stepColor(type: FlowStepType): { text: string; border: string; bg: string } {
  return colorMap[type];
}

const iconMap: Record<FlowStepType, string> = {
  request: '→',
  '402': '←',
  signing: '⚡',
  signed: '✍',
  retry: '→',
  success: '✅',
  error: '❌',
};

export function stepIcon(type: FlowStepType): string {
  return iconMap[type];
}

const labelMap: Record<FlowStepType, string> = {
  request: 'Request',
  '402': 'Payment Required',
  signing: 'Signing',
  signed: 'Signed',
  retry: 'Retry',
  success: 'Success',
  error: 'Error',
};

export function stepLabel(type: FlowStepType): string {
  return labelMap[type];
}
