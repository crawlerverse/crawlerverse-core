// packages/crawler-core/lib/engine/__tests__/items.test.ts
import { describe, it, expect } from 'vitest';
import {
  ModifierSchema,
  EffectSchema,
  ItemAppearanceSchema,
  ConsumableTemplateSchema,
  EquipmentTemplateSchema,
  ItemTemplateSchema,
  ItemInstanceSchema,
  ItemSpawnConfigSchema,
  getItemAtPosition,
  getItemsAtPosition,
  ITEM_TEMPLATES,
  getItemTemplate,
  createItemInstance,
  spawnItems,
  DEFAULT_ITEM_SPAWN_CONFIG,
  type ItemInstance,
  type ConsumableTemplate,
  type EquipmentTemplate,
} from '../items';
import type { DungeonMap, Tile } from '../map';

// --- Test Fixtures ---

/** Valid consumable template fixture */
const VALID_CONSUMABLE = {
  type: 'consumable' as const,
  id: 'test_potion',
  name: 'Test Potion',
  tier: 1,
  appearance: { char: '!', color: '#FF0000' },
  effect: { modifiers: [{ stat: 'hp' as const, delta: 5 }], duration: 'instant' as const },
};

/** Valid equipment template fixture */
const VALID_EQUIPMENT = {
  type: 'equipment' as const,
  id: 'test_sword',
  name: 'Test Sword',
  tier: 1,
  slot: 'weapon' as const,
  appearance: { char: '/', color: '#A0A0A0' },
  effect: { modifiers: [{ stat: 'attack' as const, delta: 2 }], duration: 'while_equipped' as const },
};

/** Sample item instances for position tests */
const SAMPLE_ITEMS: ItemInstance[] = [
  { id: 'item-0', templateId: 'health_potion', x: 3, y: 4, areaId: 'area-1' },
  { id: 'item-1', templateId: 'short_sword', x: 5, y: 6, areaId: 'area-1' },
  { id: 'item-2', templateId: 'leather_armor', x: 3, y: 4, areaId: 'area-1' }, // Same position as item-0
];

/** Create a mock RNG with predetermined values */
function createMockRng(values: number[]) {
  let index = 0;
  return {
    getUniform: () => values[index++ % values.length],
  };
}

/** Create a test dungeon with 2 rooms: starting room and another room */
function createTestDungeon(): DungeonMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    tiles[y] = [];
    for (let x = 0; x < 10; x++) {
      // Walls on edges, floor inside, vertical wall at x=5 with gap at y=5
      const isWall = x === 0 || x === 9 || y === 0 || y === 9 || (x === 5 && y !== 5);
      tiles[y][x] = isWall ? { type: 'wall' } : { type: 'floor' };
    }
  }
  return {
    width: 10,
    height: 10,
    tiles,
    rooms: [
      { x: 1, y: 1, width: 4, height: 8, center: { x: 2, y: 5 }, tags: ['starting'] },
      { x: 6, y: 1, width: 3, height: 8, center: { x: 7, y: 5 }, tags: [] },
    ],
    seed: 12345,
  };
}

describe('ModifierSchema', () => {
  it('parses valid hp modifier', () => {
    const modifier = ModifierSchema.parse({ stat: 'hp', delta: 5 });
    expect(modifier).toEqual({ stat: 'hp', delta: 5 });
  });

  it('parses valid attack modifier', () => {
    const modifier = ModifierSchema.parse({ stat: 'attack', delta: 2 });
    expect(modifier).toEqual({ stat: 'attack', delta: 2 });
  });

  it('parses negative delta', () => {
    const modifier = ModifierSchema.parse({ stat: 'defense', delta: -1 });
    expect(modifier).toEqual({ stat: 'defense', delta: -1 });
  });

  it('rejects invalid stat', () => {
    expect(() => ModifierSchema.parse({ stat: 'mana', delta: 5 })).toThrow();
  });

  it('rejects non-integer delta', () => {
    expect(() => ModifierSchema.parse({ stat: 'hp', delta: 2.5 })).toThrow();
  });

  it('rejects missing stat field', () => {
    expect(() => ModifierSchema.parse({ delta: 5 })).toThrow();
  });

  it('rejects missing delta field', () => {
    expect(() => ModifierSchema.parse({ stat: 'hp' })).toThrow();
  });
});

