import { describe, it, expect, beforeEach } from 'vitest';
import { ArgumentGuard } from '../../src/security/argument-guard.js';
import type { ToolDefinition } from '../../src/connectors/connector.js';

describe('ArgumentGuard', () => {
  let guard: ArgumentGuard;

  const sampleTool: ToolDefinition = {
    name: 'search',
    description: 'Search something',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2 },
        limit: { type: 'number', minimum: 1, maximum: 100 }
      },
      required: ['query']
    }
  };

  beforeEach(() => {
    guard = new ArgumentGuard({
      enabled: true,
      maxDepth: 5,
      maxPayloadBytes: 1024,
      strictExtraProperties: false
    });
    guard.registerTool('github.search', sampleTool);
  });

  it('validates compliant arguments successfully', () => {
    const res = guard.validate('github.search', { query: 'test', limit: 10 });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects missing required properties', () => {
    const res = guard.validate('github.search', { limit: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('rejects type mismatches', () => {
    const res = guard.validate('github.search', { query: 12345 });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('blocks payloads exceeding maxPayloadBytes', () => {
    const huge = { query: 'a'.repeat(2000) };
    const res = guard.validate('github.search', huge);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('exceeds maximum size');
  });

  it('blocks payloads exceeding maxDepth', () => {
    const deepObj = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    const res = guard.validate('github.search', deepObj);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('exceeds maximum');
  });

  it('bypasses checks when disabled', () => {
    const disabledGuard = new ArgumentGuard({ enabled: false });
    const res = disabledGuard.validate('any.tool', { invalid: true });
    expect(res.valid).toBe(true);
  });

  it('handles unregistered tools gracefully', () => {
    const res = guard.validate('unregistered.tool', { anything: 123 });
    expect(res.valid).toBe(true);
  });

  it('supports deregistering tools', () => {
    guard.deregisterTool('github.search');
    // Without schema, it falls back to passing schema check
    const res = guard.validate('github.search', { invalid: true });
    expect(res.valid).toBe(true);
  });
});
