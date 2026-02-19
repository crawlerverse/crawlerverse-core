/**
 * Effective Stat Calculation
 *
 * Implements CRA-67: Equipment stat modifiers.
 *
 * Equipment items provide stat bonuses through their effect modifiers.
 * This module computes the effective stats by adding equipment bonuses
 * to base entity stats.
 *
 * Design decisions:
 * - Computed on demand (single source of truth)
 * - Simple additive bonuses only (no multiplicative modifiers)
 * - Works for both players and monsters (future CRA-69)
 * - Logs errors for invalid equipment states (aids debugging)
 */

import type { Entity } from './types';
import type { ItemInstance } from './items';
import { getItemTemplate, isEquipmentTemplate } from './items';
import { DEFAULT_VISION_RADIUS } from './fov';
import { createLogger } from '../logging';

// --- Structured Logging ---
const statsLogger = createLogger({ module: 'stats' });

// --- Helper Functions ---

/**
 * Get a stat bonus from an equipped item.
 * Returns 0 if item is null/undefined, template not found, or not equipment.
 * Logs errors for invalid states to aid debugging.
 */
function getStatBonus(
  equippedItem: ItemInstance | null | undefined,
  stat: 'attack' | 'defense' | 'speed',
  expectedSlot: 'weapon' | 'armor'
): number {
  if (!equippedItem) return 0;

  const template = getItemTemplate(equippedItem.templateId);

  // Template not found - indicates data corruption
  if (!template) {
    statsLogger.error(
      { templateId: equippedItem.templateId, itemId: equippedItem.id },
      'Equipped item has invalid templateId - possible data corruption'
    );
    return 0;
  }

  // Non-equipment item in equipment slot - indicates logic bug
  if (!isEquipmentTemplate(template)) {
    statsLogger.error(
      { templateId: equippedItem.templateId, itemId: equippedItem.id, actualType: template.type },
      'Non-equipment item found in equipment slot'
    );
    return 0;
  }

  // Slot mismatch - e.g., armor in weapon slot
  if (template.slot !== expectedSlot) {
    statsLogger.warn(
      { templateId: equippedItem.templateId, itemId: equippedItem.id, actualSlot: template.slot, expectedSlot },
      'Item in wrong equipment slot'
    );
    // Still return the bonus - the item provides stats, just in wrong slot
  }

  return template.effect.modifiers
    .filter(m => m.stat === stat)
    .reduce((sum, m) => sum + m.delta, 0);
}

// --- Effect Bonus Helper ---

/**
 * Sum all stat_modifier effect bonuses for a given stat.
 * Returns 0 if entity has no active effects.
 */
function getEffectBonus(entity: Entity, stat: string): number {
  return (entity.activeEffects ?? [])
    .filter(e => e.mechanic.type === 'stat_modifier' && e.mechanic.stat === stat)
    .reduce((sum, e) => {
      const mechanic = e.mechanic as { type: 'stat_modifier'; stat: string; delta: number };
      return sum + mechanic.delta;
    }, 0);
}

// --- Public API ---

/**
 * Get a stat bonus from an item instance.
 * Returns 0 if item is null/undefined, template not found, or not equipment.
 *
 * Unlike the private getStatBonus, this doesn't validate slot - use when
 * the weapon being used may differ from the equipped slot.
 */
export function getStatBonusFromItem(
  item: ItemInstance | null | undefined,
  stat: 'attack' | 'defense' | 'speed'
): number {
  if (!item) return 0;

  const template = getItemTemplate(item.templateId);

  if (!template) {
    statsLogger.error(
      { templateId: item.templateId, itemId: item.id },
      'Item has invalid templateId - possible data corruption'
    );
    return 0;
  }

  if (!isEquipmentTemplate(template)) {
    // Non-equipment items don't have stat bonuses
    return 0;
  }

  return template.effect.modifiers
    .filter(m => m.stat === stat)
    .reduce((sum, m) => sum + m.delta, 0);
}

