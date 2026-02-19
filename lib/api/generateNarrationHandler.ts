/**
 * Generate Narration Handler Factory
 *
 * Creates a Next.js API route handler for generating event narrations.
 * Follows the same pattern as generateBioHandler.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAIModel, getProviderConfig } from '../ai/providers';
import { generateText } from 'ai';
import { logger } from '../logging';
import { EventType } from '../engine/events';
import { isRetryableError } from './errors';

// --- Request/Response Schemas ---

const RequestSchema = z.object({
  eventType: z.nativeEnum(EventType),
  personality: z.enum(['bardic', 'sardonic']),
  entities: z.array(z.object({
    name: z.string(),
    type: z.string(),
    hp: z.number(),
    maxHp: z.number(),
  })),
  turn: z.number(),
  metadata: z.record(z.unknown()),
});

type PersonalityType = 'bardic' | 'sardonic';

// --- System Prompts ---

const BARDIC_SYSTEM_PROMPT = `You are a dungeon master narrating a roguelike game.
Tone: Warm, adventurous, celebrates heroism and teamwork
Style: Vivid imagery, dramatic but sincere

Rules:
- CRITICAL: Maximum 30 words total (keep it brief!)
- 1-2 sentences maximum
- Present tense, active voice
- Use entity names from context (don't say "the crawler" - use their actual name)
- Describe outcomes, not player input
- No fourth wall breaking
- Focus on atmosphere and drama`;

const SARDONIC_SYSTEM_PROMPT = `You are a dungeon master narrating a roguelike game.
Tone: Dark humor, dramatic irony, dry wit
Style: Understated, deadpan, occasionally breaks fourth wall

Rules:
- CRITICAL: Maximum 30 words total (keep it brief!)
- 1-2 sentences maximum
- Present tense, active voice
- Use entity names from context
- Wry observations about the futility/absurdity of dungeon crawling
- Gentle mockery is fine, mean-spirited is not
- Fourth wall breaks allowed but not required`;

// --- Event Templates ---

const BARDIC_TEMPLATES: Record<EventType, string> = {
  [EventType.KILL]: "Describe the victor's triumph over their foe with heroic flair. Focus on the decisive moment.",
  [EventType.FIRST_BLOOD]: "Describe the first strike of combat with dramatic flair.",
  [EventType.CRITICAL_HP]: "Heighten tension as the entity teeters on the brink of defeat.",
  [EventType.COMBAT_END]: "Celebrate the victory. How does the victor survey the aftermath?",
  [EventType.AREA_ENTERED]: "Paint a vivid picture of the new area. What catches the crawler's eye?",
  [EventType.MONSTER_SEEN]: "Describe the first glimpse of this creature with dramatic atmosphere.",
  [EventType.ITEM_FOUND]: "Describe the discovery with a sense of fortune or destiny.",
  [EventType.PORTAL_FOUND]: "Describe the portal with anticipation of what lies ahead.",
  [EventType.CRAWLER_DEATH]: "Narrate the tragic fall with dramatic gravitas.",
  [EventType.VICTORY]: "Celebrate the hard-won triumph with epic flair.",
};

const SARDONIC_TEMPLATES: Record<EventType, string> = {
  [EventType.KILL]: "Note the victim's demise with dark humor or ironic observation.",
  [EventType.FIRST_BLOOD]: "Observe the start of violence with deadpan commentary.",
  [EventType.CRITICAL_HP]: "Comment dryly on the entity's predicament.",
  [EventType.COMBAT_END]: "Remark on the pyrrhic nature of dungeon crawling victories.",
  [EventType.AREA_ENTERED]: "Describe the area with dramatic irony or dry wit.",
  [EventType.MONSTER_SEEN]: "Note the creature's appearance with understated dread or irony.",
  [EventType.ITEM_FOUND]: "Comment on the 'fortune' with gentle cynicism.",
  [EventType.PORTAL_FOUND]: "Observe the portal with ironic anticipation.",
  [EventType.CRAWLER_DEATH]: "Remark on the inevitable outcome with dark humor.",
  [EventType.VICTORY]: "Note the 'triumph' with ironic detachment.",
};

// --- Helper Functions ---

/**
 * Sanitize user input to prevent prompt injection.
 * Removes/escapes characters that could break prompt structure.
 */
