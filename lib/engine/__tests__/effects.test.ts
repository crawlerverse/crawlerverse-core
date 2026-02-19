// packages/crawler-core/lib/engine/__tests__/effects.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EffectMechanicSchema,
  ActiveEffectSchema,
  EFFECT_TEMPLATES,
  createActiveEffect,
  resetEffectIdCounter,
  applyEffect,
  removeEffect,
  removeEffectsFromSource,
  hasEffect,
  getEffectsByMechanic,
  tickEffects,
  type EffectTemplateId,
  type ActiveEffect,
} from '../effects';
import { EntitySchema, type Entity } from '../types';

beforeEach(() => {
  resetEffectIdCounter();
});

// --- Schema Validation ---

describe('EffectMechanicSchema', () => {
  it('accepts valid stat_modifier mechanic', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'stat_modifier',
      stat: 'attack',
      delta: -2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('stat_modifier');
    }
  });

  it('accepts stat_modifier for all valid stats', () => {
    for (const stat of ['attack', 'defense', 'speed', 'visionRadius'] as const) {
      const result = EffectMechanicSchema.safeParse({
        type: 'stat_modifier',
        stat,
        delta: 1,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects stat_modifier with invalid stat', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'stat_modifier',
      stat: 'hp',
      delta: 5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid damage_over_time mechanic (positive damage)', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'damage_over_time',
      damage: 3,
    });
    expect(result.success).toBe(true);
  });

  it('accepts damage_over_time with negative damage (healing)', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'damage_over_time',
      damage: -3,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid skip_turn mechanic', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'skip_turn',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid forced_movement mechanic', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'forced_movement',
      direction: 'away_from_source',
    });
    expect(result.success).toBe(true);
  });

  it('rejects forced_movement with invalid direction', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'forced_movement',
      direction: 'toward_source',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid ai_override mechanic', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'ai_override',
      behavior: 'target_source',
    });
    expect(result.success).toBe(true);
  });

  it('rejects ai_override with invalid behavior', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'ai_override',
      behavior: 'flee',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid visibility mechanic', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'visibility',
      hidden: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects visibility with hidden: false', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'visibility',
      hidden: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown mechanic type', () => {
    const result = EffectMechanicSchema.safeParse({
      type: 'teleport',
    });
    expect(result.success).toBe(false);
  });
});

