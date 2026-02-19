/**
 * Tests for equipment stat modifiers (CRA-67)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getEffectiveAttack, getEffectiveDefense, getEffectiveSpeed, getEffectiveVisionRadius } from '../stats';
import { applyEffect, resetEffectIdCounter } from '../effects';
import { calculateDamage } from '../combat';
import { isEquipmentTemplate, isConsumableTemplate, getItemTemplate } from '../items';
import type { Entity } from '../types';
import type { ItemInstance } from '../items';

// Helper to create a test entity
function createTestEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'test-entity',
    type: 'crawler',
    x: 0,
    y: 0,
    hp: 10,
    maxHp: 10,
    name: 'Test Entity',
    attack: 5,
    defense: 2,
    speed: 100,
    char: '@',
    areaId: 'area-1',
    ...overrides,
  };
}

// Helper to create an item instance
function createItemInstance(templateId: string): ItemInstance {
  return {
    id: `item-${templateId}`,
    templateId,
    x: 0,
    y: 0,
    areaId: 'area-1',
  };
}

describe('getEffectiveAttack', () => {
  it('returns base attack when no weapon equipped', () => {
    const entity = createTestEntity({ attack: 5 });
    expect(getEffectiveAttack(entity)).toBe(5);
  });

  it('returns base attack when equippedWeapon is null', () => {
    const entity = createTestEntity({ attack: 5, equippedWeapon: null });
    expect(getEffectiveAttack(entity)).toBe(5);
  });

  it('adds short_sword attack bonus (+2)', () => {
    const entity = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('short_sword'),
    });
    expect(getEffectiveAttack(entity)).toBe(7); // 5 + 2
  });

  it('adds long_sword attack bonus (+4)', () => {
    const entity = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('long_sword'),
    });
    expect(getEffectiveAttack(entity)).toBe(9); // 5 + 4
  });

  it('returns base attack for unknown template', () => {
    const entity = createTestEntity({
      attack: 5,
      equippedWeapon: { id: 'item-1', templateId: 'unknown_weapon', x: 0, y: 0, areaId: 'area-1' },
    });
    expect(getEffectiveAttack(entity)).toBe(5);
  });

  it('returns base attack for non-equipment template (consumable)', () => {
    const entity = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('health_potion'),
    });
    expect(getEffectiveAttack(entity)).toBe(5);
  });
});

describe('getEffectiveDefense', () => {
  it('returns base defense when no armor equipped', () => {
    const entity = createTestEntity({ defense: 2 });
    expect(getEffectiveDefense(entity)).toBe(2);
  });

  it('returns base defense when equippedArmor is null', () => {
    const entity = createTestEntity({ defense: 2, equippedArmor: null });
    expect(getEffectiveDefense(entity)).toBe(2);
  });

  it('adds leather_armor defense bonus (+1)', () => {
    const entity = createTestEntity({
      defense: 2,
      equippedArmor: createItemInstance('leather_armor'),
    });
    expect(getEffectiveDefense(entity)).toBe(3); // 2 + 1
  });

  it('adds chain_mail defense bonus (+3)', () => {
    const entity = createTestEntity({
      defense: 2,
      equippedArmor: createItemInstance('chain_mail'),
    });
    expect(getEffectiveDefense(entity)).toBe(5); // 2 + 3
  });

  it('returns base defense for unknown template', () => {
    const entity = createTestEntity({
      defense: 2,
      equippedArmor: { id: 'item-1', templateId: 'unknown_armor', x: 0, y: 0, areaId: 'area-1' },
    });
    expect(getEffectiveDefense(entity)).toBe(2);
  });
});

describe('calculateDamage with equipment', () => {
  it('uses effective stats in damage calculation', () => {
    const attacker = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('long_sword'), // +4 attack
    });
    const defender = createTestEntity({
      defense: 2,
      equippedArmor: createItemInstance('leather_armor'), // +1 defense
    });

    // Effective attack: 5 + 4 = 9
    // Effective defense: 2 + 1 = 3
    // Damage: max(1, 9 - floor(3/2)) = max(1, 9 - 1) = 8
    expect(calculateDamage(attacker, defender)).toBe(8);
  });

  it('calculates damage without equipment (base stats only)', () => {
    const attacker = createTestEntity({ attack: 5 });
    const defender = createTestEntity({ defense: 2 });

    // Damage: max(1, 5 - floor(2/2)) = max(1, 5 - 1) = 4
    expect(calculateDamage(attacker, defender)).toBe(4);
  });

  it('ensures minimum 1 damage even with high effective defense', () => {
    const attacker = createTestEntity({ attack: 2 });
    const defender = createTestEntity({
      defense: 5,
      equippedArmor: createItemInstance('chain_mail'), // +3 defense
    });

    // Effective attack: 2
    // Effective defense: 5 + 3 = 8
    // Damage: max(1, 2 - floor(8/2)) = max(1, 2 - 4) = max(1, -2) = 1
    expect(calculateDamage(attacker, defender)).toBe(1);
  });

  it('handles monster without equipment (base stats)', () => {
    const monster: Entity = {
      id: 'monster-1',
      type: 'monster',
      x: 0,
      y: 0,
      hp: 5,
      maxHp: 5,
      name: 'Rat',
      attack: 3,
      defense: 1,
      speed: 120,
      monsterTypeId: 'rat',
      areaId: 'area-1',
    };
    const player = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('short_sword'), // +2 attack
    });

    // Monster attacks player: max(1, 3 - floor(2/2)) = max(1, 3 - 1) = 2
    expect(calculateDamage(monster, player)).toBe(2);

    // Player attacks monster: max(1, 7 - floor(1/2)) = max(1, 7 - 0) = 7
    expect(calculateDamage(player, monster)).toBe(7);
  });
});

describe('getEffectiveSpeed', () => {
  it('returns base speed when no equipment', () => {
    const entity = createTestEntity({ speed: 100 });
    expect(getEffectiveSpeed(entity)).toBe(100);
  });

  it('returns base speed when equipment has no speed modifiers', () => {
    const entity = createTestEntity({
      speed: 100,
      equippedWeapon: createItemInstance('short_sword'), // no speed modifier
      equippedArmor: createItemInstance('leather_armor'), // no speed modifier
    });
    expect(getEffectiveSpeed(entity)).toBe(100);
  });

  it('ensures minimum speed of 1', () => {
    // Even if hypothetical negative speed modifiers existed, speed should never be < 1
    const entity = createTestEntity({ speed: 1 });
    expect(getEffectiveSpeed(entity)).toBeGreaterThanOrEqual(1);
  });

  it('handles null equipment', () => {
    const entity = createTestEntity({
      speed: 100,
      equippedWeapon: null,
      equippedArmor: null,
    });
    expect(getEffectiveSpeed(entity)).toBe(100);
  });
});

describe('Slot mismatch handling', () => {
  it('returns base attack when armor is in weapon slot (logs warning)', () => {
    const entity = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('leather_armor'), // armor in weapon slot!
    });
    // Armor has no attack modifiers, so should return base attack
    expect(getEffectiveAttack(entity)).toBe(5);
  });

  it('returns base defense when weapon is in armor slot (logs warning)', () => {
    const entity = createTestEntity({
      defense: 2,
      equippedArmor: createItemInstance('short_sword'), // weapon in armor slot!
    });
    // Weapon has no defense modifiers, so should return base defense
    expect(getEffectiveDefense(entity)).toBe(2);
  });
});

describe('Type guards', () => {
  it('isEquipmentTemplate returns true for equipment', () => {
    const template = getItemTemplate('short_sword');
    expect(template).toBeDefined();
    expect(isEquipmentTemplate(template!)).toBe(true);
  });

  it('isEquipmentTemplate returns false for consumables', () => {
    const template = getItemTemplate('health_potion');
    expect(template).toBeDefined();
    expect(isEquipmentTemplate(template!)).toBe(false);
  });

  it('isConsumableTemplate returns true for consumables', () => {
    const template = getItemTemplate('health_potion');
    expect(template).toBeDefined();
    expect(isConsumableTemplate(template!)).toBe(true);
  });

  it('isConsumableTemplate returns false for equipment', () => {
    const template = getItemTemplate('short_sword');
    expect(template).toBeDefined();
    expect(isConsumableTemplate(template!)).toBe(false);
  });

  it('type guards enable TypeScript narrowing', () => {
    const template = getItemTemplate('short_sword');
    expect(template).toBeDefined();

    if (isEquipmentTemplate(template!)) {
      // TypeScript should know template has 'slot' property
      expect(template.slot).toBe('weapon');
    }
  });
});

// --- CRA-133: Active Effect Stat Modifiers ---

describe('Stat modifiers from active effects', () => {
  beforeEach(() => resetEffectIdCounter());

  it('getEffectiveAttack includes blessed bonus', () => {
    let entity = createTestEntity({ attack: 5 });
    entity = applyEffect(entity, 'blessed', { label: 'cleric' });
    expect(getEffectiveAttack(entity)).toBe(7); // 5 + 2
  });

  it('getEffectiveAttack includes weakened penalty', () => {
    let entity = createTestEntity({ attack: 5 });
    entity = applyEffect(entity, 'weakened', { label: 'curse' });
    expect(getEffectiveAttack(entity)).toBe(3); // 5 - 2
  });

  it('getEffectiveAttack stacks equipment and effect bonuses', () => {
    let entity = createTestEntity({
      attack: 5,
      equippedWeapon: createItemInstance('short_sword'), // +2
    });
    entity = applyEffect(entity, 'blessed', { label: 'cleric' }); // +2
    expect(getEffectiveAttack(entity)).toBe(9); // 5 + 2 + 2
  });

  it('getEffectiveAttack clamps to minimum 1', () => {
    let entity = createTestEntity({ attack: 1 });
    entity = applyEffect(entity, 'weakened', { label: 'curse' }); // -2
    expect(getEffectiveAttack(entity)).toBe(1);
  });

  it('getEffectiveDefense includes effect bonus', () => {
    let entity = createTestEntity({ defense: 3 });
    entity = {
      ...entity,
      activeEffects: [{
        id: 'eff-1', name: 'Fortified',
        mechanic: { type: 'stat_modifier' as const, stat: 'defense' as const, delta: 3 },
        duration: 5, source: { label: 'test' },
      }],
    };
    expect(getEffectiveDefense(entity)).toBe(6); // 3 + 3
  });

  it('getEffectiveSpeed includes slowed penalty', () => {
    let entity = createTestEntity({ speed: 100 });
    entity = applyEffect(entity, 'slowed', { label: 'frost' });
    expect(getEffectiveSpeed(entity)).toBe(70); // 100 - 30
  });

  it('getEffectiveSpeed clamps to minimum 1', () => {
    let entity = createTestEntity({ speed: 20 });
    entity = applyEffect(entity, 'slowed', { label: 'frost' }); // -30
    expect(getEffectiveSpeed(entity)).toBe(1);
  });

  it('multiple effects stack additively', () => {
    let entity = createTestEntity({ attack: 5 });
    entity = applyEffect(entity, 'blessed', { label: 'cleric' }); // +2
    entity = applyEffect(entity, 'weakened', { label: 'curse' }); // -2
    expect(getEffectiveAttack(entity)).toBe(5); // 5 + 2 - 2
  });
});

describe('getEffectiveVisionRadius', () => {
  beforeEach(() => resetEffectIdCounter());

  it('returns base vision radius when no effects', () => {
    const entity = createTestEntity({ visionRadius: 8 });
    expect(getEffectiveVisionRadius(entity)).toBe(8);
  });

  it('reduces vision when blinded', () => {
    let entity = createTestEntity({ visionRadius: 8 });
    entity = applyEffect(entity, 'blinded', { label: 'smoke' });
    expect(getEffectiveVisionRadius(entity)).toBe(4); // 8 - 4
  });

  it('clamps to minimum 1', () => {
    let entity = createTestEntity({ visionRadius: 3 });
    entity = applyEffect(entity, 'blinded', { label: 'smoke' }); // -4
    expect(getEffectiveVisionRadius(entity)).toBe(1);
  });

  it('uses DEFAULT_VISION_RADIUS when visionRadius not set', () => {
    const entity = createTestEntity(); // no visionRadius
    expect(getEffectiveVisionRadius(entity)).toBe(8); // DEFAULT_VISION_RADIUS
  });
});
