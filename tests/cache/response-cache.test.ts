import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ResponseCache } from '../../src/cache/response-cache.js';
import type { ToolResult } from '../../src/connectors/connector.js';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  const successResult: ToolResult = {
    content: [{ type: 'text', text: 'Files found: 5' }],
    isError: false
  };

  const errorResult: ToolResult = {
    content: [{ type: 'text', text: 'Disk failure' }],
    isError: true
  };

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ResponseCache({
      enabled: true,
      defaultTtlSeconds: 30,
      maxEntries: 2,
      perToolTtlSeconds: {
        'github.list_repos': 100
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces identical keys regardless of key order in args', () => {
    const k1 = ResponseCache.makeKey('srv', 'tool', { a: 1, b: 2 });
    const k2 = ResponseCache.makeKey('srv', 'tool', { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it('caches successful results and registers hits/misses', () => {
    const key = ResponseCache.makeKey('srv', 'tool', { query: 'test' });
    expect(cache.get(key)).toBeUndefined();

    cache.set(key, 'srv.tool', successResult);
    expect(cache.get(key)).toEqual(successResult);

    const stats = cache.stats;
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('never caches error results', () => {
    const key = ResponseCache.makeKey('srv', 'tool', { err: true });
    cache.set(key, 'srv.tool', errorResult);
    expect(cache.get(key)).toBeUndefined();
  });

  it('respects per-tool TTL overrides', () => {
    const key = ResponseCache.makeKey('github', 'list_repos', {});
    cache.set(key, 'github.list_repos', successResult);

    // Advance 50s (past default 30s, but within 100s)
    vi.advanceTimersByTime(50_000);
    expect(cache.get(key)).toBeDefined();

    // Advance past 100s
    vi.advanceTimersByTime(50_001);
    expect(cache.get(key)).toBeUndefined();
  });

  it('evicts oldest entries when exceeding maxEntries', () => {
    const k1 = 'key1';
    const k2 = 'key2';
    const k3 = 'key3';

    cache.set(k1, 'tool', successResult);
    cache.set(k2, 'tool', successResult);
    expect(cache.size).toBe(2);

    cache.set(k3, 'tool', successResult);
    expect(cache.size).toBe(2);
    expect(cache.get(k1)).toBeUndefined();
    expect(cache.get(k3)).toBeDefined();
  });
});
