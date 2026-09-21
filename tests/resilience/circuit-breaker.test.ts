import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker, BreakerOpenError } from '../../src/resilience/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker('github', {
      failureThreshold: 3,
      windowMs: 10_000,
      probeIntervalMs: 5_000
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state and allows calls', () => {
    expect(breaker.currentState).toBe('CLOSED');
    expect(breaker.allowCall()).toBe('allowed');
  });

  it('trips to OPEN state when failures reach threshold in window', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.currentState).toBe('CLOSED');

    breaker.recordFailure(); // 3rd failure
    expect(breaker.currentState).toBe('OPEN');
    expect(() => breaker.allowCall()).toThrow(BreakerOpenError);
  });

  it('transitions to HALF_OPEN after probeInterval and recovers on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.currentState).toBe('OPEN');

    // Advance past probeIntervalMs (5000ms)
    vi.advanceTimersByTime(5001);

    // Next call should be allowed as a probe
    expect(breaker.allowCall()).toBe('probe');
    expect(breaker.currentState).toBe('HALF_OPEN');

    // Success closes the breaker
    breaker.recordSuccess();
    expect(breaker.currentState).toBe('CLOSED');
    expect(breaker.allowCall()).toBe('allowed');
  });

  it('re-opens immediately if probe fails in HALF_OPEN state', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.currentState).toBe('OPEN');

    vi.advanceTimersByTime(5001);
    expect(breaker.allowCall()).toBe('probe');
    expect(breaker.currentState).toBe('HALF_OPEN');

    // Probe failure trips it back to OPEN
    breaker.recordFailure();
    expect(breaker.currentState).toBe('OPEN');
    expect(() => breaker.allowCall()).toThrow(BreakerOpenError);
  });

  it('discards old failures outside the rolling window', () => {
    breaker.recordFailure();
    breaker.recordFailure();

    // Advance 11s past windowMs (10s)
    vi.advanceTimersByTime(11_000);

    // 3rd failure now won't trip because previous 2 are expired
    breaker.recordFailure();
    expect(breaker.currentState).toBe('CLOSED');
  });
});
