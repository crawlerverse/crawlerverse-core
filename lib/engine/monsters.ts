/**
 * Monster Types and Appearances
 *
 * Defines monster type specifications (stats, level) separately from
 * visual appearance (char, color). This decouples game logic from rendering.
 */

import * as ROT from 'rot-js';
import { createEntity } from './state';
import { DEFAULT_VISION_RADIUS } from './fov';
import { logger } from '../logging';
import type { Entity, MonsterTypeId } from './types';
import type { ItemInstance } from './items';
import { createGuaranteedEquipment } from './monster-equipment';

// Re-export MonsterTypeId for convenience (canonical source is types.ts)
export type { MonsterTypeId } from './types';

// --- Monster Level Type ---

/** Monster difficulty level (1 = easy, higher = harder) */
export type MonsterLevel = number;

/** Configuration for monster type selection */
export interface MonsterSelectionConfig {
  /** Maximum level to include (default: no limit) */
  maxLevel?: number;
  /** Optional weights per level for future use (default: uniform) */
  levelWeights?: Record<number, number>;
}

// --- Monster Type Definitions ---

/** Default behavior type for monsters */
export type DefaultBehavior = 'aggressive' | 'patrol';

/** Stats and metadata for each monster type */
export interface MonsterType {
  readonly level: MonsterLevel;
  readonly baseStats: {
    readonly hp: number;
    readonly attack: number;
    readonly defense: number;
    readonly speed: number;
  };
  readonly name: string;
  /** Vision radius in tiles */
  readonly visionRadius: number;
  /** Turns spent searching before giving up */
  readonly searchDuration: number;
  /** Starting behavior (aggressive = chase, patrol = wander until alerted) */
  readonly defaultBehavior: DefaultBehavior;
  /** Whether this monster type can wield weapons/armor (humanoids only) */
  readonly canHaveEquipment?: boolean;
  /** Optional tags for objective generation: 'boss', 'objective_target' */
  readonly tags?: readonly ('boss' | 'objective_target')[];
}

export const MONSTER_TYPES: Record<MonsterTypeId, MonsterType> = {
  rat: {
    level: 1,
    baseStats: { hp: 3, attack: 1, defense: 0, speed: 120 },
    name: 'Rat',
    visionRadius: 4,
    searchDuration: 3,
    defaultBehavior: 'aggressive',
  },
  goblin: {
    level: 1,
    baseStats: { hp: 5, attack: 2, defense: 0, speed: 100 },
    name: 'Goblin',
    visionRadius: 6,
    searchDuration: 5,
    defaultBehavior: 'aggressive',
    canHaveEquipment: true,
  },
  goblin_archer: {
    level: 1,
    baseStats: { hp: 5, attack: 2, defense: 0, speed: 100 },  // Same as goblin
    name: 'Goblin Archer',
    visionRadius: 6,  // Same as goblin
    searchDuration: 5,
    defaultBehavior: 'aggressive',
    canHaveEquipment: true,
  },
  orc: {
    level: 2,
    baseStats: { hp: 10, attack: 3, defense: 1, speed: 90 },
    name: 'Orc',
    visionRadius: 5,
    searchDuration: 6,
    defaultBehavior: 'aggressive',
    canHaveEquipment: true,
  },
  skeleton: {
    level: 2,
    baseStats: { hp: 8, attack: 2, defense: 2, speed: 100 },
    name: 'Skeleton',
    visionRadius: 8,
    searchDuration: 10,
    defaultBehavior: 'patrol',
    canHaveEquipment: true,
  },
  troll: {
    level: 3,
    baseStats: { hp: 15, attack: 4, defense: 2, speed: 80 },
    name: 'Troll',
    visionRadius: 6,
    searchDuration: 8,
    defaultBehavior: 'aggressive',
    canHaveEquipment: true,
    tags: ['objective_target'],
  },
  bat: {
    level: 1,
    baseStats: { hp: 2, attack: 1, defense: 0, speed: 140 },
    name: 'Bat',
    visionRadius: 5,
    searchDuration: 2,
    defaultBehavior: 'aggressive',
  },
  snake: {
    level: 2,
    baseStats: { hp: 6, attack: 4, defense: 0, speed: 110 },
    name: 'Snake',
    visionRadius: 4,
    searchDuration: 4,
    defaultBehavior: 'patrol',
  },
  minotaur: {
    level: 3,
    baseStats: { hp: 20, attack: 5, defense: 3, speed: 70 },
    name: 'Minotaur',
    visionRadius: 7,
    searchDuration: 12,
    defaultBehavior: 'aggressive',
    canHaveEquipment: true,
  },
  demon: {
    level: 3,
    baseStats: { hp: 12, attack: 6, defense: 1, speed: 100 },
    name: 'Demon',
    visionRadius: 8,
    searchDuration: 10,
    defaultBehavior: 'aggressive',
  },
};

