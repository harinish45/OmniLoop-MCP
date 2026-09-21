/**
 * Structured JSON logger for the OmniLoop gateway.
 * Wraps pino to provide consistent log shape across all modules.
 * Every log entry carries: level, timestamp, module, traceId (when available).
 */

import pino from 'pino';

/** Log levels supported by OmniLoop (subset of pino) */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Global logger instance — initialized once at gateway startup */
let _logger: pino.Logger | null = null;

/**
 * Initialize the global logger. Must be called before any log() calls.
 * @param level  Minimum log level from config
 */
export function initLogger(level: LogLevel = 'info'): void {
  _logger = pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label })
    }
  });
}

/** Get the initialized logger, or a default info-level logger if not initialized */
function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({ level: 'info' });
  }
  return _logger;
}

/**
 * Create a child logger scoped to a specific module.
 * Child loggers inherit the parent level and add a "module" field.
 */
export function createLogger(module: string): pino.Logger {
  return getLogger().child({ module });
}

/** Convenience: log with an attached trace ID */
export function withTrace(logger: pino.Logger, traceId: string): pino.Logger {
  return logger.child({ traceId });
}