describe('EffectSchema', () => {
  it('parses instant effect', () => {
    const effect = EffectSchema.parse({
      modifiers: [{ stat: 'hp', delta: 5 }],
      duration: 'instant',
    });
    expect(effect.duration).toBe('instant');
    expect(effect.modifiers).toHaveLength(1);
  });

  it('parses while_equipped effect', () => {
    const effect = EffectSchema.parse({
      modifiers: [{ stat: 'attack', delta: 2 }],
      duration: 'while_equipped',
    });
    expect(effect.duration).toBe('while_equipped');
  });

  it('parses multiple modifiers', () => {
    const effect = EffectSchema.parse({
      modifiers: [
        { stat: 'attack', delta: 2 },
        { stat: 'speed', delta: -10 },
      ],
      duration: 'while_equipped',
    });
    expect(effect.modifiers).toHaveLength(2);
  });

  it('rejects invalid duration', () => {
    expect(() => EffectSchema.parse({
      modifiers: [{ stat: 'hp', delta: 5 }],
      duration: 'permanent',
    })).toThrow();
  });

  it('parses empty modifiers array', () => {
    const effect = EffectSchema.parse({
      modifiers: [],
      duration: 'instant',
    });
    expect(effect.modifiers).toHaveLength(0);
  });
});

describe('ItemAppearanceSchema', () => {
  it('parses valid appearance', () => {
    const appearance = ItemAppearanceSchema.parse({ char: '!', color: '#FF0000' });
    expect(appearance).toEqual({ char: '!', color: '#FF0000' });
  });

  it('rejects multi-character char', () => {
    expect(() => ItemAppearanceSchema.parse({ char: '!!', color: '#FF0000' })).toThrow();
  });

  it('rejects invalid color format (missing hash)', () => {
    expect(() => ItemAppearanceSchema.parse({ char: '!', color: 'FF0000' })).toThrow();
  });

  it('rejects invalid color format (too short)', () => {
    expect(() => ItemAppearanceSchema.parse({ char: '!', color: '#FFF' })).toThrow();
  });

  it('rejects invalid color format (invalid chars)', () => {
    expect(() => ItemAppearanceSchema.parse({ char: '!', color: '#GGGGGG' })).toThrow();
  });

  it('accepts lowercase hex color', () => {
    const appearance = ItemAppearanceSchema.parse({ char: '!', color: '#ff0000' });
    expect(appearance.color).toBe('#ff0000');
  });
});

describe('ConsumableTemplateSchema', () => {
  it('parses valid consumable', () => {
    const consumable = ConsumableTemplateSchema.parse(VALID_CONSUMABLE);
    expect(consumable.type).toBe('consumable');
    expect(consumable.id).toBe('test_potion');
  });

  it('rejects zero tier', () => {
    expect(() => ConsumableTemplateSchema.parse({
      ...VALID_CONSUMABLE,
      tier: 0,
    })).toThrow();
  });

  it('rejects negative tier', () => {
    expect(() => ConsumableTemplateSchema.parse({
      ...VALID_CONSUMABLE,
      tier: -1,
    })).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => ConsumableTemplateSchema.parse({
      ...VALID_CONSUMABLE,
      id: '',
    })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => ConsumableTemplateSchema.parse({
      ...VALID_CONSUMABLE,
      name: '',
    })).toThrow();
  });

  it('rejects while_equipped duration for consumable', () => {
    expect(() => ConsumableTemplateSchema.parse({
      ...VALID_CONSUMABLE,
      effect: { ...VALID_CONSUMABLE.effect, duration: 'while_equipped' },
    })).toThrow();
  });
});

