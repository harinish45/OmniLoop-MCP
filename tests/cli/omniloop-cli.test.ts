import { describe, it, expect } from 'vitest';
import { runCli } from '../../src/cli/omniloop-cli.js';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

describe('OmniLoop CLI', () => {
  it('runs doctor successfully', async () => {
    process.env['GITHUB_TOKEN'] = 'mock-test-token';
    process.env['MY_SECRET_ENV_VAR'] = 'mock-secret';
    process.env['POSTGRES_MCP_URL'] = 'postgres://localhost:5432/db';
    process.env['LEGACY_MCP_URL'] = 'http://localhost:8080/mcp';
    process.env['OMNILOOP_PROVENANCE_KEY'] = 'mock-key';
    const code = await runCli(['doctor', '--config=config/omniloop.example.yaml']);
    expect(code).toBe(0);
  });

  it('runs benchmark command', async () => {
    const code = await runCli(['benchmark']);
    expect(code).toBe(0);
  });

  it('verifies untampered audit log chains', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'omniloop-cli-test-'));
    const auditPath = join(tmpDir, 'audit.jsonl');

    // Create a valid 2-event chained audit file
    let prev = '0'.repeat(64);

    const event1 = { traceId: 't1', tool: 'search' };
    const hash1 = createHash('sha256').update(prev + JSON.stringify(event1)).digest('hex');
    const line1 = JSON.stringify({ ...event1, chainHash: hash1 });

    prev = hash1;
    const event2 = { traceId: 't2', tool: 'read' };
    const hash2 = createHash('sha256').update(prev + JSON.stringify(event2)).digest('hex');
    const line2 = JSON.stringify({ ...event2, chainHash: hash2 });

    writeFileSync(auditPath, `${line1}\n${line2}\n`);

    const code = await runCli(['audit', 'verify', auditPath]);
    expect(code).toBe(0);

    // Tamper with line 2
    const tamperedLine2 = JSON.stringify({ ...event2, tool: 'tampered-evil-tool', chainHash: hash2 });
    writeFileSync(auditPath, `${line1}\n${tamperedLine2}\n`);

    const failCode = await runCli(['audit', 'verify', auditPath]);
    expect(failCode).toBe(1);

    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});