/**
 * Calculate effective attack for an entity.
 *
 * Base attack + weapon attack bonus.
 * If entity has no equipped weapon, returns base attack.
 *
 * @param entity - The entity to calculate effective attack for
 * @returns The effective attack value
 *
 * @example
 * ```typescript
 * const player = { attack: 5, equippedWeapon: shortSword }; // +2 attack
 * getEffectiveAttack(player); // 7
 * ```
 */
export function getEffectiveAttack(entity: Entity): number {
  const base = entity.attack;
  const weaponBonus = getStatBonus(entity.equippedWeapon, 'attack', 'weapon');
  const effectBonus = getEffectBonus(entity, 'attack');
  return Math.max(1, base + weaponBonus + effectBonus);
}

/**
 * Calculate effective attack for an entity using a specific weapon.
 *
 * Use this for ranged attacks where the weapon being used may differ
 * from the equipped weapon slot (e.g., thrown daggers in offhand).
 *
 * @param entity - The entity to calculate effective attack for
 * @param weapon - The weapon being used (may be null for unarmed)
 * @returns The effective attack value
 *
 * @example
 * ```typescript
 * // Rogue with sword equipped, throwing a dagger from offhand
 * const damage = getEffectiveAttackWithWeapon(rogue, rogue.equippedOffhand);
 * ```
 */
export function getEffectiveAttackWithWeapon(
  entity: Entity,
  weapon: ItemInstance | null | undefined
): number {
  const base = entity.attack;
  const weaponBonus = getStatBonusFromItem(weapon, 'attack');
  const effectBonus = getEffectBonus(entity, 'attack');
  return Math.max(1, base + weaponBonus + effectBonus);
}

/**
 * Calculate effective defense for an entity.
 *
 * Base defense + armor defense bonus.
 * If entity has no equipped armor, returns base defense.
 *
 * @param entity - The entity to calculate effective defense for
 * @returns The effective defense value
 *
 * @example
 * ```typescript
 * const player = { defense: 2, equippedArmor: leatherArmor }; // +1 defense
 * getEffectiveDefense(player); // 3
 * ```
 */
export function getEffectiveDefense(entity: Entity): number {
  const base = entity.defense;
  const armorBonus = getStatBonus(entity.equippedArmor, 'defense', 'armor');
  const effectBonus = getEffectBonus(entity, 'defense');
  return Math.max(1, base + armorBonus + effectBonus);
}

/**
 * Calculate effective speed for an entity.
 *
 * Base speed + equipment speed bonuses.
 * Currently no items provide speed bonuses, but this supports future items.
 *
 * @param entity - The entity to calculate effective speed for
 * @returns The effective speed value (minimum 1)
 *
 * @example
 * ```typescript
 * const player = { speed: 100, equippedWeapon: heavyAxe }; // -10 speed
 * getEffectiveSpeed(player); // 90
 * ```
 */
export function getEffectiveSpeed(entity: Entity): number {
  const base = entity.speed;
  const weaponSpeedBonus = getStatBonus(entity.equippedWeapon, 'speed', 'weapon');
  const armorSpeedBonus = getStatBonus(entity.equippedArmor, 'speed', 'armor');
  const effectBonus = getEffectBonus(entity, 'speed');
  return Math.max(1, base + weaponSpeedBonus + armorSpeedBonus + effectBonus);
}

/**
 * Calculate effective vision radius for an entity.
 *
 * Base vision radius + vision-related effect modifiers.
 * Uses DEFAULT_VISION_RADIUS when entity has no explicit visionRadius.
 *
 * @param entity - The entity to calculate effective vision radius for
 * @returns The effective vision radius (minimum 1)
 */
export function getEffectiveVisionRadius(entity: Entity): number {
  const base = entity.visionRadius ?? DEFAULT_VISION_RADIUS;
  const effectBonus = getEffectBonus(entity, 'visionRadius');
  return Math.max(1, base + effectBonus);
}
