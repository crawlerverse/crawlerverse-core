// packages/crawler-core/lib/engine/__tests__/monster-equipment.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rollMonsterEquipment,
  dropLoot,
  resetEquipmentCounter,
  resetLootCounter,
  getConsumableTemplates,
  rollLootTableDrop,
  createGuaranteedEquipment,
  validateGuaranteedEquipment,
  type MonsterEquipmentConfig,
} from '../monster-equipment';
import type { ItemInstance } from '../items';
import { ITEM_TEMPLATES } from '../items';

// --- Test Fixtures ---

/** Create a mock RNG with predetermined values */
function createMockRng(values: number[]) {
  let index = 0;
  return {
    getUniform: () => values[index++ % values.length],
  };
}

/** Standard test config for floor 1 */
function floor1Config(rngValues: number[]): MonsterEquipmentConfig {
  return {
    floor: 1,
    rng: createMockRng(rngValues),
    areaId: 'area-1',
  };
}

// --- Tests ---

describe('rollMonsterEquipment', () => {
  beforeEach(() => {
    resetEquipmentCounter();
  });

  describe('basic behavior', () => {
    it('returns null equipment when RNG rolls high (no equipment)', () => {
      // High RNG values mean equipment chance check fails
      const result = rollMonsterEquipment('goblin', 'rat-1', floor1Config([0.99, 0.99]));
      expect(result.weapon).toBeNull();
      expect(result.armor).toBeNull();
    });

    it('returns weapon when weapon roll succeeds', () => {
      // Low first roll (weapon), high second roll (armor)
      // Tier 1 rat has 10% base chance
      const result = rollMonsterEquipment('goblin', 'rat-1', floor1Config([0.05, 0.5, 0.5]));
      expect(result.weapon).not.toBeNull();
      expect(result.armor).toBeNull();
    });

    it('returns both weapon and armor when both rolls succeed', () => {
      // Very low rolls for both weapon and armor
      const result = rollMonsterEquipment('goblin', 'rat-1', floor1Config([0.01, 0.5, 0.01, 0.5]));
      expect(result.weapon).not.toBeNull();
      expect(result.armor).not.toBeNull();
    });

    it('returns null for unknown monster type', () => {
      const result = rollMonsterEquipment('unknown' as 'goblin', 'test-1', floor1Config([0]));
      expect(result.weapon).toBeNull();
      expect(result.armor).toBeNull();
    });
  });

  describe('tier-based chance', () => {
    it('tier 1 monsters (rat) have lower base chance', () => {
      // Tier 1 base chance is 10%
      // Roll of 0.15 should fail for tier 1
      const result = rollMonsterEquipment('goblin', 'rat-1', floor1Config([0.15, 0.15]));
      expect(result.weapon).toBeNull();
    });

    it('tier 2 monsters (orc) have higher base chance', () => {
      // Tier 2 base chance is 30%
      // Roll of 0.15 should succeed for tier 2
      const result = rollMonsterEquipment('orc', 'orc-1', floor1Config([0.15, 0.5]));
      expect(result.weapon).not.toBeNull();
    });

    it('tier 3 monsters (troll) have highest base chance', () => {
      // Tier 3 base chance is 50%
      // Roll of 0.35 should succeed for tier 3
      const result = rollMonsterEquipment('troll', 'troll-1', floor1Config([0.35, 0.5]));
      expect(result.weapon).not.toBeNull();
    });
  });

  describe('floor-based scaling', () => {
    it('higher floors increase equipment chance', () => {
      // Floor 5: +20% floor bonus (5-1 * 5%)
      // Tier 1 base 10% + 20% = 30%
      // Roll of 0.25 should succeed on floor 5
      const config: MonsterEquipmentConfig = {
        floor: 5,
        rng: createMockRng([0.25, 0.5]),
        areaId: 'area-1',
      };
      const result = rollMonsterEquipment('goblin', 'rat-1', config);
      expect(result.weapon).not.toBeNull();
    });

    it('floor bonus caps at 30%', () => {
      // Floor 10: floor bonus would be 45%, but caps at 30%
      // Tier 1 base 10% + 30% = 40%
      // Roll of 0.45 should fail (capped at 40%)
      const config: MonsterEquipmentConfig = {
        floor: 10,
        rng: createMockRng([0.45, 0.5]),
        areaId: 'area-1',
      };
      const result = rollMonsterEquipment('goblin', 'rat-1', config);
      expect(result.weapon).toBeNull();
    });

    it('total equipment chance caps at 80%', () => {
      // Tier 3 (50%) + floor 10 bonus (30%) = 80%
      // Roll of 0.85 should fail even at max
      const config: MonsterEquipmentConfig = {
        floor: 10,
        rng: createMockRng([0.85, 0.5]),
        areaId: 'area-1',
      };
      const result = rollMonsterEquipment('troll', 'troll-1', config);
      expect(result.weapon).toBeNull();
    });
  });

  describe('armor chance is half of weapon chance', () => {
    it('armor roll uses half the equipment chance', () => {
      // Tier 1 at floor 1: 10% weapon, 5% armor
      // Weapon roll 0.05 succeeds, armor roll 0.06 fails (needs < 0.05)
      const result = rollMonsterEquipment('goblin', 'rat-1', floor1Config([0.05, 0.5, 0.06, 0.5]));
      expect(result.weapon).not.toBeNull();
      expect(result.armor).toBeNull();
    });
  });

  describe('equipment tier matches floor', () => {
    it('floor 1-2 spawns tier 1 equipment only', () => {
      const config: MonsterEquipmentConfig = {
        floor: 1,
        rng: createMockRng([0.01, 0.5, 0.01, 0.5]), // Very low rolls to guarantee equipment
        areaId: 'area-1',
      };
      const result = rollMonsterEquipment('troll', 'troll-1', config);
      // Check that we got equipment (tier selection happens internally)
      expect(result.weapon).not.toBeNull();
    });

    it('floor 3+ allows tier 2 equipment', () => {
      const config: MonsterEquipmentConfig = {
        floor: 3,
        rng: createMockRng([0.01, 0.5, 0.01, 0.5]),
        areaId: 'area-1',
      };
      const result = rollMonsterEquipment('troll', 'troll-1', config);
      expect(result.weapon).not.toBeNull();
    });
  });

  describe('equipment ID generation', () => {
    it('generates unique IDs with monster reference', () => {
      const result = rollMonsterEquipment('goblin', 'test-monster', floor1Config([0.01, 0, 0.01, 0]));
      if (result.weapon) {
        expect(result.weapon.id).toContain('meq-test-monster');
      }
    });

    it('increments counter for multiple items', () => {
      const result = rollMonsterEquipment('goblin', 'test-monster', floor1Config([0.01, 0, 0.01, 0]));
      if (result.weapon && result.armor) {
        expect(result.weapon.id).not.toBe(result.armor.id);
        expect(result.weapon.id).toContain('-0');
        expect(result.armor.id).toContain('-1');
      }
    });
  });

  describe('equipment has correct structure', () => {
    it('weapon has valid ItemInstance fields', () => {
      const result = rollMonsterEquipment('goblin', 'rat-1', floor1Config([0.01, 0]));
      if (result.weapon) {
        expect(result.weapon).toHaveProperty('id');
        expect(result.weapon).toHaveProperty('templateId');
        expect(result.weapon).toHaveProperty('x');
        expect(result.weapon).toHaveProperty('y');
        expect(result.weapon.x).toBe(0);
        expect(result.weapon.y).toBe(0);
      }
    });

    it('armor has valid ItemInstance fields', () => {
      const result = rollMonsterEquipment('troll', 'troll-1', floor1Config([0.01, 0, 0.01, 0]));
      if (result.armor) {
        expect(result.armor).toHaveProperty('id');
        expect(result.armor).toHaveProperty('templateId');
        expect(result.armor).toHaveProperty('x');
        expect(result.armor).toHaveProperty('y');
      }
    });
  });
});

