import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual };
});

let ArchitectureFlow: () => ReturnType<typeof createElement>;

describe('ArchitectureFlow', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    const mod = await import('../../site/src/components/ArchitectureFlow');
    ArchitectureFlow = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the "How It Works" heading', () => {
    render(createElement(ArchitectureFlow));
    expect(screen.getByText('How It Works')).toBeDefined();
  });

  it('renders the subtitle', () => {
    render(createElement(ArchitectureFlow));
    expect(screen.getByText(/HTTP 402 challenge-response flow/)).toBeDefined();
  });

  it('renders step indicator dots', () => {
    const { container } = render(createElement(ArchitectureFlow));
    const stepDots = container.querySelectorAll('.rounded-full');
    expect(stepDots.length).toBe(6);
  });

  it('starts in pre-animation state', () => {
    render(createElement(ArchitectureFlow));
    expect(screen.getByText('Starting flow…')).toBeDefined();
  });

  it('advances to step 1 after pause duration', async () => {
    vi.useFakeTimers();
    render(createElement(ArchitectureFlow));

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.queryByText('Starting flow…')).toBeNull();
    vi.useRealTimers();
  });

  it('progresses through all 6 steps', async () => {
    vi.useFakeTimers();
    render(createElement(ArchitectureFlow));

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    for (let i = 1; i < 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1900);
      });
    }

    const stepDots = screen.getAllByText(/^[1-6]$/);
    expect(stepDots.length).toBe(6);
    vi.useRealTimers();
  });

  it('loops back after completing all steps', async () => {
    vi.useFakeTimers();
    render(createElement(ArchitectureFlow));

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });
    for (let i = 1; i < 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1900);
      });
    }

    await act(async () => {
      vi.advanceTimersByTime(1900);
    });

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.queryByText('Starting flow…')).toBeNull();
    vi.useRealTimers();
  });

  it('pauses animation on mouse enter', async () => {
    vi.useFakeTimers();
    const { container } = render(createElement(ArchitectureFlow));

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    const animationContainer = container.querySelector('[class*="mt-12"]');
    if (animationContainer) {
      fireEvent.mouseEnter(animationContainer);
    }

    expect(screen.getByText(/Paused/)).toBeDefined();
    vi.useRealTimers();
  });

  it('resumes animation on mouse leave', async () => {
    vi.useFakeTimers();
    const { container } = render(createElement(ArchitectureFlow));

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    const animationContainer = container.querySelector('[class*="mt-12"]');
    if (animationContainer) {
      fireEvent.mouseEnter(animationContainer);
      fireEvent.mouseLeave(animationContainer);
    }

    expect(screen.queryByText(/Paused/)).toBeNull();
    vi.useRealTimers();
  });

  it('renders static view when reduced motion is preferred', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    vi.resetModules();
    const mod = await import('../../site/src/components/ArchitectureFlow');
    const StaticFlow = mod.default;
    render(createElement(StaticFlow));

    expect(screen.getByText('AI Agent')).toBeDefined();
    expect(screen.getByText('x402 Server')).toBeDefined();
    expect(screen.getByText('Solana')).toBeDefined();
    expect(screen.queryByText('Starting flow…')).toBeNull();
  });

  it('has correct section id for anchor links', () => {
    const { container } = render(createElement(ArchitectureFlow));
    const section = container.querySelector('#how-it-works');
    expect(section).toBeDefined();
    expect(section).not.toBeNull();
  });
});
