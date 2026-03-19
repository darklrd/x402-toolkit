import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enrichFlowStep,
  formatTimestamp,
  stepColor,
  stepIcon,
  stepLabel,
} from '../../site/src/lib/flow-types';
import type { FlowStep } from '../../site/src/lib/x402-browser-fetch';

describe('enrichFlowStep', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => 1142 });
  });

  it('converts request step', () => {
    const step: FlowStep = { type: 'request', url: 'https://api.example.com/weather' };
    const result = enrichFlowStep(step, 0, 1000, 'https://api.example.com/weather', null);
    expect(result).toEqual({
      id: 0,
      timestampMs: 142,
      type: 'request',
      url: 'https://api.example.com/weather',
      method: 'GET',
      headers: {},
    });
  });

  it('converts 402 step', () => {
    const challenge = {
      version: 1,
      nonce: 'abc123',
      expiresAt: '2026-01-01T00:00:00Z',
      requestHash: 'hash123',
      price: '1000',
      recipient: 'addr123',
    };
    const step: FlowStep = { type: '402', challenge };
    const result = enrichFlowStep(step, 1, 1000, 'https://api.example.com/weather', null);
    expect(result.type).toBe('402');
    if (result.type === '402') {
      expect(result.status).toBe(402);
      expect(result.challenge).toEqual(challenge);
      expect(result.headers).toEqual({ 'content-type': 'application/json' });
    }
  });

  it('converts signing step', () => {
    const step: FlowStep = { type: 'signing' };
    const result = enrichFlowStep(step, 2, 1000, '', null);
    expect(result).toEqual({ id: 2, timestampMs: 142, type: 'signing' });
  });

  it('converts signed step', () => {
    const step: FlowStep = { type: 'signed', signature: 'sig_abc' };
    const result = enrichFlowStep(step, 3, 1000, '', null);
    expect(result.type).toBe('signed');
    if (result.type === 'signed') {
      expect(result.signature).toBe('sig_abc');
    }
  });

  it('converts retry step with proof header', () => {
    const step: FlowStep = { type: 'retry' };
    const result = enrichFlowStep(step, 4, 1000, 'https://api.example.com/weather', 'proof_xyz');
    expect(result.type).toBe('retry');
    if (result.type === 'retry') {
      expect(result.url).toBe('https://api.example.com/weather');
      expect(result.method).toBe('GET');
      expect(result.headers).toEqual({ 'x-payment-proof': 'proof_xyz' });
    }
  });

  it('converts success step', () => {
    const step: FlowStep = { type: 'success', status: 200, data: { temp: '18' } };
    const result = enrichFlowStep(step, 5, 1000, '', null);
    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ temp: '18' });
    }
  });

  it('converts error step', () => {
    const step: FlowStep = { type: 'error', message: 'Server error' };
    const result = enrichFlowStep(step, 6, 1000, '', null);
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.message).toBe('Server error');
    }
  });
});

describe('formatTimestamp', () => {
  it('returns "0ms" for 0', () => {
    expect(formatTimestamp(0)).toBe('0ms');
  });

  it('returns "142ms" for values under 1000', () => {
    expect(formatTimestamp(142)).toBe('142ms');
  });

  it('returns seconds with decimal for values >= 1000', () => {
    expect(formatTimestamp(1200)).toBe('1.2s');
    expect(formatTimestamp(2100)).toBe('2.1s');
  });
});

describe('stepColor', () => {
  it('returns correct classes for each type', () => {
    expect(stepColor('request').text).toBe('text-accent-400');
    expect(stepColor('402').text).toBe('text-amber-400');
    expect(stepColor('signing').text).toBe('text-orange-400');
    expect(stepColor('signed').text).toBe('text-orange-400');
    expect(stepColor('retry').text).toBe('text-accent-400');
    expect(stepColor('success').text).toBe('text-green-400');
    expect(stepColor('error').text).toBe('text-red-400');
  });
});

describe('stepIcon', () => {
  it('returns correct icon for each type', () => {
    expect(stepIcon('request')).toBe('→');
    expect(stepIcon('402')).toBe('←');
    expect(stepIcon('signing')).toBe('⚡');
    expect(stepIcon('signed')).toBe('✍');
    expect(stepIcon('retry')).toBe('→');
    expect(stepIcon('success')).toBe('✅');
    expect(stepIcon('error')).toBe('❌');
  });
});

describe('stepLabel', () => {
  it('returns correct label for each type', () => {
    expect(stepLabel('request')).toBe('Request');
    expect(stepLabel('402')).toBe('Payment Required');
    expect(stepLabel('signing')).toBe('Signing');
    expect(stepLabel('signed')).toBe('Signed');
    expect(stepLabel('retry')).toBe('Retry');
    expect(stepLabel('success')).toBe('Success');
    expect(stepLabel('error')).toBe('Error');
  });
});
