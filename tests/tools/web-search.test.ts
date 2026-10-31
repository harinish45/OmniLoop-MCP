import { describe, it, expect } from 'vitest';
import { WebSearchTool } from '../../src/tools/web_search.js';
import { SearchQueryError } from '../../src/errors/tool-errors.js';

describe('WebSearchTool', () => {
  it('has correct tool metadata', () => {
    expect(WebSearchTool.NAME).toBe('web_search');
    expect(WebSearchTool.DESCRIPTION).toContain('DuckDuckGo or Brave Search API');
    expect(WebSearchTool.INPUT_SCHEMA.required).toContain('query');
  });

  it('executes mock search and returns structured results', async () => {
    const result = await WebSearchTool.execute({
      query: 'model context protocol',
      provider: 'mock',
      limit: 3
    });

    expect(result.query).toBe('model context protocol');
    expect(result.provider).toBe('mock');
    expect(result.results.length).toBeLessThanOrEqual(3);
    expect(result.totalResults).toBe(result.results.length);

    const first = result.results[0];
    expect(first).toBeDefined();
    expect(first?.title).toContain('model context protocol');
    expect(first?.url).toContain('https://');
    expect(first?.snippet.length).toBeGreaterThan(10);
  });

  it('clamps limit to maximum of 20 and minimum of 1', async () => {
    const resultMax = await WebSearchTool.execute({
      query: 'vitest test runner',
      provider: 'mock',
      limit: 100
    });
    expect(resultMax.results.length).toBeLessThanOrEqual(20);

    const resultMin = await WebSearchTool.execute({
      query: 'typescript',
      provider: 'mock',
      limit: -5
    });
    expect(resultMin.results.length).toBeGreaterThanOrEqual(1);
  });

  it('throws SearchQueryError on empty query', async () => {
    await expect(WebSearchTool.execute({ query: '' })).rejects.toThrow(SearchQueryError);
    await expect(WebSearchTool.execute({ query: '   ' })).rejects.toThrow(SearchQueryError);
  });

  it('throws SearchQueryError on non-object arguments', async () => {
    await expect(WebSearchTool.execute(null)).rejects.toThrow(SearchQueryError);
    await expect(WebSearchTool.execute('query string')).rejects.toThrow(SearchQueryError);
  });

  it('gracefully handles search fallback for duckduckgo provider', async () => {
    const result = await WebSearchTool.execute({
      query: 'vitest documentation',
      provider: 'duckduckgo',
      limit: 2
    });

    expect(result.query).toBe('vitest documentation');
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });
});
