/**
 * Procedural Objective Generation
 *
 * Generates objectives by analyzing game state after entity placement.
 * All generation is driven by explicit designer tags on monsters and rooms.
 */

import type { GameState, Entity } from './state';
import { getCrawlers } from './state';
import type { Room } from './map';
import type { CrawlerId } from './crawler-id';
import { MONSTER_TYPES } from './monsters';
import {
  type Objective,
  createKillObjective,
  createReachObjective,
  createClearZoneObjective,
  createFindExitObjective,
} from './objective';

// --- Tag Constants ---

const OBJECTIVE_MONSTER_TAGS = ['boss', 'objective_target'] as const;
const REACH_ROOM_TAGS = ['treasure', 'shrine', 'secret'] as const;
const CLEAR_ROOM_TAGS = ['arena', 'clear_required'] as const;

// --- Helper Functions ---

/**
 * Check if a monster entity has tags that make it an objective target.
 * Returns false for non-monsters or monsters without objective tags.
 */
export function hasObjectiveTag(entity: Entity, _state: GameState): boolean {
  if (entity.type !== 'monster' || !entity.monsterTypeId) return false;
  const monsterType = MONSTER_TYPES[entity.monsterTypeId];
  if (!monsterType?.tags) return false;
  return monsterType.tags.some(t =>
    (OBJECTIVE_MONSTER_TAGS as readonly string[]).includes(t)
  );
}

/**
 * Check if a room has tags that generate reach objectives.
 */
export function hasReachTag(room: Room): boolean {
  return room.tags.some(t =>
    (REACH_ROOM_TAGS as readonly string[]).includes(t)
  );
}

/**
 * Check if a room has tags that generate clear_zone objectives.
 */
export function hasClearTag(room: Room): boolean {
  return room.tags.some(t =>
    (CLEAR_ROOM_TAGS as readonly string[]).includes(t)
  );
}

/**
 * Find the crawler nearest to a target position.
 * Uses Manhattan distance. Returns null if no crawlers exist.
 */
export function findNearestCrawler(
  state: GameState,
  target: { x: number; y: number }
): CrawlerId | null {
  const crawlers = getCrawlers(state);
  if (crawlers.length === 0) return null;
  if (crawlers.length === 1) return crawlers[0].id as CrawlerId;

  let nearest = crawlers[0];
  let minDist = Math.abs(nearest.x - target.x) + Math.abs(nearest.y - target.y);

  for (const crawler of crawlers.slice(1)) {
    const dist = Math.abs(crawler.x - target.x) + Math.abs(crawler.y - target.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = crawler;
    }
  }

  return nearest.id as CrawlerId;
}

// --- Types ---

export interface GenerateObjectivesConfig {
  /** Victory condition type */
  victoryType: 'clear_all' | 'find_exit';
}

// --- Helper Functions for Descriptions ---

function describeReachObjective(room: Room): string {
  if (room.tags.includes('treasure')) return 'Find the treasure room';
  if (room.tags.includes('shrine')) return 'Visit the shrine';
  if (room.tags.includes('secret')) return 'Discover the secret area';
  return 'Explore the marked location';
}

function describeClearObjective(room: Room): string {
  if (room.tags.includes('arena')) return 'Clear the arena';
  if (room.tags.includes('clear_required')) return 'Clear all enemies from this area';
  return 'Clear the marked zone';
}

function calculateZoneBounds(state: GameState): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const area of Object.values(state.zone.areas)) {
    minX = Math.min(minX, 0);
    minY = Math.min(minY, 0);
    maxX = Math.max(maxX, area.map.width - 1);
    maxY = Math.max(maxY, area.map.height - 1);
  }

  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
}

function createPrimaryObjective(
  state: GameState,
  victoryType: 'clear_all' | 'find_exit',
  index: number
): Objective {
  if (victoryType === 'find_exit') {
    return createFindExitObjective({
      id: `obj-primary-${index}`,
      description: 'Find the exit and escape the dungeon',
      assignee: null,
      priority: 'primary',
    });
  }

  // clear_all: zone-wide clear objective
  const bounds = calculateZoneBounds(state);
  return createClearZoneObjective({
    id: `obj-primary-${index}`,
    description: 'Kill all monsters in the dungeon',
    target: bounds,
    assignee: null,
    priority: 'primary',
  });
}

// --- Main Generator ---

/**
 * Generate objectives by analyzing game state.
 * Called once at game initialization, after entities are placed.
 *
 * Generation is driven by explicit designer tags:
 * - Monsters with 'boss'/'objective_target' tags become kill objectives
 * - Rooms with 'treasure'/'shrine'/'secret' tags become reach objectives
 * - Rooms with 'arena'/'clear_required' tags become clear_zone objectives
 *
 * @param state - Game state with entities and zone
 * @param config - Configuration for objective generation
 * @returns Array of generated objectives
 */
export function generateObjectives(
  state: GameState,
  config: GenerateObjectivesConfig
): Objective[] {
  const objectives: Objective[] = [];
  let objectiveIndex = 0;

  // 1. Primary objective (global win condition)
  objectives.push(createPrimaryObjective(state, config.victoryType, objectiveIndex++));

  // 2. Kill objectives from tagged monsters
  for (const entity of Object.values(state.entities)) {
    if (entity.type === 'monster' && hasObjectiveTag(entity, state)) {
      const assignee = findNearestCrawler(state, entity);
      objectives.push(createKillObjective({
        id: `obj-kill-${objectiveIndex++}`,
        description: `Defeat the ${entity.name}`,
        target: { entityId: entity.id },
        assignee,
        priority: 'secondary',
      }));
    }
  }

  // 3. Reach objectives from tagged rooms
  for (const area of Object.values(state.zone.areas)) {
    for (const room of area.map.rooms) {
      if (hasReachTag(room)) {
        const assignee = findNearestCrawler(state, room.center);
        const description = describeReachObjective(room);
        objectives.push(createReachObjective({
          id: `obj-reach-${objectiveIndex++}`,
          description,
          target: { x: room.center.x, y: room.center.y },
          assignee,
          priority: 'secondary',
        }));
      }
    }
  }

  // 4. Clear objectives from tagged rooms
  for (const area of Object.values(state.zone.areas)) {
    for (const room of area.map.rooms) {
      if (hasClearTag(room)) {
        const assignee = findNearestCrawler(state, room.center);
        const description = describeClearObjective(room);
        objectives.push(createClearZoneObjective({
          id: `obj-clear-${objectiveIndex++}`,
          description,
          target: {
            x1: room.x,
            y1: room.y,
            x2: room.x + room.width - 1,
            y2: room.y + room.height - 1,
          },
          assignee,
          priority: 'secondary',
        }));
      }
    }
  }

  return objectives;
}
