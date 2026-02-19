/**
 * Bubble - Localized Simulation Context
 *
 * A bubble contains a group of entities (crawlers + monsters) that share
 * a turn scheduler. Bubbles run independently until crawlers meet.
 *
 * ## Error Handling Philosophy
 *
 * This module uses a "warn and continue" pattern for edge cases that may
 * indicate state desynchronization but are not fatal:
 *
 * - `createBubble` with missing entity references: logs warning, creates bubble
 *   with available entities only
 * - `shouldMerge` with missing entity in lookup: logs warning, skips that entity
 *
 * This approach prevents mid-game crashes in production. All warnings are
 * logged via structured logging (Pino) for debugging. If warnings appear
 * frequently, investigate entity lifecycle management. Fatal errors (invalid
 * radius, invalid timeout config, empty IDs) still throw exceptions.
 */

import { z } from 'zod';
import {
  createScheduler,
  addToScheduler,
  advanceScheduler,
  SchedulerStateSchema,
  EntitySpeedSchema,
  type SchedulerState,
  type EntitySpeed,
  type SchedulerEntry,
  type EntityId,
} from './scheduler';
import type { GameState } from './state';
import { type Position, type Action, ActionSchema, isCrawler } from './types';
import { createLogger } from '../logging';

// --- Branded Types ---

/**
 * Branded type for bubble IDs to prevent mixing with other string types.
 * Use `bubbleId()` to create a valid BubbleId from a string.
 */
export type BubbleId = string & { readonly __brand: 'BubbleId' };

/**
 * Creates a branded BubbleId from a string.
 * @param id - The bubble ID string
 * @returns A branded BubbleId
 * @throws Error if id is empty or whitespace-only
 */
export function bubbleId(id: string): BubbleId {
  if (!id || id.trim().length === 0) {
    throw new Error('BubbleId cannot be empty');
  }
  return id as BubbleId;
}

// --- Constants ---

/**
 * Default perception radius for bubble merge detection.
 * 8 tiles matches typical roguelike vision range in an 8-way movement system,
 * representing the distance at which crawlers can "see" each other.
 */
export const DEFAULT_PERCEPTION_RADIUS = 8;

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  warningMs: 5000,
  autoWaitMs: 10000,
};

/**
 * Default maximum commands in queue.
 * Prevents unbounded growth from rapid key presses.
 */
export const DEFAULT_COMMAND_QUEUE_SIZE = 10;

/**
 * Command queue for a single crawler.
 * Commands are processed FIFO when it's the crawler's turn.
 */
export interface CommandQueue {
  readonly commands: readonly Action[];
  readonly maxSize: number;
}

// --- Structured Logging ---

const bubbleLogger = createLogger({ module: 'bubble' });

/**
 * Warning logger for bubble operations that may indicate logic errors.
 * Uses structured logging (Pino) by default. Can be overridden for testing.
 */
export let bubbleWarnLog: (message: string, context?: Record<string, unknown>) => void =
  (message: string, context?: Record<string, unknown>) => {
    bubbleLogger.warn(context ?? {}, message);
  };

/**
 * Set custom warning logger for bubble operations.
 * Pass a no-op function to silence warnings (not recommended in production).
 */
export function setBubbleWarnLog(logger: (message: string, context?: Record<string, unknown>) => void): void {
  bubbleWarnLog = logger;
}

/**
 * Reset warning logger to default structured logging behavior.
 */
export function resetBubbleWarnLog(): void {
  bubbleWarnLog = (message: string, context?: Record<string, unknown>) => {
    bubbleLogger.warn(context ?? {}, message);
  };
}

// Test-only functions to capture warning output as strings for assertions
export function enableBubbleDebugLogging(logger: (message: string) => void = () => {}): void {
  bubbleWarnLog = (message: string, context?: Record<string, unknown>) => {
    // Format message with context for test compatibility
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    logger(`${message}${contextStr}`);
  };
}
export function disableBubbleDebugLogging(): void {
  bubbleWarnLog = () => {};
}

// --- Zod Schemas ---

export const TimeoutConfigSchema = z.object({
  warningMs: z.number().positive(),
  autoWaitMs: z.number().positive(),
}).refine(
  (config) => config.warningMs < config.autoWaitMs,
  { message: 'warningMs must be less than autoWaitMs' }
);

export const BubbleExecutionStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('processing') }),
  z.object({ status: z.literal('paused') }),
  z.object({
    status: z.literal('awaiting_input'),
    actorId: z.string().min(1),
    waitingSince: z.number().positive(),
    warningEmitted: z.boolean(),
  }),
]);

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const CommandQueueSchema = z.object({
  commands: z.array(ActionSchema),
  maxSize: z.number().int().positive(),
});

export const BubbleSchema = z.object({
  id: z.string().min(1),
  scheduler: SchedulerStateSchema,
  entityIds: z.array(z.string().min(1)),
  executionState: BubbleExecutionStateSchema,
  timeoutConfig: TimeoutConfigSchema,
  center: PositionSchema,
  radius: z.number().positive(),
  commandQueues: z.map(z.string(), CommandQueueSchema).default(new Map()),
  tick: z.number().int().nonnegative().default(0),  // Logical clock
});

