import { fetch, type RequestInit } from 'undici';
import type { ToolInputSchema } from '../connectors/connector.js';
import { HttpRequestError, ToolExecutionError } from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('http-request');

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export interface HttpRequestArgs {
  readonly url: string;
  readonly method?: HttpMethod;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly allowRedirects?: boolean;
}

export interface HttpResponseResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly data: unknown;
  readonly durationMs: number;
}

export class HttpRequestTool {
  public static readonly NAME = 'http_request';
  public static readonly DESCRIPTION = 'Perform HTTP requests (GET, POST, PUT, DELETE, PATCH, HEAD) with custom headers, body, and timeouts.';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Destination HTTP or HTTPS URL.' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
        description: 'HTTP request method (default GET).'
      },
      headers: {
        type: 'object',
        description: 'Key-value headers to include in the request.'
      },
      body: {
        description: 'Request payload (string or JSON serializable object).'
      },
      timeoutMs: {
        type: 'number',
        description: 'Request timeout in milliseconds (100 to 60000, default 10000).'
      },
      allowRedirects: {
        type: 'boolean',
        description: 'Whether to automatically follow HTTP redirects (default true).'
      }
    },
    required: ['url']
  };

  public static async execute(rawArgs: unknown): Promise<HttpResponseResult> {
    const args = this.validateArgs(rawArgs);
    const parsedUrl = this.validateUrl(args.url);
    const method = (args.method ?? 'GET').toUpperCase() as HttpMethod;
    const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 10_000, 100), 60_000);

    const headers: Record<string, string> = {
      'User-Agent': 'OmniLoop-MCP/2.0',
      ...(args.headers ?? {})
    };

    let serializedBody: string | undefined = undefined;
    if (args.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (typeof args.body === 'string') {
        serializedBody = args.body;
      } else {
        serializedBody = JSON.stringify(args.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const init: RequestInit = {
      method,
      headers,
      body: serializedBody,
      redirect: args.allowRedirects === false ? 'manual' : 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    };

    const startTime = Date.now();
    logger.debug({ method, url: parsedUrl.href, timeoutMs }, 'Dispatching HTTP request');

    try {
      const response = await fetch(parsedUrl.href, init);
      const durationMs = Date.now() - startTime;

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      const contentType = responseHeaders['content-type'] ?? '';
      let data: unknown;

      if (method === 'HEAD') {
        data = null;
      } else if (contentType.includes('application/json')) {
        const text = await response.text();
        data = text ? JSON.parse(text) : null;
      } else {
        data = await response.text();
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
        durationMs
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
        throw new HttpRequestError(args.url, `Request timed out after ${timeoutMs}ms`);
      }
      throw new HttpRequestError(args.url, `HTTP request failed: ${errorMsg}`);
    }
  }

  private static validateArgs(rawArgs: unknown): HttpRequestArgs {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('http_request', 'ERR_INVALID_ARGS', 'HTTP request arguments must be an object');
    }
    const input = rawArgs as Record<string, unknown>;
    const url = typeof input['url'] === 'string' ? input['url'].trim() : '';
    if (!url) {
      throw new ToolExecutionError('http_request', 'ERR_MISSING_URL', 'URL parameter is required and cannot be empty');
    }

    return {
      url,
      method: input['method'] as HttpMethod,
      headers: input['headers'] as Record<string, string>,
      body: input['body'],
      timeoutMs: typeof input['timeoutMs'] === 'number' ? input['timeoutMs'] : undefined,
      allowRedirects: typeof input['allowRedirects'] === 'boolean' ? input['allowRedirects'] : true
    };
  }

  private static validateUrl(urlString: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new ToolExecutionError('http_request', 'ERR_MALFORMED_URL', `Invalid URL format: "${urlString}"`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ToolExecutionError(
        'http_request',
        'ERR_UNSUPPORTED_PROTOCOL',
        `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`
      );
    }

    return parsed;
  }
}
