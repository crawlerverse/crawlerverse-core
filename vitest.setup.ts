/**
 * Vitest Setup
 *
 * Global setup for tests including jsdom matchers.
 */

import '@testing-library/jest-dom/vitest';

// Silence pino logs during tests
process.env.LOG_LEVEL = 'silent';
