import { describe, it, expect, vi } from 'vitest';
import { MiddlewareBus, type MiddlewareContext, type Middleware } from '../../src/middleware/middleware-bus.js';

describe('MiddlewareBus', () => {
  const createMockContext = (toolName: string): MiddlewareContext => ({
    traceId: 'tr-test',
    toolName,
    serverId: 'srv',
    riskLevel: 'low',
    args: { value: 1 },
    meta: {},
    startedAt: Date.now()
  });

  it('runs global before and after hooks in order', async () => {
    const bus = new MiddlewareBus();
    const calls: string[] = [];

    const mw1: Middleware = {
      name: 'mw1',
      before: (ctx) => {
        calls.push('mw1-before');
        (ctx.args as any).value += 1;
      },
      after: () => {
        calls.push('mw1-after');
      }
    };

    bus.useGlobal(mw1);
    const ctx = createMockContext('test.tool');

    await bus.runBefore(ctx);
    expect(calls).toEqual(['mw1-before']);
    expect((ctx.args as any).value).toBe(2);

    await bus.runAfter(ctx);
    expect(calls).toEqual(['mw1-before', 'mw1-after']);
  });

  it('aborts execution when before hook throws', async () => {
    const bus = new MiddlewareBus();
    const failingMw: Middleware = {
      name: 'failing',
      before: () => {
        throw new Error('Blocked by policy middleware');
      }
    };

    bus.useGlobal(failingMw);
    const ctx = createMockContext('test.tool');

    await expect(bus.runBefore(ctx)).rejects.toThrow('Blocked by policy middleware');
  });

  it('supports per-tool middleware targeting', async () => {
    const bus = new MiddlewareBus();
    const specificCall = vi.fn();

    bus.useTool('special.tool', {
      name: 'special',
      before: specificCall
    });

    const ctx1 = createMockContext('other.tool');
    await bus.runBefore(ctx1);
    expect(specificCall).not.toHaveBeenCalled();

    const ctx2 = createMockContext('special.tool');
    await bus.runBefore(ctx2);
    expect(specificCall).toHaveBeenCalledTimes(1);
  });

  it('provides graceful fallbacks on error in onError hooks', async () => {
    const bus = new MiddlewareBus();
    bus.useGlobal({
      name: 'recovery-mw',
      onError: (_ctx, _err) => ({
        content: [{ type: 'text', text: 'Fallback response from middleware' }],
        isError: false
      })
    });

    const ctx = createMockContext('faulty.tool');
    const fallback = await bus.runOnError(ctx, new Error('Downstream died'));
    expect(fallback).toBeDefined();
    expect(fallback?.isError).toBe(false);
    expect(fallback?.content[0]?.['text']).toContain('Fallback response');
  });
});
