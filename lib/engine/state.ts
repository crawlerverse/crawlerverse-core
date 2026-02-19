/**
 * Game State Types and Helpers
 *
 * Defines the core data structures for game state.
 * All types are serializable to JSON for persistence and network transfer.
 */

import { z } from 'zod';
import * as ROT from 'rot-js';
import type { Bubble } from './bubble';
import { BubbleSchema, createBubble, bubbleId } from './bubble';
import { entityId, advanceScheduler, completeCurrentTurn, type SchedulerState, type EntityId } from './scheduler';
import {
  type DungeonMap,
  type Tile,
  generateDungeon,
  getPlayerSpawnPositions,
  getMonsterSpawnPositions,
  DEFAULT_DUNGEON_CONFIG,
  type DungeonConfig,
  DungeonGenerationError,
  SpawnPositionError,
  type Area,
  type Zone,
  type AreaId,
  ZoneSchema,
} from './map';
import { createMonster, selectRandomMonsterType, resetMonsterCounter, getEntityAppearance } from './monsters';
import { type ItemInstance, ItemInstanceSchema, getItemAtPosition, getItemTemplate } from './items';
import { MAX_INVENTORY_SIZE } from './inventory';
import { computeVisibleTiles, isEntityVisible, tileKey, TILE_KEY_PATTERN, type TileKey, hasLineOfSight } from './fov';
import { getEffectiveVisionRadius } from './stats';
import {
  computeExplorationValues,
  getExplorationRecommendation,
} from './exploration';
import { crawlerIdFromIndex } from './crawler-id';
import { getPersonalityDescription, formatCharacterTitle, generateCharacterIdentity } from './character';
import { CrawlerCharacterSystem } from './character-system';
import { createRNG } from './rng';
import { logger } from '../logging';
import { ObjectiveSchema, type Objective, isObjectiveRelevantToCrawler } from './objective';
import { generateObjectives, type GenerateObjectivesConfig } from './objective-generator';
import type { CrawlerId } from './crawler-id';
import { GameEventEmitter } from './events';

// Re-export errors for consumers
export { DungeonGenerationError, SpawnPositionError };

/** Default area ID for single-area games (pre-multi-area) */
export const DEFAULT_AREA_ID = 'area-1';

// Re-export shared types from types.ts for backwards compatibility
export {
  type Position,
  DirectionSchema,
  type Direction,
  ActionSchema,
  type Action,
  EntityTypeSchema,
  type EntityType,
  MonsterTypeIdSchema,
  type MonsterTypeId,
  BehaviorStateSchema,
  type BehaviorState,
  EntitySchema,
  type Entity,
  isCrawler,
  isMonster,
} from './types';

// Import for local use
import { type Direction, type Entity, EntitySchema, isCrawler, isMonster, type MonsterTypeId } from './types';

// --- Internal Helpers ---

/**
 * Compute initial explored tiles for all crawlers based on their starting positions.
 * Explored tiles are now keyed by areaId (shared by all crawlers in the same area).
 */
function computeInitialExploredTiles(
  map: DungeonMap,
  entities: Record<string, Entity>,
  areaId: AreaId
): ExploredTiles {
  const exploredTiles: ExploredTiles = {};
  const allVisible = new Set<string>();

  // Gather visible tiles from all crawlers' starting positions
  for (const entity of Object.values(entities)) {
    if (isCrawler(entity)) {
      const visible = computeVisibleTiles(
        map,
        entity.x,
        entity.y,
        getEffectiveVisionRadius(entity)
      );
      for (const tile of visible) {
        allVisible.add(tile);
      }
    }
  }

  exploredTiles[areaId] = Array.from(allVisible);
  return exploredTiles;
}