export const CreateBubbleParamsSchema = z.object({
  id: z.string().min(1),
  entityIds: z.array(z.string().min(1)),
  entities: z.array(EntitySpeedSchema),
  center: PositionSchema,
  radius: z.number().positive().optional(),
  timeoutConfig: TimeoutConfigSchema.optional(),
});

// --- Types ---

export interface TimeoutConfig {
  readonly warningMs: number;
  readonly autoWaitMs: number;
}

/**
 * Bubble execution state machine.
 *
 * States:
 * - 'idle': Bubble is not processing any turns, waiting for advanceScheduler
 * - 'processing': An action is being resolved (AI generating, animation playing)
 * - 'paused': Bubble execution is suspended (e.g., for merge negotiation)
 * - 'awaiting_input': Waiting for a player/agent to submit their action
 *
 * Transitions:
 *   idle -> awaiting_input (when advanceScheduler selects a player's turn)
 *   idle -> processing (when advanceScheduler selects an AI monster's turn)
 *   awaiting_input -> processing (when player input received)
 *   processing -> idle (when action resolution complete)
 *   any -> paused (when merge is detected and coordination needed)
 *   paused -> idle (when merge complete or cancelled)
 */
export type BubbleExecutionState =
  | { readonly status: 'idle' }
  | { readonly status: 'processing' }
  | { readonly status: 'paused' }
  | {
      readonly status: 'awaiting_input';
      readonly actorId: EntityId;
      readonly waitingSince: number;
      readonly warningEmitted: boolean;
    };

/**
 * A bubble is a localized simulation context containing entities that
 * share a turn scheduler.
 *
 * ## Usage Example
 *
 * ```typescript
 * // Create a bubble with player and monsters
 * const bubble = createBubble({
 *   id: bubbleId('dungeon-floor-1'),
 *   entityIds: [entityId('player'), entityId('goblin')],
 *   entities: [
 *     { id: entityId('player'), speed: 100 },
 *     { id: entityId('goblin'), speed: 100 },
 *   ],
 *   center: { x: 5, y: 5 },
 * });
 *
 * // Queue a player command
 * const result = queueCommand(bubble, entityId('player'), {
 *   action: 'move',
 *   direction: 'north',
 * });
 *
 * // Simulate until input is needed
 * const simResult = simulateBubble(bubble, entities, { gameState });
 * ```
 *
 * ## Inter-field Invariants
 *
 * The following relationships must be maintained by all bubble operations:
 *
 * 1. **entityIds ↔ scheduler.entries**: Every `entityId` should have a
 *    corresponding entry in `scheduler.entries`, and vice versa. The scheduler
 *    may temporarily have fewer entries if an entity was just killed.
 *
 * 2. **commandQueues.keys() ⊆ entityIds**: Command queue keys must reference
 *    entities that are in the bubble. Queues for non-existent entities are
 *    silently ignored but indicate a logic error.
 *
 * 3. **entityIds ⊆ GameState.entities.keys()**: All entity IDs must reference
 *    entities that exist in the global game state.
 *
 * These invariants are enforced by the bubble operations (createBubble,
 * mergeBubbles, splitBubble) but not by TypeScript's type system.
 */
export interface Bubble {
  /** Unique identifier for this bubble. */
  readonly id: BubbleId;

  /** Turn scheduler state for entities in this bubble. */
  readonly scheduler: SchedulerState;

  /** IDs of all entities (crawlers and monsters) in this bubble. */
  readonly entityIds: readonly EntityId[];

  /** Current execution state (idle, processing, paused, or awaiting_input). */
  readonly executionState: BubbleExecutionState;

  /** Timeout configuration for player input. */
  readonly timeoutConfig: TimeoutConfig;

  /** Geographic center of this bubble for merge/split calculations. */
  readonly center: Position;

  /** Perception radius for merge detection (Chebyshev distance). */
  readonly radius: number;

  /** Per-crawler command queues (FIFO). Only crawlers have queues. */
  readonly commandQueues: ReadonlyMap<EntityId, CommandQueue>;

  /**
   * Logical clock tracking simulation progress.
   *
   * Incremented each time `advanceScheduler` is called (when no entity can
   * act and time must advance). The tick does NOT increment when entities
   * execute actions - only when the scheduler grants AP to everyone.
   *
   * ## Purpose
   *
   * When bubbles merge, the tick value is used to synchronize schedulers:
   * - The bubble with lower tick is "behind" in simulation time
   * - Its scheduler is fast-forwarded (entities gain AP) to catch up
   * - This ensures fair turn distribution after merge
   *
   * See `mergeBubbles()` for details on tick synchronization.
   */
  readonly tick: number;
}

export interface CreateBubbleParams {
  /** Required bubble ID. Must be unique across all bubbles. */
  readonly id: BubbleId;
  readonly entityIds: readonly EntityId[];
  readonly entities: readonly EntitySpeed[];
  readonly center: Position;
  readonly radius?: number;
  readonly timeoutConfig?: TimeoutConfig;
}

// --- Factory Functions ---

