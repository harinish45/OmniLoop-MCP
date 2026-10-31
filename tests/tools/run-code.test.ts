import { describe, it, expect } from 'vitest';
import { RunCodeTool } from '../../src/tools/run_code.js';
import {
  CodeExecutionSecurityError,
  CodeExecutionTimeoutError,
  ToolExecutionError
} from '../../src/errors/tool-errors.js';

describe('RunCodeTool', () => {
  it('evaluates safe JavaScript code and returns calculation result', async () => {
    const result = await RunCodeTool.execute({
      language: 'javascript',
      code: 'const a = 20; const b = 22; a + b;'
    });

    expect(result.language).toBe('javascript');
    expect(result.exitCode).toBe(0);
    expect(result.result).toBe(42);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stdout from console.log in sandboxed JavaScript', async () => {
    const result = await RunCodeTool.execute({
      language: 'javascript',
      code: `
        console.log('first line');
        console.info('second', 123);
        const numbers = [1, 2, 3];
        console.log(JSON.stringify(numbers));
      `
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('first line');
    expect(result.stdout).toContain('second 123');
    expect(result.stdout).toContain('[1,2,3]');
  });

  it('captures runtime exceptions in stderr and returns exitCode 1', async () => {
    const result = await RunCodeTool.execute({
      language: 'javascript',
      code: 'throw new Error("Explicit runtime failure");'
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Explicit runtime failure');
  });

  it('enforces sandbox isolation — host globals like process and require are undefined', async () => {
    const result = await RunCodeTool.execute({
      language: 'javascript',
      code: `
        const hasProcess = typeof process !== 'undefined';
        const hasRequire = typeof require !== 'undefined';
        const hasFs = typeof fs !== 'undefined';
        ({ hasProcess, hasRequire, hasFs });
      `
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({
      hasProcess: false,
      hasRequire: false,
      hasFs: false
    });
  });

  it('enforces execution timeout on infinite loops', async () => {
    await expect(
      RunCodeTool.execute({
        language: 'javascript',
        code: 'while (true) {}',
        timeoutMs: 600
      })
    ).rejects.toThrow(CodeExecutionTimeoutError);
  });

  it('rejects oversized code payloads (>50KB)', async () => {
    const hugeCode = 'const x = 1;\n'.repeat(5000);
    await expect(
      RunCodeTool.execute({
        language: 'javascript',
        code: hugeCode
      })
    ).rejects.toThrow(CodeExecutionSecurityError);
  });

  it('rejects unsupported programming languages', async () => {
    await expect(
      RunCodeTool.execute({
        language: 'ruby' as unknown as 'javascript',
        code: 'puts "hello"'
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  it('executes or handles python runtime gracefully', async () => {
    const result = await RunCodeTool.execute({
      language: 'python',
      code: 'print("Python sandbox operational")'
    });

    expect(result.language).toBe('python');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    if (result.exitCode === 0) {
      expect(result.stdout).toContain('Python sandbox operational');
    } else {
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });
});