export function isValidPosition(
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

export function validatePosition(
  x: number,
  y: number,
  width: number,
  height: number,
  entityId: string
): void {
  if (!isValidPosition(x, y, width, height)) {
    throw new Error(
      `Entity ${entityId} has invalid position (${x}, ${y}) for map size ${width}x${height}`
    );
  }
}

// Entity types are now in types.ts and re-exported above

// --- Game Status (Discriminated Union) ---
export type GameStatus =
  | { readonly status: 'playing' }
  | { readonly status: 'ended'; readonly victory: boolean };

// --- AI Metadata Type ---
export interface AIMetadata {
  readonly durationMs: number;
  readonly outputTokens?: number;
  readonly modelId?: string;
}

/**
 * Combat roll details for expandable event log display.
 *
 * Note: This mirrors CombatResult from combat.ts. The duplication is intentional
 * to maintain separation between the engine layer (combat.ts) and the state/message
 * layer (state.ts). Messages are serializable game state; CombatResult is an
 * internal engine type. If they ever diverge, this boundary keeps changes isolated.
 */
export interface CombatDetails {
  /** The d20 roll (1-20) */
  roll: number;
  /** Attacker's effective ATK stat */
  attackerAtk: number;
  /** Defender's effective DEF stat */
  defenderDef: number;
  /** Target DC (7 + DEF) */
  targetDC: number;
  /** Whether the attack hit */
  hit: boolean;
  /** Actual damage dealt (0 if miss) */
  damage: number;
  /** Base damage before crit multiplier */
  baseDamage: number;
  /** Whether this was a natural 20 */
  isCritical: boolean;
  /** Whether this was a natural 1 */
  isFumble: boolean;
}

// --- Message Type with ID ---
export interface Message {
  readonly id: string;
  readonly text: string;
  readonly turn: number;
  readonly reasoning?: string;
  readonly aiMetadata?: AIMetadata;
  readonly combatDetails?: CombatDetails;
}

/**
 * Creates a message with a deterministic ID based on turn, index, and optional prefix.
 * This avoids module-scoped mutable state that causes issues with SSR and HMR.
 *
 * @param text - Message text
 * @param turn - Current game turn
 * @param index - Message index within the turn (0-based)
 * @param prefix - Optional prefix for uniqueness across bubbles (e.g., bubble ID)
 * @param reasoning - Optional AI reasoning that led to this message
 * @param aiMetadata - Optional AI performance metadata (duration, tokens, model)
 * @param combatDetails - Optional combat roll details for expandable display
 */
export function createMessage(
  text: string,
  turn: number,
  index: number = 0,
  prefix?: string,
  reasoning?: string,
  aiMetadata?: AIMetadata,
  combatDetails?: CombatDetails
): Message {
  const id = prefix ? `msg-${prefix}-${turn}-${index}` : `msg-${turn}-${index}`;
  return {
    id,
    text,
    turn,
    ...(reasoning && { reasoning }),
    ...(aiMetadata && { aiMetadata }),
    ...(combatDetails && { combatDetails }),
  };
}


// --- Geometry Helpers ---
export function isWallPosition(
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1;
}

// --- GameState ---

// ExploredTiles type: Record<AreaId, Array<"x,y" strings>>
// Tracks explored tiles per area, shared by all crawlers
export type ExploredTiles = Record<AreaId, string[]>;

/**
 * Event tracking state for the game.
 * Tracks what events have been emitted to avoid duplicates.
 */
export interface EventTracking {
  /**
   * Combat state per area - tracks combat progression.
   * Key: AreaId
   */
  combatState: Record<AreaId, {
    /** Has first blood occurred in this area? (FIRST_BLOOD event emitted) */
    combatStarted: boolean;
    /** Were there enemies last turn? (for COMBAT_END detection) */
    wasInCombat: boolean;
    /** Kills since combat started (for KILL events) */
    killsThisEncounter: number;
  }>;

  /**
   * Monster types seen by each crawler.
   * Key: CrawlerId, Value: Set of MonsterTypeId
   */
  seenMonsterTypes: Record<CrawlerId, Set<MonsterTypeId>>;

  /**
   * Portals seen by each crawler.
   * Key: CrawlerId, Value: Set of TileKey (portal positions)
   */
  seenPortals: Record<CrawlerId, Set<TileKey>>;

  /**
   * Entities that have been below critical HP threshold.
   * Tracks EntityId to avoid duplicate CRITICAL_HP events.
   */
  entitiesBelowCritical: Set<EntityId>;
}

export interface GameState {
  readonly zone: Zone;
  readonly currentAreaId: AreaId;
  readonly entities: Record<string, Entity>;
  readonly items: readonly ItemInstance[];
  readonly bubbles: readonly Bubble[];
  readonly hibernating: readonly string[];
  readonly exploredTiles: ExploredTiles;
  readonly objectives: readonly Objective[];
  readonly turn: number;
  readonly messages: readonly Message[];
  readonly gameStatus: GameStatus;

  /**
   * Optional event emitter for tracking game events.
   * When present, events are emitted during state mutations.
   */
  readonly eventEmitter?: GameEventEmitter;

  /**
   * Optional event tracking state.
   * Tracks what events have been emitted to avoid duplicates.
   */
  readonly eventTracking?: EventTracking;
}

// ExploredTiles: Record<EntityId, Array<"x,y" strings>>
// Using string array instead of Set because Zod/JSON doesn't serialize Sets
// Tile keys are validated to match "x,y" format
const TileKeySchema = z.string().regex(TILE_KEY_PATTERN, {
  message: 'Tile key must be in "x,y" format (e.g., "5,10", "-3,7")',
});
export const ExploredTilesSchema = z.record(z.string().min(1), z.array(TileKeySchema));

export const GameStateSchema = z
  .object({
    zone: ZoneSchema,
    currentAreaId: z.string().min(1),
    entities: z.record(z.string(), EntitySchema),
    items: z.array(ItemInstanceSchema),
    bubbles: z.array(BubbleSchema),
    hibernating: z.array(z.string()),
    exploredTiles: ExploredTilesSchema.optional().default({}),
    objectives: z.array(ObjectiveSchema).default([]),
    turn: z.number().int().nonnegative(),
    messages: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        turn: z.number().int().nonnegative(),
      })
    ),
    gameStatus: z.discriminatedUnion('status', [
      z.object({ status: z.literal('playing') }),
      z.object({ status: z.literal('ended'), victory: z.boolean() }),
    ]),
  })
  .refine(
    (state) => {
      // Validate currentAreaId references an existing area
      return state.currentAreaId in state.zone.areas;
    },
    { message: 'currentAreaId must reference an existing area in zone' }
  )
  .refine(
    (state) => {
      // Validate all entity positions are in bounds (using current area's map)
      const area = state.zone.areas[state.currentAreaId];
      if (!area) return false;
      const { map } = area;
      for (const entity of Object.values(state.entities)) {
        // Only validate entities in the current area
        if (entity.areaId === state.currentAreaId) {
          if (!isValidPosition(entity.x, entity.y, map.width, map.height)) return false;
        }
      }
      return true;
    },
    { message: 'Entity positions must be within map bounds' }
  )
  .refine(
    (state) => {
      for (const entity of Object.values(state.entities)) {
        if (entity.hp > entity.maxHp) return false;
      }
      return true;
    },
    { message: 'Entity HP cannot exceed maxHp' }
  )
  .refine(
    (state) => {
      // Validate all item positions are in bounds (using current area's map)
      const area = state.zone.areas[state.currentAreaId];
      if (!area) return false;
      const { map } = area;
      for (const item of state.items) {
        // Only validate items in the current area
        if (item.areaId === state.currentAreaId) {
          if (!isValidPosition(item.x, item.y, map.width, map.height)) return false;
        }
      }
      return true;
    },
    { message: 'Item positions must be within map bounds' }
  );

// --- GameState Helper Functions ---

export function getPlayer(state: GameState): Entity | undefined {
  // Primary player is crawler-1, with legacy 'player' fallback for old saved states
  return state.entities[crawlerIdFromIndex(1)] ?? state.entities['player'];
}

export function getCrawlers(state: GameState): Entity[] {
  return Object.values(state.entities).filter(isCrawler);
}

export function getMonsters(state: GameState): Entity[] {
  return Object.values(state.entities).filter(isMonster);
}

export function getEntity(state: GameState, id: string): Entity | undefined {
  return state.entities[id];
}

/**
 * Get the current area from the game state.
 * @param state - The game state
 * @returns The current Area (metadata + map)
 * @throws Error if currentAreaId doesn't exist in zone
 */
export function getCurrentArea(state: GameState): Area {
  const area = state.zone.areas[state.currentAreaId];
  if (!area) {
    throw new Error(
      `Area "${state.currentAreaId}" not found in zone "${state.zone.id}"`
    );
  }
  return area;
}

// --- Area-scoped queries ---

/**
 * Get all entities in a specific area.
 */
export function getEntitiesInArea(state: GameState, areaId: string): Entity[] {
  return Object.values(state.entities).filter(e => e.areaId === areaId);
}

/**
 * Get all monsters in a specific area.
 */
export function getMonstersInArea(state: GameState, areaId: string): Entity[] {
  return getEntitiesInArea(state, areaId).filter(isMonster);
}

/**
 * Get all crawlers in a specific area.
 */
export function getCrawlersInArea(state: GameState, areaId: string): Entity[] {
  return getEntitiesInArea(state, areaId).filter(isCrawler);
}

/**
 * Get all items in a specific area.
 */
export function getItemsInArea(state: GameState, areaId: string): ItemInstance[] {
  return state.items.filter(item => item.areaId === areaId);
}

// --- Factory Functions ---
export function createEntity(
  params: Entity,
  bounds: { width: number; height: number }
): Entity {
  validatePosition(params.x, params.y, bounds.width, bounds.height, params.id);
  if (params.hp > params.maxHp) {
    throw new Error(`Entity ${params.id} has hp (${params.hp}) > maxHp (${params.maxHp})`);
  }
  // Validate char for crawlers (must be single character)
  if (params.char !== undefined && params.char.length !== 1) {
    throw new Error(`Entity ${params.id} char must be single character, got "${params.char}"`);
  }
  if (params.attack < 0) {
    throw new Error(`Entity ${params.id} attack must be non-negative, got ${params.attack}`);
  }
  if (params.defense < 0) {
    throw new Error(`Entity ${params.id} defense must be non-negative, got ${params.defense}`);
  }
  if (params.speed <= 0) {
    throw new Error(`Entity ${params.id} speed must be positive, got ${params.speed}`);
  }
  return Object.freeze({ ...params });
}