/**
 * Creates a new bubble with the given entities and configuration.
 *
 * The bubble starts in 'idle' execution state with a scheduler initialized
 * from the provided entities. Only entities whose IDs are in entityIds will
 * be added to the scheduler.
 *
 * @param params - Bubble creation parameters
 * @returns A new frozen Bubble object
 *
 * @remarks
 * Logs a warning if any entityIds reference entities not in the entities array.
 * This may indicate a configuration error.
 *
 * @example
 * ```typescript
 * const bubble = createBubble({
 *   id: 'bubble-player-1',
 *   entityIds: ['player', 'rat'],
 *   entities: [
 *     { id: 'player', speed: 100 },
 *     { id: 'rat', speed: 120 },
 *   ],
 *   center: { x: 5, y: 5 },
 * });
 * ```
 */
export function createBubble(params: CreateBubbleParams): Bubble {
  const { id, entityIds, entities, center, radius, timeoutConfig } = params;

  // Validate radius if provided
  if (radius !== undefined && radius <= 0) {
    throw new Error(`Bubble ${id} has invalid radius ${radius}: radius must be positive`);
  }

  // Validate timeout config if provided
  if (timeoutConfig) {
    if (timeoutConfig.warningMs >= timeoutConfig.autoWaitMs) {
      throw new Error(
        `Bubble ${id} has invalid timeout config: warningMs (${timeoutConfig.warningMs}) must be less than autoWaitMs (${timeoutConfig.autoWaitMs})`
      );
    }
  }

  // Check for missing entities and log warnings
  const entityIdSet = new Set(entities.map(e => e.id));
  const missingIds = entityIds.filter(eid => !entityIdSet.has(eid));
  if (missingIds.length > 0) {
    bubbleWarnLog('createBubble: entityIds reference missing entities', {
      action: 'createBubble',
      bubbleId: id,
      missingEntityIds: missingIds,
      hint: 'Ensure all entity IDs have corresponding entries in entities array',
    });
  }

  // Filter entities to only those in entityIds
  const bubbleEntities = entities.filter(e => entityIds.includes(e.id));

  return Object.freeze({
    id,
    scheduler: createScheduler(bubbleEntities),
    entityIds: Object.freeze([...entityIds]),
    executionState: Object.freeze({ status: 'idle' as const }),
    timeoutConfig: Object.freeze(timeoutConfig ?? DEFAULT_TIMEOUT_CONFIG),
    center: Object.freeze({ ...center }),
    radius: radius ?? DEFAULT_PERCEPTION_RADIUS,
    commandQueues: new Map(),
    tick: 0,  // Start at tick 0
  });
}

// --- Geometry Helpers ---

/**
 * Calculate Chebyshev distance between two positions.
 *
 * This is the appropriate distance metric for 8-way movement (including diagonals),
 * where moving diagonally costs the same as moving orthogonally. Also known as
 * "chessboard distance" since it matches how a king moves in chess.
 *
 * @param a - First position
 * @param b - Second position
 * @returns The Chebyshev distance (max of |dx| and |dy|)
 *
 * @example
 * ```typescript
 * distance({ x: 0, y: 0 }, { x: 3, y: 4 }) // returns 4
 * distance({ x: 0, y: 0 }, { x: 5, y: 3 }) // returns 5
 * ```
 */
export function distance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export interface PositionedEntity {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
}

export interface TypedEntity extends PositionedEntity {
  readonly type: 'crawler' | 'monster';
}

/**
 * Filter entities to those within a given radius of a center position.
 *
 * Uses Chebyshev distance for 8-way movement compatibility. An entity exactly
 * at the radius boundary is included (uses <= comparison).
 *
 * @param entities - Array of positioned entities to filter
 * @param center - Center position for distance calculation
 * @param radius - Maximum distance to include
 * @returns Array of entities within the specified radius
 */
export function entitiesWithinRadius<T extends PositionedEntity>(
  entities: readonly T[],
  center: Position,
  radius: number
): T[] {
  return entities.filter(e => distance(center, { x: e.x, y: e.y }) <= radius);
}

// --- Merge Detection ---

/**
 * Minimal entity interface required for merge detection.
 * Both TypedEntity and Entity satisfy this interface.
 */
interface MergeableEntity {
  readonly id: string;
  readonly type: 'crawler' | 'monster';
  readonly x: number;
  readonly y: number;
}

/**
 * Extract crawlers from a bubble by looking up entities.
 * Logs warnings for any entity IDs not found in the entities record.
 */
function getCrawlersFromBubble<T extends MergeableEntity>(
  bubble: Bubble,
  entities: Record<string, T>,
  action: string
): T[] {
  const crawlers: T[] = [];
  for (const id of bubble.entityIds) {
    const entity = entities[id as string];
    if (!entity) {
      bubbleWarnLog(`${action}: entity not found in entities record`, {
        action,
        entityId: id,
        bubbleId: bubble.id,
        hint: 'This may indicate stale entity references or state desynchronization',
      });
      continue;
    }
    if (entity.type === 'crawler') {
      crawlers.push(entity);
    }
  }
  return crawlers;
}

/**
 * Determine if two bubbles should merge.
 *
 * Returns true if any crawler from bubbleA is within perception range
 * of any crawler from bubbleB. Monsters do not trigger bubble merges;
 * only crawler-to-crawler proximity matters.
 *
 * @param bubbleA - First bubble
 * @param bubbleB - Second bubble
 * @param entities - Record of all entities with their positions and types
 * @returns True if the bubbles should merge
 *
 * @remarks
 * Logs a warning if any entity IDs in the bubbles are not found in the
 * entities record. This may indicate stale entity references or a
 * synchronization bug between bubble state and entity state.
 */
