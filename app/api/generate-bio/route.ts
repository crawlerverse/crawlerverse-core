/**
 * Generate Bio API Route
 *
 * Generates a short AI backstory for a character based on name and class.
 * Truncates output to 250 characters maximum.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAIModel } from '@/lib/ai/providers';
import { generateText } from 'ai';
import { CrawlerCharacterSystem, SAFE_NAME_PATTERN } from '@/lib/engine/character-system';

const BIO_MAX_LENGTH = 250;

const RequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(20)
    .regex(SAFE_NAME_PATTERN, 'Name contains invalid characters'),
  characterClass: z.enum(['warrior', 'rogue', 'mage', 'cleric']),
});

/**
 * Check if an error is likely retryable (network issues, rate limits, etc.)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('503') ||
      message.includes('429') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    );
  }
  return false;
}

export async function POST(request: Request) {
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

    const model = getAIModel();
    const { text } = await generateText({
      model,
      prompt: `Generate a brief backstory (2-3 sentences, max ${BIO_MAX_LENGTH} characters) for a ${characterClass} named ${name}.
Personality: ${personality}
Keep it evocative but short. Do not include the character's name in the backstory. Just describe their past.
Output only the backstory text, nothing else.`,
    });

    const bio = text.trim().slice(0, BIO_MAX_LENGTH);

    return NextResponse.json({ bio });
  } catch (error) {
    console.error('[generate-bio] Error:', error);

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
}