// --- GameState Factory ---

/** Victory objective type for the game */
export type VictoryObjectiveType = GenerateObjectivesConfig['victoryType'];

/**
 * Creates an initial game state.
 *
 * @param config - Optional dungeon configuration and/or pre-built zone.
 *   - When `zone` is provided, uses that zone instead of generating one.
 *   - When `zone` is not provided, generates a single-area zone using DungeonConfig.
 *   - When `victoryObjectiveType` is provided, generates objectives with that victory condition.
 * @returns A new GameState ready for play
 */
export function createInitialState(
  config?: Partial<DungeonConfig> & { zone?: Zone; victoryObjectiveType?: VictoryObjectiveType }
): GameState {
  // Reset monster counter for deterministic IDs
  resetMonsterCounter();

  // Extract zone and victoryObjectiveType from config if provided
  const { zone: providedZone, victoryObjectiveType, ...dungeonConfig } = config ?? {};

  // Use provided zone or generate single-area zone
  let zone: Zone;
  let map: DungeonMap;
  let entryAreaId: AreaId;

  if (providedZone) {
    // Use the provided zone
    zone = providedZone;
    entryAreaId = zone.entryAreaId;
    map = zone.areas[entryAreaId].map;
  } else {
    // Generate single-area zone (existing behavior)
    const seed = dungeonConfig?.seed ?? Date.now();
    const fullConfig: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      ...dungeonConfig,
      seed,
    };

    map = generateDungeon(fullConfig);
    entryAreaId = DEFAULT_AREA_ID;

    // Wrap map in Area
    const area: Area = {
      metadata: {
        id: DEFAULT_AREA_ID,
        name: 'Dungeon Level 1',
        dangerLevel: 1,
      },
      map,
    };

    // Wrap Area in Zone
    zone = {
      id: 'zone-1',
      name: 'The Dungeon',
      entryAreaId: DEFAULT_AREA_ID,
      victoryAreaIds: [DEFAULT_AREA_ID],
      areas: { [DEFAULT_AREA_ID]: area },
    };
  }

  const rng = ROT.RNG.clone();
  // Use the actual seed from the map (may differ from config.seed if retries occurred)
  rng.setSeed(map.seed);

  const playerPositions = getPlayerSpawnPositions(map, 1);
  // getPlayerSpawnPositions now throws SpawnPositionError if no rooms available
  const playerPos = playerPositions[0];

  // Use monsterCount from config (defaults to 2 in DEFAULT_DUNGEON_CONFIG)
  // Ensure seed is always set (use map.seed as fallback)
  const fullConfig: DungeonConfig = {
    ...DEFAULT_DUNGEON_CONFIG,
    ...dungeonConfig,
    seed: dungeonConfig?.seed ?? map.seed,
  };

  const entryBounds = { width: map.width, height: map.height };

  // Create player entity with crawler-1 ID and class-appropriate stats
  const playerId = crawlerIdFromIndex(1);
  const characterRng = createRNG(map.seed);
  const { characterClass, name: crawlerName } = generateCharacterIdentity(characterRng);
  const baseStats = CrawlerCharacterSystem.getBaseStats(characterClass);
  const player = createEntity({
    id: playerId,
    type: 'crawler',
    x: playerPos.x,
    y: playerPos.y,
    areaId: entryAreaId,
    hp: baseStats.hp,
    maxHp: baseStats.hp,
    name: crawlerName,
    characterClass,
    char: '@',
    attack: baseStats.attack,
    defense: baseStats.defense,
    speed: baseStats.speed,
  }, entryBounds);

  // Spawn monsters in ALL areas of the zone
  const allMonsters: ReturnType<typeof createMonster>[] = [];
  const hibernatingIds: string[] = [];

  for (const [areaId, area] of Object.entries(zone.areas)) {
    const areaMap = area.map;
    const areaBounds = { width: areaMap.width, height: areaMap.height };

    // Calculate monster count for this area based on room count
    // Use configured monsterCount for entry area, scale for other areas
    let areaMonsterCount: number;
    if (areaId === entryAreaId) {
      areaMonsterCount = fullConfig.monsterCount;
    } else {
      // For non-entry areas, scale by room count (at least 1 monster per 2 rooms)
      areaMonsterCount = Math.max(1, Math.floor(areaMap.rooms.length / 2));
    }

    // Get spawn positions, avoiding player position if this is entry area
    const excludePositions = areaId === entryAreaId ? playerPositions : [];
    const monsterPositions = getMonsterSpawnPositions(
      areaMap,
      areaMonsterCount,
      excludePositions,
      rng
    );

    // Create monsters for this area
    const areaMonsters = monsterPositions.map((pos) => {
      const monsterTypeId = selectRandomMonsterType(rng, area.metadata.dangerLevel);
      return createMonster(monsterTypeId, pos, areaBounds, { areaId });
    });

    allMonsters.push(...areaMonsters);

    // Non-entry area monsters go to hibernating
    if (areaId !== entryAreaId) {
      hibernatingIds.push(...areaMonsters.map(m => m.id));
    }
  }

  // Build entities record
  const entities: Record<string, Entity> = { [playerId]: player };
  for (const monster of allMonsters) {
    entities[monster.id] = monster;
  }

  // Get entry area monsters for the active bubble
  const entryAreaMonsters = allMonsters.filter(m => m.areaId === entryAreaId);

  // Create bubble with player and entry area entities only
  const allEntityIds = [entityId(playerId), ...entryAreaMonsters.map(m => entityId(m.id))];
  const allEntitySpeeds = [
    { id: entityId(playerId), speed: player.speed },
    ...entryAreaMonsters.map(m => ({ id: entityId(m.id), speed: m.speed })),
  ];

  const initialBubble = createBubble({
    id: bubbleId('bubble-main'),
    entityIds: allEntityIds,
    entities: allEntitySpeeds,
    center: { x: player.x, y: player.y },
  });

  // Advance scheduler until it's a crawler's turn
  const maxIterations = Object.keys(entities).length * 2;
  let iterations = 0;
  let scheduler: SchedulerState = advanceScheduler(initialBubble.scheduler);
  while (scheduler.currentActorId !== null && iterations < maxIterations) {
    iterations++;
    const currentActor = entities[scheduler.currentActorId];
    if (currentActor && isCrawler(currentActor)) {
      break;
    }
    scheduler = advanceScheduler(completeCurrentTurn(scheduler));
  }
  const bubble: Bubble = { ...initialBubble, scheduler };

  // Create state with empty objectives first
  const stateWithoutObjectives: GameState = {
    zone,
    currentAreaId: entryAreaId,
    entities,
    items: [],
    bubbles: [bubble],
    hibernating: hibernatingIds,
    exploredTiles: computeInitialExploredTiles(map, entities, entryAreaId),
    objectives: [],
    turn: 0,
    messages: [createMessage('You enter the dungeon. Kill all monsters to win.', 0, 0)],
    gameStatus: { status: 'playing' },
  };

  // Generate objectives based on victoryObjectiveType (default: clear_all)
  const objectives = generateObjectives(stateWithoutObjectives, {
    victoryType: victoryObjectiveType ?? 'clear_all',
  });

  return {
    ...stateWithoutObjectives,
    objectives,
    eventTracking: {
      combatState: {},
      seenMonsterTypes: {},
      seenPortals: {},
      entitiesBelowCritical: new Set(),
    },
    eventEmitter: new GameEventEmitter(),
  };
}

