/**
 * Combat System
 *
 * Handles d20-based attack resolution and damage computation.
 * Uses a d20 + ATK vs DC (7 + DEF) system for tactical depth
 * while maintaining deterministic behavior via seeded RNG.
 */

import type { Entity } from './types';
import type { ItemInstance } from './items';
import { getEffectiveAttack, getEffectiveDefense, getEffectiveAttackWithWeapon } from './stats';

/**
 * Convert a uniform random roll (0-1) to a d20 roll (1-20).
 *
 * @param uniformRoll - Random value from 0 (inclusive) to 1 (exclusive)
 * @returns Integer from 1 to 20
 */
export function rollD20(uniformRoll: number): number {
  return Math.floor(uniformRoll * 20) + 1;
}

/** Minimum DC - natural 1 always misses */
const MIN_DC = 2;

/** Maximum DC - ensures 20% minimum hit chance (rolls 17-20 on d20 always hit) */
const MAX_DC = 17;

/** Base DC before defense modifier */
const BASE_DC = 7;

/**
 * Calculate the target DC to hit a defender.
 *
 * Formula: 7 + effectiveDefense, clamped to 2-17
 *
 * @param defender - The defending entity
 * @returns Target DC (2 to 17)
 */
export function calculateTargetDC(defender: Entity): number {
  const effectiveDefense = getEffectiveDefense(defender);
  const rawDC = BASE_DC + effectiveDefense;
  return Math.max(MIN_DC, Math.min(MAX_DC, rawDC));
}

/**
 * Calculate damage dealt if an attack hits.
 *
 * Formula: effectiveAttack - floor(effectiveDefense/2)
 * Minimum damage is 1 to ensure combat progresses.
 *
 * @param attacker - The attacking entity
 * @param defender - The defending entity
 * @param weapon - Optional weapon being used (defaults to attacker.equippedWeapon)
 * @returns Damage amount (minimum 1)
 */
export function calculateDamage(
  attacker: Entity,
  defender: Entity,
  weapon?: ItemInstance | null
): number {
  const effectiveAttack = weapon !== undefined
    ? getEffectiveAttackWithWeapon(attacker, weapon)
    : getEffectiveAttack(attacker);
  const effectiveDefense = getEffectiveDefense(defender);

  const damage = effectiveAttack - Math.floor(effectiveDefense / 2);
  return Math.max(1, damage);
}

/**
 * Result of a combat attack roll with full details for UI display.
 */
export interface CombatResult {
  /** Whether the attack hit */
  hit: boolean;
  /** Damage dealt (0 if missed) */
  damage: number;
  /** Base damage before critical multiplier */
  baseDamage: number;
  /** The d20 roll (1-20) */
  roll: number;
  /** Attacker's effective ATK stat */
  attackerAtk: number;
  /** Defender's effective DEF stat */
  defenderDef: number;
  /** Target DC (7 + DEF, clamped 2-17) */
  targetDC: number;
  /** Whether this was a natural 20 */
  isCritical: boolean;
  /** Whether this was a natural 1 */
  isFumble: boolean;
}

/**
 * Resolve combat using a pre-rolled d20 value.
 * Use this for human player attacks where dice-box provides the roll.
 *
 * Hit formula: roll + ATK >= DC (where DC = 7 + DEF)
 * Natural 20: Always hits, double damage
 * Natural 1: Always misses
 *
 * @param roll - The d20 roll (1-20)
 * @param attacker - The attacking entity
 * @param defender - The defending entity
 * @param weapon - Optional weapon being used (defaults to attacker.equippedWeapon)
 * @returns Combat result with hit, damage, and roll details
 */
export function resolveCombatWithRoll(
  roll: number,
  attacker: Entity,
  defender: Entity,
  weapon?: ItemInstance | null
): CombatResult {
  const attackerAtk = weapon !== undefined
    ? getEffectiveAttackWithWeapon(attacker, weapon)
    : getEffectiveAttack(attacker);
  const defenderDef = getEffectiveDefense(defender);
  const targetDC = calculateTargetDC(defender);
  const baseDamage = calculateDamage(attacker, defender, weapon);

  const isCritical = roll === 20;
  const isFumble = roll === 1;

  // Determine hit: nat 20 always hits, nat 1 always misses, otherwise check threshold
  let hit: boolean;
  if (isCritical) {
    hit = true;
  } else if (isFumble) {
    hit = false;
  } else {
    hit = roll + attackerAtk >= targetDC;
  }

  // Calculate final damage
  const damage = hit ? (isCritical ? baseDamage * 2 : baseDamage) : 0;

  return {
    hit,
    damage,
    baseDamage,
    roll,
    attackerAtk,
    defenderDef,
    targetDC,
    isCritical,
    isFumble,
  };
}

/**
 * Resolve a combat attack with d20 roll using seeded RNG.
 * Use this for AI/monster attacks and deterministic replay.
 *
 * Hit formula: roll + ATK >= DC (where DC = 7 + DEF)
 * Natural 20: Always hits, double damage
 * Natural 1: Always misses
 *
 * @param attacker - The attacking entity
 * @param defender - The defending entity
 * @param uniformRoll - Random roll from 0-1 (from RNG.getUniform())
 * @param weapon - Optional weapon being used (defaults to attacker.equippedWeapon)
 * @returns Combat result with full roll details
 */
export function resolveAttack(
  attacker: Entity,
  defender: Entity,
  uniformRoll: number,
  weapon?: ItemInstance | null
): CombatResult {
  const roll = rollD20(uniformRoll);
  return resolveCombatWithRoll(roll, attacker, defender, weapon);
}