export function shouldMerge<T extends MergeableEntity>(
  bubbleA: Bubble,
  bubbleB: Bubble,
  entities: Record<string, T>
): boolean {
  const crawlersA = getCrawlersFromBubble(bubbleA, entities, 'shouldMerge');
  const crawlersB = getCrawlersFromBubble(bubbleB, entities, 'shouldMerge');

  // Check if any crawler pair is within perception range
  for (const a of crawlersA) {
    for (const b of crawlersB) {
      if (distance(a, b) <= DEFAULT_PERCEPTION_RADIUS) {
        return true;
      }
    }
  }

  return false;
}

// --- Merge Operations ---

/**
 * Merge two bubbles into one.
 *
 * Used when crawlers from different bubbles come into contact. The merged
 * bubble combines entities from both and starts in idle state.
 *
 * ## Tick Synchronization
 *
 * Bubbles run independently and may have different tick values (indicating
 * different amounts of time elapsed). When merging:
 *
 * 1. Identify which bubble is "behind" (lower tick value)
 * 2. Fast-forward the behind bubble's scheduler to match the ahead bubble
 * 3. During fast-forward, each entity gains AP equal to their speed per tick
 *
 * This ensures fair turn distribution after merge. A slow bubble's entities
 * won't be disadvantaged just because their bubble ran fewer ticks.
 *
 * Example: Bubble A (tick 10), Bubble B (tick 5)
 * - Bubble B is behind by 5 ticks
 * - Speed-100 entity in B gains 500 AP during fast-forward
 * - This catches them up to where they would have been
 *
 * ## Action Points
 *
 * When an entity exists in both bubbles (unusual edge case), the entry
 * with higher AP is used. For entities in only one bubble, their AP is
 * preserved (plus any fast-forward bonus for the slower bubble).
 *
 * ## Other Merge Behavior
 *
 * - Merged bubble ID: `bubble-merged-{bubbleA.id}-{bubbleB.id}`
 * - Center: midpoint of original centers
 * - Radius: expanded to cover both original bubbles
 * - Timeout config: uses stricter (shorter) values from both
 * - Command queues: preserved, taking longer queue for duplicates
 *
 * @param bubbleA - First bubble to merge
 * @param bubbleB - Second bubble to merge
 * @returns A new merged bubble
 */
export function mergeBubbles(bubbleA: Bubble, bubbleB: Bubble): Bubble {
  // Combine entity IDs (dedupe) and sort for deterministic order
  const mergedEntityIds = [...new Set([...bubbleA.entityIds, ...bubbleB.entityIds])]
    .sort() as EntityId[];

  // Identify which bubble is behind (lower tick) and needs fast-forwarding
  const [behind, ahead] = bubbleA.tick < bubbleB.tick ? [bubbleA, bubbleB] : [bubbleB, bubbleA];
  const tickDiff = ahead.tick - behind.tick;

  // Fast-forward the slower bubble's scheduler
  // Each tick, entities gain AP equal to their speed
  let fastForwardScheduler = behind.scheduler;
  for (let t = 0; t < tickDiff; t++) {
    fastForwardScheduler = advanceScheduler(fastForwardScheduler);
  }

  // Merge scheduler entries, preserving action points
  // When same entity in both, take higher action points (and its associated speed)
  // Use fast-forwarded scheduler for the behind bubble
  const entryMap = new Map<EntityId, SchedulerEntry>();

  // Add entries from the ahead bubble (no fast-forward needed)
  for (const entry of ahead.scheduler.entries) {
    entryMap.set(entry.entityId, entry);
  }

  // Add entries from the fast-forwarded behind bubble
  for (const entry of fastForwardScheduler.entries) {
    const existing = entryMap.get(entry.entityId);
    if (!existing || entry.actionPoints > existing.actionPoints) {
      entryMap.set(entry.entityId, entry);
    }
  }

  // Sort entries by entityId for deterministic turn order after merge
  const mergedEntries = Array.from(entryMap.values())
    .sort((a, b) => a.entityId.localeCompare(b.entityId));

  // Compute new center as midpoint between old centers
  const newCenter: Position = Object.freeze({
    x: Math.round((bubbleA.center.x + bubbleB.center.x) / 2),
    y: Math.round((bubbleA.center.y + bubbleB.center.y) / 2),
  });

  // Radius expands to cover both old bubbles from new center
  const distToA = distance(newCenter, bubbleA.center) + bubbleA.radius;
  const distToB = distance(newCenter, bubbleB.center) + bubbleB.radius;
  const newRadius = Math.max(distToA, distToB);

  // Use stricter timeout config (shorter times)
  const stricterTimeout: TimeoutConfig = Object.freeze({
    warningMs: Math.min(bubbleA.timeoutConfig.warningMs, bubbleB.timeoutConfig.warningMs),
    autoWaitMs: Math.min(bubbleA.timeoutConfig.autoWaitMs, bubbleB.timeoutConfig.autoWaitMs),
  });

  // Generate new ID deterministically from source bubbles
  const newId = bubbleId(`bubble-merged-${bubbleA.id}-${bubbleB.id}`);

  // Merged bubble starts in idle state
  const mergedScheduler: SchedulerState = Object.freeze({
    entries: Object.freeze(mergedEntries.map(e => Object.freeze({ ...e }))),
    currentActorId: null,
  });

  // Merge command queues from both bubbles
  // Entities in both bubbles: take the one with more commands (to not lose pending commands)
  const mergedCommandQueues = new Map<EntityId, CommandQueue>();
  for (const [entityId, queue] of bubbleA.commandQueues) {
    mergedCommandQueues.set(entityId, queue);
  }
  for (const [entityId, queue] of bubbleB.commandQueues) {
    const existing = mergedCommandQueues.get(entityId);
    if (!existing || queue.commands.length > existing.commands.length) {
      mergedCommandQueues.set(entityId, queue);
    }
  }

  return Object.freeze({
    id: newId,
    scheduler: mergedScheduler,
    entityIds: Object.freeze(mergedEntityIds),
    executionState: Object.freeze({ status: 'idle' as const }),
    timeoutConfig: stricterTimeout,
    center: newCenter,
    radius: newRadius,
    commandQueues: mergedCommandQueues,
    tick: Math.max(bubbleA.tick, bubbleB.tick),  // Take the ahead bubble's tick
  });
}