describe('EquipmentTemplateSchema', () => {
  it('parses valid weapon', () => {
    const weapon = EquipmentTemplateSchema.parse(VALID_EQUIPMENT);
    expect(weapon.type).toBe('equipment');
    expect(weapon.slot).toBe('weapon');
  });

  it('parses valid armor', () => {
    const armor = EquipmentTemplateSchema.parse({
      ...VALID_EQUIPMENT,
      id: 'test_armor',
      name: 'Test Armor',
      slot: 'armor',
      appearance: { char: '[', color: '#8B4513' },
      effect: { modifiers: [{ stat: 'defense', delta: 1 }], duration: 'while_equipped' },
    });
    expect(armor.slot).toBe('armor');
  });

  it('rejects invalid slot', () => {
    expect(() => EquipmentTemplateSchema.parse({
      ...VALID_EQUIPMENT,
      slot: 'helmet',
    })).toThrow();
  });

  it('rejects instant duration for equipment', () => {
    expect(() => EquipmentTemplateSchema.parse({
      ...VALID_EQUIPMENT,
      effect: { ...VALID_EQUIPMENT.effect, duration: 'instant' },
    })).toThrow();
  });
});

describe('ItemTemplateSchema (discriminated union)', () => {
  it('discriminates consumable by type', () => {
    const template = ItemTemplateSchema.parse(VALID_CONSUMABLE);
    expect(template.type).toBe('consumable');
    if (template.type === 'consumable') {
      // TypeScript should narrow the type here
      expect(template.effect.duration).toBe('instant');
    }
  });

  it('discriminates equipment by type', () => {
    const template = ItemTemplateSchema.parse(VALID_EQUIPMENT);
    expect(template.type).toBe('equipment');
    if (template.type === 'equipment') {
      expect(template.slot).toBe('weapon');
    }
  });
});

describe('ItemInstanceSchema', () => {
  it('parses valid item instance', () => {
    const instance = ItemInstanceSchema.parse({
      id: 'item-0',
      templateId: 'health_potion',
      x: 5,
      y: 3,
      areaId: 'area-1',
    });
    expect(instance).toEqual({
      id: 'item-0',
      templateId: 'health_potion',
      x: 5,
      y: 3,
      areaId: 'area-1',
    });
  });

  it('rejects missing templateId', () => {
    expect(() => ItemInstanceSchema.parse({ id: 'item-0', x: 5, y: 3, areaId: 'area-1' })).toThrow();
  });

  it('rejects non-integer coordinates', () => {
    expect(() => ItemInstanceSchema.parse({
      id: 'item-0',
      templateId: 'health_potion',
      x: 5.5,
      y: 3,
      areaId: 'area-1',
    })).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => ItemInstanceSchema.parse({
      id: '',
      templateId: 'health_potion',
      x: 5,
      y: 3,
      areaId: 'area-1',
    })).toThrow();
  });

  it('rejects empty templateId', () => {
    expect(() => ItemInstanceSchema.parse({
      id: 'item-0',
      templateId: '',
      x: 5,
      y: 3,
      areaId: 'area-1',
    })).toThrow();
  });
});

describe('ItemInstanceSchema - areaId', () => {
  it('requires areaId field', () => {
    const itemWithoutAreaId = {
      id: 'item-1',
      templateId: 'health_potion',
      x: 5,
      y: 5,
    };
    const result = ItemInstanceSchema.safeParse(itemWithoutAreaId);
    expect(result.success).toBe(false);
  });

  it('accepts item with areaId', () => {
    const itemWithAreaId = {
      id: 'item-1',
      templateId: 'health_potion',
      x: 5,
      y: 5,
      areaId: 'area-1',
    };
    const result = ItemInstanceSchema.safeParse(itemWithAreaId);
    expect(result.success).toBe(true);
  });
});