describe('ActiveEffectSchema', () => {
  it('accepts a valid active effect', () => {
    const effect = {
      id: 'eff-1',
      name: 'poisoned',
      mechanic: { type: 'damage_over_time', damage: 3 },
      duration: 5,
      source: { label: 'spider bite' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(true);
  });

  it('accepts active effect with source entityId', () => {
    const effect = {
      id: 'eff-2',
      name: 'taunted',
      mechanic: { type: 'ai_override', behavior: 'target_source' },
      duration: 3,
      source: { entityId: 'monster-1', label: 'war cry' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source.entityId).toBe('monster-1');
    }
  });

  it('rejects effect with zero duration', () => {
    const effect = {
      id: 'eff-3',
      name: 'poisoned',
      mechanic: { type: 'damage_over_time', damage: 3 },
      duration: 0,
      source: { label: 'spider bite' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(false);
  });

  it('rejects effect with negative duration', () => {
    const effect = {
      id: 'eff-4',
      name: 'poisoned',
      mechanic: { type: 'damage_over_time', damage: 3 },
      duration: -1,
      source: { label: 'spider bite' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(false);
  });

  it('rejects effect with non-integer duration', () => {
    const effect = {
      id: 'eff-5',
      name: 'poisoned',
      mechanic: { type: 'damage_over_time', damage: 3 },
      duration: 2.5,
      source: { label: 'spider bite' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(false);
  });

  it('rejects effect with empty name', () => {
    const effect = {
      id: 'eff-6',
      name: '',
      mechanic: { type: 'skip_turn' },
      duration: 2,
      source: { label: 'stun bash' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(false);
  });

  it('rejects effect with empty source label', () => {
    const effect = {
      id: 'eff-7',
      name: 'stunned',
      mechanic: { type: 'skip_turn' },
      duration: 2,
      source: { label: '' },
    };
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(false);
  });
});

// --- Effect Templates ---

describe('EFFECT_TEMPLATES', () => {
  const EXPECTED_TEMPLATES: Record<string, { name: string; mechanicType: string; duration: number }> = {
    poisoned: { name: 'Poisoned', mechanicType: 'damage_over_time', duration: 5 },
    burning: { name: 'Burning', mechanicType: 'damage_over_time', duration: 3 },
    regenerating: { name: 'Regenerating', mechanicType: 'damage_over_time', duration: 4 },
    slowed: { name: 'Slowed', mechanicType: 'stat_modifier', duration: 3 },
    weakened: { name: 'Weakened', mechanicType: 'stat_modifier', duration: 4 },
    blessed: { name: 'Blessed', mechanicType: 'stat_modifier', duration: 5 },
    blinded: { name: 'Blinded', mechanicType: 'stat_modifier', duration: 3 },
    stunned: { name: 'Stunned', mechanicType: 'skip_turn', duration: 2 },
    feared: { name: 'Feared', mechanicType: 'forced_movement', duration: 3 },
    taunted: { name: 'Taunted', mechanicType: 'ai_override', duration: 3 },
    invisible: { name: 'Invisible', mechanicType: 'visibility', duration: 5 },
  };

  it('contains exactly 11 templates', () => {
    expect(Object.keys(EFFECT_TEMPLATES)).toHaveLength(11);
  });

  it.each(Object.entries(EXPECTED_TEMPLATES))(
    'template "%s" exists with correct name, mechanic type, and duration',
    (id, expected) => {
      const template = EFFECT_TEMPLATES[id as EffectTemplateId];
      expect(template).toBeDefined();
      expect(template.name).toBe(expected.name);
      expect(template.mechanic.type).toBe(expected.mechanicType);
      expect(template.duration).toBe(expected.duration);
    }
  );

  it('poisoned deals 3 damage per tick', () => {
    const m = EFFECT_TEMPLATES.poisoned.mechanic;
    expect(m.type).toBe('damage_over_time');
    if (m.type === 'damage_over_time') {
      expect(m.damage).toBe(3);
    }
  });

  it('burning deals 2 damage per tick', () => {
    const m = EFFECT_TEMPLATES.burning.mechanic;
    expect(m.type).toBe('damage_over_time');
    if (m.type === 'damage_over_time') {
      expect(m.damage).toBe(2);
    }
  });

  it('regenerating heals 3 per tick (negative damage)', () => {
    const m = EFFECT_TEMPLATES.regenerating.mechanic;
    expect(m.type).toBe('damage_over_time');
    if (m.type === 'damage_over_time') {
      expect(m.damage).toBe(-3);
    }
  });

  it('slowed reduces speed by 30', () => {
    const m = EFFECT_TEMPLATES.slowed.mechanic;
    expect(m.type).toBe('stat_modifier');
    if (m.type === 'stat_modifier') {
      expect(m.stat).toBe('speed');
      expect(m.delta).toBe(-30);
    }
  });

  it('weakened reduces attack by 2', () => {
    const m = EFFECT_TEMPLATES.weakened.mechanic;
    expect(m.type).toBe('stat_modifier');
    if (m.type === 'stat_modifier') {
      expect(m.stat).toBe('attack');
      expect(m.delta).toBe(-2);
    }
  });

  it('blessed increases attack by 2', () => {
    const m = EFFECT_TEMPLATES.blessed.mechanic;
    expect(m.type).toBe('stat_modifier');
    if (m.type === 'stat_modifier') {
      expect(m.stat).toBe('attack');
      expect(m.delta).toBe(2);
    }
  });

  it('blinded reduces visionRadius by 4', () => {
    const m = EFFECT_TEMPLATES.blinded.mechanic;
    expect(m.type).toBe('stat_modifier');
    if (m.type === 'stat_modifier') {
      expect(m.stat).toBe('visionRadius');
      expect(m.delta).toBe(-4);
    }
  });

  it('feared forces movement away from source', () => {
    const m = EFFECT_TEMPLATES.feared.mechanic;
    expect(m.type).toBe('forced_movement');
    if (m.type === 'forced_movement') {
      expect(m.direction).toBe('away_from_source');
    }
  });

  it('taunted overrides AI to target source', () => {
    const m = EFFECT_TEMPLATES.taunted.mechanic;
    expect(m.type).toBe('ai_override');
    if (m.type === 'ai_override') {
      expect(m.behavior).toBe('target_source');
    }
  });

  it('invisible sets hidden to true', () => {
    const m = EFFECT_TEMPLATES.invisible.mechanic;
    expect(m.type).toBe('visibility');
    if (m.type === 'visibility') {
      expect(m.hidden).toBe(true);
    }
  });

  it('templates are frozen (immutable)', () => {
    expect(Object.isFrozen(EFFECT_TEMPLATES)).toBe(true);
  });
});

// --- Factory Function ---

describe('createActiveEffect', () => {
  it('creates a valid active effect from template', () => {
    const effect = createActiveEffect('poisoned', { label: 'spider bite' });
    const result = ActiveEffectSchema.safeParse(effect);
    expect(result.success).toBe(true);
  });

  it('uses template name and mechanic', () => {
    const effect = createActiveEffect('blessed', { label: 'holy shrine' });
    expect(effect.name).toBe('Blessed');
    expect(effect.mechanic.type).toBe('stat_modifier');
    if (effect.mechanic.type === 'stat_modifier') {
      expect(effect.mechanic.stat).toBe('attack');
      expect(effect.mechanic.delta).toBe(2);
    }
  });

  it('uses template default duration', () => {
    const effect = createActiveEffect('stunned', { label: 'bash' });
    expect(effect.duration).toBe(2);
  });

  it('allows duration override', () => {
    const effect = createActiveEffect('poisoned', { label: 'venom' }, 10);
    expect(effect.duration).toBe(10);
  });

  it('includes source entityId when provided', () => {
    const effect = createActiveEffect('taunted', {
      entityId: 'monster-42',
      label: 'war cry',
    });
    expect(effect.source.entityId).toBe('monster-42');
    expect(effect.source.label).toBe('war cry');
  });

  it('omits source entityId when not provided', () => {
    const effect = createActiveEffect('burning', { label: 'lava trap' });
    expect(effect.source.entityId).toBeUndefined();
    expect(effect.source.label).toBe('lava trap');
  });

  it('generates unique IDs for successive effects', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const e2 = createActiveEffect('burning', { label: 'fire' });
    const e3 = createActiveEffect('stunned', { label: 'bash' });
    expect(e1.id).not.toBe(e2.id);
    expect(e2.id).not.toBe(e3.id);
    expect(e1.id).not.toBe(e3.id);
  });

  it('resets ID counter for test determinism', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    resetEffectIdCounter();
    const e2 = createActiveEffect('poisoned', { label: 'bite' });
    expect(e1.id).toBe(e2.id);
  });

  it('throws for unknown template ID', () => {
    expect(() =>
      createActiveEffect('nonexistent' as EffectTemplateId, { label: 'test' })
    ).toThrow(/unknown effect template/i);
  });

  it('all 11 templates produce valid effects via createActiveEffect', () => {
    const templateIds = Object.keys(EFFECT_TEMPLATES) as EffectTemplateId[];
    expect(templateIds).toHaveLength(11);

    for (const id of templateIds) {
      const effect = createActiveEffect(id, { label: 'test source' });
      const result = ActiveEffectSchema.safeParse(effect);
      expect(result.success).toBe(true);
    }
  });
});

// --- Helper to build a minimal test entity ---
// Entity type requires specific fields per the Zod schema;
// activeEffects is not yet in the schema (Task 3), so we add it via spread.

type EntityWithEffects = Entity & { activeEffects?: ActiveEffect[] };

function makeTestEntity(overrides: Partial<EntityWithEffects> = {}): EntityWithEffects {
  return {
    id: 'test-crawler-1',
    type: 'crawler',
    x: 5,
    y: 5,
    areaId: 'area-1',
    hp: 20,
    maxHp: 20,
    name: 'Test Crawler',
    attack: 5,
    defense: 3,
    speed: 100,
    char: '@',
    ...overrides,
  } as EntityWithEffects;
}

// --- applyEffect ---

describe('applyEffect', () => {
  it('adds a new effect to an entity with no existing effects', () => {
    const entity = makeTestEntity();
    const result = applyEffect(entity, 'poisoned', { label: 'spider bite' });
    const effects = (result as EntityWithEffects).activeEffects ?? [];
    expect(effects).toHaveLength(1);
    expect(effects[0].name).toBe('Poisoned');
    expect(effects[0].duration).toBe(5);
    expect(effects[0].source.label).toBe('spider bite');
  });

  it('adds a new effect when activeEffects is undefined', () => {
    const entity = makeTestEntity({ activeEffects: undefined });
    const result = applyEffect(entity, 'stunned', { label: 'bash' });
    const effects = (result as EntityWithEffects).activeEffects ?? [];
    expect(effects).toHaveLength(1);
    expect(effects[0].name).toBe('Stunned');
  });

  it('refreshes duration when same-named effect already exists', () => {
    const existingEffect = createActiveEffect('poisoned', {
      entityId: 'spider-1',
      label: 'old bite',
    });
    const entity = makeTestEntity({ activeEffects: [existingEffect] });

    const result = applyEffect(entity, 'poisoned', {
      entityId: 'spider-2',
      label: 'new bite',
    });
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    // Should still be just one effect (refreshed, not duplicated)
    expect(effects).toHaveLength(1);
    // Duration should be refreshed to template default
    expect(effects[0].duration).toBe(5);
    // Source should be updated
    expect(effects[0].source.label).toBe('new bite');
    expect(effects[0].source.entityId).toBe('spider-2');
  });

  it('updates source.label on refresh', () => {
    const existingEffect = createActiveEffect('blessed', { label: 'old shrine' });
    const entity = makeTestEntity({ activeEffects: [existingEffect] });

    const result = applyEffect(entity, 'blessed', { label: 'new shrine' });
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
    expect(effects[0].source.label).toBe('new shrine');
  });

  it('allows different-named effects to coexist', () => {
    const poison = createActiveEffect('poisoned', { label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [poison] });

    const result = applyEffect(entity, 'stunned', { label: 'bash' });
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(2);
    expect(effects.map((e) => e.name).sort()).toEqual(['Poisoned', 'Stunned']);
  });

  it('preserves other entity fields', () => {
    const entity = makeTestEntity({ hp: 15, name: 'Battered Crawler' });
    const result = applyEffect(entity, 'burning', { label: 'lava' });

    expect(result.hp).toBe(15);
    expect(result.name).toBe('Battered Crawler');
    expect(result.id).toBe('test-crawler-1');
    expect(result.x).toBe(5);
  });

  it('uses durationOverride when provided', () => {
    const entity = makeTestEntity();
    const result = applyEffect(entity, 'poisoned', { label: 'venom' }, 10);
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
    expect(effects[0].duration).toBe(10);
  });

  it('does not mutate the original entity', () => {
    const entity = makeTestEntity({ activeEffects: [] });
    const result = applyEffect(entity, 'poisoned', { label: 'bite' });

    expect((entity as EntityWithEffects).activeEffects).toHaveLength(0);
    expect((result as EntityWithEffects).activeEffects).toHaveLength(1);
  });
});

// --- removeEffect ---

describe('removeEffect', () => {
  it('removes an effect by its id', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const e2 = createActiveEffect('stunned', { label: 'bash' });
    const entity = makeTestEntity({ activeEffects: [e1, e2] });

    const result = removeEffect(entity, e1.id);
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe(e2.id);
  });

  it('is a no-op for unknown id', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [e1] });

    const result = removeEffect(entity, 'nonexistent-id');
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe(e1.id);
  });

  it('handles entity with no activeEffects', () => {
    const entity = makeTestEntity();
    const result = removeEffect(entity, 'any-id');
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(0);
  });
});

// --- removeEffectsFromSource ---

describe('removeEffectsFromSource', () => {
  it('removes all effects from a given source entity', () => {
    const e1 = createActiveEffect('poisoned', { entityId: 'spider-1', label: 'bite' });
    const e2 = createActiveEffect('stunned', { entityId: 'spider-1', label: 'venom' });
    const e3 = createActiveEffect('burning', { entityId: 'fire-trap', label: 'trap' });
    const entity = makeTestEntity({ activeEffects: [e1, e2, e3] });

    const result = removeEffectsFromSource(entity, 'spider-1');
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe(e3.id);
  });

  it('keeps effects that have no source entityId', () => {
    const e1 = createActiveEffect('burning', { label: 'lava trap' }); // no entityId
    const e2 = createActiveEffect('poisoned', { entityId: 'spider-1', label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [e1, e2] });

    const result = removeEffectsFromSource(entity, 'spider-1');
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe(e1.id);
  });

  it('is a no-op when no effects match the source', () => {
    const e1 = createActiveEffect('poisoned', { entityId: 'spider-1', label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [e1] });

    const result = removeEffectsFromSource(entity, 'unknown-entity');
    const effects = (result as EntityWithEffects).activeEffects ?? [];

    expect(effects).toHaveLength(1);
  });
});

// --- hasEffect ---

describe('hasEffect', () => {
  it('returns true when entity has the named effect', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [e1] });

    expect(hasEffect(entity, 'Poisoned')).toBe(true);
  });

  it('returns false when entity does not have the named effect', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [e1] });

    expect(hasEffect(entity, 'Stunned')).toBe(false);
  });

  it('returns false when entity has no activeEffects', () => {
    const entity = makeTestEntity();
    expect(hasEffect(entity, 'Poisoned')).toBe(false);
  });

  it('returns false for empty activeEffects array', () => {
    const entity = makeTestEntity({ activeEffects: [] });
    expect(hasEffect(entity, 'Poisoned')).toBe(false);
  });
});

