/**
 * Generate Narration API Route
 *
 * Generates event narrations using AI based on game events.
 * Uses the shared createGenerateNarrationHandler from the core library.
 */
import { createGenerateNarrationHandler } from '@crawlerverse/core/api';

export const POST = createGenerateNarrationHandler();