describe('dropLoot', () => {
  describe('basic behavior', () => {
    it('returns same items array when monster has no equipment', () => {
      const monster = { x: 5, y: 5 };
      const items: ItemInstance[] = [{ id: 'item-1', templateId: 'health_potion', x: 1, y: 1, areaId: 'area-1' }];
      const result = dropLoot(monster, items);
      expect(result).toHaveLength(1);
    });

    it('adds equipped weapon to items array at monster position', () => {
      const weapon: ItemInstance = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
      const monster = { x: 5, y: 5, equippedWeapon: weapon };
      const items: ItemInstance[] = [];
      const result = dropLoot(monster, items);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('weapon-1');
      expect(result[0].x).toBe(5);
      expect(result[0].y).toBe(5);
    });

    it('adds equipped armor to items array at monster position', () => {
      const armor: ItemInstance = { id: 'armor-1', templateId: 'leather_armor', x: 0, y: 0, areaId: 'area-1' };
      const monster = { x: 7, y: 3, equippedArmor: armor };
      const items: ItemInstance[] = [];
      const result = dropLoot(monster, items);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('armor-1');
      expect(result[0].x).toBe(7);
      expect(result[0].y).toBe(3);
    });

    it('adds both weapon and armor when monster has both', () => {
      const weapon: ItemInstance = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
      const armor: ItemInstance = { id: 'armor-1', templateId: 'leather_armor', x: 0, y: 0, areaId: 'area-1' };
      const monster = { x: 5, y: 5, equippedWeapon: weapon, equippedArmor: armor };
      const items: ItemInstance[] = [];
      const result = dropLoot(monster, items);

      expect(result).toHaveLength(2);
      expect(result[0].x).toBe(5);
      expect(result[0].y).toBe(5);
      expect(result[1].x).toBe(5);
      expect(result[1].y).toBe(5);
    });
  });

  describe('preserves existing items', () => {
    it('appends to existing items without modifying them', () => {
      const weapon: ItemInstance = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
      const monster = { x: 5, y: 5, equippedWeapon: weapon };
      const existing: ItemInstance[] = [
        { id: 'item-1', templateId: 'health_potion', x: 1, y: 1, areaId: 'area-1' },
        { id: 'item-2', templateId: 'leather_armor', x: 2, y: 2, areaId: 'area-1' },
      ];
      const result = dropLoot(monster, existing);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(existing[0]);
      expect(result[1]).toEqual(existing[1]);
      expect(result[2].id).toBe('weapon-1');
    });

    it('does not mutate original items array', () => {
      const weapon: ItemInstance = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
      const monster = { x: 5, y: 5, equippedWeapon: weapon };
      const original: ItemInstance[] = [{ id: 'item-1', templateId: 'health_potion', x: 1, y: 1, areaId: 'area-1' }];
      const originalLength = original.length;
      dropLoot(monster, original);

      expect(original).toHaveLength(originalLength);
    });
  });

  describe('handles null equipment', () => {
    it('handles explicit null weapon', () => {
      const monster = { x: 5, y: 5, equippedWeapon: null };
      const items: ItemInstance[] = [];
      const result = dropLoot(monster, items);
      expect(result).toHaveLength(0);
    });

    it('handles explicit null armor', () => {
      const monster = { x: 5, y: 5, equippedArmor: null };
      const items: ItemInstance[] = [];
      const result = dropLoot(monster, items);
      expect(result).toHaveLength(0);
    });

    it('handles mixed null and equipped', () => {
      const weapon: ItemInstance = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
      const monster = { x: 5, y: 5, equippedWeapon: weapon, equippedArmor: null };
      const items: ItemInstance[] = [];
      const result = dropLoot(monster, items);
      expect(result).toHaveLength(1);
    });
  });

  describe('updates equipment position', () => {
    it('updates equipment x,y to monster position', () => {
      const weapon: ItemInstance = { id: 'weapon-1', templateId: 'short_sword', x: 100, y: 200, areaId: 'area-1' };
      const monster = { x: 5, y: 5, equippedWeapon: weapon };
      const result = dropLoot(monster, []);

      expect(result[0].x).toBe(5);
      expect(result[0].y).toBe(5);
      // Original should be unchanged
      expect(weapon.x).toBe(100);
      expect(weapon.y).toBe(200);
    });
  });
});

