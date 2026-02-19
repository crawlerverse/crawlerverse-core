/**
 * Objective System
 *
 * Defines objectives that drive crawler exploration with two ownership models:
 * - Global objectives (assignee: null) apply to all crawlers (e.g., "clear dungeon")
 * - Per-crawler objectives guide individual behavior (e.g., "kill the troll")
 *
 * Supports four objective types: reach, kill, find_exit, clear_zone.
 * Primary objectives serve as win conditions; secondary objectives guide exploration.
 *
 * Completion is checked after each crawler action via updateObjectives().
 */

import { z } from 'zod';
import type { CrawlerId } from './crawler-id';
import type { GameState } from './state';
import { getEntity, getMonsters, getCurrentArea } from './state';
import { createLogger } from '../logging';

const objectiveLogger = createLogger({ module: 'objective' });

// --- Types ---

export type ObjectiveType = 'reach' | 'kill' | 'find_exit' | 'clear_zone';
export type ObjectiveStatus = 'active' | 'completed';
export type ObjectivePriority = 'primary' | 'secondary';

export interface ReachTarget {
  x: number;
  y: number;
}

export interface KillTarget {
  entityId: string;
}

export interface ClearZoneTarget {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// --- Discriminated Union Types ---
// Each objective type has a specific target type, enforced at compile time

interface BaseObjective {
  id: string;
  description: string;
  status: ObjectiveStatus;
  priority: ObjectivePriority;
  assignee: CrawlerId | null;
}

export interface ReachObjective extends BaseObjective {
  type: 'reach';
  target: ReachTarget;
}

export interface KillObjective extends BaseObjective {
  type: 'kill';
  target: KillTarget;
}

export interface FindExitObjective extends BaseObjective {
  type: 'find_exit';
  target: null;
}

export interface ClearZoneObjective extends BaseObjective {
  type: 'clear_zone';
  target: ClearZoneTarget;
}

/**
 * Discriminated union of all objective types.
 * TypeScript enforces that each objective type has the correct target shape.
 */
export type Objective = ReachObjective | KillObjective | FindExitObjective | ClearZoneObjective;

// --- Zod Schemas ---

const BaseObjectiveFields = {
  id: z.string(),
  description: z.string(),
  status: z.enum(['active', 'completed']),
  priority: z.enum(['primary', 'secondary']),
  assignee: z.string().nullable(),
};

const ClearZoneTargetSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
}).refine(
  (t) => t.x1 <= t.x2 && t.y1 <= t.y2,
  { message: 'ClearZone bounds must satisfy x1 <= x2 and y1 <= y2' }
);

/**
 * Zod schema using discriminatedUnion to enforce type-target consistency.
 * This ensures deserialized objectives have matching type and target fields.
 */
export const ObjectiveSchema = z.discriminatedUnion('type', [
  z.object({
    ...BaseObjectiveFields,
    type: z.literal('reach'),
    target: z.object({ x: z.number(), y: z.number() }),
  }),
  z.object({
    ...BaseObjectiveFields,
    type: z.literal('kill'),
    target: z.object({ entityId: z.string() }),
  }),
  z.object({
    ...BaseObjectiveFields,
    type: z.literal('find_exit'),
    target: z.null(),
  }),
  z.object({
    ...BaseObjectiveFields,
    type: z.literal('clear_zone'),
    target: ClearZoneTargetSchema,
  }),
]);

// --- Factory Functions ---

interface CreateObjectiveOptions {
  id: string;
  description: string;
  assignee?: CrawlerId | null;
  priority?: ObjectivePriority;
}

/**
 * Create a reach objective - completed when crawler reaches target coordinates.
 * Default priority: secondary
 */
export function createReachObjective(
  options: CreateObjectiveOptions & { target: ReachTarget }
): ReachObjective {
  return {
    id: options.id,
    type: 'reach',
    description: options.description,
    target: options.target,
    status: 'active',
    priority: options.priority ?? 'secondary',
    assignee: options.assignee ?? null,
  };
}

/**
 * Create a kill objective - completed when target entity is dead or removed.
 * Default priority: secondary
 *
 * Note: An objective for a non-existent entity ID will complete immediately.
 * This is by design - if the target was already killed, the objective is done.
 */
export function createKillObjective(
  options: CreateObjectiveOptions & { target: KillTarget }
): KillObjective {
  return {
    id: options.id,
    type: 'kill',
    description: options.description,
    target: options.target,
    status: 'active',
    priority: options.priority ?? 'secondary',
    assignee: options.assignee ?? null,
  };
}

/**
 * Create a find_exit objective - completed when crawler is adjacent to a portal.
 * Default priority: primary (typically a main goal)
 *
 * Adjacency is 8-way (includes diagonals). Standing directly on a portal
 * does not count as adjacent.
 */
export function createFindExitObjective(
  options: CreateObjectiveOptions
): FindExitObjective {
  return {
    id: options.id,
    type: 'find_exit',
    description: options.description,
    target: null,
    status: 'active',
    priority: options.priority ?? 'primary',
    assignee: options.assignee ?? null,
  };
}

/**
 * Create a clear_zone objective - completed when no monsters exist in bounds.
 * Default priority: primary (typically a main goal)
 *
 * Bounds are inclusive: monsters at x1, y1, x2, or y2 count as "in zone".
 * @throws Error if bounds are invalid (x1 > x2 or y1 > y2)
 */
