import { describe, it, expect } from 'vitest';
import { GitHubPRTool } from '../../src/tools/github_pr.js';
import { ToolExecutionError } from '../../src/errors/tool-errors.js';

describe('GitHubPRTool', () => {
  it('validates tool schema and required fields', () => {
    expect(GitHubPRTool.NAME).toBe('github_pr');
    expect(GitHubPRTool.INPUT_SCHEMA.required).toContain('action');
    expect(GitHubPRTool.INPUT_SCHEMA.required).toContain('owner');
    expect(GitHubPRTool.INPUT_SCHEMA.required).toContain('repo');
  });

  it('lists pull requests in mock mode', async () => {
    const result = await GitHubPRTool.execute({
      action: 'list',
      owner: 'harinish45',
      repo: 'OmniLoop-MCP',
      mock: true
    });

    expect(result.action).toBe('list');
    expect(result.repository).toBe('harinish45/OmniLoop-MCP');
    expect(Array.isArray(result.pullRequests)).toBe(true);
    expect(result.pullRequests?.length).toBeGreaterThan(0);
    const pr = result.pullRequests?.[0];
    expect(pr?.number).toBe(101);
    expect(pr?.state).toBe('open');
  });

  it('retrieves detailed single pull request in mock mode', async () => {
    const result = await GitHubPRTool.execute({
      action: 'get',
      owner: 'harinish45',
      repo: 'OmniLoop-MCP',
      pullNumber: 101,
      mock: true
    });

    expect(result.action).toBe('get');
    expect(result.pullRequest?.number).toBe(101);
    expect(result.pullRequest?.body).toBeDefined();
  });

  it('creates formatted summary text of pull requests', async () => {
    const result = await GitHubPRTool.execute({
      action: 'create_summary',
      owner: 'harinish45',
      repo: 'OmniLoop-MCP',
      mock: true
    });

    expect(result.action).toBe('create_summary');
    expect(result.summaryText).toContain('#101 [OPEN]');
  });

  it('throws ToolExecutionError on missing pullNumber for "get" action', async () => {
    await expect(
      GitHubPRTool.execute({
        action: 'get',
        owner: 'harinish45',
        repo: 'OmniLoop-MCP',
        mock: true
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  it('throws ToolExecutionError on invalid action', async () => {
    await expect(
      GitHubPRTool.execute({
        action: 'invalid_action' as unknown as 'list',
        owner: 'harinish45',
        repo: 'OmniLoop-MCP'
      })
    ).rejects.toThrow(ToolExecutionError);
  });
});
