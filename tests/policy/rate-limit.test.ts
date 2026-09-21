/**
 * Unit tests for RateLimiter — token bucket behavior, per-tool limits,
 * window refresh, and default config.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../../src/policy/rate-limit.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls within the configured limit', () => {
    limiter.configure('github.search_repos', { requests: 3, windowSeconds: 60 });
    expect(limiter.check('github', 'search_repos')).toBe(true);
    expect(limiter.check('github', 'search_repos')).toBe(true);
    expect(limiter.check('github', 'search_repos')).toBe(true);
  });

  it('denies calls that exceed the limit', () => {
    limiter.configure('github.search_repos', { requests: 2, windowSeconds: 60 });
    limiter.check('github', 'search_repos');
    limiter.check('github', 'search_repos');
    expect(limiter.check('github', 'search_repos')).toBe(false);
  });

  it('refills tokens after the window elapses', () => {
    limiter.configure('github.search_repos', { requests: 1, windowSeconds: 10 });
    limiter.check('github', 'search_repos'); // consume
    expect(limiter.check('github', 'search_repos')).toBe(false); // denied

    // Advance past the window
    vi.advanceTimersByTime(10_001);
    expect(limiter.check('github', 'search_repos')).toBe(true); // refilled
  });

  it('applies default limits to unconfigured tools', () => {
    // Default is 60 req/min — should allow first call
    expect(limiter.check('unknown', 'some_tool')).toBe(true);
  });

  it('tracks remaining tokens correctly', () => {
    limiter.configure('github.create_issue', { requests: 5, windowSeconds: 60 });
    limiter.check('github', 'create_issue');
    limiter.check('github', 'create_issue');
    expect(limiter.remaining('github', 'create_issue')).toBe(3);
  });

  it('tracks different tools independently', () => {
    limiter.configure('github.read', { requests: 2, windowSeconds: 60 });
    limiter.configure('github.write', { requests: 1, windowSeconds: 60 });

    limiter.check('github', 'read');
    limiter.check('github', 'read');
    expect(limiter.check('github', 'read')).toBe(false);

    // write tool has its own separate bucket
    expect(limiter.check('github', 'write')).toBe(true);
  });
});