describe('ItemSpawnConfigSchema', () => {
  it('parses valid config', () => {
    const config = ItemSpawnConfigSchema.parse({
      minItems: 2,
      maxItems: 4,
      floor: 1,
    });
    expect(config).toEqual({ minItems: 2, maxItems: 4, floor: 1 });
  });

  it('rejects minItems > maxItems', () => {
    expect(() => ItemSpawnConfigSchema.parse({
      minItems: 5,
      maxItems: 3,
      floor: 1,
    })).toThrow();
  });

  it('rejects negative minItems', () => {
    expect(() => ItemSpawnConfigSchema.parse({
      minItems: -1,
      maxItems: 3,
      floor: 1,
    })).toThrow();
  });

  it('rejects zero floor', () => {
    expect(() => ItemSpawnConfigSchema.parse({
      minItems: 2,
      maxItems: 4,
      floor: 0,
    })).toThrow();
  });

  it('rejects negative floor', () => {
    expect(() => ItemSpawnConfigSchema.parse({
      minItems: 2,
      maxItems: 4,
      floor: -1,
    })).toThrow();
  });

  it('allows equal minItems and maxItems', () => {
    const config = ItemSpawnConfigSchema.parse({
      minItems: 3,
      maxItems: 3,
      floor: 1,
    });
    expect(config.minItems).toBe(config.maxItems);
  });

  it('allows zero items', () => {
    const config = ItemSpawnConfigSchema.parse({
      minItems: 0,
      maxItems: 0,
      floor: 1,
    });
    expect(config.minItems).toBe(0);
  });
});

describe('createItemInstance', () => {
  it('creates valid item instance', () => {
    const item = createItemInstance('item-1', 'health_potion', 5, 3, 'area-1');
    expect(item).toEqual({
      id: 'item-1',
      templateId: 'health_potion',
      x: 5,
      y: 3,
      areaId: 'area-1',
    });
  });

  it('throws for unknown templateId', () => {
    expect(() => createItemInstance('item-1', 'nonexistent', 5, 3, 'area-1')).toThrow(
      /Unknown item template: 'nonexistent'/
    );
  });

  it('throws for empty templateId', () => {
    expect(() => createItemInstance('item-1', '', 5, 3, 'area-1')).toThrow();
  });
});

describe('getItemAtPosition', () => {
  it('returns item at position in area', () => {
    const item = getItemAtPosition(SAMPLE_ITEMS, 3, 4, 'area-1');
    expect(item?.id).toBe('item-0');
  });

  it('returns undefined if no item at position', () => {
    const item = getItemAtPosition(SAMPLE_ITEMS, 0, 0, 'area-1');
    expect(item).toBeUndefined();
  });

  it('returns undefined if item exists but in different area', () => {
    const item = getItemAtPosition(SAMPLE_ITEMS, 3, 4, 'area-2');
    expect(item).toBeUndefined();
  });
});

describe('getItemsAtPosition', () => {
  it('returns all items at position in area', () => {
    const found = getItemsAtPosition(SAMPLE_ITEMS, 3, 4, 'area-1');
    expect(found).toHaveLength(2);
    expect(found.map(i => i.id)).toEqual(['item-0', 'item-2']);
  });

  it('returns empty array if no items at position', () => {
    const found = getItemsAtPosition(SAMPLE_ITEMS, 0, 0, 'area-1');
    expect(found).toEqual([]);
  });

  it('returns empty array if items exist but in different area', () => {
    const found = getItemsAtPosition(SAMPLE_ITEMS, 3, 4, 'area-2');
    expect(found).toEqual([]);
  });
});

describe('ITEM_TEMPLATES', () => {
  it('contains 12 items across all tiers', () => {
    expect(Object.keys(ITEM_TEMPLATES)).toHaveLength(12);
  });

  it('all templates pass schema validation', () => {
    for (const template of Object.values(ITEM_TEMPLATES)) {
      expect(() => ItemTemplateSchema.parse(template)).not.toThrow();
    }
  });

  it('consumables have instant duration', () => {
    const potion = ITEM_TEMPLATES.health_potion;
    expect(potion.type).toBe('consumable');
    expect(potion.effect.duration).toBe('instant');
  });

  it('equipment has while_equipped duration', () => {
    const sword = ITEM_TEMPLATES.short_sword;
    expect(sword.type).toBe('equipment');
    expect(sword.effect.duration).toBe('while_equipped');
  });

  it('tier 1 items exist', () => {
    const tier1 = Object.values(ITEM_TEMPLATES).filter(t => t.tier === 1);
    expect(tier1.length).toBeGreaterThan(0);
  });

  it('tier 2 items exist', () => {
    const tier2 = Object.values(ITEM_TEMPLATES).filter(t => t.tier === 2);
    expect(tier2.length).toBeGreaterThan(0);
  });

  it('tier 3 items exist', () => {
    const tier3 = Object.values(ITEM_TEMPLATES).filter(t => t.tier === 3);
    expect(tier3.length).toBeGreaterThan(0);
  });
});

