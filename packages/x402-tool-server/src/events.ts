import { EventEmitter } from 'events';
import type { X402Challenge, PricingConfig } from './types.js';

export interface RequestInfo {
  method: string;
  url: string;
  ip: string;
}

export interface X402ChallengeEvent {
  challenge: X402Challenge;
  request: RequestInfo;
  timestamp: string;
}

export interface X402PaymentEvent {
  receipt: {
    nonce: string;
    payer: string;
    amount: string;
    asset: string;
    network: string;
    recipient: string;
    endpoint: string;
    method: string;
    requestHash: string;
  };
  request: RequestInfo;
  timestamp: string;
}

export type X402ErrorReason = 'invalid_proof' | 'nonce_replay';

export interface X402ErrorEvent {
  reason: X402ErrorReason;
  pricing: PricingConfig;
  request: RequestInfo;
  timestamp: string;
}

export interface X402EventMap {
  'x402:challenge': [event: X402ChallengeEvent];
  'x402:payment': [event: X402PaymentEvent];
  'x402:error': [event: X402ErrorEvent];
}

export class X402EventEmitter extends EventEmitter<X402EventMap> {}
