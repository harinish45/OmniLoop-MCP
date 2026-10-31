import * as fs from 'fs';
import * as path from 'path';
import type { ToolInputSchema } from '../connectors/connector.js';
import {
  PathTraversalError,
  FileNotFoundError,
  FileAlreadyExistsError,
  ToolExecutionError
} from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('file-system');

export interface ReadFileArgs {
  readonly path: string;
  readonly encoding?: BufferEncoding;
  readonly allowedDirectory?: string;
  readonly maxSizeBytes?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly encoding: BufferEncoding;
}

export interface WriteFileArgs {
  readonly path: string;
  readonly content: string;
  readonly encoding?: BufferEncoding;
  readonly overwrite?: boolean;
  readonly createDirectory?: boolean;
  readonly append?: boolean;
  readonly allowedDirectory?: string;
}

export interface WriteFileResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly status: 'SUCCESS';
}

function resolveSafePath(userPath: string, allowedDir?: string): { safePath: string; allowedRoot: string } {
  if (typeof userPath !== 'string' || !userPath.trim()) {
    throw new ToolExecutionError('file_system', 'ERR_INVALID_PATH', 'File path must be a non-empty string');
  }

  if (userPath.includes('\0')) {
    throw new ToolExecutionError('file_system', 'ERR_NULL_BYTE', 'Null byte detected in file path');
  }

  const allowedRoot = path.resolve(allowedDir ?? process.cwd());
  const normalizedUserPath = path.normalize(userPath);

  const safePath = path.isAbsolute(normalizedUserPath)
    ? path.resolve(normalizedUserPath)
    : path.resolve(allowedRoot, normalizedUserPath);

  const relative = path.relative(allowedRoot, safePath);
  const isEscaping = relative.startsWith('..') || (path.isAbsolute(relative) && !safePath.startsWith(allowedRoot));

  if (isEscaping) {
    throw new PathTraversalError(userPath, allowedRoot);
  }

  return { safePath, allowedRoot };
}

export class ReadFileTool {
  public static readonly NAME = 'read_file';
  public static readonly DESCRIPTION = 'Safely read file contents within permitted directory boundaries with path traversal protection.';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file to read.' },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'utf8', 'ascii', 'base64', 'hex'],
        description: 'Text encoding format (default utf-8).'
      },
      allowedDirectory: { type: 'string', description: 'Boundary root directory restricting access (default cwd).' },
      maxSizeBytes: { type: 'number', description: 'Maximum allowed file size in bytes (default 5MB).' }
    },
    required: ['path']
  };

  public static async execute(rawArgs: unknown): Promise<ReadFileResult> {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('file_system', 'ERR_INVALID_ARGS', 'Read file arguments must be an object');
    }

    const input = rawArgs as Record<string, unknown>;
    const rawPath = String(input['path'] ?? '');
    const encoding = (input['encoding'] as BufferEncoding) ?? 'utf-8';
    const allowedDir = typeof input['allowedDirectory'] === 'string' ? input['allowedDirectory'] : undefined;
    const maxSizeBytes = typeof input['maxSizeBytes'] === 'number' ? input['maxSizeBytes'] : 5 * 1024 * 1024;

    const { safePath } = resolveSafePath(rawPath, allowedDir);

    if (!fs.existsSync(safePath)) {
      throw new FileNotFoundError(safePath);
    }

    const stats = await fs.promises.stat(safePath);
    if (stats.isDirectory()) {
      throw new ToolExecutionError('file_system', 'ERR_IS_DIRECTORY', `Path is a directory, not a file: "${safePath}"`);
    }

    if (stats.size > maxSizeBytes) {
      throw new ToolExecutionError(
        'file_system',
        'ERR_FILE_TOO_LARGE',
        `File size (${stats.size} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`
      );
    }

    logger.debug({ path: safePath, size: stats.size }, 'Reading file');
    const content = await fs.promises.readFile(safePath, { encoding });

    return {
      path: safePath,
      content,
      sizeBytes: stats.size,
      encoding
    };
  }
}

export class WriteFileTool {
  public static readonly NAME = 'write_file';
  public static readonly DESCRIPTION = 'Safely write or append content to a file within permitted directory boundaries.';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the target file.' },
      content: { type: 'string', description: 'String content to write to the file.' },
      encoding: { type: 'string', description: 'Text encoding (default utf-8).' },
      overwrite: { type: 'boolean', description: 'Whether to overwrite existing file (default true).' },
      createDirectory: { type: 'boolean', description: 'Automatically create parent directories if missing (default true).' },
      append: { type: 'boolean', description: 'Append content instead of overwriting (default false).' },
      allowedDirectory: { type: 'string', description: 'Boundary root directory restricting access (default cwd).' }
    },
    required: ['path', 'content']
  };

  public static async execute(rawArgs: unknown): Promise<WriteFileResult> {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('file_system', 'ERR_INVALID_ARGS', 'Write file arguments must be an object');
    }

    const input = rawArgs as Record<string, unknown>;
    const rawPath = String(input['path'] ?? '');
    const content = typeof input['content'] === 'string' ? input['content'] : String(input['content'] ?? '');
    const encoding = (input['encoding'] as BufferEncoding) ?? 'utf-8';
    const overwrite = input['overwrite'] !== false;
    const createDir = input['createDirectory'] !== false;
    const append = input['append'] === true;
    const allowedDir = typeof input['allowedDirectory'] === 'string' ? input['allowedDirectory'] : undefined;

    const { safePath } = resolveSafePath(rawPath, allowedDir);

    if (fs.existsSync(safePath) && !overwrite && !append) {
      throw new FileAlreadyExistsError(safePath);
    }

    if (createDir) {
      const parentDir = path.dirname(safePath);
      await fs.promises.mkdir(parentDir, { recursive: true });
    }

    logger.debug({ path: safePath, append }, 'Writing file');

    if (append) {
      await fs.promises.appendFile(safePath, content, { encoding });
    } else {
      await fs.promises.writeFile(safePath, content, { encoding });
    }

    const writtenBytes = Buffer.byteLength(content, encoding);

    return {
      path: safePath,
      bytesWritten: writtenBytes,
      status: 'SUCCESS'
    };
  }
}
