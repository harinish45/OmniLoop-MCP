import { describe, it, expect } from 'vitest';
import { SandboxGuard } from '../../src/security/sandbox.js';

describe('SandboxGuard', () => {
  const guard = new SandboxGuard({
    enabled: true,
    allowedPaths: ['c:/workspace', '/workspace'],
    blockPrivateNetworks: true,
    sanitizeShell: true
  });

  describe('Path Traversal Defense', () => {
    it('blocks directory traversal attempts', () => {
      expect(guard.isPathAllowed('../../etc/passwd')).toBe(false);
      expect(guard.isPathAllowed('..\\..\\windows\\system32')).toBe(false);
      expect(guard.isPathAllowed('%2e%2e/secret.txt')).toBe(false);
    });

    it('blocks Windows Alternate Data Streams and UNC paths', () => {
      expect(guard.isPathAllowed('file.txt::$DATA')).toBe(false);
      expect(guard.isPathAllowed('\\\\malicious-server\\share\\file.txt')).toBe(false);
    });

    it('allows safe paths inside allowed directory boundaries', () => {
      expect(guard.isPathAllowed('c:/workspace/project/file.ts')).toBe(true);
    });
  });

  describe('SSRF Network Boundary Enforcement', () => {
    it('blocks private IP ranges and localhost', () => {
      expect(guard.isUrlAllowed('http://localhost:8080/admin')).toBe(false);
      expect(guard.isUrlAllowed('http://127.0.0.1/status')).toBe(false);
      expect(guard.isUrlAllowed('http://10.0.0.1/secrets')).toBe(false);
      expect(guard.isUrlAllowed('http://192.168.1.1/router')).toBe(false);
      expect(guard.isUrlAllowed('http://172.16.0.5/api')).toBe(false);
    });

    it('blocks cloud metadata endpoint (169.254.169.254)', () => {
      expect(guard.isUrlAllowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('blocks IPv6 loopback and internal domains', () => {
      expect(guard.isUrlAllowed('http://[::1]/debug')).toBe(false);
      expect(guard.isUrlAllowed('http://service.internal/')).toBe(false);
      expect(guard.isUrlAllowed('http://app.local/')).toBe(false);
    });

    it('allows public Internet URLs', () => {
      expect(guard.isUrlAllowed('https://api.github.com/repos')).toBe(true);
      expect(guard.isUrlAllowed('https://raw.githubusercontent.com/file')).toBe(true);
    });
  });

  describe('Shell Argument Sanitization', () => {
    it('blocks shell chaining and command injection characters', () => {
      expect(guard.isShellSafe('cat file.txt | grep secret')).toBe(false);
      expect(guard.isShellSafe('echo hello; rm -rf /')).toBe(false);
      expect(guard.isShellSafe('test && evil_command')).toBe(false);
      expect(guard.isShellSafe('data `whoami`')).toBe(false);
      expect(guard.isShellSafe('val $(id)')).toBe(false);
    });

    it('allows safe alphanumeric shell arguments', () => {
      expect(guard.isShellSafe('my-branch-name-v2')).toBe(true);
      expect(guard.isShellSafe('commit_msg_123')).toBe(true);
    });
  });

  describe('Full Argument Payload Validation', () => {
    it('detects nested path and SSRF violations in complex payloads', () => {
      const payload = {
        options: {
          targetUrl: 'http://169.254.169.254/credentials',
          filePath: '../../windows/system32/cmd.exe'
        }
      };

      const result = guard.validate(payload);
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBe(2);
    });
  });
});
