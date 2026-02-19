/**
 * Generate Bio Handler Factory
 *
 * Creates a Next.js API route handler for generating character backstories.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAIModel, getProviderConfig } from '../ai/providers';
import { generateText } from 'ai';
import { logger } from '../logging';
import { CrawlerCharacterSystem, SAFE_NAME_PATTERN } from '../engine/character-system';
import { isRetryableError } from './errors';

const BIO_MAX_LENGTH = 250;

const RequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(20)
    .regex(SAFE_NAME_PATTERN, 'Name contains invalid characters'),
  characterClass: z.enum(['warrior', 'rogue', 'mage', 'cleric']),
});

export interface CreateGenerateBioHandlerOptions {
  /**
   * Model ID to use. If not specified, uses provider default.
   */
  model?: string;
}

/**
 * Creates a Next.js API route handler for generating character backstories.
 *
 * @example
 * // In app/api/generate-bio/route.ts
 * import { createGenerateBioHandler } from '@crawler/core/api';
 * export const POST = createGenerateBioHandler();
 */
export function createGenerateBioHandler(options: CreateGenerateBioHandlerOptions = {}) {
  const { model } = options;

  return async function POST(request: Request) {
    try {
      const body = await request.json();
      const parsed = RequestSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid request', details: parsed.error.issues },
          { status: 400 }
        );
      }

      const { name, characterClass } = parsed.data;
      const classDef = CrawlerCharacterSystem.classes.find(c => c.id === characterClass);
      const personality = classDef?.personality ?? '';

      const config = getProviderConfig();
      const aiModel = getAIModel(model, config);
      const { text } = await generateText({
        model: aiModel,
        prompt: `Generate a brief backstory (2-3 sentences, max ${BIO_MAX_LENGTH} characters) for a ${characterClass} named ${name}.
Personality: ${personality}
Keep it evocative but short. Do not include the character's name in the backstory. Just describe their past.
Output only the backstory text, nothing else.`,
      });

      const bio = text.trim().slice(0, BIO_MAX_LENGTH);

      return NextResponse.json({ bio });
    } catch (error) {
      logger.error({ error, module: 'generate-bio' }, 'Bio generation failed');

      // Differentiate between retryable and permanent errors
      if (isRetryableError(error)) {
        return NextResponse.json(
          { error: 'AI service temporarily unavailable. Please try again.', retryable: true },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to generate backstory. Please try again or write your own.', retryable: false },
        { status: 500 }
      );
    }
  };
}
