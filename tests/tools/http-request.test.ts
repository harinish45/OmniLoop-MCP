import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpRequestTool } from '../../src/tools/http_request.js';
import { HttpRequestError, ToolExecutionError } from '../../src/errors/tool-errors.js';

describe('HttpRequestTool', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ delayed: true }));
        }, 1500);
        return;
      }

      if (req.url === '/json') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Echo-Method': req.method ?? 'GET'
          });
          res.end(JSON.stringify({
            receivedMethod: req.method,
            receivedHeader: req.headers['x-custom-header'],
            receivedBody: body ? JSON.parse(body) : null
          }));
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello from local test server');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('validates tool schema and metadata', () => {
    expect(HttpRequestTool.NAME).toBe('http_request');
    expect(HttpRequestTool.INPUT_SCHEMA.required).toContain('url');
  });

  it('executes GET request and parses text response', async () => {
    const response = await HttpRequestTool.execute({
      url: `${baseUrl}/`
    });

    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.data).toBe('Hello from local test server');
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('executes POST request with JSON payload and custom headers', async () => {
    const payload = { action: 'test', count: 42 };
    const response = await HttpRequestTool.execute({
      url: `${baseUrl}/json`,
      method: 'POST',
      headers: { 'X-Custom-Header': 'OmniLoopTest' },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(response.headers['x-echo-method']).toBe('POST');
    const data = response.data as { receivedMethod: string; receivedHeader: string; receivedBody: typeof payload };
    expect(data.receivedMethod).toBe('POST');
    expect(data.receivedHeader).toBe('OmniLoopTest');
    expect(data.receivedBody).toEqual(payload);
  });

  it('aborts and throws HttpRequestError when request exceeds timeoutMs', async () => {
    await expect(
      HttpRequestTool.execute({
        url: `${baseUrl}/slow`,
        timeoutMs: 300
      })
    ).rejects.toThrow(HttpRequestError);
  });

  it('rejects unsupported protocols like file:// or ftp://', async () => {
    await expect(
      HttpRequestTool.execute({
        url: 'file:///etc/passwd'
      })
    ).rejects.toThrow(ToolExecutionError);

    await expect(
      HttpRequestTool.execute({
        url: 'ftp://ftp.example.com/test'
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  it('rejects malformed or empty URLs', async () => {
    await expect(HttpRequestTool.execute({ url: '' })).rejects.toThrow(ToolExecutionError);
    await expect(HttpRequestTool.execute({ url: 'not-a-valid-url' })).rejects.toThrow(ToolExecutionError);
  });
});
