/**
 * Structured Logger
 *
 * Pino-based logging with pretty-print in dev, JSON in prod.
 * Use createLogger() for context-rich child loggers.
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isServer = typeof window === 'undefined';

// Browser-safe logger (pino-pretty doesn't work in browser)
const transport = isServer && !isProduction
  ? { target: 'pino-pretty', options: { colorize: true } }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport,
  browser: {
    // In browser, use console methods
    asObject: false,
  },
});

/**
 * Create a child logger with inherited context.
 * Use for request-scoped or game-scoped logging.
 *
 * @example
 * const gameLogger = createLogger({ sessionId, turn });
 * gameLogger.info('AI action requested');
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