export const MONSTER_TYPE_IDS = Object.keys(MONSTER_TYPES) as MonsterTypeId[];

// --- Monster Appearance (Decoupled from Entity) ---

export interface MonsterAppearance {
  readonly char: string;
  readonly fg: string;
}

export const MONSTER_APPEARANCE: Record<MonsterTypeId, MonsterAppearance> = {
  rat:           { char: 'r', fg: '#8B4513' },  // Brown
  goblin:        { char: 'g', fg: '#00FF00' },  // Green
  goblin_archer: { char: 'g', fg: '#32CD32' },  // Lime green
  orc:           { char: 'o', fg: '#228B22' },  // Forest green
  skeleton: { char: 's', fg: '#FFFFFF' },  // White/bone
  troll:    { char: 'T', fg: '#2E8B57' },  // Sea green, uppercase for size
  bat:      { char: 'b', fg: '#8B008B' },  // Dark magenta
  snake:    { char: 'S', fg: '#228B22' },  // Forest green
  minotaur: { char: 'M', fg: '#8B4513' },  // Brown
  demon:    { char: 'D', fg: '#DC143C' },  // Crimson
};

export function getMonsterAppearance(monsterTypeId: MonsterTypeId): MonsterAppearance {
  return MONSTER_APPEARANCE[monsterTypeId];
}

// --- Entity Appearance Helper ---

const CRAWLER_DEFAULT_APPEARANCE = { char: '@', fg: '#FFFF00' };
const INVALID_MONSTER_APPEARANCE = { char: '?', fg: '#FF0000' };

/**
 * Get the display appearance for any entity.
 * Monsters use the MONSTER_APPEARANCE lookup by monsterTypeId.
 * Crawlers use their char field with a default yellow color.
 *
 * @param entity - The entity to get appearance for
 * @returns Object with char and fg color for rendering
 */
export function getEntityAppearance(entity: Entity): { char: string; fg: string } {
  // Handle monsters - require monsterTypeId for proper appearance
  if (entity.type === 'monster') {
    if (!entity.monsterTypeId) {
      // This should never happen with schema validation, but log if it does
      logger.error(
        { entityId: entity.id, entityType: entity.type },
        'Monster entity missing monsterTypeId - data integrity issue'
      );
      return INVALID_MONSTER_APPEARANCE;
    }
    return getMonsterAppearance(entity.monsterTypeId);
  }

  // Handle crawlers - use char field with default color
  if (!entity.char) {
    logger.warn(
      { entityId: entity.id },
      'Crawler entity missing char field, using default'
    );
  }
  return {
    char: entity.char ?? CRAWLER_DEFAULT_APPEARANCE.char,
    fg: CRAWLER_DEFAULT_APPEARANCE.fg,
  };
}

// --- Perception Helpers ---

/**
 * Get the vision radius for an entity.
 *
 * Named for its general use case across all entity types:
 * - Monsters use their type's visionRadius from MONSTER_TYPES
 * - Crawlers and other entities use DEFAULT_VISION_RADIUS
 */
export function getEntityVisionRadius(entity: Entity): number {
  // Check entity-level override first (allows per-instance customization)
  if (entity.visionRadius !== undefined) {
    return entity.visionRadius;
  }
  // Fall back to monster type's vision radius
  const monsterType = entity.monsterTypeId ? MONSTER_TYPES[entity.monsterTypeId] : undefined;
  return monsterType?.visionRadius ?? DEFAULT_VISION_RADIUS;
}

/**
 * Get the search duration for a monster type.
 * Returns the number of turns a monster will search before giving up.
 */
export function getSearchDuration(monsterTypeId: MonsterTypeId): number {
  return MONSTER_TYPES[monsterTypeId].searchDuration;
}

// --- Monster Factory ---

