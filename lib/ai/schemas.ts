/**
 * AI Schemas
 *
 * Zod schemas for AI input/output validation.
 * These define the contract between the game engine and AI agents.
 */

import { z } from 'zod';
import agentSystemPromptData from '../../../../shared/prompts/agent-system.json';

// Re-export action schema from engine (it's the AI output format)
export { ActionSchema, type Action } from '../engine/state';

// Validate the shared prompt file at import time
const AgentSystemPromptSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  prompt: z.string().min(1),
});

const validatedPrompt = AgentSystemPromptSchema.safeParse(agentSystemPromptData);
if (!validatedPrompt.success) {
  throw new Error(
    `Invalid agent-system.json: ${validatedPrompt.error.message}. ` +
    `Got keys: ${JSON.stringify(Object.keys(agentSystemPromptData))}`
  );
}

// Agent system prompt (loaded and validated from shared/prompts/agent-system.json)
export const AGENT_SYSTEM_PROMPT: string = validatedPrompt.data.prompt;

/**
 * Schema for raw AI response before conversion to Action.
 * Used by both the API handler and headless agent.
 *
 * Note: This is a flat structure because discriminated unions don't work well
 * with the AI SDK's generateObject. The response is converted to the proper
 * Action type after validation.
 */
export const AIResponseSchema = z.object({
  action: z.enum(['move', 'attack', 'wait', 'pickup', 'equip', 'enter_portal']).describe('The action to take'),
  direction: z.enum([
    'north', 'south', 'east', 'west',
    'northeast', 'northwest', 'southeast', 'southwest',
  ]).optional().describe('Direction for move/attack (required for move and attack)'),
  itemType: z.string().optional().describe('Template ID of item to equip (required for equip action)'),
  reasoning: z.string().describe('Brief explanation of your choice'),
  shortThought: z.string().describe('A brief in-character thought bubble (max 25 chars) matching your personality'),
});

export type AIResponse = z.infer<typeof AIResponseSchema>;
