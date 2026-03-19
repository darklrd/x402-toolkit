import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { EnrichedFlowStep } from '../../site/src/lib/flow-types';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual };
});

let StepDetail: (props: { step: EnrichedFlowStep }) => ReturnType<typeof createElement>;

describe('StepDetail', () => {
  beforeEach(async () => {
    const mod = await import('../../site/src/components/StepDetail');
    StepDetail = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows method and URL for request step', () => {
    const step: EnrichedFlowStep = {
      id: 0, timestampMs: 0, type: 'request',
      url: 'https://api.example.com/weather', method: 'GET', headers: {},
    };
    render(createElement(StepDetail, { step }));
    expect(screen.getByText('GET')).toBeDefined();
    expect(screen.getByText('https://api.example.com/weather')).toBeDefined();
  });

  it('renders headers table for request with headers', () => {
    const step: EnrichedFlowStep = {
      id: 0, timestampMs: 0, type: 'request',
      url: 'https://api.example.com', method: 'GET',
      headers: { 'content-type': 'application/json' },
    };
    render(createElement(StepDetail, { step }));
    expect(screen.getByText('content-type')).toBeDefined();
    expect(screen.getByText('application/json')).toBeDefined();
  });

  it('shows challenge JSON for 402 step', () => {
    const step: EnrichedFlowStep = {
      id: 1, timestampMs: 100, type: '402', status: 402,
      headers: {}, challenge: {
        version: 1, nonce: 'abc', expiresAt: '2026-01-01T00:00:00Z',
        requestHash: 'hash', price: '1000', recipient: 'addr',
      },
    };
    render(createElement(StepDetail, { step }));
    expect(screen.getByText('402 Payment Required')).toBeDefined();
    expect(screen.getByText(/"nonce": "abc"/)).toBeDefined();
  });

  it('shows full signature for signed step', () => {
    const step: EnrichedFlowStep = {
      id: 3, timestampMs: 200, type: 'signed', signature: '3xK7mP9f_long_sig',
    };
    render(createElement(StepDetail, { step }));
    expect(screen.getByText('3xK7mP9f_long_sig')).toBeDefined();
  });

  it('shows response JSON for success step', () => {
    const step: EnrichedFlowStep = {
      id: 5, timestampMs: 300, type: 'success', status: 200,
      data: { weather: 'sunny' },
    };
    render(createElement(StepDetail, { step }));
    expect(screen.getByText('200 OK')).toBeDefined();
    expect(screen.getByText(/"weather": "sunny"/)).toBeDefined();
  });

  it('shows error message in red', () => {
    const step: EnrichedFlowStep = {
      id: 6, timestampMs: 400, type: 'error', message: 'Server returned 500',
    };
    const { container } = render(createElement(StepDetail, { step }));
    expect(screen.getByText('Server returned 500')).toBeDefined();
    const errorEl = container.querySelector('.text-red-400');
    expect(errorEl).toBeTruthy();
  });

  it('has scrollable max-h class for long JSON', () => {
    const step: EnrichedFlowStep = {
      id: 5, timestampMs: 300, type: 'success', status: 200,
      data: { weather: 'sunny' },
    };
    const { container } = render(createElement(StepDetail, { step }));
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('max-h-48');
  });
});
