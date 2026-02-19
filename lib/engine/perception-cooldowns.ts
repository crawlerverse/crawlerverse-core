/**
 * Perception Cooldowns
 *
 * Prevents perception spam by tracking recently emitted perceptions.
 */

import type { HealthBand, Perception } from './perception-types';
import type { EntityId } from './scheduler';

// --- Cooldown Configuration ---

export const COOLDOWN_TURNS = {
  enemyHealth: 3,
  selfHealth: 2,
  itemQuality: Infinity, // Once per item
  itemComparison: Infinity, // Once per item
} as const;

// --- Cooldown State ---

export interface PerceptionCooldowns {
  readonly enemyHealth: ReadonlyMap<EntityId, { band: HealthBand; turnsRemaining: number }>;
  readonly selfHealth: { band: HealthBand; turnsRemaining: number } | null;
  readonly itemQuality: ReadonlyMap<string, true>;
  readonly itemComparison: ReadonlyMap<string, true>;
}

/**
 * Create empty cooldowns state.
 */
export function createCooldowns(): PerceptionCooldowns {
  return {
    enemyHealth: new Map(),
    selfHealth: null,
    itemQuality: new Map(),
    itemComparison: new Map(),
  };
}

/**
 * Check if a perception should be emitted based on cooldowns.
 */
export function shouldEmitPerception(
  perception: Perception,
  cooldowns: PerceptionCooldowns
): boolean {
  switch (perception.type) {
    case 'enemy_health': {
      const existing = cooldowns.enemyHealth.get(perception.entityId);
      if (!existing) return true;
      if (perception.band !== existing.band) return true;
      return existing.turnsRemaining <= 0;
    }

    case 'self_health': {
      if (!cooldowns.selfHealth) return true;
      if (perception.band !== cooldowns.selfHealth.band) return true;
      return cooldowns.selfHealth.turnsRemaining <= 0;
    }

    case 'item_quality': {
      return !cooldowns.itemQuality.has(perception.itemId);
    }

    case 'item_comparison': {
      return !cooldowns.itemComparison.has(perception.itemId);
    }

    case 'relative_danger':
      return true; // Always emit relative danger

    default:
      return true;
  }
}

/**
 * Update cooldowns after emitting a perception.
 */
export function updateCooldowns(
  perception: Perception,
  cooldowns: PerceptionCooldowns
): PerceptionCooldowns {
  switch (perception.type) {
    case 'enemy_health': {
      const newMap = new Map(cooldowns.enemyHealth);
      newMap.set(perception.entityId, {
        band: perception.band,
        turnsRemaining: COOLDOWN_TURNS.enemyHealth,
      });
      return { ...cooldowns, enemyHealth: newMap };
    }

    case 'self_health': {
      return {
        ...cooldowns,
        selfHealth: {
          band: perception.band,
          turnsRemaining: COOLDOWN_TURNS.selfHealth,
        },
      };
    }

    case 'item_quality': {
      const newMap = new Map(cooldowns.itemQuality);
      newMap.set(perception.itemId, true);
      return { ...cooldowns, itemQuality: newMap };
    }

    case 'item_comparison': {
      const newMap = new Map(cooldowns.itemComparison);
      newMap.set(perception.itemId, true);
      return { ...cooldowns, itemComparison: newMap };
    }

    default:
      return cooldowns;
  }
}

/**
 * Tick all cooldowns down by 1 turn.
 */
export function tickCooldowns(cooldowns: PerceptionCooldowns): PerceptionCooldowns {
  const newEnemyHealth = new Map<EntityId, { band: HealthBand; turnsRemaining: number }>();
  for (const [id, data] of cooldowns.enemyHealth) {
    if (data.turnsRemaining > 1) {
      newEnemyHealth.set(id, { ...data, turnsRemaining: data.turnsRemaining - 1 });
    }
  }

  const newSelfHealth = cooldowns.selfHealth
    ? cooldowns.selfHealth.turnsRemaining > 1
      ? { ...cooldowns.selfHealth, turnsRemaining: cooldowns.selfHealth.turnsRemaining - 1 }
      : null
    : null;

  return {
    ...cooldowns,
    enemyHealth: newEnemyHealth,
    selfHealth: newSelfHealth,
  };
}

/**
 * Reset combat-related cooldowns (e.g., when combat ends).
 */
export function resetCombatCooldowns(cooldowns: PerceptionCooldowns): PerceptionCooldowns {
  return {
    ...cooldowns,
    enemyHealth: new Map(),
    selfHealth: null,
  };
}
