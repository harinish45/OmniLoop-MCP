/**
 * Unit tests for AuthorizationService — allow/deny logic, risk resolution,
 * confirmation requirements, and rate limit integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthorizationService } from '../../src/policy/authorization.js';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import type { ToolDefinition } from '../../src/connectors/connector.js';

const makeTool = (name: string): ToolDefinition => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: 'object' }
});

describe('AuthorizationService', () => {
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    toolRegistry.registerServerTools('github', [
      makeTool('search_repos'),
      makeTool('create_issue'),
      makeTool('delete_repo')
    ]);
    toolRegistry.registerServerTools('db', [makeTool('drop_table')]);
  });

  it('allows a low-risk read tool', () => {
    const auth = new AuthorizationService(toolRegistry, undefined);
    const result = auth.authorize('github.search_repos');
    expect(result.allowed).toBe(true);
    expect(result.risk).toBe('low');
    expect(result.confirmationRequired).toBe(false);
  });

  it('allows a medium-risk create tool with no confirmation by default', () => {
    const auth = new AuthorizationService(toolRegistry, undefined);
    const result = auth.authorize('github.create_issue');
    expect(result.allowed).toBe(true);
    expect(result.risk).toBe('medium');
    expect(result.confirmationRequired).toBe(false);
  });

  it('requires confirmation for high-risk delete tools', () => {
    const auth = new AuthorizationService(toolRegistry, undefined);
    const result = auth.authorize('github.delete_repo');
    expect(result.allowed).toBe(true);
    expect(result.risk).toBe('high');
    expect(result.confirmationRequired).toBe(true);
  });

  it('requires confirmation for critical-risk drop tools', () => {
    const auth = new AuthorizationService(toolRegistry, undefined);
    const result = auth.authorize('db.drop_table');
    expect(result.allowed).toBe(true);
    expect(result.risk).toBe('critical');
    expect(result.confirmationRequired).toBe(true);
  });

  it('denies tools not found in registry', () => {
    const auth = new AuthorizationService(toolRegistry, undefined);
    const result = auth.authorize('github.nonexistent_tool');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('denies tools explicitly blocked by policy', () => {
    const auth = new AuthorizationService(toolRegistry, {
      overrides: { 'github.create_issue': { deny: true } }
    });
    const result = auth.authorize('github.create_issue');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied by gateway policy');
  });

  it('applies policy confirmation override for medium-risk tool', () => {
    const auth = new AuthorizationService(toolRegistry, {
      overrides: { 'github.create_issue': { risk: 'medium', confirmation: 'required' } }
    });
    const result = auth.authorize('github.create_issue');
    expect(result.allowed).toBe(true);
    expect(result.confirmationRequired).toBe(true);
  });

  it('applies custom timeout from policy override', () => {
    const auth = new AuthorizationService(toolRegistry, {
      overrides: { 'github.search_repos': { timeoutSeconds: 5 } }
    });
    const result = auth.authorize('github.search_repos');
    expect(result.timeoutMs).toBe(5000);
  });
});
