/**
 * Targeting System for Ranged Combat
 *
 * Handles the player targeting mode for ranged attacks, including:
 * - Detecting if player has a usable ranged weapon
 * - Finding valid targets (monsters in range with clear LOS)
 * - Managing target selection state (cycling through targets)
 *
 * This module is used by:
 * - PlayGame component for keyboard controls
 * - GameCanvas for visual rendering of targeting state
 */

import type { Entity } from './types';
import type { EntityId } from './scheduler';
import { entityId } from './scheduler';
import type { DungeonMap } from './map';
import { getItemTemplate, isEquipmentTemplate, type EquipmentTemplate } from './items';
import { computeVisibleTiles, hasLineOfSight, DEFAULT_VISION_RADIUS, tileKey } from './fov';

// --- Types ---

/**
 * Information about the player's equipped ranged weapon.
 * Used for determining range, ammo availability, and weapon type.
 */
export interface RangedWeaponInfo {
  /** Template ID of the ranged weapon */
  readonly templateId: string;
  /** Maximum range of the weapon */
  readonly range: number;
  /** Type of ranged weapon (bow or thrown) */
  readonly rangedType: 'bow' | 'thrown';
  /** Available ammo (quiver arrows for bow, quantity for thrown) */
  readonly ammoAvailable: number;
}

/**
 * State for the targeting system.
 * Tracks whether targeting mode is active, valid targets, and current selection.
 */
export interface TargetingState {
  /** Whether targeting mode is currently active */
  readonly active: boolean;
  /** Array of valid target entity IDs, sorted by distance (closest first) */
  readonly validTargets: readonly EntityId[];
  /** Index of the currently selected target in validTargets */
  readonly currentIndex: number;
  /** Range of the equipped ranged weapon (for display purposes) */
  readonly weaponRange: number;
}

/**
 * Default inactive targeting state.
 * Used when targeting mode is not active.
 */
export const INACTIVE_TARGETING: TargetingState = {
  active: false,
  validTargets: [],
  currentIndex: 0,
  weaponRange: 0,
};

// --- Ranged Weapon Detection ---

/**
 * Get information about the player's equipped ranged weapon.
 *
 * For bows: Requires bow in weapon slot AND quiver with ammo in offhand slot.
 * For thrown weapons: Checks weapon slot first, then offhand slot (rogue configuration:
 * sword in weapon slot, throwing daggers in offhand).
 *
 * @param player - The player entity to check
 * @returns RangedWeaponInfo if player has a usable ranged weapon, null otherwise
 */
export function getEquippedRangedWeapon(player: Entity): RangedWeaponInfo | null {
  // First, check the main weapon slot for ranged weapons
  if (player.equippedWeapon) {
    const template = getItemTemplate(player.equippedWeapon.templateId);
    if (template && isEquipmentTemplate(template)) {
      const equipTemplate = template as EquipmentTemplate;

      if (equipTemplate.rangedType && equipTemplate.range) {
        // Handle bow weapons - need quiver with ammo in offhand
        if (equipTemplate.rangedType === 'bow') {
          if (player.equippedOffhand) {
            const currentAmmo = player.equippedOffhand.currentAmmo ?? 0;
            if (currentAmmo > 0) {
              return {
                templateId: player.equippedWeapon.templateId,
                range: equipTemplate.range,
                rangedType: 'bow',
                ammoAvailable: currentAmmo,
              };
            }
          }
        }

        // Handle thrown weapons in main weapon slot
        if (equipTemplate.rangedType === 'thrown') {
          const quantity = player.equippedWeapon.quantity ?? 0;
          if (quantity > 0) {
            return {
              templateId: player.equippedWeapon.templateId,
              range: equipTemplate.range,
              rangedType: 'thrown',
              ammoAvailable: quantity,
            };
          }
        }
      }
    }
  }

  // Check offhand for thrown weapons (rogue configuration: sword + throwing daggers)
  if (player.equippedOffhand) {
    const offhandTemplate = getItemTemplate(player.equippedOffhand.templateId);
    if (offhandTemplate && isEquipmentTemplate(offhandTemplate)) {
      const equipTemplate = offhandTemplate as EquipmentTemplate;

      if (equipTemplate.rangedType === 'thrown' && equipTemplate.range) {
        const quantity = player.equippedOffhand.quantity ?? 0;
        if (quantity > 0) {
          return {
            templateId: player.equippedOffhand.templateId,
            range: equipTemplate.range,
            rangedType: 'thrown',
            ammoAvailable: quantity,
          };
        }
      }
    }
  }

  return null;
}

// --- Target Finding ---

/**
 * Calculate Chebyshev distance (max of dx and dy).
 * This is the distance metric used in roguelikes for movement and targeting.
 */
function chebyshevDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