// --- State Serialization ---
function getTileChar(tile: Tile): string {
  switch (tile.type) {
    case 'wall': return '#';
    case 'floor': return '.';
    case 'door': return tile.open ? '/' : '+';
    case 'portal':
      if (tile.direction === 'up') return '<';
      if (tile.direction === 'down') return '>';
      return 'O';  // Generic portal without direction
  }
}

/**
 * Get the relative direction from a position delta using octants.
 * Returns the cardinal or intercardinal direction that best matches the delta.
 */
function getRelativeDirection(dx: number, dy: number): Direction | null {
  if (dx === 0 && dy === 0) return null;

  // Use octants: divide the circle into 8 sectors of 45° each
  // atan2 returns angle in radians from -π to π, with 0 pointing east
  const angle = Math.atan2(-dy, dx); // Negate dy because Y increases southward
  const octant = Math.round((angle / Math.PI) * 4); // -4 to 4

  // Map octant to direction
  switch (octant) {
    case 0: return 'east';
    case 1: return 'northeast';
    case 2: return 'north';
    case 3: return 'northwest';
    case 4:
    case -4: return 'west';
    case -3: return 'southwest';
    case -2: return 'south';
    case -1: return 'southeast';
    default: return 'east'; // Fallback
  }
}

/**
 * Get Chebyshev distance (king's move distance) for 8-directional movement.
 */
function getChebyshevDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * Format a relative position as human-readable text.
 * Examples: "3 tiles east", "adjacent north", "2 tiles southwest"
 * Note: This is a local copy for stateToPrompt. The canonical export is from decision-context.ts.
 */
function formatRelativePosition(dx: number, dy: number): string {
  const distance = getChebyshevDistance(dx, dy);
  const direction = getRelativeDirection(dx, dy);

  if (!direction) return 'here';
  if (distance === 1) return `adjacent ${direction}`;
  return `${distance} tiles ${direction}`;
}

// --- Action Analysis for AI Prompts ---

/** All 8 movement directions */
const DIRECTIONS: Direction[] = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest'
];

/** Direction to coordinate delta mapping (local copy for use in stateToPrompt) */
const DIRECTION_DELTAS: Record<Direction, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};

/**
 * Convert direction + distance to absolute position.
 * Inverse of formatRelativePosition - used for ranged targeting.
 *
 * @param from - Starting position
 * @param direction - Direction (north, northeast, etc.)
 * @param distance - Number of tiles
 * @returns Target position
 */
export function deltaToPosition(
  from: { x: number; y: number },
  direction: Direction,
  distance: number
): { x: number; y: number } {
  const [dx, dy] = DIRECTION_DELTAS[direction];
  return {
    x: from.x + dx * distance,
    y: from.y + dy * distance,
  };
}

/** Analysis of a tile in a specific direction from an entity */
interface TileAnalysis {
  direction: Direction;
  x: number;
  y: number;
  blocked: boolean;
  blockedBy: string | null;  // 'wall', 'Goblin', etc.
  hasMonster: Entity | null;
  hasItem: boolean;
}

/**
 * Analyze a tile in a specific direction from a position.
 * Returns information about what's there and whether movement is blocked.
 * Note: This is a local copy for stateToPrompt. The canonical export is from decision-context.ts.
 */
function analyzeTile(
  state: GameState,
  fromX: number,
  fromY: number,
  direction: Direction
): TileAnalysis {
  const [dx, dy] = DIRECTION_DELTAS[direction];
  const x = fromX + dx;
  const y = fromY + dy;

  const { map } = getCurrentArea(state);

  // Check bounds
  if (!isValidPosition(x, y, map.width, map.height)) {
    return { direction, x, y, blocked: true, blockedBy: 'edge', hasMonster: null, hasItem: false };
  }

  // Check tile type
  const tile = map.tiles[y][x];
  if (tile.type === 'wall') {
    return { direction, x, y, blocked: true, blockedBy: 'wall', hasMonster: null, hasItem: false };
  }
  if (tile.type === 'door' && !tile.open) {
    return { direction, x, y, blocked: true, blockedBy: 'closed door', hasMonster: null, hasItem: false };
  }

  // Check for monsters
  const monsters = getMonsters(state);
  const monsterAtTile = monsters.find(m => m.x === x && m.y === y);
  if (monsterAtTile) {
    return {
      direction, x, y,
      blocked: true,
      blockedBy: monsterAtTile.name,
      hasMonster: monsterAtTile,
      hasItem: false
    };
  }

  // Check for items
  const hasItem = state.items.some(item => item.x === x && item.y === y);

  return { direction, x, y, blocked: false, blockedBy: null, hasMonster: null, hasItem };
}

/**
 * Analyze all 8 directions from an entity's position.
 */
function analyzeAllDirections(state: GameState, entity: Entity): TileAnalysis[] {
  return DIRECTIONS.map(dir => analyzeTile(state, entity.x, entity.y, dir));
}

/**
 * Estimate combat outcome between two entities.
 * Note: This is a local copy for stateToPrompt. The canonical export is from decision-context.ts.
 */
function estimateCombat(attacker: Entity, defender: Entity): {
  damageDealt: number;
  hitsToKill: number;
  damageReceived: number;
  hitsToSurvive: number;
} {
  // Damage = attack - defense (minimum 1)
  const damageDealt = Math.max(1, attacker.attack - defender.defense);
  const damageReceived = Math.max(1, defender.attack - attacker.defense);

  const hitsToKill = Math.ceil(defender.hp / damageDealt);
  const hitsToSurvive = Math.ceil(attacker.hp / damageReceived);

  return { damageDealt, hitsToKill, damageReceived, hitsToSurvive };
}

// --- Ranged Weapon Info Types ---

interface RangedWeaponInfo {
  weaponName: string;
  range: number;
  rangedType: 'bow' | 'thrown';
  ammoCount?: number;
  ammoCapacity?: number;
  quantity?: number;
}

interface ValidTarget {
  monster: Entity;
  distance: number;
  direction: Direction;
}

/**
 * Get ranged weapon info from entity's equipped weapon.
 * Returns null if no ranged weapon is equipped.
 */