function sanitizeInput(input: string): string {
  return input
    .replace(/\n/g, ' ')  // Replace newlines with spaces
    .replace(/\r/g, '')   // Remove carriage returns
    .trim()
    .slice(0, 200);       // Limit length to prevent token flooding
}

function getSystemPrompt(personality: PersonalityType): string {
  switch (personality) {
    case 'bardic':
      return BARDIC_SYSTEM_PROMPT;
    case 'sardonic':
      return SARDONIC_SYSTEM_PROMPT;
  }
}

function getEventTemplate(eventType: EventType, personality: PersonalityType): string {
  const templates = personality === 'bardic' ? BARDIC_TEMPLATES : SARDONIC_TEMPLATES;
  return templates[eventType];
}

function buildPrompt(
  eventType: EventType,
  personality: PersonalityType,
  entities: Array<{ name: string; type: string; hp: number; maxHp: number }>,
  turn: number,
  metadata: Record<string, unknown>
): string {
  const entityDescriptions = entities
    .map(e => `${sanitizeInput(e.name)} (${e.type}, ${e.hp}/${e.maxHp} HP)`)
    .join(', ');

  const metadataLines = Object.entries(metadata)
    .map(([key, value]) => `${sanitizeInput(key)}: ${sanitizeInput(String(value))}`)
    .join('\n');

  const template = getEventTemplate(eventType, personality);

  return `Turn: ${turn}
Entities: ${entityDescriptions}
${metadataLines}

${template}

Generate 1-2 sentences of narration.`;
}

// --- Handler Factory ---

export interface CreateGenerateNarrationHandlerOptions {
  /**
   * Model ID to use. If not specified, uses provider default.
   */
  model?: string;
}

/**
 * Creates a Next.js API route handler for generating event narrations.
 *
 * @example
 * // In app/api/generate-narration/route.ts
 * import { createGenerateNarrationHandler } from '@crawler/core/api';
 * export const POST = createGenerateNarrationHandler();
 */
export function createGenerateNarrationHandler(
  options: CreateGenerateNarrationHandlerOptions = {}
) {
  const { model } = options;

  return async function POST(request: Request) {
    try {
      const body = await request.json();
      const parsed = RequestSchema.safeParse(body);

      if (!parsed.success) {
        logger.warn(
          {
            validationErrors: parsed.error.issues,
            receivedData: body,
          },
          'Invalid narration request'
        );
        return NextResponse.json(
          { error: 'Invalid request', details: parsed.error.issues },
          { status: 400 }
        );
      }

      const { eventType, personality, entities, turn, metadata } = parsed.data;

      const config = getProviderConfig();
      const aiModel = getAIModel(model, config);

      const systemPrompt = getSystemPrompt(personality);
      const userPrompt = buildPrompt(eventType, personality, entities, turn, metadata);

      const startTime = performance.now();
      const { text, usage } = await generateText({
        model: aiModel,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.8,
        maxRetries: 0,
      });
      const durationMs = Math.round(performance.now() - startTime);

      // Structured success logging
      logger.debug({
        eventType,
        personality,
        turn,
        modelId: model || config.model,
        durationMs,
        tokens: usage?.totalTokens,
        narrationLength: text.length,
      }, 'Narration generated successfully');

      return NextResponse.json({ narration: text.trim() });

    } catch (error) {
      // Structured error logging with full context
      logger.error({
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause,
        } : String(error),
        modelId: model,
      }, 'Narration generation failed');

      // Differentiate retryable vs permanent errors
      if (isRetryableError(error)) {
        return NextResponse.json(
          { error: 'AI service temporarily unavailable. Please try again.', retryable: true },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to generate narration', retryable: false },
        { status: 500 }
      );
    }
  };
}