// --- getEffectsByMechanic ---

describe('getEffectsByMechanic', () => {
  it('returns effects matching the given mechanic type', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const e2 = createActiveEffect('burning', { label: 'fire' });
    const e3 = createActiveEffect('stunned', { label: 'bash' });
    const entity = makeTestEntity({ activeEffects: [e1, e2, e3] });

    const dots = getEffectsByMechanic(entity, 'damage_over_time');
    expect(dots).toHaveLength(2);
    expect(dots.map((e) => e.name).sort()).toEqual(['Burning', 'Poisoned']);
  });

  it('returns empty array when no effects match', () => {
    const e1 = createActiveEffect('poisoned', { label: 'bite' });
    const entity = makeTestEntity({ activeEffects: [e1] });

    const result = getEffectsByMechanic(entity, 'skip_turn');
    expect(result).toHaveLength(0);
  });

  it('returns empty array when entity has no activeEffects', () => {
    const entity = makeTestEntity();
    const result = getEffectsByMechanic(entity, 'damage_over_time');
    expect(result).toHaveLength(0);
  });

  it('filters by specific mechanic types correctly', () => {
    const e1 = createActiveEffect('slowed', { label: 'spell' });
    const e2 = createActiveEffect('weakened', { label: 'curse' });
    const e3 = createActiveEffect('feared', { label: 'roar' });
    const entity = makeTestEntity({ activeEffects: [e1, e2, e3] });

    const statMods = getEffectsByMechanic(entity, 'stat_modifier');
    expect(statMods).toHaveLength(2);

    const movement = getEffectsByMechanic(entity, 'forced_movement');
    expect(movement).toHaveLength(1);
    expect(movement[0].name).toBe('Feared');
  });
});