describe('getItemTemplate', () => {
  it('returns template by id', () => {
    const template = getItemTemplate('health_potion');
    expect(template?.name).toBe('Health Potion');
  });

  it('returns undefined for unknown id', () => {
    const template = getItemTemplate('nonexistent');
    expect(template).toBeUndefined();
  });
});

describe('spawnItems', () => {
  it('spawns items within count range', () => {
    const map = createTestDungeon();
    const rng = createMockRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const items = spawnItems(map, { minItems: 2, maxItems: 4, floor: 1 }, [], rng, 'area-1');
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.length).toBeLessThanOrEqual(4);
  });

  it('does not spawn items in starting room', () => {
    const map = createTestDungeon();
    const startingRoom = map.rooms.find(r => r.tags.includes('starting'))!;
    const rng = createMockRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1]);
    const items = spawnItems(map, { minItems: 5, maxItems: 5, floor: 1 }, [], rng, 'area-1');

    for (const item of items) {
      const inStartingRoom =
        item.x >= startingRoom.x &&
        item.x < startingRoom.x + startingRoom.width &&
        item.y >= startingRoom.y &&
        item.y < startingRoom.y + startingRoom.height;
      expect(inStartingRoom).toBe(false);
    }
  });

  it('excludes entity positions from spawning', () => {
    const map = createTestDungeon();
    const exclude = [{ x: 7, y: 5 }]; // Center of non-starting room
    const rng = createMockRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const items = spawnItems(map, { minItems: 10, maxItems: 10, floor: 1 }, exclude, rng, 'area-1');

    expect(items.every(i => !(i.x === 7 && i.y === 5))).toBe(true);
  });

  it('returns empty array if no non-starting rooms', () => {
    const map: DungeonMap = {
      width: 5,
      height: 5,
      tiles: Array(5).fill(null).map(() => Array(5).fill({ type: 'floor' })),
      rooms: [{ x: 1, y: 1, width: 3, height: 3, center: { x: 2, y: 2 }, tags: ['starting'] }],
      seed: 0,
    };
    const rng = createMockRng([0.5]);
    const items = spawnItems(map, DEFAULT_ITEM_SPAWN_CONFIG, [], rng, 'area-1');
    expect(items).toEqual([]);
  });

  it('assigns unique item IDs', () => {
    const map = createTestDungeon();
    const rng = createMockRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const items = spawnItems(map, { minItems: 3, maxItems: 3, floor: 1 }, [], rng, 'area-1');
    const ids = items.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('spawns items with valid template IDs', () => {
    const map = createTestDungeon();
    const rng = createMockRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1]);
    const items = spawnItems(map, { minItems: 3, maxItems: 3, floor: 1 }, [], rng, 'area-1');
    for (const item of items) {
      expect(getItemTemplate(item.templateId)).toBeDefined();
    }
  });

  it('returns empty array when minItems and maxItems are 0', () => {
    const map = createTestDungeon();
    const rng = createMockRng([0.5]);
    const items = spawnItems(map, { minItems: 0, maxItems: 0, floor: 1 }, [], rng, 'area-1');
    expect(items).toEqual([]);
  });

  it('handles room with all tiles excluded gracefully', () => {
    // Create a dungeon where the non-starting room is small
    const map: DungeonMap = {
      width: 10,
      height: 5,
      tiles: Array(5).fill(null).map((_, y) =>
        Array(10).fill(null).map((_, x) =>
          // Small rooms: starting at x=1-3, non-starting at x=6-8
          ((x >= 1 && x <= 3) || (x >= 6 && x <= 8)) && y >= 1 && y <= 3
            ? { type: 'floor' as const }
            : { type: 'wall' as const }
        )
      ),
      rooms: [
        { x: 1, y: 1, width: 3, height: 3, center: { x: 2, y: 2 }, tags: ['starting'] },
        { x: 6, y: 1, width: 3, height: 3, center: { x: 7, y: 2 }, tags: [] },
      ],
      seed: 0,
    };

    // Exclude all positions in the non-starting room
    const exclude = [
      { x: 6, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 1 },
      { x: 6, y: 2 }, { x: 7, y: 2 }, { x: 8, y: 2 },
      { x: 6, y: 3 }, { x: 7, y: 3 }, { x: 8, y: 3 },
    ];

    const rng = createMockRng([0.5, 0.5, 0.5, 0.5, 0.5]);
    // Should not crash, may return fewer items than requested
    const items = spawnItems(map, { minItems: 3, maxItems: 3, floor: 1 }, exclude, rng, 'area-1');
    expect(Array.isArray(items)).toBe(true);
  });

  it('includes map seed and floor in item IDs for global uniqueness', () => {
    const map = createTestDungeon();
    const rng = createMockRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const items = spawnItems(map, { minItems: 2, maxItems: 2, floor: 3 }, [], rng, 'area-1');

    // IDs should contain the seed and floor
    for (const item of items) {
      expect(item.id).toContain('12345'); // seed
      expect(item.id).toContain('-3-'); // floor
    }
  });
});