/**
 * Find all valid targets for a ranged attack.
 *
 * A valid target must:
 * 1. Be a monster (type === 'monster')
 * 2. Be alive (hp > 0)
 * 3. Be in the same area as the player
 * 4. Be within the weapon's range
 * 5. Be in the player's field of view (visible tiles)
 * 6. Have a clear line of sight (no walls blocking the path)
 *
 * Results are sorted by distance (closest first) for intuitive cycling.
 *
 * @param player - The player entity
 * @param monsters - Array of all monster entities
 * @param map - The dungeon map (for LOS calculations)
 * @param weaponRange - Maximum range of the equipped weapon
 * @returns Array of valid target entity IDs, sorted by distance
 */
export function findValidTargets(
  player: Entity,
  monsters: readonly Entity[],
  map: DungeonMap,
  weaponRange: number
): EntityId[] {
  // Compute player's visible tiles
  const visionRadius = player.visionRadius ?? DEFAULT_VISION_RADIUS;
  const visibleTiles = computeVisibleTiles(map, player.x, player.y, visionRadius);

  // Filter and sort monsters
  const targetsWithDistance: Array<{ id: EntityId; distance: number }> = [];

  for (const monster of monsters) {
    // Skip dead monsters
    if (monster.hp <= 0) {
      continue;
    }

    // Skip monsters in different areas
    if (monster.areaId !== player.areaId) {
      continue;
    }

    // Check distance
    const distance = chebyshevDistance(player.x, player.y, monster.x, monster.y);
    if (distance > weaponRange) {
      continue;
    }

    // Skip adjacent monsters (distance 1) - those are melee targets
    if (distance <= 1) {
      continue;
    }

    // Check if monster is in player's FOV
    const monsterTileKey = tileKey(monster.x, monster.y);
    if (!visibleTiles.has(monsterTileKey)) {
      continue;
    }

    // Check line of sight
    if (!hasLineOfSight(map, player.x, player.y, monster.x, monster.y)) {
      continue;
    }

    targetsWithDistance.push({
      id: entityId(monster.id),
      distance,
    });
  }

  // Sort by distance (closest first)
  targetsWithDistance.sort((a, b) => a.distance - b.distance);

  return targetsWithDistance.map(t => t.id);
}

// --- Targeting Mode Management ---

/**
 * Result of attempting to enter targeting mode.
 * Includes both the targeting state and a failure reason if unsuccessful.
 */
export interface EnterTargetingResult {
  /** The targeting state (INACTIVE_TARGETING if failed) */
  readonly state: TargetingState;
  /** Reason targeting mode failed (null if successful) */
  readonly failureReason: 'no_ranged_weapon' | 'no_ammo' | 'no_targets' | null;
}

/**
 * Enter targeting mode with the equipped ranged weapon.
 *
 * Returns a new TargetingState with valid targets if:
 * 1. Player has a usable ranged weapon with ammo
 * 2. There is at least one valid target
 *
 * Returns INACTIVE_TARGETING with a failure reason otherwise.
 *
 * @param player - The player entity
 * @param monsters - Array of all monster entities
 * @param map - The dungeon map
 * @returns EnterTargetingResult with state and optional failure reason
 */
export function enterTargetingMode(
  player: Entity,
  monsters: readonly Entity[],
  map: DungeonMap
): EnterTargetingResult {
  // Check for equipped ranged weapon
  const weaponInfo = getEquippedRangedWeapon(player);
  if (!weaponInfo) {
    return {
      state: INACTIVE_TARGETING,
      failureReason: 'no_ranged_weapon',
    };
  }

  // Find valid targets
  const validTargets = findValidTargets(player, monsters, map, weaponInfo.range);
  if (validTargets.length === 0) {
    return {
      state: INACTIVE_TARGETING,
      failureReason: 'no_targets',
    };
  }

  return {
    state: {
      active: true,
      validTargets,
      currentIndex: 0,
      weaponRange: weaponInfo.range,
    },
    failureReason: null,
  };
}

/**
 * Cycle to the next target in the list.
 * Wraps around to the beginning when reaching the end.
 *
 * @param state - Current targeting state
 * @returns Updated targeting state with new currentIndex
 */
export function cycleTargetNext(state: TargetingState): TargetingState {
  if (!state.active || state.validTargets.length === 0) {
    return state;
  }

  const nextIndex = (state.currentIndex + 1) % state.validTargets.length;
  return {
    ...state,
    currentIndex: nextIndex,
  };
}

/**
 * Cycle to the previous target in the list.
 * Wraps around to the end when going past the beginning.
 *
 * @param state - Current targeting state
 * @returns Updated targeting state with new currentIndex
 */
export function cycleTargetPrev(state: TargetingState): TargetingState {
  if (!state.active || state.validTargets.length === 0) {
    return state;
  }

  const prevIndex = (state.currentIndex - 1 + state.validTargets.length) % state.validTargets.length;
  return {
    ...state,
    currentIndex: prevIndex,
  };
}

/**
 * Get the ID of the currently selected target.
 *
 * @param state - Current targeting state
 * @returns EntityId of the current target, or null if targeting is inactive
 */
export function getCurrentTargetId(state: TargetingState): EntityId | null {
  if (!state.active || state.validTargets.length === 0) {
    return null;
  }

  return state.validTargets[state.currentIndex];
}
