/**
 * Tests for combat system (CRA-21, CRA-82)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateDamage,
  resolveAttack,
  resolveCombatWithRoll,
  rollD20,
  calculateTargetDC,
} from '../combat';
import { createTestEntity, createTestItem } from './test-helpers';

// Alias for backward compatibility within this file
const createItemInstance = createTestItem;

describe('rollD20', () => {
  it('returns values between 1 and 20 inclusive', () => {
    // Test with multiple RNG values
    expect(rollD20(0.0)).toBe(1);    // Minimum
    expect(rollD20(0.05)).toBe(2);
    expect(rollD20(0.95)).toBe(20);
    expect(rollD20(0.999)).toBe(20); // Maximum
  });

  it('distributes evenly across 1-20 range', () => {
    // 0.0-0.05 -> 1, 0.05-0.10 -> 2, etc.
    expect(rollD20(0.049)).toBe(1);
    expect(rollD20(0.050)).toBe(2);
    expect(rollD20(0.949)).toBe(19);
    expect(rollD20(0.950)).toBe(20);
  });
});

describe('calculateTargetDC', () => {
  it('returns 7 + defense for base case', () => {
    const defender = createTestEntity({ defense: 5 });
    expect(calculateTargetDC(defender)).toBe(12); // 7 + 5
  });

  it('clamps minimum DC to 8 with minimum effective defense of 1', () => {
    // Effective defense floors at 1 (CRA-133), so minimum DC = 7 + 1 = 8
    const defender = createTestEntity({ defense: 0 });
    expect(calculateTargetDC(defender)).toBe(8); // 7 + 1 (defense clamped to 1)
  });

  it('clamps maximum DC to 17 (95% hit floor)', () => {
    const defender = createTestEntity({ defense: 20 });
    expect(calculateTargetDC(defender)).toBe(17); // Clamped from 27
  });

  it('uses effective defense including equipment', () => {
    const defender = createTestEntity({
      defense: 2,
      equippedArmor: createItemInstance('chain_mail'), // +3 defense
    });
    expect(calculateTargetDC(defender)).toBe(12); // 7 + 5
  });
});

describe('calculateDamage', () => {
  it('calculates damage as attack minus half defense', () => {
    const attacker = createTestEntity({ attack: 8 });
    const defender = createTestEntity({ defense: 4 });
    // 8 - floor(4/2) = 8 - 2 = 6
    expect(calculateDamage(attacker, defender)).toBe(6);
  });

  it('floors defense before halving', () => {
    const attacker = createTestEntity({ attack: 8 });
    const defender = createTestEntity({ defense: 5 });
    // 8 - floor(5/2) = 8 - 2 = 6
    expect(calculateDamage(attacker, defender)).toBe(6);
  });

  it('ensures minimum 1 damage', () => {
    const attacker = createTestEntity({ attack: 2 });
    const defender = createTestEntity({ defense: 10 });
    // 2 - floor(10/2) = 2 - 5 = -3, clamped to 1
    expect(calculateDamage(attacker, defender)).toBe(1);
  });

  it('uses effective stats including equipment', () => {
    const attacker = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('long_sword'), // +4 attack
    });
    const defender = createTestEntity({
      defense: 2,
      equippedArmor: createItemInstance('chain_mail'), // +3 defense
    });
    // Effective: attack 9, defense 5
    // 9 - floor(5/2) = 9 - 2 = 7
    expect(calculateDamage(attacker, defender)).toBe(7);
  });
});

describe('resolveAttack (d20 system)', () => {
  const attacker = createTestEntity({ attack: 4 });
  const defender = createTestEntity({ defense: 4 });
  // DC = 7 + 4 = 11, need roll + 4 >= 11, so need roll >= 7

  it('returns full combat details on hit', () => {
    const result = resolveAttack(attacker, defender, 0.5); // roll = 11
    expect(result.hit).toBe(true);
    expect(result.roll).toBe(11);
    expect(result.attackerAtk).toBe(4);
    expect(result.defenderDef).toBe(4);
    expect(result.targetDC).toBe(11);
    expect(result.isCritical).toBe(false);
    expect(result.isFumble).toBe(false);
    expect(result.damage).toBeGreaterThan(0);
    expect(result.baseDamage).toBe(result.damage);
  });

  it('returns full combat details on miss', () => {
    const result = resolveAttack(attacker, defender, 0.1); // roll = 3
    expect(result.hit).toBe(false);
    expect(result.roll).toBe(3);
    expect(result.damage).toBe(0);
    expect(result.baseDamage).toBeGreaterThan(0); // Would-have-been damage
  });

  it('natural 20 is always a critical hit', () => {
    const weakAttacker = createTestEntity({ attack: 1 });
    const strongDefender = createTestEntity({ defense: 20 });
    const result = resolveAttack(weakAttacker, strongDefender, 0.95); // roll = 20
    expect(result.roll).toBe(20);
    expect(result.hit).toBe(true);
    expect(result.isCritical).toBe(true);
  });

  it('critical hit doubles damage', () => {
    const result = resolveAttack(attacker, defender, 0.95); // roll = 20
    expect(result.isCritical).toBe(true);
    expect(result.damage).toBe(result.baseDamage * 2);
  });

  it('natural 1 is always a fumble/miss', () => {
    const strongAttacker = createTestEntity({ attack: 20 });
    const weakDefender = createTestEntity({ defense: 1 });
    const result = resolveAttack(strongAttacker, weakDefender, 0.0); // roll = 1
    expect(result.roll).toBe(1);
    expect(result.hit).toBe(false);
    expect(result.isFumble).toBe(true);
  });

  it('hit threshold is roll + ATK >= DC', () => {
    // ATK 4, DEF 4, DC = 11
    // Roll 7 + ATK 4 = 11 >= 11 -> hit
    const hitResult = resolveAttack(attacker, defender, 0.30); // roll = 7
    expect(hitResult.roll).toBe(7);
    expect(hitResult.hit).toBe(true);

    // Roll 6 + ATK 4 = 10 < 11 -> miss
    const missResult = resolveAttack(attacker, defender, 0.25); // roll = 6
    expect(missResult.roll).toBe(6);
    expect(missResult.hit).toBe(false);
  });
});

describe('combat with specific weapon', () => {
  const attacker: ReturnType<typeof createTestEntity> = createTestEntity({
    id: 'attacker',
    type: 'crawler',
    x: 0,
    y: 0,
    hp: 20,
    maxHp: 20,
    name: 'Attacker',
    char: '@',
    attack: 5,
    defense: 2,
    speed: 100,
    equippedWeapon: createItemInstance('short_sword'), // +2 attack
  });

  const defender: ReturnType<typeof createTestEntity> = createTestEntity({
    id: 'defender',
    type: 'monster',
    x: 1,
    y: 0,
    hp: 10,
    maxHp: 10,
    name: 'Defender',
    attack: 3,
    defense: 1,
    speed: 100,
  });

  const throwingDagger = createItemInstance('throwing_dagger'); // +1 attack

  it('resolveCombatWithRoll uses specified weapon stats', () => {
    // Roll 15 + ATK vs DC - should hit
    const result = resolveCombatWithRoll(15, attacker, defender, throwingDagger);

    // attackerAtk should be 5 (base) + 1 (dagger) = 6, NOT 5 + 2 (sword)
    expect(result.attackerAtk).toBe(6);
  });

  it('resolveAttack uses specified weapon stats', () => {
    // uniformRoll that produces d20=15
    const result = resolveAttack(attacker, defender, 0.7, throwingDagger);

    expect(result.attackerAtk).toBe(6);
  });

  it('uses equipped weapon when weapon param is undefined', () => {
    const result = resolveCombatWithRoll(15, attacker, defender);

    // Should use equipped short_sword (+2)
    expect(result.attackerAtk).toBe(7);
  });

  it('calculateDamage uses specified weapon stats', () => {
    // With throwing_dagger (+1), effective attack = 5 + 1 = 6
    // defender defense = 1, so damage = 6 - floor(1/2) = 6 - 0 = 6
    const damage = calculateDamage(attacker, defender, throwingDagger);
    expect(damage).toBe(6);
  });

  it('calculateDamage uses equipped weapon when weapon param is undefined', () => {
    // With short_sword (+2), effective attack = 5 + 2 = 7
    // defender defense = 1, so damage = 7 - floor(1/2) = 7 - 0 = 7
    const damage = calculateDamage(attacker, defender);
    expect(damage).toBe(7);
  });
});

describe('resolveCombatWithRoll', () => {
  // ATK 5, DEF 4 -> DC = 7 + 4 = 11
  const attacker = createTestEntity({ attack: 5, defense: 3 });
  const defender = createTestEntity({ attack: 3, defense: 4 });

  it('uses provided roll value instead of RNG', () => {
    const result = resolveCombatWithRoll(15, attacker, defender);
    expect(result.roll).toBe(15);
  });

  it('natural 20 is always a critical hit', () => {
    const result = resolveCombatWithRoll(20, attacker, defender);
    expect(result.isCritical).toBe(true);
    expect(result.hit).toBe(true);
  });

  it('natural 1 is always a fumble/miss', () => {
    const result = resolveCombatWithRoll(1, attacker, defender);
    expect(result.isFumble).toBe(true);
    expect(result.hit).toBe(false);
  });

  it('calculates hit based on roll + ATK vs DC', () => {
    // DC = 7 + DEF(4) = 11
    // Roll 5 + ATK 5 = 10, miss
    const miss = resolveCombatWithRoll(5, attacker, defender);
    expect(miss.hit).toBe(false);

    // Roll 6 + ATK 5 = 11, hit
    const hit = resolveCombatWithRoll(6, attacker, defender);
    expect(hit.hit).toBe(true);
  });

  it('returns full combat details', () => {
    const result = resolveCombatWithRoll(15, attacker, defender);
    expect(result.roll).toBe(15);
    expect(result.attackerAtk).toBe(5);
    expect(result.defenderDef).toBe(4);
    expect(result.targetDC).toBe(11);
    expect(result.hit).toBe(true);
    expect(result.baseDamage).toBeGreaterThan(0);
    expect(result.damage).toBe(result.baseDamage);
    expect(result.isCritical).toBe(false);
    expect(result.isFumble).toBe(false);
  });

  it('critical hit doubles damage', () => {
    const result = resolveCombatWithRoll(20, attacker, defender);
    expect(result.isCritical).toBe(true);
    expect(result.damage).toBe(result.baseDamage * 2);
  });

  it('fumble deals zero damage', () => {
    const result = resolveCombatWithRoll(1, attacker, defender);
    expect(result.isFumble).toBe(true);
    expect(result.damage).toBe(0);
    expect(result.baseDamage).toBeGreaterThan(0); // Would-have-been damage
  });
});