describe('tier weighting', () => {
  // Helper to spawn many items and count tiers with deterministic RNG
  // RNG sequence: [count, room, position, tierRoll, templateIndex]
  function spawnManyAndCountTiers(floor: number, count: number): { tier1: number; tier2: number } {
    const map = createTestDungeon();
    let tier1 = 0;
    let tier2 = 0;
    for (let i = 0; i < count; i++) {
      // Use deterministic sequence spread across 0-1 range for tier roll (4th value)
      const tierRoll = i / count;
      const rng = createMockRng([0.5, 0.5, 0.5, tierRoll, 0.5]);
      const items = spawnItems(map, { minItems: 1, maxItems: 1, floor }, [], rng, 'area-1');
      if (items.length > 0) {
        const template = getItemTemplate(items[0].templateId);
        if (template?.tier === 1) tier1++;
        if (template?.tier === 2) tier2++;
      }
    }
    return { tier1, tier2 };
  }

  it('floor 1 spawns mostly tier 1 items', () => {
    const { tier1, tier2 } = spawnManyAndCountTiers(1, 100);
    // Floor 1: 90% tier 1, 10% tier 2
    expect(tier1).toBeGreaterThan(tier2);
  });

  it('floor 5 spawns more tier 2 items than floor 1', () => {
    const floor1 = spawnManyAndCountTiers(1, 100);
    const floor5 = spawnManyAndCountTiers(5, 100);
    // Floor 5 should have higher tier2 ratio
    const floor1Ratio = floor1.tier2 / (floor1.tier1 + floor1.tier2);
    const floor5Ratio = floor5.tier2 / (floor5.tier1 + floor5.tier2);
    expect(floor5Ratio).toBeGreaterThan(floor1Ratio);
  });

  it('floor 10 caps tier2 weight at 50%', () => {
    const floor10 = spawnManyAndCountTiers(10, 100);
    // At floor 10+, tier2 should be roughly 50%
    const tier2Ratio = floor10.tier2 / (floor10.tier1 + floor10.tier2);
    expect(tier2Ratio).toBeGreaterThanOrEqual(0.4);
    expect(tier2Ratio).toBeLessThanOrEqual(0.6);
  });
});

