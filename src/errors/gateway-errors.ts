/**
 * Structured Gateway Error Types
 * All errors have machine-readable codes for programmatic handling.
 */

export interface GatewayErrorContext {
  [key: string]: unknown;
}

export class GatewayError extends Error {
  public readonly code: string;
  public readonly context: GatewayErrorContext;
  public readonly timestamp: Date;

  constructor(code: string, message: string, context: GatewayErrorContext = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date();

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GatewayError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack
    };
  }
}

// ── Specific Error Types ────────────────────────────────────────────────────────

export class ToolNotFoundError extends GatewayError {
  constructor(toolName: string) {
    super('TOOL_NOT_FOUND', `Tool "${toolName}" not found in registry`, { toolName });
    this.name = 'ToolNotFoundError';
  }
}

export class AuthorizationError extends GatewayError {
  constructor(reason: string, context: GatewayErrorContext = {}) {
    super('AUTHORIZATION_DENIED', `Authorization denied: ${reason}`, context);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends GatewayError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, context: GatewayErrorContext = {}) {
    super('RATE_LIMIT_EXCEEDED', `Rate limit exceeded. Retry in ${Math.ceil(retryAfterMs / 1000)}s`, { retryAfterMs, ...context });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class ValidationError extends GatewayError {
  public readonly errors: string[];

  constructor(errors: string[], context: GatewayErrorContext = {}) {
    super('VALIDATION_FAILED', `Validation failed: ${errors.join('; ')}`, { errors, ...context });
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class CircuitBreakerOpenError extends GatewayError {
  public readonly serverId: string;
  public readonly retryAfterMs: number;

  constructor(serverId: string, retryAfterMs: number) {
    super('CIRCUIT_BREAKER_OPEN', `Circuit breaker OPEN for server "${serverId}". Retry in ${Math.round(retryAfterMs / 1000)}s.`, { serverId, retryAfterMs });
    this.name = 'CircuitBreakerOpenError';
    this.serverId = serverId;
    this.retryAfterMs = retryAfterMs;
  }
}

export class SandboxViolationError extends GatewayError {
  public readonly violations: string[];

  constructor(violations: string[], context: GatewayErrorContext = {}) {
    super('SANDBOX_VIOLATION', `Sandbox violation: ${violations.join('; ')}`, { violations, ...context });
    this.name = 'SandboxViolationError';
    this.violations = violations;
  }
}

export class AnomalyDetectedError extends GatewayError {
  public readonly reasons: string[];

  constructor(reasons: string[], context: GatewayErrorContext = {}) {
    super('ANOMALY_DETECTED', `Anomaly detected: ${reasons.join('; ')}`, { reasons, ...context });
    this.name = 'AnomalyDetectedError';
    this.reasons = reasons;
  }
}

export class HitlRequiredError extends GatewayError {
  public readonly toolName: string;
  public readonly riskLevel: string;
  public readonly reason: string;

  constructor(toolName: string, riskLevel: string, reason: string) {
    super('HITL_REQUIRED', `HITL required for ${toolName} (risk: ${riskLevel}): ${reason}`, { toolName, riskLevel, reason });
    this.name = 'HitlRequiredError';
    this.toolName = toolName;
    this.riskLevel = riskLevel;
    this.reason = reason;
  }
}

export class IdempotencyConflictError extends GatewayError {
  public readonly key: string;

  constructor(key: string) {
    super('IDEMPOTENCY_CONFLICT', `Idempotency key already processed: ${key}`, { key });
    this.name = 'IdempotencyConflictError';
    this.key = key;
  }
}

export class VerificationFailedError extends GatewayError {
  public readonly toolName: string;
  public readonly iterations: number;
  public readonly failureReason?: string;

  constructor(toolName: string, iterations: number, failureReason?: string) {
    super('VERIFICATION_FAILED', `Verification failed for ${toolName} after ${iterations} iterations${failureReason ? `: ${failureReason}` : ''}`, { toolName, iterations, failureReason });
    this.name = 'VerificationFailedError';
    this.toolName = toolName;
    this.iterations = iterations;
    this.failureReason = failureReason;
  }
}

export class TimeoutError extends GatewayError {
  public readonly timeoutMs: number;
  public readonly operation: string;

  constructor(operation: string, timeoutMs: number) {
    super('TIMEOUT', `${operation} timed out after ${timeoutMs}ms`, { operation, timeoutMs });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}

export class ConfigurationError extends GatewayError {
  public readonly configPath: string;

  constructor(message: string, configPath: string) {
    super('CONFIGURATION_ERROR', `Configuration error: ${message}`, { configPath });
    this.name = 'ConfigurationError';
    this.configPath = configPath;
  }
}

export class ConnectorError extends GatewayError {
  public readonly serverId: string;
  public readonly transport: string;
  public readonly originalError: Error | undefined;

  constructor(serverId: string, transport: string, message: string, originalError?: Error) {
    super('CONNECTOR_ERROR', `Connector error (${transport}://${serverId}): ${message}`, { serverId, transport, originalError: originalError?.message });
    this.name = 'ConnectorError';
    this.serverId = serverId;
    this.transport = transport;
    this.originalError = originalError;
  }
}

export class ServerOfflineError extends GatewayError {
  public readonly serverId: string;

  constructor(serverId: string) {
    super('SERVER_OFFLINE', `Server "${serverId}" is offline`, { serverId });
    this.name = 'ServerOfflineError';
    this.serverId = serverId;
  }
}

export class CacheError extends GatewayError {
  public readonly operation: 'get' | 'set' | 'invalidate' | 'gc';

  constructor(operation: 'get' | 'set' | 'invalidate' | 'gc', message: string) {
    super('CACHE_ERROR', `Cache ${operation} failed: ${message}`, { operation });
    this.name = 'CacheError';
    this.operation = operation;
  }
}

// ── Error Code Constants ────────────────────────────────────────────────────────

export const ERROR_CODES = {
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
  SANDBOX_VIOLATION: 'SANDBOX_VIOLATION',
  ANOMALY_DETECTED: 'ANOMALY_DETECTED',
  HITL_REQUIRED: 'HITL_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  TIMEOUT: 'TIMEOUT',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  CONNECTOR_ERROR: 'CONNECTOR_ERROR',
  SERVER_OFFLINE: 'SERVER_OFFLINE',
  CACHE_ERROR: 'CACHE_ERROR'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// ── Error Factory ────────────────────────────────────────────────────────────────

export function createGatewayError(code: ErrorCode, message: string, context: GatewayErrorContext = {}): GatewayError {
  switch (code) {
    case 'TOOL_NOT_FOUND':
      return new ToolNotFoundError(context.toolName as string);
    case 'AUTHORIZATION_DENIED':
      return new AuthorizationError(message, context);
    case 'RATE_LIMIT_EXCEEDED':
      return new RateLimitError(context.retryAfterMs as number, context);
    case 'VALIDATION_FAILED':
      return new ValidationError(context.errors as string[], context);
    case 'CIRCUIT_BREAKER_OPEN':
      return new CircuitBreakerOpenError(context.serverId as string, context.retryAfterMs as number);
    case 'SANDBOX_VIOLATION':
      return new SandboxViolationError(context.violations as string[], context);
    case 'ANOMALY_DETECTED':
      return new AnomalyDetectedError(context.reasons as string[], context);
    case 'HITL_REQUIRED':
      return new HitlRequiredError(context.toolName as string, context.riskLevel as string, context.reason as string);
    case 'IDEMPOTENCY_CONFLICT':
      return new IdempotencyConflictError(context.key as string);
    case 'VERIFICATION_FAILED':
      return new VerificationFailedError(context.toolName as string, context.iterations as number, context.failureReason as string);
    case 'TIMEOUT':
      return new TimeoutError(context.operation as string, context.timeoutMs as number);
    case 'CONFIGURATION_ERROR':
      return new ConfigurationError(message, context.configPath as string);
    case 'CONNECTOR_ERROR':
      return new ConnectorError(context.serverId as string, context.transport as string, message, context.originalError as Error);
    case 'SERVER_OFFLINE':
      return new ServerOfflineError(context.serverId as string);
    case 'CACHE_ERROR':
      return new CacheError(context.operation as 'get' | 'set' | 'invalidate' | 'gc', message);
    default:
      return new GatewayError(code, message, context);
  }
}

// ── Type Guards ──────────────────────────────────────────────────────────────────

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export function isCircuitBreakerOpenError(error: unknown): error is CircuitBreakerOpenError {
  return error instanceof CircuitBreakerOpenError;
}

export function isRetryableError(error: unknown): boolean {
  return (
    isRateLimitError(error) ||
    isCircuitBreakerOpenError(error) ||
    (error instanceof GatewayError && error.code === 'TIMEOUT')
  );
}