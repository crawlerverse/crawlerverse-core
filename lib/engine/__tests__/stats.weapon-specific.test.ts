/**
 * Tests for getEffectiveAttackWithWeapon (CRA-143)
 *
 * Tests the weapon-specific attack calculation needed for ranged combat
 * where the weapon used may differ from the equipped weapon slot.
 */

import { describe, it, expect } from 'vitest';
import { getEffectiveAttackWithWeapon } from '../stats';
import type { Entity } from '../types';
import type { ItemInstance } from '../items';

const createTestEntity = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'test',
  type: 'crawler',
  x: 0,
  y: 0,
  areaId: 'test',
  hp: 20,
  maxHp: 20,
  name: 'Test',
  char: '@',
  attack: 5,
  defense: 3,
  speed: 100,
  ...overrides,
});

const shortSword: ItemInstance = {
  id: 'sword-1',
  templateId: 'short_sword', // +2 attack
  x: 0,
  y: 0,
  areaId: 'test',
};

const throwingDagger: ItemInstance = {
  id: 'dagger-1',
  templateId: 'throwing_dagger', // +1 attack
  quantity: 5,
  x: 0,
  y: 0,
  areaId: 'test',
};

describe('getEffectiveAttackWithWeapon', () => {
  it('returns base attack when weapon is null', () => {
    const entity = createTestEntity({ attack: 5 });
    expect(getEffectiveAttackWithWeapon(entity, null)).toBe(5);
  });

  it('returns base attack when weapon is undefined', () => {
    const entity = createTestEntity({ attack: 5 });
    expect(getEffectiveAttackWithWeapon(entity, undefined)).toBe(5);
  });

  it('adds weapon bonus to base attack', () => {
    const entity = createTestEntity({ attack: 5 });
    // short_sword has +2 attack
    expect(getEffectiveAttackWithWeapon(entity, shortSword)).toBe(7);
  });

  it('uses specified weapon regardless of equipped weapon', () => {
    const entity = createTestEntity({
      attack: 5,
      equippedWeapon: shortSword, // +2 attack
    });
    // Should use throwing_dagger (+1) not equipped short_sword (+2)
    expect(getEffectiveAttackWithWeapon(entity, throwingDagger)).toBe(6);
  });

  it('returns base attack for unknown template', () => {
    const entity = createTestEntity({ attack: 5 });
    const unknownItem: ItemInstance = {
      id: 'unknown-1',
      templateId: 'unknown_weapon',
      x: 0,
      y: 0,
      areaId: 'test',
    };
    expect(getEffectiveAttackWithWeapon(entity, unknownItem)).toBe(5);
  });

  it('returns base attack for non-equipment template (consumable)', () => {
    const entity = createTestEntity({ attack: 5 });
    const potion: ItemInstance = {
      id: 'potion-1',
      templateId: 'health_potion',
      x: 0,
      y: 0,
      areaId: 'test',
    };
    expect(getEffectiveAttackWithWeapon(entity, potion)).toBe(5);
  });
});