describe('new item templates (CRA-105)', () => {
  describe('greater_health_potion', () => {
    it('is tier 2 consumable', () => {
      const template = ITEM_TEMPLATES.greater_health_potion;
      expect(template.type).toBe('consumable');
      expect(template.tier).toBe(2);
    });

    it('heals 10 hp', () => {
      const template = ITEM_TEMPLATES.greater_health_potion as ConsumableTemplate;
      expect(template.effect.modifiers).toContainEqual({ stat: 'hp', delta: 10 });
    });
  });

  describe('elixir_of_vitality', () => {
    it('is tier 3 consumable', () => {
      const template = ITEM_TEMPLATES.elixir_of_vitality;
      expect(template.type).toBe('consumable');
      expect(template.tier).toBe(3);
    });

    it('increases maxHp and heals', () => {
      const template = ITEM_TEMPLATES.elixir_of_vitality as ConsumableTemplate;
      expect(template.effect.modifiers).toContainEqual({ stat: 'maxHp', delta: 10 });
      expect(template.effect.modifiers).toContainEqual({ stat: 'hp', delta: 10 });
    });
  });

  describe('bastard_sword', () => {
    it('is tier 3 weapon', () => {
      const template = ITEM_TEMPLATES.bastard_sword;
      expect(template.type).toBe('equipment');
      expect(template.tier).toBe(3);
      expect((template as EquipmentTemplate).slot).toBe('weapon');
    });

    it('adds 5 attack', () => {
      const template = ITEM_TEMPLATES.bastard_sword as EquipmentTemplate;
      expect(template.effect.modifiers).toContainEqual({ stat: 'attack', delta: 5 });
    });
  });

  describe('scale_mail', () => {
    it('is tier 3 armor', () => {
      const template = ITEM_TEMPLATES.scale_mail;
      expect(template.type).toBe('equipment');
      expect(template.tier).toBe(3);
      expect((template as EquipmentTemplate).slot).toBe('armor');
    });

    it('adds 4 defense', () => {
      const template = ITEM_TEMPLATES.scale_mail as EquipmentTemplate;
      expect(template.effect.modifiers).toContainEqual({ stat: 'defense', delta: 4 });
    });
  });
});

describe('maxHp modifier schema', () => {
  it('accepts maxHp as valid stat', () => {
    const modifier = { stat: 'maxHp', delta: 10 };
    expect(() => ModifierSchema.parse(modifier)).not.toThrow();
  });
});

describe('Ranged weapon templates', () => {
  it('has shortbow template', () => {
    const template = getItemTemplate('shortbow');
    expect(template).toBeDefined();
    expect(template?.type).toBe('equipment');
    if (template?.type === 'equipment') {
      expect(template.slot).toBe('weapon');
    }
  });

  it('shortbow has range property', () => {
    const template = getItemTemplate('shortbow');
    expect(template).toHaveProperty('range', 6);
    expect(template).toHaveProperty('rangedType', 'bow');
  });

  it('has leather_quiver template', () => {
    const template = getItemTemplate('leather_quiver');
    expect(template).toBeDefined();
    expect(template?.type).toBe('equipment');
    if (template?.type === 'equipment') {
      expect(template.slot).toBe('offhand');
    }
  });

  it('quiver has capacity and currentAmmo', () => {
    const template = getItemTemplate('leather_quiver');
    expect(template).toHaveProperty('capacity', 20);
    expect(template).toHaveProperty('currentAmmo', 20);
  });

  it('has throwing_dagger template', () => {
    const template = getItemTemplate('throwing_dagger');
    expect(template).toBeDefined();
    expect(template?.type).toBe('equipment');
    if (template?.type === 'equipment') {
      expect(template.slot).toBe('weapon');
    }
  });

  it('throwing_dagger is stackable with quantity', () => {
    const template = getItemTemplate('throwing_dagger');
    expect(template).toHaveProperty('rangedType', 'thrown');
    expect(template).toHaveProperty('range', 4);
    expect(template).toHaveProperty('stackable', true);
    expect(template).toHaveProperty('quantity', 5);
  });
});