// --- Wake Operations ---

/**
 * Result of waking hibernating entities.
 */
export interface WakeResult {
  /** Updated game state with hibernating list modified */
  readonly state: GameState;
  /** Updated bubble with new entities added */
  readonly bubble: Bubble;
  /** IDs of entities that were woken */
  readonly wokenIds: readonly EntityId[];
}

/**
 * Wake hibernating entities within perception radius of a crawler.
 *
 * When a crawler moves, nearby hibernating entities should "wake up" and
 * join the crawler's bubble. This function:
 * 1. Finds hibernating entities within DEFAULT_PERCEPTION_RADIUS
 * 2. Removes them from the hibernating list
 * 3. Adds them to the bubble's entityIds
 * 4. Adds them to the bubble's scheduler with 0 action points
 *
 * @param state - Current game state
 * @param bubble - Bubble to add woken entities to
 * @param crawlerPos - Position of the crawler that triggers the wake
 * @returns Updated state, bubble, and list of woken entity IDs
 *
 * @remarks
 * Uses Chebyshev distance for perception radius check, consistent with
 * 8-way movement. Returns unchanged state if no entities need to wake.
 */
export function wakeNearbyEntities(
  state: GameState,
  bubble: Bubble,
  crawlerPos: Position
): WakeResult {
  // 1. Find hibernating entities within perception radius AND in the same area
  const toWake: EntityId[] = [];
  const currentAreaId = state.currentAreaId;

  for (const hibernatingId of state.hibernating) {
    const entity = state.entities[hibernatingId];
    if (!entity) {
      bubbleWarnLog('wakeNearbyEntities: hibernating entity not found', {
        action: 'wakeNearbyEntities',
        entityId: hibernatingId,
        hint: 'Hibernating list references non-existent entity',
      });
      continue;
    }

    // Only wake entities in the same area as the crawler
    if (entity.areaId !== currentAreaId) {
      continue;
    }

    const entityPos = { x: entity.x, y: entity.y };
    if (distance(crawlerPos, entityPos) <= DEFAULT_PERCEPTION_RADIUS) {
      toWake.push(hibernatingId as EntityId);
    }
  }

  // 2. If nothing to wake, return unchanged
  if (toWake.length === 0) {
    return { state, bubble, wokenIds: [] };
  }

  // 3. Update hibernating list (remove woken entities)
  const newHibernating = state.hibernating.filter(id => !toWake.includes(id as EntityId));

  // 4. Add entities to bubble entityIds
  const newEntityIds = [...bubble.entityIds, ...toWake];

  // 5. Add to scheduler with 0 AP
  let newScheduler = bubble.scheduler;
  for (const id of toWake) {
    const entity = state.entities[id];
    if (entity) {
      newScheduler = addToScheduler(newScheduler, { id, speed: entity.speed });
    }
  }

  // 6. Build result
  const newBubble: Bubble = Object.freeze({
    ...bubble,
    entityIds: Object.freeze(newEntityIds),
    scheduler: newScheduler,
  });

  const newState: GameState = {
    ...state,
    hibernating: Object.freeze(newHibernating),
  };

  return { state: newState, bubble: newBubble, wokenIds: toWake };
}

// --- Hibernate Operations ---

/**
 * Hibernate all entities in a bubble by moving them to the hibernating list.
 *
 * Used when a bubble no longer contains any crawlers (e.g., crawler died or
 * moved to another bubble). The remaining entities (monsters) are placed into
 * hibernation where they become inactive until a crawler comes within range.
 *
 * @param bubble - The bubble to hibernate
 * @param state - Current game state
 * @returns Updated game state with entities hibernated and bubble removed
 *
 * @remarks
 * Action points are discarded when hibernating. When entities wake up later
 * via `wakeNearbyEntities`, they start with 0 action points.
 *
 * The bubble is removed from state.bubbles entirely.
 */
export function hibernateBubble(
  bubble: Bubble,
  state: GameState
): GameState {
  // Move all entities in bubble to hibernating list
  const newHibernating = [...state.hibernating, ...bubble.entityIds];

  // Remove the bubble from bubbles array
  const newBubbles = state.bubbles.filter(b => b.id !== bubble.id);

  return {
    ...state,
    bubbles: Object.freeze(newBubbles),
    hibernating: Object.freeze(newHibernating),
  };
}

