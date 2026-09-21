import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../../src/audit/audit-logger.js';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AuditLogger', () => {
  let tmpDir: string;
  let logger: AuditLogger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omniloop-audit-test-'));
    logger = new AuditLogger({
      enabled: true,
      directory: tmpDir,
      retentionDays: 7
    });
    logger.initialize();
  });

  afterEach(async () => {
    await logger.close();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('initializes audit directory and writes tamper-evident event', async () => {
    logger.write({
      traceId: 'tr-001',
      timestamp: new Date().toISOString(),
      toolName: 'github.search',
      serverId: 'github',
      args: { q: 'repo' },
      resultSummary: 'OK',
      riskLevel: 'low',
      authorized: true,
      verificationPassed: true,
      durationMs: 42,
      cacheHit: false,
      idempotencyHit: false,
      threatDetected: false,
      threats: []
    });

    await logger.close();

    const today = new Date().toISOString().slice(0, 10);
    const logPath = join(tmpDir, `audit-${today}.jsonl`);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.traceId).toBe('tr-001');
    expect(parsed.chainHash).toBeDefined();
    expect(parsed.chainHash.length).toBe(64); // SHA-256 hex string
  });

  it('generates a cryptographically chained hash sequence', async () => {
    logger.write({
      traceId: 'tr-001',
      timestamp: new Date().toISOString(),
      toolName: 'tool1',
      serverId: 's1',
      args: {},
      resultSummary: 'OK',
      riskLevel: 'low',
      authorized: true,
      verificationPassed: true,
      durationMs: 10,
      cacheHit: false,
      idempotencyHit: false,
      threatDetected: false,
      threats: []
    });

    logger.write({
      traceId: 'tr-002',
      timestamp: new Date().toISOString(),
      toolName: 'tool2',
      serverId: 's2',
      args: {},
      resultSummary: 'OK',
      riskLevel: 'low',
      authorized: true,
      verificationPassed: true,
      durationMs: 12,
      cacheHit: false,
      idempotencyHit: false,
      threatDetected: false,
      threats: []
    });

    await logger.close();

    const today = new Date().toISOString().slice(0, 10);
    const logPath = join(tmpDir, `audit-${today}.jsonl`);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]!);
    const entry2 = JSON.parse(lines[1]!);

    expect(entry1.chainHash).not.toBe(entry2.chainHash);
  });
});
