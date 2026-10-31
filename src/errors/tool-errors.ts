/**
 * Specialized Tool Error Types for OmniLoop-MCP
 */

export class ToolExecutionError extends Error {
  public readonly toolName: string;
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(
    toolName: string,
    code: string,
    message: string,
    context: Record<string, unknown> = {}
  ) {
    super(`[${toolName}] ${message}`);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
    this.code = code;
    this.context = context;
  }
}

export class PathTraversalError extends ToolExecutionError {
  constructor(attemptedPath: string, allowedRoot: string) {
    super(
      'file_system',
      'ERR_PATH_TRAVERSAL',
      `Access denied: path "${attemptedPath}" escapes allowed directory "${allowedRoot}"`,
      { attemptedPath, allowedRoot }
    );
    this.name = 'PathTraversalError';
  }
}

export class FileNotFoundError extends ToolExecutionError {
  constructor(filePath: string) {
    super('file_system', 'ERR_FILE_NOT_FOUND', `File not found at path "${filePath}"`, { filePath });
    this.name = 'FileNotFoundError';
  }
}

export class FileAlreadyExistsError extends ToolExecutionError {
  constructor(filePath: string) {
    super('file_system', 'ERR_FILE_EXISTS', `File already exists at path "${filePath}" and overwrite is false`, { filePath });
    this.name = 'FileAlreadyExistsError';
  }
}

export class HttpRequestError extends ToolExecutionError {
  public readonly statusCode?: number;

  constructor(url: string, message: string, statusCode?: number) {
    super('http_request', 'ERR_HTTP_REQUEST', message, { url, statusCode });
    this.name = 'HttpRequestError';
    this.statusCode = statusCode;
  }
}

export class CodeExecutionTimeoutError extends ToolExecutionError {
  constructor(language: string, timeoutMs: number) {
    super(
      'run_code',
      'ERR_CODE_TIMEOUT',
      `Code execution for language "${language}" timed out after ${timeoutMs}ms`,
      { language, timeoutMs }
    );
    this.name = 'CodeExecutionTimeoutError';
  }
}

export class CodeExecutionSecurityError extends ToolExecutionError {
  constructor(language: string, reason: string) {
    super('run_code', 'ERR_CODE_SECURITY', `Security violation in ${language}: ${reason}`, { language, reason });
    this.name = 'CodeExecutionSecurityError';
  }
}

export class DatabaseQueryError extends ToolExecutionError {
  constructor(query: string, errorDetail: string) {
    super('database_query', 'ERR_DATABASE_QUERY', `SQL query failed: ${errorDetail}`, { query, errorDetail });
    this.name = 'DatabaseQueryError';
  }
}

export class SearchQueryError extends ToolExecutionError {
  constructor(provider: string, detail: string) {
    super('web_search', 'ERR_SEARCH_QUERY', `Search via ${provider} failed: ${detail}`, { provider, detail });
    this.name = 'SearchQueryError';
  }
}