// --- Entity Schema with activeEffects ---

describe('Entity schema with activeEffects', () => {
  /** Minimal valid crawler for EntitySchema.parse */
  const baseCrawler = {
    id: 'crawler-1',
    type: 'crawler' as const,
    x: 0,
    y: 0,
    areaId: 'area-1',
    hp: 10,
    maxHp: 10,
    name: 'Test Crawler',
    attack: 3,
    defense: 2,
    speed: 100,
    char: '@',
  };

  /** Minimal valid monster for EntitySchema.parse */
  const baseMonster = {
    id: 'goblin-1',
    type: 'monster' as const,
    x: 3,
    y: 4,
    areaId: 'area-1',
    hp: 5,
    maxHp: 5,
    name: 'Goblin',
    attack: 2,
    defense: 1,
    speed: 80,
    monsterTypeId: 'goblin',
  };

  it('activeEffects is optional (undefined when not provided)', () => {
    const parsed = EntitySchema.parse(baseCrawler);
    expect(parsed.activeEffects).toBeUndefined();
  });

  it('parses entity with active effects', () => {
    const effect = createActiveEffect('poisoned', { label: 'spider bite' });
    const parsed = EntitySchema.parse({
      ...baseCrawler,
      activeEffects: [effect],
    });
    expect(parsed.activeEffects).toHaveLength(1);
    expect(parsed.activeEffects![0].name).toBe('Poisoned');
    expect(parsed.activeEffects![0].mechanic.type).toBe('damage_over_time');
  });

  it('accepts optional mana fields on crawlers', () => {
    const parsed = EntitySchema.parse({
      ...baseCrawler,
      mana: 15,
      maxMana: 20,
    });
    expect(parsed.mana).toBe(15);
    expect(parsed.maxMana).toBe(20);
  });

  it('rejects negative mana', () => {
    const result = EntitySchema.safeParse({
      ...baseCrawler,
      mana: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero maxMana', () => {
    const result = EntitySchema.safeParse({
      ...baseCrawler,
      maxMana: 0,
    });
    expect(result.success).toBe(false);
  });

  it('backwards compatible — old entities without activeEffects parse fine', () => {
    // Monster without activeEffects field (simulates old save data)
    const parsed = EntitySchema.parse(baseMonster);
    expect(parsed.activeEffects).toBeUndefined();
    expect(parsed.mana).toBeUndefined();
    expect(parsed.maxMana).toBeUndefined();
  });
});

// --- tickEffects ---

describe('tickEffects', () => {
  it('decrements duration of all effects', () => {
    let entity = makeTestEntity() as Entity;
    entity = applyEffect(entity, 'poisoned', { label: 'bite' }, 3);
    entity = applyEffect(entity, 'stunned', { label: 'bash' }, 2);
    const result = tickEffects(entity);
    const effects = result.entity.activeEffects ?? [];
    expect(effects).toHaveLength(2);
    expect(effects.find(e => e.name === 'Poisoned')?.duration).toBe(2);
    expect(effects.find(e => e.name === 'Stunned')?.duration).toBe(1);
  });

  it('removes effects when duration reaches 0', () => {
    let entity = makeTestEntity() as Entity;
    entity = applyEffect(entity, 'stunned', { label: 'bash' }, 1);
    const result = tickEffects(entity);
    expect(result.entity.activeEffects ?? []).toHaveLength(0);
    expect(result.messages.some(m => m.text.includes('wears off'))).toBe(true);
  });

  it('applies damage_over_time (positive = damage)', () => {
    let entity = makeTestEntity({ hp: 20, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'poisoned', { label: 'spider' }, 3);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(17);
    expect(result.messages.some(m => m.text.includes('takes 3') && m.text.includes('Poisoned'))).toBe(true);
  });

  it('applies damage_over_time (negative = heal)', () => {
    let entity = makeTestEntity({ hp: 10, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'regenerating', { label: 'cleric' }, 3);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(13);
    expect(result.messages.some(m => m.text.includes('regenerates 3 HP'))).toBe(true);
  });

  it('clamps healing to maxHp', () => {
    let entity = makeTestEntity({ hp: 19, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'regenerating', { label: 'cleric' }, 3);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(20);
    expect(result.messages.some(m => m.text.includes('regenerates 1 HP'))).toBe(true);
  });

  it('flags death when DoT reduces HP to 0', () => {
    let entity = makeTestEntity({ hp: 2, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'poisoned', { label: 'spider' }, 3);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(0);
    expect(result.died).toBe(true);
    expect(result.messages.some(m => m.text.includes('succumbed'))).toBe(true);
  });

  it('does not reduce HP below 0', () => {
    let entity = makeTestEntity({ hp: 1, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'poisoned', { label: 'spider' }, 3);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(0);
  });

  it('processes multiple DoT effects in one tick', () => {
    let entity = makeTestEntity({ hp: 20, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'poisoned', { label: 'spider' }, 3);
    entity = applyEffect(entity, 'burning', { label: 'fire' }, 2);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(15); // 20 - 3 - 2
  });

  it('does not affect HP for non-DoT effects', () => {
    let entity = makeTestEntity({ hp: 20, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'slowed', { label: 'frost' }, 3);
    entity = applyEffect(entity, 'blessed', { label: 'cleric' }, 3);
    const result = tickEffects(entity);
    expect(result.entity.hp).toBe(20);
    expect(result.died).toBe(false);
  });

  it('entity is not mutated (immutability)', () => {
    let entity = makeTestEntity({ hp: 20, maxHp: 20 }) as Entity;
    entity = applyEffect(entity, 'poisoned', { label: 'bite' }, 3);
    const originalHp = entity.hp;
    const result = tickEffects(entity);
    expect(entity.hp).toBe(originalHp);
    expect(result.entity.hp).toBe(17);
    expect(result.entity).not.toBe(entity);
  });
});
