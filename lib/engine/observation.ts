/**
 * Crawler Observation Types
 *
 * Defines the observation data structure that represents what a crawler
 * can see from their perspective. Each crawler gets their own view of
 * the game state, scoped to their bubble.
 *
 * This is used by AI agents to understand their local environment and
 * make decisions about actions.
 */

import { z } from 'zod';
import type { GameState } from './state';
import { getCurrentArea } from './state';
import type { EntityId } from './scheduler';
import { getEntityAppearance } from './monsters';
import { computeVisibleTiles, isEntityVisible, DEFAULT_VISION_RADIUS } from './fov';
import { getEffectiveAttack, getEffectiveDefense } from './stats';

// --- Zod Schemas ---

/**
 * Schema for visible entities (other entities in the bubble).
 */
export const VisibleEntitySchema = z.object({
  id: z.string(),
  type: z.enum(['crawler', 'monster']),
  position: z.object({ x: z.number(), y: z.number() }),
  name: z.string(),
  char: z.string(),
  hp: z.number(),
  maxHp: z.number(),
});

/**
 * Schema for other crawler info (minimal info about allies).
 */
export const OtherCrawlerSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  hp: z.number(),
  maxHp: z.number(),
  isInSameBubble: z.boolean(),
});

/**
 * Schema for the complete crawler observation.
 *
 * Represents what a specific crawler can see and know about the game state.
 * This is scoped to their bubble for visible entities and includes
 * information about other crawlers (even in different bubbles).
 */
export const CrawlerObservationSchema = z.object({
  // Turn info
  turn: z.number(),
  yourTurn: z.boolean(),
  currentActor: z.string().nullable(),

  // Self info
  self: z.object({
    id: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    hp: z.number(),
    maxHp: z.number(),
    attack: z.number(),
    defense: z.number(),
    speed: z.number(),
    // Effective stats include equipment bonuses (CRA-67)
    effectiveAttack: z.number(),
    effectiveDefense: z.number(),
  }),

  // Visible entities (in same bubble)
  visibleEntities: z.array(VisibleEntitySchema),

  // Other crawlers (may be in different bubbles)
  otherCrawlers: z.array(OtherCrawlerSchema),

  // Game status
  gameStatus: z.discriminatedUnion('status', [
    z.object({ status: z.literal('playing') }),
    z.object({ status: z.literal('ended'), victory: z.boolean() }),
  ]),

  // Map dimensions
  mapWidth: z.number(),
  mapHeight: z.number(),

  // Portal info (present when standing on a portal tile)
  onPortal: z.object({
    direction: z.enum(['up', 'down']).optional(),
    targetAreaId: z.string(),
    targetAreaName: z.string().optional(),
  }).nullable(),
});

// --- Types ---

export type CrawlerObservation = z.infer<typeof CrawlerObservationSchema>;
export type VisibleEntity = z.infer<typeof VisibleEntitySchema>;
export type OtherCrawler = z.infer<typeof OtherCrawlerSchema>;

// --- Factory Functions ---

/**
 * Creates an observation for a specific crawler.
 *
 * The observation includes:
 * - Turn info: current turn, whether it's the crawler's turn, current actor
 * - Self info: the crawler's own stats and position
 * - Visible entities: other entities in the same bubble (excluding self)
 * - Other crawlers: info about all other crawlers (in any bubble)
 * - Game status: current game state (playing or ended)
 * - Map dimensions: width and height of the game map
 *
 * @param state - Current game state
 * @param crawlerId - ID of the crawler to create observation for
 * @returns CrawlerObservation for the specified crawler
 * @throws Error if the crawler is not found in the state
 *
 * @example
 * ```typescript
 * const observation = createObservation(state, entityId('player'));
 * console.log(observation.yourTurn); // true or false
 * console.log(observation.visibleEntities); // entities in same bubble
 * ```
 */
export function createObservation(
  state: GameState,
  crawlerId: EntityId
): CrawlerObservation {
  const crawler = state.entities[crawlerId];
  if (!crawler) {
    throw new Error(
      `Crawler ${crawlerId} not found in state. ` +
      `Turn: ${state.turn}. ` +
      `Available entities: ${Object.keys(state.entities).join(', ')}`
    );
  }

  // Find crawler's bubble
  const crawlerBubble = state.bubbles.find(b =>
    b.entityIds.includes(crawlerId)
  );

  // Get current actor from crawler's bubble
  const currentActor = crawlerBubble?.scheduler.currentActorId ?? null;
  const isYourTurn = currentActor === crawlerId;

  // Compute visible tiles using FOV
  const { map } = getCurrentArea(state);
  const visibleTiles = computeVisibleTiles(
    map,
    crawler.x,
    crawler.y,
    crawler.visionRadius ?? DEFAULT_VISION_RADIUS
  );

  // Get visible entities (entities in same bubble, excluding self, filtered by FOV)
  const visibleEntities: VisibleEntity[] = [];
  if (crawlerBubble) {
    for (const id of crawlerBubble.entityIds) {
      if (id === crawlerId) continue;
      const entity = state.entities[id];
      if (!entity) continue;

      // Only include entities the crawler can see
      if (!isEntityVisible(entity, visibleTiles)) continue;

      const { char } = getEntityAppearance(entity);
      visibleEntities.push({
        id: entity.id,
        type: entity.type,
        position: { x: entity.x, y: entity.y },
        name: entity.name,
        char,
        hp: entity.hp,
        maxHp: entity.maxHp,
      });
    }
  }

  // Get other crawlers (all crawlers except self)
  const otherCrawlers: OtherCrawler[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.id === crawlerId) continue;
    if (entity.type !== 'crawler') continue;

    const isInSameBubble = crawlerBubble?.entityIds.includes(entity.id as EntityId) ?? false;
    otherCrawlers.push({
      id: entity.id,
      name: entity.name,
      position: { x: entity.x, y: entity.y },
      hp: entity.hp,
      maxHp: entity.maxHp,
      isInSameBubble,
    });
  }

  // Check if crawler is standing on a portal
  const tile = map.tiles[crawler.y]?.[crawler.x];
  let onPortal: CrawlerObservation['onPortal'] = null;
  if (tile?.type === 'portal' && tile.connection) {
    const targetArea = state.zone.areas[tile.connection.targetAreaId];
    onPortal = {
      direction: tile.direction,
      targetAreaId: tile.connection.targetAreaId,
      targetAreaName: targetArea?.metadata.name,
    };
  }

  return {
    turn: state.turn,
    yourTurn: isYourTurn,
    currentActor,
    self: {
      id: crawler.id,
      position: { x: crawler.x, y: crawler.y },
      hp: crawler.hp,
      maxHp: crawler.maxHp,
      attack: crawler.attack,
      defense: crawler.defense,
      speed: crawler.speed,
      effectiveAttack: getEffectiveAttack(crawler),
      effectiveDefense: getEffectiveDefense(crawler),
    },
    visibleEntities,
    otherCrawlers,
    gameStatus: state.gameStatus,
    mapWidth: map.width,
    mapHeight: map.height,
    onPortal,
  };
}
