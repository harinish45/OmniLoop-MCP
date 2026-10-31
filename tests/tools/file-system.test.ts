import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadFileTool, WriteFileTool } from '../../src/tools/file_system.js';
import {
  PathTraversalError,
  FileNotFoundError,
  FileAlreadyExistsError,
  ToolExecutionError
} from '../../src/errors/tool-errors.js';

describe('FileSystemTools (read_file & write_file)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omniloop-fs-test-'));
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('WriteFileTool', () => {
    it('writes a new file in allowed directory', async () => {
      const target = 'sub/file.txt';
      const result = await WriteFileTool.execute({
        path: target,
        content: 'Hello OmniLoop MCP!',
        allowedDirectory: tempDir
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.bytesWritten).toBe(Buffer.byteLength('Hello OmniLoop MCP!'));
      expect(fs.existsSync(result.path)).toBe(true);

      const content = await fs.promises.readFile(result.path, 'utf-8');
      expect(content).toBe('Hello OmniLoop MCP!');
    });

    it('appends content when append is true', async () => {
      const target = 'append-test.txt';
      await WriteFileTool.execute({
        path: target,
        content: 'Line 1\n',
        allowedDirectory: tempDir
      });

      await WriteFileTool.execute({
        path: target,
        content: 'Line 2\n',
        append: true,
        allowedDirectory: tempDir
      });

      const fullContent = await fs.promises.readFile(path.join(tempDir, target), 'utf-8');
      expect(fullContent).toBe('Line 1\nLine 2\n');
    });

    it('throws FileAlreadyExistsError when overwrite is false and file exists', async () => {
      const target = 'existing.txt';
      await WriteFileTool.execute({
        path: target,
        content: 'Original',
        allowedDirectory: tempDir
      });

      await expect(
        WriteFileTool.execute({
          path: target,
          content: 'New content',
          overwrite: false,
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(FileAlreadyExistsError);
    });

    it('blocks path traversal attacks attempting to escape allowedDirectory', async () => {
      await expect(
        WriteFileTool.execute({
          path: '../../malicious.txt',
          content: 'pwned',
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(PathTraversalError);

      await expect(
        WriteFileTool.execute({
          path: path.join(os.tmpdir(), 'outside-target.txt'),
          content: 'pwned',
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(PathTraversalError);
    });

    it('rejects null byte injections', async () => {
      await expect(
        WriteFileTool.execute({
          path: 'safe.txt\0.exe',
          content: 'payload',
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(ToolExecutionError);
    });
  });

  describe('ReadFileTool', () => {
    it('reads an existing file accurately', async () => {
      const testFile = path.join(tempDir, 'data.json');
      await fs.promises.writeFile(testFile, '{"key": "omniloop"}', 'utf-8');

      const result = await ReadFileTool.execute({
        path: 'data.json',
        allowedDirectory: tempDir
      });

      expect(result.content).toBe('{"key": "omniloop"}');
      expect(result.sizeBytes).toBe(Buffer.byteLength('{"key": "omniloop"}'));
      expect(result.encoding).toBe('utf-8');
    });

    it('throws FileNotFoundError when target does not exist', async () => {
      await expect(
        ReadFileTool.execute({
          path: 'non-existent.txt',
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(FileNotFoundError);
    });

    it('throws PathTraversalError when trying to escape boundary', async () => {
      await expect(
        ReadFileTool.execute({
          path: '../parent-secret.key',
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(PathTraversalError);
    });

    it('throws ToolExecutionError when target is a directory', async () => {
      const subDir = path.join(tempDir, 'folder');
      await fs.promises.mkdir(subDir);

      await expect(
        ReadFileTool.execute({
          path: 'folder',
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(ToolExecutionError);
    });

    it('throws ToolExecutionError when file size exceeds maxSizeBytes', async () => {
      const testFile = path.join(tempDir, 'large.txt');
      await fs.promises.writeFile(testFile, 'A'.repeat(500), 'utf-8');

      await expect(
        ReadFileTool.execute({
          path: 'large.txt',
          maxSizeBytes: 200,
          allowedDirectory: tempDir
        })
      ).rejects.toThrow(ToolExecutionError);
    });
  });
});
