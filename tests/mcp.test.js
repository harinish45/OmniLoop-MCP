import assert from 'node:assert';
import test from 'node:test';
import os from 'node:os';

test('OmniLoop MCP Tool: System Metrics Retrieval', () => {
  const metrics = {
    platform: os.platform(),
    totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
    cpuCount: os.cpus().length
  };
  assert.ok(metrics.totalMemoryMB > 0);
  assert.ok(metrics.cpuCount >= 1);
  assert.ok(typeof metrics.platform === 'string');
});

test('OmniLoop MCP Security Guardrail: Task Validation', () => {
  function executeSafeDiagnostic(task) {
    const valid = ['ping', 'healthcheck', 'version'];
    if (!valid.includes(task)) {
      return { status: 'ERROR', reason: 'Denied by guardrail' };
    }
    return { status: 'SUCCESS' };
  }

  assert.strictEqual(executeSafeDiagnostic('healthcheck').status, 'SUCCESS');
  assert.strictEqual(executeSafeDiagnostic('rm -rf /').status, 'ERROR');
});