function getRangedWeaponInfo(entity: Entity): RangedWeaponInfo | null {
  if (!entity.equippedWeapon) return null;

  const template = getItemTemplate(entity.equippedWeapon.templateId);
  if (!template || template.type !== 'equipment' || !template.range) return null;

  // Log warning if rangedType is missing - indicates template misconfiguration
  if (!template.rangedType) {
    logger.warn(
      { templateId: entity.equippedWeapon.templateId, hasRange: !!template.range },
      'Ranged weapon template missing rangedType - defaulting to thrown'
    );
  }

  const info: RangedWeaponInfo = {
    weaponName: template.name,
    range: template.range,
    rangedType: template.rangedType ?? 'thrown',
  };

  if (template.rangedType === 'bow') {
    // Bows need a quiver - check offhand
    if (entity.equippedOffhand) {
      const quiverTemplate = getItemTemplate(entity.equippedOffhand.templateId);
      if (quiverTemplate && quiverTemplate.type === 'equipment' && quiverTemplate.capacity) {
        // Use instance-level currentAmmo if available, otherwise template default
        info.ammoCount = entity.equippedOffhand.currentAmmo ?? quiverTemplate.currentAmmo ?? 0;
        info.ammoCapacity = quiverTemplate.capacity;
      }
    }
  } else if (template.rangedType === 'thrown') {
    // Thrown weapons track quantity on the equipped item
    info.quantity = entity.equippedWeapon.quantity ?? template.quantity ?? 1;
  }

  return info;
}

/**
 * Check if entity can make ranged attacks (has ranged weapon and ammo).
 */
function canMakeRangedAttack(entity: Entity): boolean {
  const info = getRangedWeaponInfo(entity);
  if (!info) return false;

  if (info.rangedType === 'bow') {
    // Bows need at least 1 arrow
    return (info.ammoCount ?? 0) > 0;
  } else {
    // Thrown weapons need at least 1 remaining
    return (info.quantity ?? 0) > 0;
  }
}

/**
 * Get valid ranged attack targets - visible monsters within range with clear LOS.
 */
function getValidRangedTargets(
  state: GameState,
  entity: Entity,
  visibleMonsters: Entity[],
  rangedInfo: RangedWeaponInfo
): ValidTarget[] {
  const { map } = getCurrentArea(state);
  const targets: ValidTarget[] = [];

  for (const monster of visibleMonsters) {
    const dx = monster.x - entity.x;
    const dy = monster.y - entity.y;
    const distance = getChebyshevDistance(dx, dy);

    // Must be within range
    if (distance > rangedInfo.range) continue;

    // Must have clear line of sight
    if (!hasLineOfSight(map, entity.x, entity.y, monster.x, monster.y)) continue;

    // Get direction for the target
    const direction = getRelativeDirection(dx, dy);
    if (!direction) continue;

    targets.push({ monster, distance, direction });
  }

  return targets;
}

/**
 * Generate the RANGED WEAPON section for AI prompt.
 */
function generateRangedWeaponSection(entity: Entity, validTargets: ValidTarget[]): string {
  const info = getRangedWeaponInfo(entity);
  if (!info) return '';

  const lines: string[] = ['RANGED WEAPON:'];

  if (info.rangedType === 'bow') {
    lines.push(`- ${info.weaponName} (range: ${info.range})`);
    if (info.ammoCount !== undefined && info.ammoCapacity !== undefined) {
      lines.push(`- Quiver: ${info.ammoCount}/${info.ammoCapacity} arrows`);
    } else {
      lines.push('- No quiver equipped (cannot shoot)');
    }
  } else {
    // Thrown weapon
    lines.push(`- ${info.weaponName} x${info.quantity ?? 1} (range: ${info.range})`);
  }

  // List valid targets
  if (validTargets.length > 0) {
    const targetStrs = validTargets.map(t =>
      `${t.monster.name} (${t.distance} tiles ${t.direction})`
    );
    lines.push(`- Valid targets: ${targetStrs.join(', ')}`);
  } else {
    lines.push('- Valid targets: none in range');
  }

  return lines.join('\n');
}

/**
 * Generate the AVAILABLE ACTIONS section for AI prompt.
 */
function generateAvailableActions(
  state: GameState,
  entity: Entity,
  analyses: TileAnalysis[],
  explorationValues?: Map<Direction, number>,
  validRangedTargets?: ValidTarget[]
): string {
  const lines: string[] = [];

  // Get exploration recommendation if we have exploration values
  const recommendation = explorationValues
    ? getExplorationRecommendation(explorationValues)
    : null;

  // Movement actions
  for (const analysis of analyses) {
    if (analysis.blocked) {
      lines.push(`- move ${analysis.direction}: BLOCKED (${analysis.blockedBy})`);
    } else {
      const extras: string[] = [];
      if (analysis.hasItem) {
        // Find the actual item to give a specific hint
        const item = state.items.find(i => i.x === analysis.x && i.y === analysis.y);
        if (item) {
          const template = getItemTemplate(item.templateId);
          extras.push(`has ${template?.name ?? 'item'} - move here to pick it up`);
        } else {
          extras.push('has item - move here to pick it up');
        }
      }

      // Build exploration info string if we have exploration values
      let explorationStr = '';
      if (explorationValues) {
        const explorationValue = explorationValues.get(analysis.direction) ?? 0;
        const isBest = recommendation?.type === 'explore' &&
                       recommendation.bestDirection === analysis.direction;

        if (explorationValue === 0) {
          explorationStr = 'exploration: 0 - fully explored';
        } else if (isBest) {
          explorationStr = `exploration: ${explorationValue} - best`;
        } else {
          explorationStr = `exploration: ${explorationValue}`;
        }
      }

      // Build the final line
      let suffix = '';
      if (extras.length > 0 && explorationStr) {
        suffix = ` - ${extras.join(', ')} (${explorationStr})`;
      } else if (extras.length > 0) {
        suffix = ` - ${extras.join(', ')}`;
      } else if (explorationStr) {
        suffix = ` (${explorationStr})`;
      }
      lines.push(`- move ${analysis.direction}: clear${suffix}`);
    }
  }

  // Attack actions (only adjacent monsters)
  const adjacentMonsters = analyses.filter(a => a.hasMonster);
  for (const analysis of adjacentMonsters) {
    const monster = analysis.hasMonster!;
    const combat = estimateCombat(entity, monster);
    lines.push(
      `- attack ${analysis.direction}: ${monster.name} (${monster.hp} HP) - ` +
      `you deal ~${combat.damageDealt} damage, kill in ${combat.hitsToKill} hit${combat.hitsToKill !== 1 ? 's' : ''}`
    );
  }

  // Pickup action - check if there's an item at entity's position
  const itemHere = getItemAtPosition(state.items, entity.x, entity.y, entity.areaId);
  if (itemHere) {
    const template = getItemTemplate(itemHere.templateId);
    const itemName = template?.name ?? 'Unknown Item';
    let itemInfo = '';
    if (template?.type === 'equipment') {
      const modifier = template.effect.modifiers[0];
      if (modifier) {
        itemInfo = ` (${template.slot}, +${modifier.delta} ${modifier.stat})`;
      }
    }
    lines.push(`- pickup: ${itemName}${itemInfo}`);
  }

  // Equip actions - show unequipped equipment in inventory
  const inventory = entity.inventory ?? [];
  for (const item of inventory) {
    const template = getItemTemplate(item.templateId);
    if (template?.type === 'equipment') {
      const currentlyEquipped =
        template.slot === 'weapon' ? entity.equippedWeapon :
        template.slot === 'armor' ? entity.equippedArmor :
        entity.equippedOffhand;
      const currentName = currentlyEquipped
        ? getItemTemplate(currentlyEquipped.templateId)?.name ?? 'Unknown'
        : 'nothing';
      const bonus = template.effect.modifiers[0];
      const bonusStr = bonus ? `+${bonus.delta} ${bonus.stat}` : '';
      lines.push(`- equip ${item.templateId}: ${template.name} (${bonusStr}) - replaces ${currentName}`);
    }
  }

  // Enter portal action - check if standing on a portal tile
  const { map } = getCurrentArea(state);
  const tile = map.tiles[entity.y]?.[entity.x];
  if (tile?.type === 'portal' && tile.connection) {
    const directionHint = tile.direction === 'up' ? 'up' : tile.direction === 'down' ? 'down' : '';
    const targetArea = state.zone.areas[tile.connection.targetAreaId];
    const areaName = targetArea?.metadata.name ?? tile.connection.targetAreaId;
    lines.push(`- enter_portal: Use portal leading ${directionHint} to ${areaName}`);
  }

  // Ranged attack action - show when entity has ranged weapon and valid targets
  if (validRangedTargets && validRangedTargets.length > 0 && canMakeRangedAttack(entity)) {
    const targetList = validRangedTargets
      .map(t => `${t.monster.name} (${t.direction} ${t.distance})`)
      .join(', ');
    lines.push(`- ranged_attack <direction> <distance>: Shoot at ${targetList}`);
  }

  lines.push('- wait: skip turn');

  return lines.join('\n');
}