// --- Split Operations ---

/**
 * Split a bubble when crawlers move far apart (beyond perception radius).
 *
 * Creates a separate bubble for each crawler in the original bubble.
 * Monsters are assigned to the nearest crawler's bubble using Chebyshev distance.
 * Ties are broken deterministically by crawler ID (lower ID wins).
 *
 * @param bubble - The bubble to split
 * @param state - Current game state (for entity position lookup)
 * @returns Array of new bubbles, one per crawler
 *
 * @remarks
 * If the bubble contains only one crawler (or zero), returns the original bubble
 * unchanged in a single-element array.
 *
 * Action points are preserved from the original scheduler. Each entity's AP
 * is transferred to their new bubble's scheduler.
 *
 * New bubbles are centered on their respective crawler's position.
 */
export function splitBubble(
  bubble: Bubble,
  state: GameState
): Bubble[] {
  // 1. Identify crawlers and monsters in the bubble
  const crawlerIds: EntityId[] = [];
  const monsterIds: EntityId[] = [];

  for (const id of bubble.entityIds) {
    const entity = state.entities[id];
    if (!entity) {
      bubbleWarnLog('splitBubble: entity not found', {
        action: 'splitBubble',
        entityId: id,
        bubbleId: bubble.id,
        hint: 'Bubble entityIds references non-existent entity',
      });
      continue;
    }
    if (isCrawler(entity)) {
      crawlerIds.push(id as EntityId);
    } else {
      monsterIds.push(id as EntityId);
    }
  }

  // 2. If only one crawler (or zero), return single bubble unchanged
  if (crawlerIds.length <= 1) {
    return [bubble];
  }

  // 3. Sort crawlers by ID for deterministic ordering
  crawlerIds.sort();

  // 4. Create a map of crawler -> assigned entity IDs
  const assignments = new Map<EntityId, EntityId[]>();
  for (const crawlerId of crawlerIds) {
    assignments.set(crawlerId, [crawlerId]); // Each crawler starts with itself
  }

  // 5. Assign each monster to nearest crawler
  for (const monsterId of monsterIds) {
    const monster = state.entities[monsterId];
    if (!monster) continue;

    let nearestCrawlerId = crawlerIds[0];
    let minDistance = Infinity;

    for (const crawlerId of crawlerIds) {
      const crawler = state.entities[crawlerId];
      if (!crawler) continue;

      const d = distance({ x: monster.x, y: monster.y }, { x: crawler.x, y: crawler.y });
      // Ties are broken by crawler ID (already sorted, so first encountered wins)
      if (d < minDistance) {
        minDistance = d;
        nearestCrawlerId = crawlerId;
      }
    }

    assignments.get(nearestCrawlerId)?.push(monsterId);
  }

  // 6. Build new bubbles
  const newBubbles: Bubble[] = [];
  let bubbleIndex = 0;

  for (const crawlerId of crawlerIds) {
    const assignedIds = assignments.get(crawlerId) || [];
    const crawler = state.entities[crawlerId];

    // Get scheduler entries for assigned entities, preserving action points
    const entriesWithAP: SchedulerEntry[] = assignedIds.map(id => {
      const originalEntry = bubble.scheduler.entries.find(e => e.entityId === id);
      const entity = state.entities[id];
      return Object.freeze({
        entityId: id,
        speed: originalEntry?.speed ?? entity?.speed ?? 100,
        actionPoints: originalEntry?.actionPoints ?? 0,
      });
    });

    // Create new bubble ID deterministically
    const newId = bubbleId(`${bubble.id}-split-${bubbleIndex++}`);

    // Build scheduler with preserved AP
    const newScheduler: SchedulerState = Object.freeze({
      entries: Object.freeze(entriesWithAP),
      currentActorId: null,
    });

    // Preserve command queues for entities in this new bubble
    const newCommandQueues = new Map<EntityId, CommandQueue>();
    for (const id of assignedIds) {
      const queue = bubble.commandQueues.get(id);
      if (queue) {
        newCommandQueues.set(id, queue);
      }
    }

    // Create new bubble centered on crawler
    const newBubble: Bubble = Object.freeze({
      id: newId,
      scheduler: newScheduler,
      entityIds: Object.freeze(assignedIds),
      executionState: Object.freeze({ status: 'idle' as const }),
      timeoutConfig: bubble.timeoutConfig,
      center: Object.freeze({ x: crawler?.x ?? 0, y: crawler?.y ?? 0 }),
      radius: bubble.radius,
      commandQueues: newCommandQueues,
      tick: bubble.tick,  // Preserve the original bubble's tick
    });

    newBubbles.push(newBubble);
  }

  return newBubbles;
}

// --- Reconciliation ---

