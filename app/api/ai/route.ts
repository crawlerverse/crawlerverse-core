/**
 * AI API Route - crawler-core demo
 *
 * Uses the shared createAIHandler from the core library.
 * No auth required for local development - you control the server.
 */

import { createAIHandler } from '@/lib/api/aiHandler';

export const POST = createAIHandler({ skipAccessCodeValidation: true });