/** Options for creating a monster entity */
export interface CreateMonsterOptions {
  /** Custom ID suffix (e.g., 'boss') instead of auto-incrementing number */
  idSuffix?: string;
  /** Weapon to equip (applies attack bonus via getEffectiveAttack) */
  equippedWeapon?: ItemInstance;
  /** Armor to equip (applies defense bonus via getEffectiveDefense) */
  equippedArmor?: ItemInstance;
  /** Area ID where this monster is located */
  areaId?: string;
}

let monsterCounter = 0;

/**
 * Reset the monster ID counter.
 * Useful for tests to ensure deterministic IDs.
 */
export function resetMonsterCounter(): void {
  monsterCounter = 0;
}

/**
 * Create a monster entity from a type definition.
 *
 * @param monsterTypeId - The type of monster to create (must be valid MonsterTypeId)
 * @param position - The spawn position { x, y }
 * @param bounds - Map bounds for position validation { width, height }
 * @param options - Optional configuration (id suffix, equipment, areaId)
 * @returns A new Entity with stats from the monster type definition
 * @throws Error if monsterTypeId is invalid or position is out of bounds
 */
export function createMonster(
  monsterTypeId: MonsterTypeId,
  position: { x: number; y: number },
  bounds: { width: number; height: number },
  options?: CreateMonsterOptions
): Entity {
  const monsterType = MONSTER_TYPES[monsterTypeId];

  // Runtime validation for invalid monsterTypeId (e.g., from deserialized JSON)
  if (!monsterType) {
    throw new Error(
      `createMonster: Unknown monster type "${monsterTypeId}". ` +
      `Valid types are: ${MONSTER_TYPE_IDS.join(', ')}.`
    );
  }

  const id = options?.idSuffix
    ? `${monsterTypeId}-${options.idSuffix}`
    : `${monsterTypeId}-${monsterCounter++}`;

  const areaId = options?.areaId ?? 'area-1';  // Default to 'area-1' for backwards compatibility

  // Get guaranteed equipment for this monster type (e.g., goblin_archer gets shortbow + quiver)
  const guaranteedEquipment = createGuaranteedEquipment(monsterTypeId, id, areaId);

  // Map defaultBehavior to initial behaviorState
  // 'aggressive' -> 'chase' (immediately pursue player)
  // 'patrol' -> 'patrol' (wander until alerted)
  const initialBehaviorState = monsterType.defaultBehavior === 'patrol' ? 'patrol' : 'chase';

  // Determine final equipment: guaranteed equipment takes priority, then options, then null
  const equippedWeapon = guaranteedEquipment.weapon ?? options?.equippedWeapon ?? null;
  const equippedArmor = options?.equippedArmor ?? null;
  const equippedOffhand = guaranteedEquipment.offhand ?? null;

  return createEntity(
    {
      id,
      type: 'monster',
      x: position.x,
      y: position.y,
      areaId,
      hp: monsterType.baseStats.hp,
      maxHp: monsterType.baseStats.hp,
      name: monsterType.name,
      attack: monsterType.baseStats.attack,
      defense: monsterType.baseStats.defense,
      speed: monsterType.baseStats.speed,
      monsterTypeId,
      behaviorState: initialBehaviorState,
      equippedWeapon,
      equippedArmor,
      equippedOffhand,
    },
    bounds
  );
}

/**
 * Select a random monster type appropriate for the given danger level.
 * Only monsters with level <= dangerLevel are eligible.
 *
 * @param rng - rot.js RNG instance (seeded for determinism)
 * @param dangerLevel - Area danger level (1+). Higher = harder monsters eligible.
 * @returns A randomly selected MonsterTypeId from eligible types
 * @throws Error if dangerLevel < 1 or no monster types defined
 */
export function selectRandomMonsterType(
  rng: typeof ROT.RNG,
  dangerLevel: number
): MonsterTypeId {
  if (dangerLevel < 1) {
    throw new Error(
      `selectRandomMonsterType: dangerLevel must be >= 1, got ${dangerLevel}`
    );
  }

  const eligible = MONSTER_TYPE_IDS.filter(
    (id) => MONSTER_TYPES[id].level <= dangerLevel
  );

  if (eligible.length === 0) {
    throw new Error(
      'selectRandomMonsterType: No monster types defined. ' +
      'MONSTER_TYPE_IDS array is empty. This is a configuration error.'
    );
  }

  const index = Math.floor(rng.getUniform() * eligible.length);
  return eligible[index];
}
