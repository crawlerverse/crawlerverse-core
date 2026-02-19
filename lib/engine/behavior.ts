/**
 * Behavior State Machine
 *
 * Manages monster behavior state transitions based on player visibility and damage.
 * All functions are pure and return new entity objects.
 */

import type { Entity, Position, Direction, Action } from './types';
import { getSearchDuration } from './monsters';
import { createLogger } from '../logging';
import { getItemTemplate } from './items';
import { isPassable, type DungeonMap } from './map';

const behaviorLogger = createLogger({ module: 'behavior' });

/**
 * Transition monster to alerted state (just spotted player).
 * Alerted state lasts 1 turn before transitioning to chase.
 * Sets lastKnownTarget to the position where player was spotted.
 */
export function transitionToAlerted(monster: Entity, targetPos: Position): Entity {
  return {
    ...monster,
    behaviorState: 'alerted',
    lastKnownTarget: { x: targetPos.x, y: targetPos.y },
  };
}

/**
 * Transition monster to chase state (actively pursuing).
 * Updates lastKnownTarget to current player position.
 */
export function transitionToChase(monster: Entity, targetPos: Position): Entity {
  return {
    ...monster,
    behaviorState: 'chase',
    lastKnownTarget: { x: targetPos.x, y: targetPos.y },
  };
}

/**
 * Transition monster to hunt state (moving to last known position).
 * Preserves lastKnownTarget from previous state.
 */
export function transitionToHunt(monster: Entity): Entity {
  return {
    ...monster,
    behaviorState: 'hunt',
  };
}

/**
 * Transition monster to search state (wandering near last known position).
 * Initializes searchTurnsRemaining based on monster type's searchDuration.
 */
export function transitionToSearch(monster: Entity): Entity {
  const searchDuration = monster.monsterTypeId
    ? getSearchDuration(monster.monsterTypeId)
    : 5;

  return {
    ...monster,
    behaviorState: 'search',
    searchTurnsRemaining: searchDuration,
  };
}

/**
 * Transition monster to idle state.
 * Clears lastKnownTarget and searchTurnsRemaining.
 */
export function transitionToIdle(monster: Entity): Entity {
  return {
    ...monster,
    behaviorState: 'idle',
    lastKnownTarget: undefined,
    searchTurnsRemaining: undefined,
  };
}

/**
 * Check if hunting monster has reached its target and should transition to search.
 * Call this after monster movement to trigger hunt→search transition.
 */
export function reachedHuntTarget(monster: Entity): Entity {
  if (monster.behaviorState !== 'hunt') {
    return monster;
  }

  const target = monster.lastKnownTarget;
  if (!target) {
    // No target, transition to search anyway
    return transitionToSearch(monster);
  }

  if (monster.x === target.x && monster.y === target.y) {
    return transitionToSearch(monster);
  }

  return monster;
}

/**
 * Update monster behavior state based on current conditions.
 * This is the main state machine function called each turn.
 *
 * State transitions:
 * - PATROL → sees player → ALERTED
 * - ALERTED → next turn → CHASE (always, even if lost sight)
 * - CHASE → sees player → CHASE (update target)
 * - CHASE → loses sight → HUNT
 * - HUNT → sees player → CHASE
 * - HUNT → at target → SEARCH (handled separately by reachedHuntTarget)
 * - SEARCH → sees player → CHASE
 * - SEARCH → timer expires → IDLE
 * - IDLE → sees player → CHASE
 */
export function updateBehaviorState(
  monster: Entity,
  canSeePlayer: boolean,
  playerPosition: Position | null
): Entity {
  const currentState = monster.behaviorState ?? 'chase'; // Default aggressive

  switch (currentState) {
    case 'patrol':
      if (canSeePlayer && playerPosition) {
        return transitionToAlerted(monster, playerPosition);
      }
      return monster;

    case 'alerted':
      // Always transition to chase on next turn
      if (canSeePlayer && playerPosition) {
        return transitionToChase(monster, playerPosition);
      }
      // Even if lost sight, chase toward last known
      // Defensive: if somehow alerted without target (schema violation), transition to idle
      if (!monster.lastKnownTarget) {
        return transitionToIdle(monster);
      }
      return transitionToChase(monster, monster.lastKnownTarget);

    case 'chase':
      if (canSeePlayer && playerPosition) {
        return transitionToChase(monster, playerPosition);
      }
      return transitionToHunt(monster);

    case 'hunt':
      if (canSeePlayer && playerPosition) {
        return transitionToChase(monster, playerPosition);
      }
      return monster; // Stay hunting until reachedHuntTarget

    case 'search':
      if (canSeePlayer && playerPosition) {
        return transitionToChase(monster, playerPosition);
      }
      const remaining = (monster.searchTurnsRemaining ?? 1) - 1;
      if (remaining <= 0) {
        return transitionToIdle(monster);
      }
      return { ...monster, searchTurnsRemaining: remaining };

    case 'idle':
      if (canSeePlayer && playerPosition) {
        return transitionToChase(monster, playerPosition);
      }
      return monster;

    default:
      // Log unexpected state - should never happen with valid data
      behaviorLogger.warn(
        { monsterId: monster.id, behaviorState: currentState },
        'Unknown behavior state encountered - monster will not change state'
      );
      return monster;
  }
}

