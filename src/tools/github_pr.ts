import { fetch } from 'undici';
import type { ToolInputSchema } from '../connectors/connector.js';
import { ToolExecutionError } from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('github-pr');

export type GitHubPRAction = 'list' | 'get' | 'create_summary';

export interface GitHubPRArgs {
  readonly action: GitHubPRAction;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber?: number;
  readonly token?: string;
  readonly mock?: boolean;
}

export interface PullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly author: string;
  readonly htmlUrl: string;
  readonly createdAt: string;
}

export interface GitHubPRResult {
  readonly action: GitHubPRAction;
  readonly repository: string;
  readonly pullRequests?: PullRequestSummary[];
  readonly pullRequest?: PullRequestSummary & { readonly body?: string };
  readonly summaryText?: string;
}

export class GitHubPRTool {
  public static readonly NAME = 'github_pr';
  public static readonly DESCRIPTION = 'Inspect, list, or format pull request details for GitHub repositories.';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'create_summary'],
        description: 'Operation to perform on repository pull requests.'
      },
      owner: { type: 'string', description: 'GitHub organization or username owner.' },
      repo: { type: 'string', description: 'Repository name.' },
      pullNumber: { type: 'number', description: 'Pull request number (required for "get" action).' },
      token: { type: 'string', description: 'GitHub personal access token (optional).' },
      mock: { type: 'boolean', description: 'Use simulated data without contacting GitHub API (default false).' }
    },
    required: ['action', 'owner', 'repo']
  };

  public static async execute(rawArgs: unknown): Promise<GitHubPRResult> {
    const args = this.validateArgs(rawArgs);
    const repoIdentifier = `${args.owner}/${args.repo}`;
    const token = args.token ?? process.env['GITHUB_TOKEN'];
    const isMock = args.mock === true || !token || process.env['OMNILOOP_MOCK_GITHUB'] === 'true';

    logger.debug({ action: args.action, repo: repoIdentifier, isMock }, 'Executing GitHub PR operation');

    if (isMock) {
      return this.executeMock(args);
    }

    return this.executeApi(args, token);
  }

  private static validateArgs(rawArgs: unknown): GitHubPRArgs {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('github_pr', 'ERR_INVALID_ARGS', 'GitHub PR arguments must be an object');
    }
    const input = rawArgs as Record<string, unknown>;
    const action = input['action'] as GitHubPRAction;
    if (!['list', 'get', 'create_summary'].includes(action)) {
      throw new ToolExecutionError('github_pr', 'ERR_INVALID_ACTION', `Invalid action "${action}"`);
    }

    const owner = typeof input['owner'] === 'string' ? input['owner'].trim() : '';
    const repo = typeof input['repo'] === 'string' ? input['repo'].trim() : '';
    if (!owner || !repo) {
      throw new ToolExecutionError('github_pr', 'ERR_MISSING_REPO', 'Both "owner" and "repo" must be provided');
    }

    const pullNumber = typeof input['pullNumber'] === 'number' ? input['pullNumber'] : undefined;
    if (action === 'get' && pullNumber === undefined) {
      throw new ToolExecutionError('github_pr', 'ERR_MISSING_PR_NUMBER', 'Action "get" requires "pullNumber"');
    }

    return {
      action,
      owner,
      repo,
      pullNumber,
      token: typeof input['token'] === 'string' ? input['token'] : undefined,
      mock: typeof input['mock'] === 'boolean' ? input['mock'] : undefined
    };
  }

  private static executeMock(args: GitHubPRArgs): GitHubPRResult {
    const repoIdentifier = `${args.owner}/${args.repo}`;

    if (args.action === 'get') {
      return {
        action: 'get',
        repository: repoIdentifier,
        pullRequest: {
          number: args.pullNumber ?? 101,
          title: 'feat: add enterprise verification and mcp tools',
          state: 'open',
          author: args.owner,
          htmlUrl: `https://github.com/${repoIdentifier}/pull/${args.pullNumber ?? 101}`,
          createdAt: new Date().toISOString(),
          body: 'Implements core tools, security guards, and automated test coverage.'
        }
      };
    }

    const samplePRs: PullRequestSummary[] = [
      {
        number: 101,
        title: 'feat: add enterprise verification and mcp tools',
        state: 'open',
        author: args.owner,
        htmlUrl: `https://github.com/${repoIdentifier}/pull/101`,
        createdAt: new Date(Date.now() - 3600_000).toISOString()
      },
      {
        number: 100,
        title: 'chore: update dependency versions',
        state: 'closed',
        author: 'bot',
        htmlUrl: `https://github.com/${repoIdentifier}/pull/100`,
        createdAt: new Date(Date.now() - 86400_000).toISOString()
      }
    ];

    if (args.action === 'create_summary') {
      const summaryText = samplePRs
        .map((pr) => `#${pr.number} [${pr.state.toUpperCase()}] ${pr.title} by @${pr.author}`)
        .join('\n');
      return {
        action: 'create_summary',
        repository: repoIdentifier,
        pullRequests: samplePRs,
        summaryText
      };
    }

    return {
      action: 'list',
      repository: repoIdentifier,
      pullRequests: samplePRs
    };
  }

  private static async executeApi(args: GitHubPRArgs, token: string): Promise<GitHubPRResult> {
    const repoIdentifier = `${args.owner}/${args.repo}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${token}`,
      'User-Agent': 'OmniLoop-MCP/2.0'
    };

    if (args.action === 'get') {
      const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new ToolExecutionError('github_pr', 'ERR_PR_FETCH_FAILED', `GitHub API error ${response.status}`);
      }
      const data = (await response.json()) as {
        number: number;
        title: string;
        state: string;
        user?: { login?: string };
        html_url: string;
        created_at: string;
        body?: string;
      };
      return {
        action: 'get',
        repository: repoIdentifier,
        pullRequest: {
          number: data.number,
          title: data.title,
          state: data.state,
          author: data.user?.login ?? 'unknown',
          htmlUrl: data.html_url,
          createdAt: data.created_at,
          body: data.body ?? ''
        }
      };
    }

    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls?state=all&per_page=10`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ToolExecutionError('github_pr', 'ERR_PR_LIST_FAILED', `GitHub API error ${response.status}`);
    }
    const items = (await response.json()) as Array<{
      number: number;
      title: string;
      state: string;
      user?: { login?: string };
      html_url: string;
      created_at: string;
    }>;

    const pullRequests: PullRequestSummary[] = items.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      author: i.user?.login ?? 'unknown',
      htmlUrl: i.html_url,
      createdAt: i.created_at
    }));

    if (args.action === 'create_summary') {
      const summaryText = pullRequests
        .map((pr) => `#${pr.number} [${pr.state.toUpperCase()}] ${pr.title} by @${pr.author}`)
        .join('\n');
      return {
        action: 'create_summary',
        repository: repoIdentifier,
        pullRequests,
        summaryText
      };
    }

    return {
      action: 'list',
      repository: repoIdentifier,
      pullRequests
    };
  }
}