export function createClearZoneObjective(
  options: CreateObjectiveOptions & { target: ClearZoneTarget }
): ClearZoneObjective {
  const { target } = options;
  if (target.x1 > target.x2 || target.y1 > target.y2) {
    throw new Error(
      `Invalid ClearZone bounds: (${target.x1},${target.y1}) to (${target.x2},${target.y2}). ` +
      `x1 must be <= x2 and y1 must be <= y2.`
    );
  }
  return {
    id: options.id,
    type: 'clear_zone',
    description: options.description,
    target: options.target,
    status: 'active',
    priority: options.priority ?? 'primary',
    assignee: options.assignee ?? null,
  };
}

// --- Completion Checking ---

/**
 * Check if an objective is relevant to a specific crawler.
 * Global objectives (assignee: null) are relevant to all crawlers.
 */
export function isObjectiveRelevantToCrawler(
  objective: Objective,
  crawlerId: CrawlerId
): boolean {
  return objective.assignee === null || objective.assignee === crawlerId;
}

/**
 * Check if an objective is completed based on current game state.
 * Returns false if the objective is not relevant to the given crawler.
 *
 * Completion criteria by type:
 * - reach: crawler position matches target coordinates exactly
 * - kill: target entity does not exist OR has hp <= 0
 * - find_exit: crawler is adjacent (8-way) to any portal tile
 * - clear_zone: no monsters exist within the zone bounds (inclusive)
 *
 * @param objective - The objective to check
 * @param state - Current game state
 * @param crawlerId - The crawler checking completion
 * @returns true if objective is completed, false otherwise
 */
export function checkObjectiveCompletion(
  objective: Objective,
  state: GameState,
  crawlerId: CrawlerId
): boolean {
  if (!isObjectiveRelevantToCrawler(objective, crawlerId)) {
    return false;
  }

  // Type-safe switch using discriminated union - no casts needed
  switch (objective.type) {
    case 'reach': {
      const crawler = getEntity(state, crawlerId);
      if (!crawler) {
        objectiveLogger.warn(
          { crawlerId, objectiveId: objective.id },
          'Crawler not found when checking reach objective - may indicate state corruption'
        );
        return false;
      }
      return crawler.x === objective.target.x && crawler.y === objective.target.y;
    }

    case 'kill': {
      const entity = getEntity(state, objective.target.entityId);
      // Entity not found = killed/removed. Entity with hp <= 0 = dead but not yet removed.
      // Both cases mean the objective is complete.
      return entity === undefined || entity.hp <= 0;
    }

    case 'find_exit': {
      const crawler = getEntity(state, crawlerId);
      if (!crawler) {
        objectiveLogger.warn(
          { crawlerId, objectiveId: objective.id },
          'Crawler not found when checking find_exit objective - may indicate state corruption'
        );
        return false;
      }
      return isAdjacentToExit(state, crawler.x, crawler.y);
    }

    case 'clear_zone': {
      const { target } = objective;
      const monsters = getMonsters(state);
      const monstersInZone = monsters.filter(
        (m) => m.x >= target.x1 && m.x <= target.x2 && m.y >= target.y1 && m.y <= target.y2
      );
      return monstersInZone.length === 0;
    }

    default: {
      // Exhaustive type checking - TypeScript will error if a case is missing
      const _exhaustiveCheck: never = objective;
      objectiveLogger.error(
        { objective: _exhaustiveCheck },
        'Unknown objective type - this should never happen with proper typing'
      );
      return false;
    }
  }
}

/**
 * Check if a position is adjacent to an exit (portal) tile.
 * Uses 8-way adjacency (does not include standing directly on a portal).
 *
 * @param state - Current game state (for map access)
 * @param x - X coordinate to check from
 * @param y - Y coordinate to check from
 * @returns true if any adjacent tile is a portal, false otherwise
 */
function isAdjacentToExit(state: GameState, x: number, y: number): boolean {
  // Validate inputs
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    objectiveLogger.error(
      { x, y },
      'Invalid coordinates for exit adjacency check'
    );
    return false;
  }

  const deltas = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],          [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  const { map } = getCurrentArea(state);
  for (const [dx, dy] of deltas) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
      const tile = map.tiles[ny]?.[nx];
      if (tile?.type === 'portal') {
        return true;
      }
    }
  }
  return false;
}

// --- State Update ---

/**
 * Update all objectives based on current game state.
 * Evaluates only active objectives; completed objectives are preserved.
 * Returns a new state with updated objective statuses (immutable pattern).
 *
 * @param state - Current game state with objectives
 * @param crawlerId - The crawler whose actions may have completed objectives
 * @returns New state with updated objectives (same reference if no changes)
 */
export function updateObjectives(
  state: GameState,
  crawlerId: CrawlerId
): GameState {
  return updateObjectivesForCrawlers(state, [crawlerId]);
}

/**
 * Batch update objectives for multiple crawlers.
 * More efficient than calling updateObjectives repeatedly when processing
 * multiple crawlers, as it creates only one new state object.
 *
 * @param state - Current game state with objectives
 * @param crawlerIds - Array of crawler IDs to check objectives for
 * @returns New state with updated objectives (same reference if no changes)
 */
export function updateObjectivesForCrawlers(
  state: GameState,
  crawlerIds: readonly CrawlerId[]
): GameState {
  if (state.objectives.length === 0 || crawlerIds.length === 0) {
    return state;
  }

  let hasChanges = false;
  const updatedObjectives = state.objectives.map((obj) => {
    if (obj.status !== 'active') {
      return obj;
    }

    // Check if any crawler completed this objective
    for (const crawlerId of crawlerIds) {
      if (checkObjectiveCompletion(obj, state, crawlerId)) {
        hasChanges = true;
        return { ...obj, status: 'completed' as const };
      }
    }

    return obj;
  });

  if (!hasChanges) {
    return state;
  }

  return { ...state, objectives: updatedObjectives };
}
