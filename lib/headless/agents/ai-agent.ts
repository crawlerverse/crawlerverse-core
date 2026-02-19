/**
 * AI Agent
 *
 * Makes real AI calls using the provider factory.
 * This is the production agent for headless game execution.
 */

import { generateObject } from 'ai';
import type { AgentAdapter, AgentResponse, GameTrace } from '../types';
import type { GameState, Entity, Action } from '../../engine/state';
import { ActionSchema, getEntity, getMonstersInArea, getCurrentArea } from '../../engine/state';
import { formatRelativePosition } from '../../ai/decision-context';
import { getItemTemplate } from '../../engine/items';
import { computeVisibleTiles, isEntityVisible, DEFAULT_VISION_RADIUS, tileKey, type TileKey } from '../../engine/fov';
import type { CrawlerId } from '../../engine/crawler-id';
import { getAIModel, getProviderConfig } from '../../ai/providers';
import { AGENT_SYSTEM_PROMPT, AIResponseSchema } from '../../ai/schemas';
import { createLogger } from '../../logging';

const logger = createLogger({ module: 'ai-agent' });

/**
 * Get monsters adjacent to a crawler (within 1 tile)
 */
function getAdjacentMonsters(state: GameState, crawler: Entity): Entity[] {
  const monsters = getMonstersInArea(state, crawler.areaId);
  return monsters.filter(m => {
    const dx = Math.abs(m.x - crawler.x);
    const dy = Math.abs(m.y - crawler.y);
    return dx <= 1 && dy <= 1 && (dx + dy > 0);
  });
}

export interface AIAgentOptions {
  /** Model to use (default: from provider config) */
  model?: string;
  /** Timeout per request in ms (default: 30000) */
  timeoutMs?: number;
}

export class AIAgent implements AgentAdapter {
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: AIAgentOptions = {}) {
    const config = getProviderConfig();
    this.model = options.model ?? config.model;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async getAction(
    crawlerId: CrawlerId,
    prompt: string,
    state: GameState
  ): Promise<AgentResponse> {
    const startTime = performance.now();
    const crawler = getEntity(state, crawlerId);

    try {
      // Log the full prompt for debugging
      logger.debug({
        crawlerId,
        prompt,
      }, 'AI prompt sent');

      const { object: aiResponse, usage } = await generateObject({
        model: getAIModel(this.model),
        schema: AIResponseSchema,
        system: AGENT_SYSTEM_PROMPT,
        prompt,
      });

      const durationMs = Math.round(performance.now() - startTime);

      // Build Action object from AI response
      // The AI returns flat { action, direction, reasoning, ... }
      // But ActionSchema expects { action, direction, reasoning } nested
      const action = {
        action: aiResponse.action,
        ...(aiResponse.direction && { direction: aiResponse.direction }),
        ...(aiResponse.itemType && { itemType: aiResponse.itemType }),
        reasoning: aiResponse.reasoning,
      };

      // Validate the constructed action
      const validatedAction = ActionSchema.parse(action);

      // Build context for logging
      const adjacentMonsters = crawler ? getAdjacentMonsters(state, crawler) : [];
      const allMonsters = getMonstersInArea(state, crawler?.areaId ?? state.currentAreaId);

      // Compute visible tiles for the crawler (for visibility checks)
      let visibleTiles: Set<TileKey> | undefined;
      if (crawler) {
        try {
          const area = getCurrentArea(state);
          visibleTiles = computeVisibleTiles(area.map, crawler.x, crawler.y, DEFAULT_VISION_RADIUS);
        } catch {
          // Fall back if FOV computation fails (e.g., in tests with mock data)
        }
      }

      // Format adjacent enemy for log
      const enemy = adjacentMonsters.length > 0
        ? `${adjacentMonsters[0].name} (HP:${adjacentMonsters[0].hp} ATK:${adjacentMonsters[0].attack} DEF:${adjacentMonsters[0].defense})`
        : undefined;

      // Format all nearby monsters with relative positions and visibility
      const nearbyMonsters = crawler && allMonsters.length > 0
        ? allMonsters.map(m => {
            const dx = m.x - crawler.x;
            const dy = m.y - crawler.y;
            const relPos = formatRelativePosition(dx, dy);
            const visible = visibleTiles ? isEntityVisible(m, visibleTiles) : true;
            return `${m.name} (${relPos})${visible ? '' : ' [hidden]'}`;
          }).join(', ')
        : undefined;

      // Format nearby items with relative positions and visibility (same area only)
      const nearbyItems = crawler && state.items?.length > 0
        ? state.items
            .filter(item => item.areaId === crawler.areaId)
            .map(item => {
              const template = getItemTemplate(item.templateId);
              const dx = item.x - crawler.x;
              const dy = item.y - crawler.y;
              const relPos = formatRelativePosition(dx, dy);
              const visible = visibleTiles ? visibleTiles.has(tileKey(item.x, item.y)) : true;
              return `${template?.name ?? item.templateId} (${relPos})${visible ? '' : ' [hidden]'}`;
            }).join(', ')
        : undefined;

      // Extract optional fields from discriminated union
      const direction = 'direction' in validatedAction ? validatedAction.direction : undefined;
      const itemType = 'itemType' in validatedAction ? validatedAction.itemType : undefined;

      // Detect invalid actions (for logging only - let them execute to match main game behavior)
      const invalidAttack = validatedAction.action === 'attack' && adjacentMonsters.length === 0;
      if (invalidAttack) {
        logger.warn({
          crawlerId,
          direction,
          nearbyMonsters,
        }, 'AI chose invalid attack (no adjacent enemy) - will swing at empty air');
      }

      logger.debug({
        crawlerId,
        pos: crawler ? `(${crawler.x},${crawler.y})` : undefined,
        stats: crawler ? `HP:${crawler.hp}/${crawler.maxHp} ATK:${crawler.attack} DEF:${crawler.defense}` : undefined,
        action: validatedAction.action,
        direction,
        itemType,
        enemy,
        nearbyMonsters,
        nearbyItems,
        invalidAttack: invalidAttack || undefined,
        thought: aiResponse.shortThought,
        reasoning: aiResponse.reasoning,
        durationMs,
        outputTokens: usage?.outputTokens,
      }, 'AI action generated');

      return {
        action: validatedAction,
        reasoning: aiResponse.reasoning,
        shortThought: aiResponse.shortThought,
        modelId: this.model,
        durationMs,
        outputTokens: usage?.outputTokens,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      logger.error({
        crawlerId,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      }, 'AI action failed');
      throw error;
    }
  }

  async onGameEnd(trace: GameTrace): Promise<void> {
    // No cleanup needed for AI agent
    logger.info({
      traceId: trace.id,
      outcome: trace.outcome,
      totalTurns: trace.totalTurns,
    }, 'Game completed');
  }
}