/**
 * Reconcile bubble structure after entity movement.
 *
 * This function is the main orchestrator for bubble lifecycle management.
 * It should be called after any entity movement to ensure bubbles accurately
 * reflect the current positions of entities in the game.
 *
 * The reconciliation process has three phases:
 *
 * 1. **Merge Phase**: Merge any bubbles where crawlers are within perception
 *    range of each other. This continues until no more merges are possible.
 *
 * 2. **Split Phase**: Split any bubbles where crawlers are too far apart
 *    (beyond perception radius). Each crawler gets their own bubble with
 *    nearby monsters assigned to them.
 *
 * 3. **Hibernate Phase**: Any bubble without crawlers (monster-only bubbles)
 *    is hibernated. The monsters are moved to the hibernating list.
 *
 * @param state - Current game state
 * @returns Updated game state with reconciled bubbles
 *
 * @example
 * ```typescript
 * // After moving a crawler
 * const newState = resolveMove(state, playerId, direction);
 * const reconciledState = reconcileBubbles(newState);
 * ```
 */
// --- Timeout Checking ---

/**
 * Timeout action types returned by checkTimeout.
 *
 * - 'none': No timeout action needed
 * - 'warn': Should emit a warning to the player
 * - 'force_wait': Should automatically force a wait action
 */
export type TimeoutAction = 'none' | 'warn' | 'force_wait';

/**
 * Result of checking a bubble for input timeout.
 */
export interface TimeoutCheckResult {
  /** The action to take based on timeout status */
  readonly action: TimeoutAction;
  /** The bubble, possibly updated with warningEmitted flag */
  readonly bubble: Bubble;
}

/**
 * Check if a bubble awaiting input has timed out.
 *
 * When a player is expected to provide input, there are timeout thresholds:
 * 1. **Warning threshold** (default 5000ms): Emit a warning to encourage action
 * 2. **Auto-wait threshold** (default 10000ms): Force a wait action
 *
 * @param bubble - The bubble to check
 * @param now - Current timestamp (typically Date.now())
 * @returns TimeoutCheckResult with action to take and updated bubble
 *
 * @remarks
 * - Returns 'none' if bubble is not in 'awaiting_input' state
 * - Returns 'none' if within warning threshold
 * - Returns 'warn' if past warning threshold but not yet auto-wait (and warning not emitted)
 * - Returns 'force_wait' if past auto-wait threshold
 * - Returns 'none' if warning already emitted but not yet auto-wait threshold
 *
 * The returned bubble will have `warningEmitted: true` if action is 'warn',
 * allowing callers to update state and avoid duplicate warnings.
 *
 * @example
 * ```typescript
 * const result = checkTimeout(bubble, Date.now());
 * if (result.action === 'warn') {
 *   notifyPlayer('Time is running out!');
 *   updateBubble(result.bubble); // Has warningEmitted: true
 * } else if (result.action === 'force_wait') {
 *   submitWaitAction(bubble);
 * }
 * ```
 */
export function checkTimeout(bubble: Bubble, now: number): TimeoutCheckResult {
  // Not awaiting input - nothing to timeout
  if (bubble.executionState.status !== 'awaiting_input') {
    return { action: 'none', bubble };
  }

  const { waitingSince, warningEmitted } = bubble.executionState;
  const { warningMs, autoWaitMs } = bubble.timeoutConfig;
  const elapsed = now - waitingSince;

  // Past auto-wait threshold - force a wait action
  if (elapsed >= autoWaitMs) {
    return { action: 'force_wait', bubble };
  }

  // Past warning threshold but not yet warned
  if (elapsed >= warningMs && !warningEmitted) {
    const updatedBubble: Bubble = {
      ...bubble,
      executionState: {
        ...bubble.executionState,
        warningEmitted: true,
      },
    };
    return { action: 'warn', bubble: updatedBubble };
  }

  // Nothing to do
  return { action: 'none', bubble };
}

// --- Command Queue Operations ---

/**
 * Result of queuing a command.
 */
export interface QueueCommandResult {
  /** Whether the command was successfully queued */
  readonly success: boolean;
  /** Updated bubble with command queued (or unchanged if failed) */
  readonly bubble: Bubble;
  /** Error message if command was not queued */
  readonly error?: string;
  /** Whether an older command was dropped due to queue overflow */
  readonly droppedOldest?: boolean;
}

/**
 * Queue a command for a crawler in this bubble.
 *
 * Commands are processed FIFO when it's the crawler's turn. If the queue
 * is full (DEFAULT_COMMAND_QUEUE_SIZE), the oldest command is dropped
 * and droppedOldest is set to true.
 *
 * @param bubble - The bubble containing the crawler
 * @param crawlerId - ID of the crawler to queue command for
 * @param action - The action to queue
 * @returns QueueCommandResult with success status and updated bubble
 *
 * @example
 * ```typescript
 * const result = queueCommand(bubble, playerId, moveAction);
 * if (!result.success) {
 *   console.error(result.error);
 * } else if (result.droppedOldest) {
 *   console.warn('Queue full - oldest command dropped');
 * }
 * ```
 */
