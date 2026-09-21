/**
 * Unit tests for VerificationLoop — pass on first try, fail + recover,
 * iteration limit enforcement, and timeout behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationLoop } from '../../src/verification/loop.js';
import { isSuccess } from '../../src/verification/verifier.js';
import type { ToolResult } from '../../src/connectors/connector.js';
import type { ToolRouter } from '../../src/routing/tool-router.js';

/** Create a mock ToolRouter that returns a sequence of results */
function mockRouter(results: ToolResult[]): ToolRouter {
  let callCount = 0;
  return {
    route: vi.fn().mockImplementation(async () => {
      const result = results[callCount] ?? results[results.length - 1];
      callCount++;
      return result;
    })
  } as unknown as ToolRouter;
}

const successResult: ToolResult = {
  content: [{ type: 'text', text: 'OK' }],
  isError: false
};

const errorResult: ToolResult = {
  content: [{ type: 'text', text: 'Error occurred' }],
  isError: true
};

describe('VerificationLoop', () => {
  it('passes immediately on first successful call', async () => {
    const router = mockRouter([successResult]);
    const loop = new VerificationLoop(router);

    const result = await loop.execute('github.search_repos', {}, {
      maxIterations: 3,
      timeoutMs: 5000,
      verifier: isSuccess()
    });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.finalResult).toEqual(successResult);
  });

  it('retries on failure and passes on second attempt', async () => {
    const router = mockRouter([errorResult, successResult]);
    const loop = new VerificationLoop(router);

    const result = await loop.execute('github.create_issue', {}, {
      maxIterations: 3,
      timeoutMs: 5000,
      verifier: isSuccess(),
      recovery: { strategy: 'retry', retryDelayMs: 0 }
    });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(1); // second attempt in recovery
  });

  it('exhausts iterations and returns failure', async () => {
    const router = mockRouter([errorResult]);
    const loop = new VerificationLoop(router);

    const result = await loop.execute('db.drop_table', {}, {
      maxIterations: 2,
      timeoutMs: 5000,
      verifier: isSuccess(),
      recovery: { strategy: 'retry', retryDelayMs: 0 }
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toContain('iterations');
  });

  it('aborts immediately with abort recovery strategy', async () => {
    const router = mockRouter([errorResult]);
    const loop = new VerificationLoop(router);

    const result = await loop.execute('db.destroy_all', {}, {
      maxIterations: 5,
      timeoutMs: 5000,
      verifier: isSuccess(),
      recovery: { strategy: 'abort' }
    });

    expect(result.passed).toBe(false);
    expect(result.failureReason).toContain('Abort');
    // Should not retry — only 1 iteration
    expect(result.iterations).toBe(1);
  });

  it('handles tool call throwing an exception', async () => {
    const router = {
      route: vi.fn().mockRejectedValue(new Error('Connection refused'))
    } as unknown as ToolRouter;
    const loop = new VerificationLoop(router);

    const result = await loop.execute('github.search_repos', {}, {
      maxIterations: 1,
      timeoutMs: 5000,
      verifier: isSuccess()
    });

    expect(result.passed).toBe(false);
    expect(result.finalResult.isError).toBe(true);
  });
});