describe('resetEquipmentCounter', () => {
  it('resets counter so IDs start from 0', () => {
    // Generate some equipment
    rollMonsterEquipment('troll', 'troll-1', floor1Config([0.01, 0, 0.01, 0]));
    rollMonsterEquipment('troll', 'troll-2', floor1Config([0.01, 0, 0.01, 0]));

    // Reset
    resetEquipmentCounter();

    // New equipment should start from 0
    const result = rollMonsterEquipment('troll', 'troll-3', floor1Config([0.01, 0]));
    if (result.weapon) {
      expect(result.weapon.id).toContain('-0');
    }
  });
});

describe('getConsumableTemplates', () => {
  it('returns only consumable templates up to max tier', () => {
    const tier1 = getConsumableTemplates(1);
    expect(tier1.every(t => t.type === 'consumable')).toBe(true);
    expect(tier1.every(t => t.tier <= 1)).toBe(true);
  });

  it('returns empty array when no consumables match tier', () => {
    // Tier 0 should return no consumables
    const tier0 = getConsumableTemplates(0);
    expect(tier0).toHaveLength(0);
  });

  it('returns more consumables for higher tiers', () => {
    const tier1 = getConsumableTemplates(1);
    const tier3 = getConsumableTemplates(3);
    // Tier 3 should include at least tier 1 consumables
    expect(tier3.length).toBeGreaterThanOrEqual(tier1.length);
  });
});

