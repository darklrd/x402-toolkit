import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import type { EnrichedFlowStep } from '../../site/src/lib/flow-types';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual };
});

let FlowStepRow: (props: { step: EnrichedFlowStep; isActive: boolean; isLast: boolean }) => ReturnType<typeof createElement>;

const requestStep: EnrichedFlowStep = {
  id: 0, timestampMs: 142, type: 'request',
  url: 'https://api.example.com/weather', method: 'GET', headers: {},
};

describe('FlowStepRow', () => {
  beforeEach(async () => {
    const mod = await import('../../site/src/components/FlowStepRow');
    FlowStepRow = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders timestamp', () => {
    render(createElement(FlowStepRow, { step: requestStep, isActive: false, isLast: false }));
    expect(screen.getByText('142ms')).toBeDefined();
  });

  it('renders step icon', () => {
    render(createElement(FlowStepRow, { step: requestStep, isActive: false, isLast: false }));
    expect(screen.getByText('→')).toBeDefined();
  });

  it('renders summary text', () => {
    render(createElement(FlowStepRow, { step: requestStep, isActive: false, isLast: false }));
    expect(screen.getByText('GET https://api.example.com/weather')).toBeDefined();
  });

  it('active step has pulse animation', () => {
    const { container } = render(createElement(FlowStepRow, { step: requestStep, isActive: true, isLast: false }));
    const dot = container.querySelector('[data-testid="step-dot"]');
    expect(dot?.className).toContain('animate-pulse');
  });

  it('inactive step has no pulse', () => {
    const { container } = render(createElement(FlowStepRow, { step: requestStep, isActive: false, isLast: false }));
    const dot = container.querySelector('[data-testid="step-dot"]');
    expect(dot?.className).not.toContain('animate-pulse');
  });

  it('click toggles detail expansion', () => {
    const { container } = render(createElement(FlowStepRow, { step: requestStep, isActive: false, isLast: false }));
    const row = container.firstElementChild!;
    // Initially collapsed (isLast=false)
    expect(container.querySelector('.ml-8')).toBeNull();
    fireEvent.click(row);
    // Now expanded - StepDetail should appear
    expect(container.querySelector('.ml-8')).toBeTruthy();
    fireEvent.click(row);
    // Collapsed again
    expect(container.querySelector('.ml-8')).toBeNull();
  });
});