describe('EquipmentTemplateSchema refinement rejections', () => {
  it('rejects range without rangedType', () => {
    const invalid = {
      type: 'equipment',
      id: 'test',
      name: 'Test',
      tier: 1,
      slot: 'weapon',
      appearance: { char: '/', color: '#FFFFFF' },
      effect: { modifiers: [{ stat: 'attack', delta: 1 }], duration: 'while_equipped' },
      range: 5, // has range but missing rangedType
    };
    expect(EquipmentTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects rangedType without range', () => {
    const invalid = {
      type: 'equipment',
      id: 'test',
      name: 'Test',
      tier: 1,
      slot: 'weapon',
      appearance: { char: '/', color: '#FFFFFF' },
      effect: { modifiers: [{ stat: 'attack', delta: 1 }], duration: 'while_equipped' },
      rangedType: 'bow', // has rangedType but missing range
    };
    expect(EquipmentTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects rangedType on non-weapon slot', () => {
    const invalid = {
      type: 'equipment',
      id: 'test',
      name: 'Test',
      tier: 1,
      slot: 'armor', // not weapon
      appearance: { char: '[', color: '#FFFFFF' },
      effect: { modifiers: [{ stat: 'defense', delta: 1 }], duration: 'while_equipped' },
      range: 5,
      rangedType: 'bow',
    };
    expect(EquipmentTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects capacity on weapon slot', () => {
    const invalid = {
      type: 'equipment',
      id: 'test',
      name: 'Test',
      tier: 1,
      slot: 'weapon', // not offhand
      appearance: { char: '/', color: '#FFFFFF' },
      effect: { modifiers: [{ stat: 'attack', delta: 1 }], duration: 'while_equipped' },
      capacity: 20, // capacity only valid on offhand
    };
    expect(EquipmentTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects stackable on non-thrown weapon', () => {
    const invalid = {
      type: 'equipment',
      id: 'test',
      name: 'Test',
      tier: 1,
      slot: 'weapon',
      appearance: { char: '/', color: '#FFFFFF' },
      effect: { modifiers: [{ stat: 'attack', delta: 1 }], duration: 'while_equipped' },
      range: 6,
      rangedType: 'bow', // bow, not thrown
      stackable: true, // only valid for thrown
    };
    expect(EquipmentTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects currentAmmo exceeding capacity', () => {
    const invalid = {
      type: 'equipment',
      id: 'test',
      name: 'Test',
      tier: 1,
      slot: 'offhand',
      appearance: { char: '(', color: '#FFFFFF' },
      effect: { modifiers: [], duration: 'while_equipped' },
      capacity: 10,
      currentAmmo: 15, // exceeds capacity
    };
    expect(EquipmentTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts valid ranged weapon template', () => {
    const valid = {
      type: 'equipment',
      id: 'test_bow',
      name: 'Test Bow',
      tier: 1,
      slot: 'weapon',
      appearance: { char: ')', color: '#8B4513' },
      effect: { modifiers: [{ stat: 'attack', delta: 2 }], duration: 'while_equipped' },
      range: 6,
      rangedType: 'bow',
    };
    expect(EquipmentTemplateSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts valid quiver template', () => {
    const valid = {
      type: 'equipment',
      id: 'test_quiver',
      name: 'Test Quiver',
      tier: 1,
      slot: 'offhand',
      appearance: { char: '(', color: '#8B4513' },
      effect: { modifiers: [], duration: 'while_equipped' },
      capacity: 20,
      currentAmmo: 20,
    };
    expect(EquipmentTemplateSchema.safeParse(valid).success).toBe(true);
  });
});

describe('Ranged items in loot tables (CRA-132)', () => {
  it('tier 1 templates include ranged weapons', () => {
    const tier1Templates = Object.values(ITEM_TEMPLATES).filter(t => t.tier === 1);
    const rangedTemplates = tier1Templates.filter(t =>
      t.type === 'equipment' && 'range' in t && (t as EquipmentTemplate).range !== undefined
    );

    expect(rangedTemplates.length).toBeGreaterThan(0);
    expect(rangedTemplates.some(t => t.id === 'shortbow')).toBe(true);
    expect(rangedTemplates.some(t => t.id === 'throwing_dagger')).toBe(true);
  });

  it('tier 1 templates include quiver', () => {
    const tier1Templates = Object.values(ITEM_TEMPLATES).filter(t => t.tier === 1);
    const quiver = tier1Templates.find(t => t.id === 'leather_quiver');

    expect(quiver).toBeDefined();
    expect(quiver?.type).toBe('equipment');
  });

  it('all ranged items are tier 1 for equal spawning weight', () => {
    const shortbow = getItemTemplate('shortbow');
    const quiver = getItemTemplate('leather_quiver');
    const dagger = getItemTemplate('throwing_dagger');

    expect(shortbow?.tier).toBe(1);
    expect(quiver?.tier).toBe(1);
    expect(dagger?.tier).toBe(1);
  });
});
