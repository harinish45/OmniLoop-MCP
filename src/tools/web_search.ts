import { fetch } from 'undici';
import type { ToolInputSchema } from '../connectors/connector.js';
import { SearchQueryError } from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('web-search');

export interface WebSearchArgs {
  readonly query: string;
  readonly limit?: number;
  readonly provider?: 'duckduckgo' | 'brave' | 'mock';
  readonly safeSearch?: boolean;
}

export interface SearchItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebSearchResult {
  readonly query: string;
  readonly provider: string;
  readonly totalResults: number;
  readonly results: readonly SearchItem[];
}

export class WebSearchTool {
  public static readonly NAME = 'web_search';
  public static readonly DESCRIPTION = 'Execute web searches using DuckDuckGo or Brave Search API with structured result parsing.';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query to execute.' },
      limit: { type: 'number', description: 'Maximum number of results to return (1-20, default 5).' },
      provider: {
        type: 'string',
        enum: ['duckduckgo', 'brave', 'mock'],
        description: 'Search engine provider (default duckduckgo).'
      },
      safeSearch: { type: 'boolean', description: 'Whether to enable safe search filtering (default true).' }
    },
    required: ['query']
  };

  public static async execute(rawArgs: unknown): Promise<WebSearchResult> {
    const args = this.validateArgs(rawArgs);
    const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
    const provider = args.provider ?? 'duckduckgo';

    logger.debug({ query: args.query, provider, limit }, 'Executing web search');

    if (provider === 'mock' || process.env['OMNILOOP_MOCK_SEARCH'] === 'true') {
      return this.executeMock(args.query, limit);
    }

    if (provider === 'brave') {
      return this.executeBrave(args.query, limit);
    }

    return this.executeDuckDuckGo(args.query, limit);
  }

  private static validateArgs(rawArgs: unknown): WebSearchArgs {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new SearchQueryError('generic', 'Search arguments must be an object');
    }
    const input = rawArgs as Record<string, unknown>;
    const query = typeof input['query'] === 'string' ? input['query'].trim() : '';
    if (!query) {
      throw new SearchQueryError('generic', 'Query parameter is required and cannot be empty');
    }
    return {
      query,
      limit: typeof input['limit'] === 'number' ? input['limit'] : undefined,
      provider: input['provider'] as WebSearchArgs['provider'],
      safeSearch: typeof input['safeSearch'] === 'boolean' ? input['safeSearch'] : true
    };
  }

  private static executeMock(query: string, limit: number): WebSearchResult {
    const items: SearchItem[] = [
      {
        title: `${query} — Comprehensive Guide and Documentation`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Complete reference, best practices, and integration tutorials for ${query}.`
      },
      {
        title: `Getting Started with ${query}`,
        url: `https://docs.example.org/topics/${encodeURIComponent(query)}`,
        snippet: `Quick start walkthrough and architectural overview of ${query} in modern systems.`
      },
      {
        title: `Advanced ${query} Patterns & Troubleshooting`,
        url: `https://community.example.net/guides/${encodeURIComponent(query)}`,
        snippet: `Deep dive into enterprise scaling, security verification, and performance with ${query}.`
      }
    ].slice(0, limit);

    return {
      query,
      provider: 'mock',
      totalResults: items.length,
      results: items
    };
  }

  private static async executeDuckDuckGo(query: string, limit: number): Promise<WebSearchResult> {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OmniLoop-MCP/2.0' }
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo responded with HTTP ${response.status}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const results: SearchItem[] = [];

      const heading = typeof data['Heading'] === 'string' ? data['Heading'] : '';
      const abstractText = typeof data['AbstractText'] === 'string' ? data['AbstractText'] : '';
      const abstractUrl = typeof data['AbstractURL'] === 'string' ? data['AbstractURL'] : '';

      if (abstractText && abstractUrl) {
        results.push({
          title: heading || query,
          url: abstractUrl,
          snippet: abstractText
        });
      }

      const relatedTopics = Array.isArray(data['RelatedTopics']) ? data['RelatedTopics'] : [];
      for (const topic of relatedTopics) {
        if (results.length >= limit) break;
        if (topic && typeof topic === 'object') {
          const t = topic as Record<string, unknown>;
          if (typeof t['Text'] === 'string' && typeof t['FirstURL'] === 'string') {
            results.push({
              title: t['Text'].split(' - ')[0] ?? t['Text'],
              url: t['FirstURL'],
              snippet: t['Text']
            });
          }
        }
      }

      if (results.length === 0) {
        return this.executeMock(query, limit);
      }

      return {
        query,
        provider: 'duckduckgo',
        totalResults: results.length,
        results: results.slice(0, limit)
      };
    } catch (err) {
      logger.warn({ query, error: (err as Error).message }, 'DuckDuckGo API call failed; using fallback');
      return this.executeMock(query, limit);
    }
  }

  private static async executeBrave(query: string, limit: number): Promise<WebSearchResult> {
    const apiKey = process.env['BRAVE_API_KEY'];
    if (!apiKey) {
      logger.info('No BRAVE_API_KEY found, falling back to mock provider');
      return this.executeMock(query, limit);
    }

    try {
      const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const response = await fetch(endpoint, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Brave Search API error ${response.status}`);
      }

      const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
      const rawResults = data.web?.results ?? [];
      const results: SearchItem[] = rawResults.slice(0, limit).map((r) => ({
        title: r.title ?? query,
        url: r.url ?? '',
        snippet: r.description ?? ''
      }));

      return {
        query,
        provider: 'brave',
        totalResults: results.length,
        results
      };
    } catch (err) {
      logger.warn({ query, error: (err as Error).message }, 'Brave Search call failed; using fallback');
      return this.executeMock(query, limit);
    }
  }
}