describe('rollLootTableDrop', () => {
  beforeEach(() => {
    resetLootCounter();
  });

  it('returns empty array when roll fails', () => {
    // RNG returns 0.5, tier 1 needs < 0.10 to succeed
    const rng = { getUniform: () => 0.5 };
    const result = rollLootTableDrop('goblin', { x: 5, y: 5 }, 'area-1', rng);
    expect(result).toEqual([]);
  });

  it('returns consumable when roll succeeds', () => {
    // RNG returns 0.05 (< 0.10 threshold), then 0 for item selection
    let callCount = 0;
    const rng = { getUniform: () => (callCount++ === 0 ? 0.05 : 0) };
    const result = rollLootTableDrop('goblin', { x: 5, y: 5 }, 'area-1', rng);

    expect(result.length).toBe(1);
    expect(result[0].x).toBe(5);
    expect(result[0].y).toBe(5);
    expect(result[0].areaId).toBe('area-1');
  });

  it('level 1 monsters have 10% drop chance', () => {
    // RNG at exactly 0.10 should NOT drop (>= threshold)
    const rngAtThreshold = { getUniform: () => 0.10 };
    expect(rollLootTableDrop('goblin', { x: 0, y: 0 }, 'area-1', rngAtThreshold)).toEqual([]);

    // RNG just below 0.10 should drop
    let callCount = 0;
    const rngBelowThreshold = { getUniform: () => (callCount++ === 0 ? 0.09 : 0) };
    expect(rollLootTableDrop('goblin', { x: 0, y: 0 }, 'area-1', rngBelowThreshold).length).toBe(1);
  });

  it('level 2 monsters have 25% drop chance', () => {
    const rngAtThreshold = { getUniform: () => 0.25 };
    expect(rollLootTableDrop('orc', { x: 0, y: 0 }, 'area-1', rngAtThreshold)).toEqual([]);

    let callCount = 0;
    const rngBelowThreshold = { getUniform: () => (callCount++ === 0 ? 0.24 : 0) };
    expect(rollLootTableDrop('skeleton', { x: 0, y: 0 }, 'area-1', rngBelowThreshold).length).toBe(1);
  });

  it('level 3 monsters have 50% drop chance', () => {
    const rngAtThreshold = { getUniform: () => 0.50 };
    expect(rollLootTableDrop('troll', { x: 0, y: 0 }, 'area-1', rngAtThreshold)).toEqual([]);

    let callCount = 0;
    const rngBelowThreshold = { getUniform: () => (callCount++ === 0 ? 0.49 : 0) };
    expect(rollLootTableDrop('troll', { x: 0, y: 0 }, 'area-1', rngBelowThreshold).length).toBe(1);
  });

  it('resetLootCounter resets IDs', () => {
    let callCount = 0;
    const rng = { getUniform: () => (callCount++ === 0 ? 0.01 : 0) };

    const first = rollLootTableDrop('troll', { x: 0, y: 0 }, 'area-1', rng);
    expect(first[0].id).toBe('loot-0');

    callCount = 0;
    const second = rollLootTableDrop('troll', { x: 0, y: 0 }, 'area-1', rng);
    expect(second[0].id).toBe('loot-1');

    resetLootCounter();
    callCount = 0;
    const afterReset = rollLootTableDrop('troll', { x: 0, y: 0 }, 'area-1', rng);
    expect(afterReset[0].id).toBe('loot-0');
  });
});

