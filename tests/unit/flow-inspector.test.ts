import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import type { EnrichedFlowStep } from '../../site/src/lib/flow-types';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual };
});

let FlowInspector: (props: { steps: EnrichedFlowStep[] }) => ReturnType<typeof createElement>;

const makeSteps = (...types: EnrichedFlowStep['type'][]): EnrichedFlowStep[] =>
  types.map((type, i) => {
    const base = { id: i, timestampMs: i * 100 };
    switch (type) {
      case 'request': return { ...base, type, url: 'https://api.example.com/weather', method: 'GET', headers: {} };
      case '402': return { ...base, type, status: 402 as const, headers: {}, challenge: { version: 1, nonce: 'n', expiresAt: '2026-01-01T00:00:00Z', requestHash: 'h', price: '1000', recipient: 'r' } };
      case 'signing': return { ...base, type };
      case 'signed': return { ...base, type, signature: 'sig_abcdef123456' };
      case 'retry': return { ...base, type, url: 'https://api.example.com/weather', method: 'GET', headers: { 'x-payment-proof': 'proof_xyz' } };
      case 'success': return { ...base, type, status: 200, data: { weather: 'sunny' } };
      case 'error': return { ...base, type, message: 'Server returned 500' };
    }
  });

describe('FlowInspector', () => {
  beforeEach(async () => {
    const mod = await import('../../site/src/components/FlowInspector');
    FlowInspector = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when steps is empty', () => {
    const { container } = render(createElement(FlowInspector, { steps: [] }));
    expect(container.innerHTML).toBe('');
  });

  it('renders header with Flow Inspector text', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request') }));
    expect(screen.getByText(/Flow Inspector/)).toBeDefined();
  });

  it('renders progress pills for all step types', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request') }));
    const pills = container.querySelectorAll('[data-testid^="pill-"]');
    expect(pills.length).toBe(6);
  });

  it('shows request step with URL', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request') }));
    expect(screen.getAllByText(/api\.example\.com\/weather/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows 402 step with Payment Required', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request', '402') }));
    expect(screen.getByText('Payment Required')).toBeDefined();
  });

  it('shows signing step with active pulse', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request', '402', 'signing') }));
    const dots = container.querySelectorAll('[data-testid="step-dot"]');
    const lastDot = dots[dots.length - 1];
    expect(lastDot.className).toContain('animate-pulse');
  });

  it('shows signed step with truncated signature', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request', '402', 'signing', 'signed') }));
    expect(screen.getAllByText(/sig_abcd/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows retry step with proof header mention', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request', '402', 'signing', 'signed', 'retry') }));
    // Retry step is the last, auto-expanded, showing x-payment-proof header
    expect(screen.getByText('x-payment-proof')).toBeDefined();
  });

  it('shows success step with status code', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request', '402', 'signing', 'signed', 'retry', 'success') }));
    expect(screen.getAllByText('200 OK').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error step with red styling', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request', 'error') }));
    expect(screen.getAllByText('Server returned 500').length).toBeGreaterThanOrEqual(1);
    const redEl = container.querySelector('.text-red-400');
    expect(redEl).toBeTruthy();
  });

  it('collapse button hides step list', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request') }));
    expect(container.querySelector('[data-testid="step-list"]')).toBeTruthy();
    const btn = screen.getByLabelText('Collapse');
    fireEvent.click(btn);
    expect(container.querySelector('[data-testid="step-list"]')).toBeNull();
  });

  it('expand button shows step list', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request') }));
    const btn = screen.getByLabelText('Collapse');
    fireEvent.click(btn);
    expect(container.querySelector('[data-testid="step-list"]')).toBeNull();
    const expandBtn = screen.getByLabelText('Expand');
    fireEvent.click(expandBtn);
    expect(container.querySelector('[data-testid="step-list"]')).toBeTruthy();
  });

  it('clicking a step row expands detail', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request', '402') }));
    // First step (request) is not last, so collapsed by default
    const rows = container.querySelectorAll('[role="button"]');
    fireEvent.click(rows[0]);
    expect(container.querySelectorAll('.ml-8').length).toBeGreaterThanOrEqual(2);
  });

  it('clicking expanded step row collapses it', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request') }));
    // Only step is last, so auto-expanded
    const row = container.querySelector('[role="button"]')!;
    expect(container.querySelector('.ml-8')).toBeTruthy();
    fireEvent.click(row);
    expect(container.querySelector('.ml-8')).toBeNull();
  });

  it('last step auto-expands', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request', '402') }));
    // Last step (402) should have detail visible
    const details = container.querySelectorAll('.ml-8');
    expect(details.length).toBe(1);
  });

  it('timestamps display correctly', () => {
    render(createElement(FlowInspector, { steps: makeSteps('request', '402') }));
    expect(screen.getByText('0ms')).toBeDefined();
    expect(screen.getByText('100ms')).toBeDefined();
  });

  it('multiple steps render in order', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request', '402', 'signing') }));
    const rows = container.querySelectorAll('[role="button"]');
    expect(rows.length).toBe(3);
  });

  it('progress pills update status as steps arrive', () => {
    const { container } = render(createElement(FlowInspector, { steps: makeSteps('request', '402') }));
    const requestPill = container.querySelector('[data-testid="pill-request"]');
    const fourOhTwoPill = container.querySelector('[data-testid="pill-402"]');
    const signingPill = container.querySelector('[data-testid="pill-signing"]');
    expect(requestPill?.getAttribute('data-status')).toBe('done');
    expect(fourOhTwoPill?.getAttribute('data-status')).toBe('done');
    expect(signingPill?.getAttribute('data-status')).toBe('active');
  });
});