export function queueCommand(
  bubble: Bubble,
  crawlerId: EntityId,
  action: Action
): QueueCommandResult {
  // Fail if entity not in bubble
  if (!bubble.entityIds.includes(crawlerId)) {
    const error = `Entity ${crawlerId} not found in bubble ${bubble.id}`;
    bubbleWarnLog('queueCommand: entity not in bubble', {
      action: 'queueCommand',
      entityId: crawlerId,
      bubbleId: bubble.id,
      attemptedAction: action,
    });
    return { success: false, bubble, error };
  }

  const existingQueue = bubble.commandQueues.get(crawlerId);
  const currentCommands = existingQueue?.commands ?? [];
  const maxSize = existingQueue?.maxSize ?? DEFAULT_COMMAND_QUEUE_SIZE;

  // Add new command, drop oldest if at capacity
  let newCommands: readonly Action[];
  let droppedOldest = false;
  if (currentCommands.length >= maxSize) {
    bubbleWarnLog('queueCommand: dropping oldest command due to queue overflow', {
      action: 'queueCommand',
      entityId: crawlerId,
      bubbleId: bubble.id,
      droppedAction: currentCommands[0],
      queueSize: maxSize,
    });
    newCommands = [...currentCommands.slice(1), action];
    droppedOldest = true;
  } else {
    newCommands = [...currentCommands, action];
  }

  const newQueue: CommandQueue = Object.freeze({
    commands: Object.freeze(newCommands),
    maxSize,
  });

  const newQueues = new Map(bubble.commandQueues);
  newQueues.set(crawlerId, newQueue);

  const updatedBubble = Object.freeze({
    ...bubble,
    commandQueues: newQueues,
  });

  return { success: true, bubble: updatedBubble, droppedOldest };
}

/**
 * Result of dequeuing a command.
 */
export interface DequeueResult {
  /** The dequeued action, or null if queue was empty */
  readonly action: Action | null;
  /** Updated bubble with command removed from queue */
  readonly bubble: Bubble;
}

/**
 * Dequeue the next command for a crawler.
 *
 * Returns the first command in the queue (FIFO) and removes it.
 * If the queue is empty or the entity is not in the bubble,
 * returns null action and unchanged bubble.
 *
 * @param bubble - The bubble containing the crawler
 * @param crawlerId - ID of the crawler to dequeue command for
 * @returns DequeueResult with action (or null) and updated bubble
 */
export function dequeueCommand(
  bubble: Bubble,
  crawlerId: EntityId
): DequeueResult {
  const queue = bubble.commandQueues.get(crawlerId);

  if (!queue || queue.commands.length === 0) {
    return { action: null, bubble };
  }

  const [action, ...remaining] = queue.commands;

  const newQueue: CommandQueue = Object.freeze({
    commands: Object.freeze(remaining),
    maxSize: queue.maxSize,
  });

  const newQueues = new Map(bubble.commandQueues);
  newQueues.set(crawlerId, newQueue);

  const newBubble = Object.freeze({
    ...bubble,
    commandQueues: newQueues,
  });

  return { action, bubble: newBubble };
}

export function reconcileBubbles(state: GameState): GameState {
  let currentState = state;

  // Phase 1: Merge overlapping bubbles
  // Keep merging until no more merges are possible
  let mergeOccurred = true;
  while (mergeOccurred) {
    mergeOccurred = false;
    const bubbles = currentState.bubbles;

    // Check all bubble pairs for merge conditions
    outer: for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        if (shouldMerge(bubbles[i], bubbles[j], currentState.entities)) {
          // Merge these two bubbles
          const merged = mergeBubbles(bubbles[i], bubbles[j]);
          const newBubbles = bubbles.filter((_, k) => k !== i && k !== j);
          newBubbles.push(merged);
          currentState = { ...currentState, bubbles: newBubbles };
          mergeOccurred = true;
          break outer; // Restart checking with new bubble set
        }
      }
    }
  }

  // Phase 2: Split bubbles where crawlers are distant
  const bubblesAfterSplit: Bubble[] = [];
  for (const bubble of currentState.bubbles) {
    // Find all crawlers in this bubble
    const crawlerIds = bubble.entityIds.filter(id => {
      const entity = currentState.entities[id];
      return entity && isCrawler(entity);
    });

    // Only check for split if there are 2+ crawlers
    if (crawlerIds.length >= 2) {
      // Check if any crawler pair is beyond perception radius
      let shouldSplit = false;
      for (let i = 0; i < crawlerIds.length && !shouldSplit; i++) {
        for (let j = i + 1; j < crawlerIds.length; j++) {
          const a = currentState.entities[crawlerIds[i]];
          const b = currentState.entities[crawlerIds[j]];
          if (a && b && distance(a, b) > DEFAULT_PERCEPTION_RADIUS) {
            shouldSplit = true;
            break;
          }
        }
      }

      if (shouldSplit) {
        const splits = splitBubble(bubble, currentState);
        bubblesAfterSplit.push(...splits);
      } else {
        bubblesAfterSplit.push(bubble);
      }
    } else {
      bubblesAfterSplit.push(bubble);
    }
  }
  currentState = { ...currentState, bubbles: bubblesAfterSplit };

  // Phase 3: Hibernate crawler-less bubbles
  // We need to iterate carefully since hibernateBubble modifies the bubbles array
  const bubblesSnapshot = [...currentState.bubbles];
  for (const bubble of bubblesSnapshot) {
    // Skip if this bubble was already removed
    if (!currentState.bubbles.find(b => b.id === bubble.id)) {
      continue;
    }

    const hasCrawler = bubble.entityIds.some(id => {
      const entity = currentState.entities[id];
      return entity && isCrawler(entity);
    });

    if (!hasCrawler) {
      currentState = hibernateBubble(bubble, currentState);
    }
  }

  return currentState;
}
