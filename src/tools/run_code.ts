import * as vm from 'node:vm';
import { spawn } from 'node:child_process';
import type { ToolInputSchema } from '../connectors/connector.js';
import {
  CodeExecutionSecurityError,
  CodeExecutionTimeoutError,
  ToolExecutionError
} from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('run-code');

export interface RunCodeArgs {
  readonly language: 'javascript' | 'python';
  readonly code: string;
  readonly timeoutMs?: number;
}

export interface RunCodeResult {
  readonly language: 'javascript' | 'python';
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly result?: unknown;
}

export class RunCodeTool {
  public static readonly NAME = 'run_code';
  public static readonly DESCRIPTION = 'Execute code in an isolated sandbox with stdout/stderr capture (supports JavaScript and Python).';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['javascript', 'python'],
        description: 'Programming language runtime.'
      },
      code: {
        type: 'string',
        description: 'Source code to evaluate in the isolated sandbox.'
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum execution time in milliseconds (500 to 15000, default 5000).'
      }
    },
    required: ['language', 'code']
  };

  public static async execute(rawArgs: unknown): Promise<RunCodeResult> {
    const args = this.validateArgs(rawArgs);
    const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 5000, 500), 15_000);

    logger.debug({ language: args.language, timeoutMs }, 'Executing sandboxed code');

    if (args.language === 'javascript') {
      return this.executeJavaScript(args.code, timeoutMs);
    }

    return this.executePython(args.code, timeoutMs);
  }

  private static validateArgs(rawArgs: unknown): RunCodeArgs {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('run_code', 'ERR_INVALID_ARGS', 'Code runner arguments must be an object');
    }
    const input = rawArgs as Record<string, unknown>;
    const language = input['language'] as string;
    if (language !== 'javascript' && language !== 'python') {
      throw new ToolExecutionError(
        'run_code',
        'ERR_UNSUPPORTED_LANGUAGE',
        `Unsupported language "${language}". Only 'javascript' and 'python' are supported.`
      );
    }

    const code = typeof input['code'] === 'string' ? input['code'] : '';
    if (!code.trim()) {
      throw new ToolExecutionError('run_code', 'ERR_EMPTY_CODE', 'Code content cannot be empty');
    }

    if (code.length > 50_000) {
      throw new CodeExecutionSecurityError(language, 'Code payload exceeds maximum size limit of 50KB');
    }

    return {
      language,
      code,
      timeoutMs: typeof input['timeoutMs'] === 'number' ? input['timeoutMs'] : undefined
    };
  }

  private static executeJavaScript(code: string, timeoutMs: number): RunCodeResult {
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    const customConsole = {
      log: (...items: unknown[]) => stdoutParts.push(items.map((i) => this.formatValue(i)).join(' ')),
      info: (...items: unknown[]) => stdoutParts.push(items.map((i) => this.formatValue(i)).join(' ')),
      warn: (...items: unknown[]) => stderrParts.push(items.map((i) => this.formatValue(i)).join(' ')),
      error: (...items: unknown[]) => stderrParts.push(items.map((i) => this.formatValue(i)).join(' '))
    };

    const sandbox = Object.create(null);
    Object.assign(sandbox, {
      console: customConsole,
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      parseInt,
      parseFloat,
      isNaN,
      isFinite
    });

    const context = vm.createContext(sandbox);
    const startTime = Date.now();

    try {
      const script = new vm.Script(code);
      const evalResult = script.runInContext(context, { timeout: timeoutMs });
      const durationMs = Date.now() - startTime;

      return {
        language: 'javascript',
        stdout: stdoutParts.join('\n'),
        stderr: stderrParts.join('\n'),
        exitCode: 0,
        durationMs,
        result: evalResult !== undefined ? evalResult : null
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;

      if (errorMsg.includes('timed out') || (err as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new CodeExecutionTimeoutError('javascript', timeoutMs);
      }

      return {
        language: 'javascript',
        stdout: stdoutParts.join('\n'),
        stderr: (stderrParts.concat(errorMsg)).join('\n'),
        exitCode: 1,
        durationMs,
        result: null
      };
    }
  }

  private static async executePython(code: string, timeoutMs: number): Promise<RunCodeResult> {
    const startTime = Date.now();

    return new Promise<RunCodeResult>((resolve, reject) => {
      const pyProcess = spawn('python', ['-c', code], {
        timeout: timeoutMs,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });

      let stdout = '';
      let stderr = '';
      let hasTimedOut = false;

      const timer = setTimeout(() => {
        hasTimedOut = true;
        pyProcess.kill('SIGKILL');
      }, timeoutMs);

      pyProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      pyProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      pyProcess.on('error', (err: Error) => {
        clearTimeout(timer);
        // If Python executable is not available, report friendly message
        if ((err as { code?: string }).code === 'ENOENT') {
          resolve({
            language: 'python',
            stdout: '',
            stderr: 'Python runtime is not installed or not found in system PATH.',
            exitCode: 127,
            durationMs: Date.now() - startTime
          });
          return;
        }
        reject(new ToolExecutionError('run_code', 'ERR_PYTHON_PROCESS', err.message));
      });

      pyProcess.on('close', (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (hasTimedOut) {
          reject(new CodeExecutionTimeoutError('python', timeoutMs));
          return;
        }

        resolve({
          language: 'python',
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
          exitCode: code ?? 0,
          durationMs
        });
      });
    });
  }

  private static formatValue(val: unknown): string {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  }
}