/**
 * Handle damage event - monster becomes alerted to attacker position.
 * Interrupts patrol, search, idle, and hunt states. Chase/alerted states just update target.
 *
 * State transitions on damage:
 * - PATROL → ALERTED (with attacker position)
 * - IDLE → ALERTED (with attacker position)
 * - SEARCH → ALERTED (with attacker position)
 * - HUNT → ALERTED (with attacker position)
 * - CHASE → CHASE (update target to attacker)
 * - ALERTED → CHASE (update target to attacker)
 */
export function handleDamage(
  monster: Entity,
  attackerPosition: Position
): Entity {
  const currentState = monster.behaviorState ?? 'chase';

  // If already chasing or alerted, just update target to attacker
  if (currentState === 'chase' || currentState === 'alerted') {
    return transitionToChase(monster, attackerPosition);
  }

  // All other states transition to alerted
  return transitionToAlerted(monster, attackerPosition);
}

// --- Ranged Behavior Utility Functions ---

/**
 * Check if entity has a ranged weapon equipped.
 * Returns true for bows (require quiver) and thrown weapons.
 */
export function hasRangedWeapon(entity: Entity): boolean {
  if (!entity.equippedWeapon) return false;

  const template = getItemTemplate(entity.equippedWeapon.templateId);
  if (!template) {
    behaviorLogger.warn(
      { entityId: entity.id, templateId: entity.equippedWeapon.templateId },
      'Equipped weapon template not found - entity has weapon with unknown template'
    );
    return false;
  }

  if (template.type !== 'equipment') {
    behaviorLogger.warn(
      { entityId: entity.id, templateId: entity.equippedWeapon.templateId, actualType: template.type },
      'Equipped weapon template is not equipment type - schema mismatch'
    );
    return false;
  }

  return template.range !== undefined && template.range > 0;
}

/**
 * Check if entity has ammo for their ranged weapon.
 * - Bows: check equippedOffhand for quiver with currentAmmo > 0
 * - Thrown: check weapon's quantity > 0
 */
export function hasAmmo(entity: Entity): boolean {
  if (!hasRangedWeapon(entity)) return false;

  const template = getItemTemplate(entity.equippedWeapon!.templateId);
  if (!template || template.type !== 'equipment') return false;

  if (template.rangedType === 'bow') {
    // Bows need a quiver with ammo
    if (!entity.equippedOffhand) return false;
    const currentAmmo = entity.equippedOffhand.currentAmmo ?? 0;
    return currentAmmo > 0;
  }

  if (template.rangedType === 'thrown') {
    // Thrown weapons track quantity on the weapon itself
    const quantity = entity.equippedWeapon!.quantity ?? 0;
    return quantity > 0;
  }

  return false;
}

/**
 * Get optimal range for kiting (75% of weapon's max range, floored).
 * Returns 0 if entity has no ranged weapon.
 */
export function getOptimalRange(entity: Entity): number {
  if (!hasRangedWeapon(entity)) return 0;

  const template = getItemTemplate(entity.equippedWeapon!.templateId);
  if (!template || template.type !== 'equipment' || !template.range) return 0;

  return Math.floor(template.range * 0.75);
}

// --- Kiting Direction ---

const DIRECTIONS: Direction[] = [
  'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
];

const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
  northeast: { dx: 1, dy: -1 },
  northwest: { dx: -1, dy: -1 },
  southeast: { dx: 1, dy: 1 },
  southwest: { dx: -1, dy: 1 },
};

/**
 * Calculate distance between two positions (Chebyshev/8-directional).
 */
function getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Get direction to move away from target (kiting).
 * Prefers cardinal directions for predictable movement.
 * Returns null if no valid retreat direction exists.
 */
export function getKiteDirection(
  monster: { x: number; y: number },
  target: { x: number; y: number },
  map: DungeonMap
): Direction | null {
  const currentDistance = getDistance(monster, target);

  let bestDirection: Direction | null = null;
  let bestScore = -Infinity;

  for (const direction of DIRECTIONS) {
    const { dx, dy } = DIRECTION_VECTORS[direction];
    const newX = monster.x + dx;
    const newY = monster.y + dy;

    // Skip if not passable
    if (!isPassable(map, newX, newY)) continue;

    const newDistance = getDistance({ x: newX, y: newY }, target);

    // Only consider directions that increase distance from target
    if (newDistance <= currentDistance) continue;

    // Score by distance increase + cardinal bonus
    const distanceIncrease = newDistance - currentDistance;
    const cardinalBonus = (dx === 0 || dy === 0) ? 0.5 : 0;
    const score = distanceIncrease + cardinalBonus;

    if (score > bestScore) {
      bestScore = score;
      bestDirection = direction;
    }
  }

  return bestDirection;
}

/**
 * Get direction from source to target.
 */
function getDirectionToward(
  source: { x: number; y: number },
  target: { x: number; y: number }
): Direction {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  // Normalize to -1, 0, or 1
  const ndx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const ndy = dy === 0 ? 0 : dy > 0 ? 1 : -1;

  // Map to direction
  if (ndx === 0 && ndy === -1) return 'north';
  if (ndx === 0 && ndy === 1) return 'south';
  if (ndx === 1 && ndy === 0) return 'east';
  if (ndx === -1 && ndy === 0) return 'west';
  if (ndx === 1 && ndy === -1) return 'northeast';
  if (ndx === -1 && ndy === -1) return 'northwest';
  if (ndx === 1 && ndy === 1) return 'southeast';
  if (ndx === -1 && ndy === 1) return 'southwest';

  // Fallback (shouldn't happen with valid coordinates)
  return 'north';
}

/**
 * Get weapon range for a monster with ranged weapon.
 * Returns 0 if no ranged weapon.
 */
function getWeaponRange(entity: Entity): number {
  if (!hasRangedWeapon(entity)) return 0;

  const template = getItemTemplate(entity.equippedWeapon!.templateId);
  if (!template || template.type !== 'equipment' || !template.range) return 0;

  return template.range;
}

/**
 * Select ranged action for a monster with ranged weapon.
 * Returns null if monster should fall back to melee behavior.
 *
 * Decision logic:
 * 1. No ranged weapon or no ammo → null (use melee)
 * 2. Target too far (> weapon range) → move toward
 * 3. Target too close (< optimal - 1) AND distance > 1 → move away (kite)
 * 4. Adjacent (distance <= 1) → null (use melee)
 * 5. In range → ranged_attack
 */
export function selectRangedAction(
  monster: Entity,
  target: { x: number; y: number },
  map: DungeonMap
): Action | null {
  // 1. No ranged weapon or no ammo → fall back to melee
  if (!hasRangedWeapon(monster) || !hasAmmo(monster)) {
    return null;
  }

  const distance = getDistance(monster, target);
  const weaponRange = getWeaponRange(monster);
  const optimalRange = getOptimalRange(monster);

  // 4. Adjacent → fall back to melee
  if (distance <= 1) {
    return null;
  }

  // 2. Target too far → move toward
  if (distance > weaponRange) {
    const direction = getDirectionToward(monster, target);
    return {
      action: 'move',
      direction,
      reasoning: `Target at distance ${distance} is beyond weapon range ${weaponRange}. Moving closer.`,
    };
  }

  // 3. Target too close (< optimal - 1) → kite (move away)
  if (distance < optimalRange - 1) {
    const kiteDir = getKiteDirection(monster, target, map);
    if (kiteDir) {
      return {
        action: 'move',
        direction: kiteDir,
        reasoning: `Target at distance ${distance} is too close (optimal: ${optimalRange}). Kiting away.`,
      };
    }
    // Can't kite, fall through to attack anyway
  }

  // 5. In range → ranged attack
  const direction = getDirectionToward(monster, target);
  return {
    action: 'ranged_attack',
    direction,
    distance,
    reasoning: `Target in range at distance ${distance}. Attacking with ranged weapon.`,
  };
}
