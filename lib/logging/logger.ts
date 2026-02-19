/**
 * Structured Logger
 *
 * Pino-based logging with pretty-print in dev, JSON in prod.
 * Use createLogger() for context-rich child loggers.
 *
 * IMPORTANT: This logger is server-side only. In browser contexts,
 * pino will automatically use console methods (see browser config).
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isServer = typeof window === 'undefined';

// Create logger with browser-safe configuration
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  // Only use pino-pretty transport on server in development
  // We can't reference it here due to bundler issues, so configure it
  // at the application level if needed
  browser: {
    // In browser, pino uses console methods automatically
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
