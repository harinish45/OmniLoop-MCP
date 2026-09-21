import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IdempotencyGate } from '../../src/security/idempotency.js';
import type { ToolResult } from '../../src/connectors/connector.js';

describe('IdempotencyGate', () => {
  let gate: IdempotencyGate;

  const sampleResult: ToolResult = {
    content: [{ type: 'text', text: 'Operation completed' }],
    isError: false
  };

  beforeEach(() => {
    vi.useFakeTimers();
    gate = new IdempotencyGate({
      enabled: true,
      ttlSeconds: 60,
      maxCacheSize: 3
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates deterministic keys from identical inputs', () => {
    const key1 = IdempotencyGate.generateKey('create_issue', { title: 'Bug', priority: 1 });
    const key2 = IdempotencyGate.generateKey('create_issue', { title: 'Bug', priority: 1 });
    const key3 = IdempotencyGate.generateKey('create_issue', { title: 'Other' });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('returns undefined on cache miss and returns cached result after storing', () => {
    const key = 'idem-123';
    expect(gate.check(key)).toBeUndefined();

    gate.store(key, 'create_issue', sampleResult);
    const cached = gate.check(key);

    expect(cached).toEqual(sampleResult);
  });

  it('expires entries after ttl elapses', () => {
    const key = 'expire-key';
    gate.store(key, 'create_issue', sampleResult);

    expect(gate.check(key)).toBeDefined();

    vi.advanceTimersByTime(60_001);

    expect(gate.check(key)).toBeUndefined();
  });

  it('evicts oldest entries when reaching maxCacheSize', () => {
    gate.store('k1', 't1', sampleResult);
    gate.store('k2', 't2', sampleResult);
    gate.store('k3', 't3', sampleResult);
    expect(gate.size).toBe(3);

    // 4th insert should evict k1
    gate.store('k4', 't4', sampleResult);
    expect(gate.size).toBe(3);
    expect(gate.check('k1')).toBeUndefined();
    expect(gate.check('k4')).toBeDefined();
  });

  it('supports manual invalidation', () => {
    const key = 'inv-key';
    gate.store(key, 'tool', sampleResult);
    expect(gate.check(key)).toBeDefined();

    gate.invalidate(key);
    expect(gate.check(key)).toBeUndefined();
  });
});