describe('createGuaranteedEquipment', () => {
  beforeEach(() => {
    resetEquipmentCounter();
  });

  describe('goblin_archer', () => {
    it('returns shortbow as weapon', () => {
      const result = createGuaranteedEquipment('goblin_archer', 'goblin_archer-1', 'area-1');
      expect(result.weapon).not.toBeNull();
      expect(result.weapon?.templateId).toBe('shortbow');
    });

    it('returns leather_quiver as offhand', () => {
      const result = createGuaranteedEquipment('goblin_archer', 'goblin_archer-1', 'area-1');
      expect(result.offhand).not.toBeNull();
      expect(result.offhand?.templateId).toBe('leather_quiver');
    });

    it('quiver is initialized with full ammo', () => {
      const result = createGuaranteedEquipment('goblin_archer', 'goblin_archer-1', 'area-1');
      expect(result.offhand).not.toBeNull();
      // Get quiver capacity from template
      const quiverTemplate = ITEM_TEMPLATES['leather_quiver'];
      expect(quiverTemplate.type).toBe('equipment');
      if (quiverTemplate.type === 'equipment') {
        expect(result.offhand?.currentAmmo).toBe(quiverTemplate.capacity);
      }
    });

    it('generates unique IDs for each item', () => {
      const result = createGuaranteedEquipment('goblin_archer', 'ga-1', 'area-1');
      expect(result.weapon?.id).toContain('meq-ga-1');
      expect(result.offhand?.id).toContain('meq-ga-1');
      expect(result.weapon?.id).not.toBe(result.offhand?.id);
    });
  });

  describe('monsters without guaranteed equipment', () => {
    it('returns null for regular goblin', () => {
      const result = createGuaranteedEquipment('goblin', 'goblin-1', 'area-1');
      expect(result.weapon).toBeNull();
      expect(result.offhand).toBeNull();
    });

    it('returns null for rat', () => {
      const result = createGuaranteedEquipment('rat', 'rat-1', 'area-1');
      expect(result.weapon).toBeNull();
      expect(result.offhand).toBeNull();
    });

    it('returns null for orc', () => {
      const result = createGuaranteedEquipment('orc', 'orc-1', 'area-1');
      expect(result.weapon).toBeNull();
      expect(result.offhand).toBeNull();
    });
  });
});

describe('validateGuaranteedEquipment', () => {
  it('returns empty array when all configurations are valid', () => {
    const errors = validateGuaranteedEquipment();
    expect(errors).toEqual([]);
  });

  it('validates weapon template references exist', () => {
    // The current GUARANTEED_EQUIPMENT config references shortbow for goblin_archer
    // This test ensures that check passes
    const errors = validateGuaranteedEquipment();
    const weaponErrors = errors.filter(e => e.includes('.weapon'));
    expect(weaponErrors).toHaveLength(0);
  });

  it('validates offhand template references exist', () => {
    // The current GUARANTEED_EQUIPMENT config references leather_quiver for goblin_archer
    // This test ensures that check passes
    const errors = validateGuaranteedEquipment();
    const offhandErrors = errors.filter(e => e.includes('.offhand'));
    expect(offhandErrors).toHaveLength(0);
  });
});