/**
 * Generate the TACTICAL SITUATION section for AI prompt.
 */
function generateTacticalSituation(
  state: GameState,
  entity: Entity,
  analyses: TileAnalysis[],
  visibleTiles: Set<TileKey>,
  explorationValues?: Map<Direction, number>
): string {
  const lines: string[] = [];

  // Adjacent threats
  const adjacentMonsters = analyses.filter(a => a.hasMonster);
  if (adjacentMonsters.length > 0) {
    const threats = adjacentMonsters.map(a => {
      const monster = a.hasMonster!;
      const combat = estimateCombat(monster, entity);
      return `${monster.name} (${a.direction}) - ~${combat.damageDealt} damage/hit`;
    });
    lines.push(`- Adjacent threats: ${threats.join('; ')}`);
  } else {
    lines.push('- Adjacent threats: none');
  }

  // Escape routes
  const clearDirections = analyses.filter(a => !a.blocked).length;
  lines.push(`- Escape routes: ${clearDirections} direction${clearDirections !== 1 ? 's' : ''} clear`);

  // Health status
  const healthPercent = (entity.hp / entity.maxHp) * 100;
  if (healthPercent <= 30) {
    lines.push('- Health: CRITICAL - consider retreating');
  } else if (healthPercent <= 50) {
    lines.push('- Health: LOW - fight carefully');
  }

  // Adjacent items - items you can pick up in one move
  const adjacentItems = analyses.filter(a => a.hasItem && !a.blocked);
  if (adjacentItems.length > 0) {
    const itemDescs = adjacentItems.map(a => {
      const item = state.items.find(i => i.x === a.x && i.y === a.y);
      if (item) {
        const template = getItemTemplate(item.templateId);
        return `${template?.name ?? 'Item'} (${a.direction})`;
      }
      return `Item (${a.direction})`;
    });
    lines.push(`- Adjacent items: ${itemDescs.join('; ')} - move there to pick up`);
  }

  // Nearby items - visible items not adjacent
  const nearbyItems = state.items.filter(item => {
    // Must be visible
    if (!visibleTiles.has(tileKey(item.x, item.y))) return false;
    const dx = item.x - entity.x;
    const dy = item.y - entity.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance
    // Not adjacent (distance > 1) but within visible range
    return distance > 1;
  });
  if (nearbyItems.length > 0 && adjacentMonsters.length === 0) {
    const itemDescs = nearbyItems.slice(0, 3).map(item => {
      const template = getItemTemplate(item.templateId);
      const dx = item.x - entity.x;
      const dy = item.y - entity.y;
      const relPos = formatRelativePosition(dx, dy);
      return `${template?.name ?? 'Item'} (${relPos})`;
    });
    lines.push(`- Nearby items: ${itemDescs.join('; ')}`);
  }

  // Simple recommendation
  if (adjacentMonsters.length > 0 && healthPercent > 30) {
    // Check for kill shot opportunity
    const killShot = adjacentMonsters.find(a => {
      const monster = a.hasMonster!;
      const combat = estimateCombat(entity, monster);
      return monster.hp <= combat.damageDealt;
    });
    if (killShot) {
      lines.push(`- Recommendation: Kill ${killShot.hasMonster!.name} (${killShot.direction}) - one hit kill`);
    } else {
      lines.push('- Recommendation: Attack adjacent enemy');
    }
  } else if (adjacentMonsters.length > 0 && healthPercent <= 30) {
    lines.push('- Recommendation: Retreat to safety if possible');
  } else if (adjacentItems.length > 0) {
    // No enemies adjacent but items are - prioritize picking them up
    const firstItem = adjacentItems[0];
    const item = state.items.find(i => i.x === firstItem.x && i.y === firstItem.y);
    const template = item ? getItemTemplate(item.templateId) : null;
    lines.push(`- Recommendation: Move ${firstItem.direction} to pick up ${template?.name ?? 'item'}`);
  } else if (nearbyItems.length > 0 && adjacentMonsters.length === 0) {
    // No enemies adjacent, but there are nearby items worth getting
    const nearestItem = nearbyItems[0];
    const template = getItemTemplate(nearestItem.templateId);
    const dx = nearestItem.x - entity.x;
    const dy = nearestItem.y - entity.y;
    const relPos = formatRelativePosition(dx, dy);
    lines.push(`- Recommendation: Move toward ${template?.name ?? 'item'} (${relPos})`);
  } else {
    const monsters = getMonsters(state);
    if (monsters.length > 0) {
      lines.push('- Recommendation: Move toward nearest enemy');
    } else {
      lines.push('- Recommendation: All enemies defeated - explore for items or exit');
    }
  }

  // Exploration guidance (when no adjacent enemies)
  if (adjacentMonsters.length === 0 && explorationValues) {
    const recommendation = getExplorationRecommendation(explorationValues);

    if (recommendation.type === 'fully_explored') {
      lines.push('- Exploration: All areas explored');
    } else {
      lines.push(
        `- Exploration: ${recommendation.bestDirection} has most unexplored territory ` +
        `(${recommendation.bestValue} tiles reachable)`
      );

      if (recommendation.fullyExploredDirections.length > 0) {
        lines.push(
          `- Dead ends: ${recommendation.fullyExploredDirections.join(', ')} (fully explored)`
        );
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format objectives section for AI prompt.
 * Shows only active objectives relevant to the specified crawler.
 *
 * When no active objectives exist, provides fallback exploration guidance.
 * When only primary objectives remain, suggests exploration as implicit secondary goal.
 *
 * @param objectives - All objectives in the game state
 * @param crawlerId - The crawler to filter objectives for
 * @returns Formatted OBJECTIVES section for AI prompt
 */
function formatObjectivesForPrompt(
  objectives: readonly Objective[],
  crawlerId: CrawlerId
): string {
  const relevant = objectives.filter(
    (o) => o.status === 'active' && isObjectiveRelevantToCrawler(o, crawlerId)
  );

  if (relevant.length === 0) {
    return 'OBJECTIVES:\n\nNo active objectives. Explore unexplored areas or assist other crawlers.';
  }

  const primary = relevant.filter((o) => o.priority === 'primary');
  const secondary = relevant.filter((o) => o.priority === 'secondary');

  const lines = [
    'OBJECTIVES:',
    '',
    ...primary.map((o) => `- [PRIMARY] ${o.description}`),
    ...secondary.map((o) => `- [SECONDARY] ${o.description}`),
  ];

  if (secondary.length === 0 && primary.length > 0) {
    lines.push('', 'No secondary objectives. Explore unexplored areas or assist other crawlers.');
  }

  return lines.join('\n');
}

/**
 * Generate a text prompt describing the game state for an AI agent.
 *
 * When crawlerId is provided, includes:
 * - TURN INFO section showing whose turn it is
 * - OTHER CRAWLERS section (if multiple crawlers exist)
 *
 * @param state - The current game state
 * @param crawlerId - Optional ID of the crawler requesting the prompt (for turn info perspective)
 * @param options - Optional settings for prompt generation
 * @param options.isYourTurn - Override turn detection (use when caller knows it's this crawler's turn)
 * @returns A formatted text description of the game state
 */
export function stateToPrompt(
  state: GameState,
  crawlerId?: string,
  options?: { isYourTurn?: boolean }
): string {
  // Determine which entity is the viewer
  // If crawlerId provided, use it; otherwise fall back to first crawler
  const crawlers = getCrawlers(state);
  const viewer = crawlerId ? state.entities[crawlerId] : crawlers[0];
  const monsters = getMonsters(state);

  if (!viewer) {
    throw new Error('No crawler entity found in state');
  }

  // Use 'player' as variable name for the viewing entity (backward compat)
  const player = viewer;

  const { map } = getCurrentArea(state);

  // Validate positions before building map
  validatePosition(
    player.x,
    player.y,
    map.width,
    map.height,
    player.id
  );
  for (const monster of monsters) {
    validatePosition(monster.x, monster.y, map.width, map.height, monster.id);
  }

  // Compute visible tiles for the viewer using FOV
  const visibleTiles = computeVisibleTiles(
    map,
    player.x,
    player.y,
    getEffectiveVisionRadius(player)
  );

  // Get explored tiles for the current area (shared by all crawlers)
  const exploredArray = state.exploredTiles?.[state.currentAreaId];
  if (exploredArray === undefined && state.gameStatus.status === 'playing') {
    logger.debug(
      { areaId: state.currentAreaId, turn: state.turn },
      'No explored tiles found for area'
    );
  }
  // Cast to TileKey since these strings come from tileKey() calls and are validated by schema
  const exploredTiles = new Set(exploredArray ?? []) as Set<TileKey>;

  // Combine visible and explored tiles - visible tiles are always considered explored
  const allExplored = new Set<TileKey>([...exploredTiles, ...visibleTiles]);

  // Build ASCII map from tiles with visibility filtering
  const mapChars: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    mapChars[y] = [];
    for (let x = 0; x < map.width; x++) {
      const key = tileKey(x, y);
      const tile = map.tiles[y][x];
      if (visibleTiles.has(key)) {
        // Currently visible: show full detail
        mapChars[y][x] = getTileChar(tile);
      } else if (allExplored.has(key)) {
        // Explored but not visible: show tile (same as visible for ASCII text)
        mapChars[y][x] = getTileChar(tile);
      } else {
        // Unexplored: show blank
        mapChars[y][x] = ' ';
      }
    }
  }

  // Filter items to only visible ones
  const visibleItems = state.items.filter(item => visibleTiles.has(tileKey(item.x, item.y)));

  // Place visible items on map (before entities, so entities appear on top)
  for (const item of visibleItems) {
    const template = getItemTemplate(item.templateId);
    // Use placeholder '?' for unknown templates
    mapChars[item.y][item.x] = template ? template.appearance.char : '?';
  }

  // Filter monsters to only visible ones and place them on map
  const visibleMonsters = monsters.filter(m => isEntityVisible(m, visibleTiles));
  for (const monster of visibleMonsters) {
    const { char } = getEntityAppearance(monster);
    mapChars[monster.y][monster.x] = char;
  }
  const { char: playerChar } = getEntityAppearance(player);
  mapChars[player.y][player.x] = playerChar;

  const mapStr = mapChars.map((row) => row.join('')).join('\n');

  // Monster list only includes visible monsters
  const monstersStr = visibleMonsters
    .map((m) => {
      const dx = m.x - player.x;
      const dy = m.y - player.y;
      const relPos = formatRelativePosition(dx, dy);
      const effectsStr = (m.activeEffects ?? []).length > 0
        ? ` [${(m.activeEffects ?? []).map(e => `${e.name}: ${e.duration} turns`).join(', ')}]`
        : '';
      return `- ${m.name} (${relPos}), HP: ${m.hp}/${m.maxHp}, ATK: ${m.attack}, DEF: ${m.defense}, SPD: ${m.speed}${effectsStr}`;
    })
    .join('\n');

  // Item list only includes visible items
  const itemsStr = visibleItems
    .map(item => {
      const template = getItemTemplate(item.templateId);
      const dx = item.x - player.x;
      const dy = item.y - player.y;
      const relPos = formatRelativePosition(dx, dy);
      return template
        ? `- ${template.name} (${relPos})`
        : `- Unknown item (${relPos})`;
    })
    .join('\n');

  const recentMessages = state.messages
    .slice(-5)
    .map((m) => m.text)
    .join('\n- ');

  // Filter recent messages for this crawler's actions (for targeted feedback)
  // Messages typically start with the actor's name, e.g., "Thornhelm swings at empty air."
  const crawlerName = player.name;
  const yourRecentActions = state.messages
    .filter((m) => m.text.startsWith(crawlerName))
    .slice(-3)
    .map((m) => m.text)
    .join('\n- ');

  let statusStr: string;
  if (state.gameStatus.status === 'playing') {
    statusStr = 'In Progress';
  } else if (state.gameStatus.victory) {
    statusStr = 'Victory';
  } else {
    statusStr = 'Defeat';
  }

  // Get turn info if crawlerId is provided and we have bubbles
  let turnInfo = '';
  if (crawlerId && state.bubbles.length > 0) {
    // Find the bubble containing this crawler
    const viewerBubble = state.bubbles.find(b =>
      b.entityIds.some(id => id === crawlerId)
    );
    if (viewerBubble) {
      // Use explicit isYourTurn if provided, otherwise infer from scheduler
      // Note: scheduler.currentActorId may be stale when waiting for input,
      // so callers should pass isYourTurn: true when they know it's this crawler's turn
      const isYourTurn = options?.isYourTurn ?? viewerBubble.scheduler.currentActorId === crawlerId;
      turnInfo = `
TURN INFO:
- Your turn: ${isYourTurn ? 'Yes' : 'No'}
`;
    }
  }

  // Generate character info section for AI personality
  let characterSection = '';
  if (player.characterClass) {
    const personality = getPersonalityDescription(player.characterClass);
    const title = formatCharacterTitle(player.name, player.characterClass);
    const bioLine = player.bio ? `\n- Backstory: ${player.bio}` : '';
    characterSection = `
YOUR CHARACTER:
- Name: ${title}
- Class: ${player.characterClass}
- Personality: ${personality}${bioLine}
`;
  }

  // Get other crawlers info (only if crawlerId is provided)
  let otherCrawlersSection = '';
  if (crawlerId) {
    const otherCrawlers = crawlers.filter(c => c.id !== viewer.id);
    if (otherCrawlers.length > 0) {
      const crawlerList = otherCrawlers.map(c => {
        const dx = c.x - player.x;
        const dy = c.y - player.y;
        const relPos = formatRelativePosition(dx, dy);
        return `- ${c.name} (${c.id}, ${relPos}), HP: ${c.hp}/${c.maxHp}`;
      }).join('\n');
      otherCrawlersSection = `
OTHER CRAWLERS:
${crawlerList}
`;
    }
  }

  // Analyze available actions for AI decision-making
  const analyses = analyzeAllDirections(state, player);

  // Compute exploration values for AI guidance
  const explorationValues = computeExplorationValues(
    map,
    { x: player.x, y: player.y },
    visibleTiles,
    allExplored
  );

  // Get ranged weapon info and valid targets
  const rangedInfo = getRangedWeaponInfo(player);
  const validRangedTargets = rangedInfo
    ? getValidRangedTargets(state, player, visibleMonsters, rangedInfo)
    : [];

  // Generate ranged weapon section if player has ranged weapon
  let rangedWeaponSection = '';
  if (rangedInfo) {
    rangedWeaponSection = `
${generateRangedWeaponSection(player, validRangedTargets)}
`;
  }

  const availableActionsStr = generateAvailableActions(state, player, analyses, explorationValues, validRangedTargets);
  const tacticalStr = generateTacticalSituation(state, player, analyses, visibleTiles, explorationValues);

  // Generate objectives section if crawlerId is provided
  let objectivesSection = '';
  if (crawlerId) {
    objectivesSection = `
${formatObjectivesForPrompt(state.objectives, crawlerId as CrawlerId)}
`;
  }

  // Inventory section
  const inventoryLines: string[] = [];
  const inventory = player.inventory ?? [];

  if (inventory.length === 0 && !player.equippedWeapon && !player.equippedArmor) {
    inventoryLines.push('Empty');
  } else {
    if (player.equippedWeapon) {
      const template = getItemTemplate(player.equippedWeapon.templateId);
      const bonus = template?.effect.modifiers[0];
      inventoryLines.push(`Weapon: ${template?.name ?? 'Unknown'} (+${bonus?.delta ?? 0} ${bonus?.stat ?? 'attack'})`);
    } else {
      inventoryLines.push('Weapon: none');
    }

    if (player.equippedArmor) {
      const template = getItemTemplate(player.equippedArmor.templateId);
      const bonus = template?.effect.modifiers[0];
      inventoryLines.push(`Armor: ${template?.name ?? 'Unknown'} (+${bonus?.delta ?? 0} ${bonus?.stat ?? 'defense'})`);
    } else {
      inventoryLines.push('Armor: none');
    }

    if (inventory.length > 0) {
      inventoryLines.push(`Bag (${inventory.length}/${MAX_INVENTORY_SIZE}):`);
      for (const item of inventory) {
        const template = getItemTemplate(item.templateId);
        inventoryLines.push(`  - ${template?.name ?? 'Unknown'} (${item.templateId})`);
      }
    }
  }

  const inventorySection = inventoryLines.join('\n');

  // Active effects for YOUR STATUS display
  const playerEffects = player.activeEffects ?? [];
  const playerEffectsStr = playerEffects.length > 0
    ? `\n- Active Effects: ${playerEffects.map(e => `${e.name} (${e.duration} turns)`).join(', ')}`
    : '';

  // Contextual effects reference — only when effects are active on player or visible monsters
  const allRelevantEffects = [
    ...playerEffects,
    ...visibleMonsters.flatMap(m => m.activeEffects ?? []),
  ];
  const EFFECT_DESCRIPTIONS: Record<string, string> = {
    Poisoned: 'damage each turn. Use health potion to survive.',
    Burning: 'fire damage each turn. Use health potion to survive.',
    Regenerating: 'healing each turn.',
    Slowed: 'fewer actions per turn. Enemies can outrun you.',
    Weakened: 'reduced attack damage.',
    Blinded: 'reduced vision range.',
    Blessed: 'improved combat stats.',
    Stunned: 'skip next action. Cannot act.',
    Feared: 'forced to move away from source.',
    Taunted: 'forced to target the taunter.',
    Invisible: 'hidden from enemies. Breaks on attack.',
  };
  let effectsReferenceSection = '';
  if (allRelevantEffects.length > 0) {
    const uniqueNames = [...new Set(allRelevantEffects.map(e => e.name))];
    const refLines = uniqueNames
      .map(name => `  ${name}: ${EFFECT_DESCRIPTIONS[name] ?? 'Unknown effect.'}`)
      .join('\n');
    effectsReferenceSection = `
ACTIVE EFFECTS REFERENCE:
${refLines}
`;
  }

  return `GAME STATE (Turn ${state.turn}):
${turnInfo}${characterSection}
MAP:
${mapStr}

YOUR STATUS:
- Position: (${player.x}, ${player.y})
- HP: ${player.hp}/${player.maxHp}
- Attack: ${player.attack}
- Defense: ${player.defense}
- Speed: ${player.speed}${playerEffectsStr}

MONSTERS:
${monstersStr || 'None'}

ITEMS:
${itemsStr || 'None'}

AVAILABLE ACTIONS:
${availableActionsStr}

TACTICAL SITUATION:
${tacticalStr}
${rangedWeaponSection}${effectsReferenceSection}
INVENTORY:
${inventorySection}
${objectivesSection}${otherCrawlersSection}
GAME STATUS: ${statusStr}

YOUR RECENT ACTIONS:
${yourRecentActions ? `- ${yourRecentActions}` : '(none yet)'}

RECENT EVENTS:
- ${recentMessages}`;
}
