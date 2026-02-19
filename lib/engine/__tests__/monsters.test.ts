import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MONSTER_TYPES,
  MONSTER_TYPE_IDS,
  MONSTER_APPEARANCE,
  getMonsterAppearance,
  getEntityAppearance,
  createMonster,
  resetMonsterCounter,
  selectRandomMonsterType,
  getEntityVisionRadius,
  getSearchDuration,
  type MonsterTypeId,
} from '../monsters';
import { DEFAULT_VISION_RADIUS } from '../fov';
import { logger } from '../../logging';
import type { Entity } from '../types';
import { BehaviorStateSchema, EntitySchema } from '../types';
import * as ROT from 'rot-js';

describe('MONSTER_TYPES', () => {
  it('defines exactly 10 monster types', () => {
    expect(MONSTER_TYPE_IDS).toHaveLength(10);
    expect(MONSTER_TYPE_IDS).toContain('rat');
    expect(MONSTER_TYPE_IDS).toContain('goblin');
    expect(MONSTER_TYPE_IDS).toContain('goblin_archer');
    expect(MONSTER_TYPE_IDS).toContain('orc');
    expect(MONSTER_TYPE_IDS).toContain('skeleton');
    expect(MONSTER_TYPE_IDS).toContain('troll');
    expect(MONSTER_TYPE_IDS).toContain('bat');
    expect(MONSTER_TYPE_IDS).toContain('snake');
    expect(MONSTER_TYPE_IDS).toContain('minotaur');
    expect(MONSTER_TYPE_IDS).toContain('demon');
  });

  it.each(MONSTER_TYPE_IDS)('%s has valid stats', (typeId) => {
    const monster = MONSTER_TYPES[typeId];
    expect(monster.baseStats.hp).toBeGreaterThan(0);
    expect(monster.baseStats.attack).toBeGreaterThanOrEqual(0);
    expect(monster.baseStats.defense).toBeGreaterThanOrEqual(0);
    expect(monster.baseStats.speed).toBeGreaterThan(0);
  });

  it.each(MONSTER_TYPE_IDS)('%s has valid level (positive number)', (typeId) => {
    const monster = MONSTER_TYPES[typeId];
    expect(monster.level).toBeGreaterThan(0);
  });

  it.each(MONSTER_TYPE_IDS)('%s has a name', (typeId) => {
    const monster = MONSTER_TYPES[typeId];
    expect(monster.name.length).toBeGreaterThan(0);
  });

  describe('perception stats', () => {
    it('all monster types have valid visionRadius', () => {
      for (const [, type] of Object.entries(MONSTER_TYPES)) {
        expect(type.visionRadius).toBeGreaterThan(0);
        expect(type.visionRadius).toBeLessThanOrEqual(20);
      }
    });

    it('all monster types have valid searchDuration', () => {
      for (const [, type] of Object.entries(MONSTER_TYPES)) {
        expect(type.searchDuration).toBeGreaterThan(0);
        expect(type.searchDuration).toBeLessThanOrEqual(20);
      }
    });

    it('all monster types have valid defaultBehavior', () => {
      const validBehaviors = ['aggressive', 'patrol'];
      for (const [, type] of Object.entries(MONSTER_TYPES)) {
        expect(validBehaviors).toContain(type.defaultBehavior);
      }
    });

    it('skeleton has patrol behavior', () => {
      expect(MONSTER_TYPES.skeleton.defaultBehavior).toBe('patrol');
    });

    it('non-skeleton monsters have aggressive behavior', () => {
      expect(MONSTER_TYPES.rat.defaultBehavior).toBe('aggressive');
      expect(MONSTER_TYPES.goblin.defaultBehavior).toBe('aggressive');
      expect(MONSTER_TYPES.orc.defaultBehavior).toBe('aggressive');
      expect(MONSTER_TYPES.troll.defaultBehavior).toBe('aggressive');
    });

    it('rat has poor vision (4 tiles)', () => {
      expect(MONSTER_TYPES.rat.visionRadius).toBe(4);
    });

    it('skeleton has vision matching player default', () => {
      expect(MONSTER_TYPES.skeleton.visionRadius).toBe(DEFAULT_VISION_RADIUS);
    });
  });
});

describe('MONSTER_APPEARANCE', () => {
  it.each(MONSTER_TYPE_IDS)('%s has single-character display char', (typeId) => {
    const appearance = MONSTER_APPEARANCE[typeId];
    expect(appearance.char).toHaveLength(1);
  });

  it.each(MONSTER_TYPE_IDS)('%s has valid hex color', (typeId) => {
    const appearance = MONSTER_APPEARANCE[typeId];
    expect(appearance.fg).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('troll uses uppercase T (traditional roguelike for large creatures)', () => {
    expect(MONSTER_APPEARANCE.troll.char).toBe('T');
  });
});

describe('getMonsterAppearance', () => {
  it.each(MONSTER_TYPE_IDS)('returns appearance for %s', (typeId) => {
    const appearance = getMonsterAppearance(typeId);
    expect(appearance).toHaveProperty('char');
    expect(appearance).toHaveProperty('fg');
  });
});

describe('getEntityAppearance', () => {
  it('returns appearance for monster with monsterTypeId', () => {
    const monster: Entity = {
      id: 'troll-1',
      type: 'monster',
      x: 5,
      y: 5,
      hp: 15,
      maxHp: 15,
      name: 'Troll',
      attack: 4,
      defense: 2,
      speed: 80,
      monsterTypeId: 'troll',
      areaId: 'area-1',
    };
    const appearance = getEntityAppearance(monster);
    expect(appearance.char).toBe('T');
    expect(appearance.fg).toBe('#2E8B57');
  });

  it('returns char and default color for crawler', () => {
    const crawler: Entity = {
      id: 'player',
      type: 'crawler',
      x: 2,
      y: 2,
      hp: 10,
      maxHp: 10,
      name: 'Player',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    const appearance = getEntityAppearance(crawler);
    expect(appearance.char).toBe('@');
    expect(appearance.fg).toBe('#FFFF00'); // Yellow default
  });

  it('uses @ as fallback if crawler has no char', () => {
    // Edge case - shouldn't happen with schema validation, but handle gracefully
    const crawler = {
      id: 'player',
      type: 'crawler',
      x: 2,
      y: 2,
      hp: 10,
      maxHp: 10,
      name: 'Player',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    } as Entity;
    const appearance = getEntityAppearance(crawler);
    expect(appearance.char).toBe('@');
  });
});

describe('createMonster', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('creates monster with correct stats from type definition', () => {
    const monster = createMonster('troll', { x: 5, y: 5 }, { width: 10, height: 10 });
    expect(monster.hp).toBe(15);
    expect(monster.maxHp).toBe(15);
    expect(monster.attack).toBe(4);
    expect(monster.defense).toBe(2);
    expect(monster.speed).toBe(80);
    expect(monster.name).toBe('Troll');
    expect(monster.monsterTypeId).toBe('troll');
    expect(monster.type).toBe('monster');
  });

  // Parameterized test: verify all monster types have stats matching their definitions
  it.each(MONSTER_TYPE_IDS)('createMonster(%s) produces stats matching MONSTER_TYPES', (typeId) => {
    resetMonsterCounter();
    const monster = createMonster(typeId, { x: 5, y: 5 }, { width: 10, height: 10 });
    const expected = MONSTER_TYPES[typeId];

    expect(monster.hp).toBe(expected.baseStats.hp);
    expect(monster.maxHp).toBe(expected.baseStats.hp);
    expect(monster.attack).toBe(expected.baseStats.attack);
    expect(monster.defense).toBe(expected.baseStats.defense);
    expect(monster.speed).toBe(expected.baseStats.speed);
    expect(monster.name).toBe(expected.name);
    expect(monster.monsterTypeId).toBe(typeId);
  });

  it('throws for invalid monsterTypeId', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidType = 'dragon' as any;
    expect(() =>
      createMonster(invalidType, { x: 5, y: 5 }, { width: 10, height: 10 })
    ).toThrow('Unknown monster type "dragon"');
  });

  it('sets position correctly', () => {
    const monster = createMonster('rat', { x: 3, y: 7 }, { width: 10, height: 10 });
    expect(monster.x).toBe(3);
    expect(monster.y).toBe(7);
  });

  it('generates auto-incrementing ID', () => {
    const m1 = createMonster('rat', { x: 1, y: 1 }, { width: 10, height: 10 });
    const m2 = createMonster('goblin', { x: 2, y: 2 }, { width: 10, height: 10 });
    expect(m1.id).toBe('rat-0');
    expect(m2.id).toBe('goblin-1');
  });

  it('uses custom idSuffix when provided', () => {
    const monster = createMonster('orc', { x: 1, y: 1 }, { width: 10, height: 10 }, { idSuffix: 'boss' });
    expect(monster.id).toBe('orc-boss');
  });

  it('throws for position out of bounds', () => {
    expect(() =>
      createMonster('skeleton', { x: 15, y: 5 }, { width: 10, height: 10 })
    ).toThrow();
  });

  describe('behavior state initialization', () => {
    it('initializes skeleton with patrol behavior state', () => {
      const skeleton = createMonster('skeleton', { x: 5, y: 5 }, { width: 10, height: 10 });
      expect(skeleton.behaviorState).toBe('patrol');
    });

    it('initializes aggressive monsters with chase behavior state', () => {
      const rat = createMonster('rat', { x: 5, y: 5 }, { width: 10, height: 10 });
      expect(rat.behaviorState).toBe('chase');

      const goblin = createMonster('goblin', { x: 5, y: 5 }, { width: 10, height: 10 });
      expect(goblin.behaviorState).toBe('chase');
    });

    it('does not initialize lastKnownTarget or searchTurnsRemaining', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, { width: 10, height: 10 });
      expect(monster.lastKnownTarget).toBeUndefined();
      expect(monster.searchTurnsRemaining).toBeUndefined();
    });
  });
});

describe('selectRandomMonsterType', () => {
  it('returns a valid monster type ID', () => {
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);
    const typeId = selectRandomMonsterType(rng, 3); // dangerLevel 3 allows all tiers
    expect(MONSTER_TYPE_IDS).toContain(typeId);
  });

  it('returns different types with different seeds', () => {
    const types = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const rng = ROT.RNG.clone();
      rng.setSeed(seed);
      // Warm up RNG (first value after setSeed can be predictable)
      rng.getUniform();
      types.add(selectRandomMonsterType(rng, 3)); // dangerLevel 3 allows all tiers
    }
    expect(types.size).toBeGreaterThan(1);
  });

  it('handles RNG returning 0', () => {
    // Mock RNG that returns exactly 0
    const rngZero = { getUniform: () => 0 } as typeof ROT.RNG;
    const result = selectRandomMonsterType(rngZero, 3); // dangerLevel 3 allows all tiers
    expect(MONSTER_TYPE_IDS).toContain(result);
    // With tier filtering, first element of eligible list (tier 1 monsters: rat, goblin)
    expect(['rat', 'goblin', 'orc', 'skeleton', 'troll']).toContain(result);
  });

  it('handles RNG returning value just under 1', () => {
    // Mock RNG that returns just under 1 (should select last element)
    const rngAlmostOne = { getUniform: () => 0.9999 } as typeof ROT.RNG;
    const result = selectRandomMonsterType(rngAlmostOne, 3);
    expect(MONSTER_TYPE_IDS).toContain(result);
  });

  it('throws error when dangerLevel is less than 1', () => {
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);
    expect(() => selectRandomMonsterType(rng, 0)).toThrow('dangerLevel must be >= 1');
    expect(() => selectRandomMonsterType(rng, -1)).toThrow('dangerLevel must be >= 1');
  });

  it('dangerLevel 1 returns only level 1 monsters', () => {
    const rng = ROT.RNG.clone();
    const results = new Set<MonsterTypeId>();

    for (let seed = 0; seed < 100; seed++) {
      rng.setSeed(seed);
      rng.getUniform(); // Warm up
      results.add(selectRandomMonsterType(rng, 1));
    }

    // Should only contain level 1: rat, goblin, goblin_archer, bat
    for (const typeId of results) {
      expect(MONSTER_TYPES[typeId].level).toBe(1);
    }
    // Should have found level 1 types (rat, goblin, goblin_archer, bat)
    expect(results.has('rat')).toBe(true);
    expect(results.has('goblin')).toBe(true);
    expect(results.has('goblin_archer')).toBe(true);
    expect(results.has('bat')).toBe(true);
  });

  it('dangerLevel 2 excludes level 3 monsters', () => {
    const rng = ROT.RNG.clone();
    const results = new Set<MonsterTypeId>();

    for (let seed = 0; seed < 100; seed++) {
      rng.setSeed(seed);
      rng.getUniform(); // Warm up
      results.add(selectRandomMonsterType(rng, 2));
    }

    // Should not contain level 3 monsters (troll, minotaur, demon)
    expect(results.has('troll')).toBe(false);
    expect(results.has('minotaur')).toBe(false);
    expect(results.has('demon')).toBe(false);

    // Should contain level 1 and 2
    for (const typeId of results) {
      expect(MONSTER_TYPES[typeId].level).toBeLessThanOrEqual(2);
    }
  });

  it('dangerLevel 3 includes all monster types', () => {
    const rng = ROT.RNG.clone();
    const results = new Set<MonsterTypeId>();

    for (let seed = 0; seed < 200; seed++) {
      rng.setSeed(seed);
      rng.getUniform(); // Warm up
      results.add(selectRandomMonsterType(rng, 3));
    }

    // Should have found all 10 types
    expect(results.size).toBe(10);
    expect(results.has('rat')).toBe(true);
    expect(results.has('goblin')).toBe(true);
    expect(results.has('goblin_archer')).toBe(true);
    expect(results.has('orc')).toBe(true);
    expect(results.has('skeleton')).toBe(true);
    expect(results.has('troll')).toBe(true);
    expect(results.has('bat')).toBe(true);
    expect(results.has('snake')).toBe(true);
    expect(results.has('minotaur')).toBe(true);
    expect(results.has('demon')).toBe(true);
  });

  it('dangerLevel > max level behaves like max level', () => {
    const rng = ROT.RNG.clone();
    const results = new Set<MonsterTypeId>();

    for (let seed = 0; seed < 200; seed++) {
      rng.setSeed(seed);
      rng.getUniform(); // Warm up
      results.add(selectRandomMonsterType(rng, 10)); // Way above max level
    }

    // Should have found all 10 types (same as dangerLevel 3)
    expect(results.size).toBe(10);
  });
});

describe('getEntityAppearance edge cases', () => {
  it('returns red ? for monster without monsterTypeId', () => {
    // This is an invalid state that should not happen with schema validation
    const invalidMonster = {
      id: 'broken-monster',
      type: 'monster',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Broken',
      attack: 1,
      defense: 0,
      speed: 100,
      // missing monsterTypeId
    } as Entity;

    // Should return the invalid monster appearance (red ?)
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const appearance = getEntityAppearance(invalidMonster);
    expect(appearance.char).toBe('?');
    expect(appearance.fg).toBe('#FF0000');
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      { entityId: 'broken-monster', entityType: 'monster' },
      'Monster entity missing monsterTypeId - data integrity issue'
    );
    loggerErrorSpy.mockRestore();
  });

  it('logs warning for crawler without char', () => {
    const crawlerWithoutChar = {
      id: 'player',
      type: 'crawler',
      x: 2,
      y: 2,
      hp: 10,
      maxHp: 10,
      name: 'Player',
      attack: 2,
      defense: 0,
      speed: 100,
      // missing char
    } as Entity;

    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const appearance = getEntityAppearance(crawlerWithoutChar);
    expect(appearance.char).toBe('@'); // Falls back to default
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      { entityId: 'player' },
      'Crawler entity missing char field, using default'
    );
    loggerWarnSpy.mockRestore();
  });
});

describe('BehaviorState schema', () => {
  it('accepts valid behavior states', () => {
    const validStates = ['patrol', 'alerted', 'chase', 'hunt', 'search', 'idle'];
    for (const state of validStates) {
      expect(BehaviorStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it('rejects invalid behavior states', () => {
    expect(BehaviorStateSchema.safeParse('attack').success).toBe(false);
    expect(BehaviorStateSchema.safeParse('').success).toBe(false);
    expect(BehaviorStateSchema.safeParse(123).success).toBe(false);
  });
});

describe('Entity behavior fields', () => {
  it('accepts entity with behavior state', () => {
    const entity = {
      id: 'skeleton-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 8,
      maxHp: 8,
      name: 'Skeleton',
      attack: 2,
      defense: 2,
      speed: 100,
      monsterTypeId: 'skeleton',
      behaviorState: 'patrol',
    };
    expect(EntitySchema.safeParse(entity).success).toBe(true);
  });

  it('accepts entity with lastKnownTarget', () => {
    const entity = {
      id: 'goblin-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Goblin',
      attack: 2,
      defense: 0,
      speed: 100,
      monsterTypeId: 'goblin',
      behaviorState: 'hunt',
      lastKnownTarget: { x: 10, y: 10 },
    };
    expect(EntitySchema.safeParse(entity).success).toBe(true);
  });

  it('accepts entity with searchTurnsRemaining', () => {
    const entity = {
      id: 'orc-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Orc',
      attack: 3,
      defense: 1,
      speed: 90,
      monsterTypeId: 'orc',
      behaviorState: 'search',
      lastKnownTarget: { x: 8, y: 8 },
      searchTurnsRemaining: 5,
    };
    expect(EntitySchema.safeParse(entity).success).toBe(true);
  });

  it('rejects negative searchTurnsRemaining', () => {
    const entity = {
      id: 'rat-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 3,
      maxHp: 3,
      name: 'Rat',
      attack: 1,
      defense: 0,
      speed: 120,
      monsterTypeId: 'rat',
      searchTurnsRemaining: -1,
    };
    expect(EntitySchema.safeParse(entity).success).toBe(false);
  });

  it('rejects invalid lastKnownTarget format', () => {
    const entity = {
      id: 'troll-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 15,
      maxHp: 15,
      name: 'Troll',
      attack: 4,
      defense: 2,
      speed: 80,
      monsterTypeId: 'troll',
      lastKnownTarget: { x: 'invalid', y: 10 },
    };
    expect(EntitySchema.safeParse(entity).success).toBe(false);
  });

  it('accepts entity with searchTurnsRemaining of zero', () => {
    const entity = {
      id: 'orc-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Orc',
      attack: 3,
      defense: 1,
      speed: 90,
      monsterTypeId: 'orc',
      behaviorState: 'search',
      lastKnownTarget: { x: 8, y: 8 },
      searchTurnsRemaining: 0,
    };
    expect(EntitySchema.safeParse(entity).success).toBe(true);
  });

  it.each(['chase', 'idle'] as const)('accepts entity with %s behavior state', (state) => {
    const entity = {
      id: 'goblin-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Goblin',
      attack: 2,
      defense: 0,
      speed: 100,
      monsterTypeId: 'goblin',
      behaviorState: state,
    };
    expect(EntitySchema.safeParse(entity).success).toBe(true);
  });

  it('accepts entity with alerted state and lastKnownTarget', () => {
    const entity = {
      id: 'goblin-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Goblin',
      attack: 2,
      defense: 0,
      speed: 100,
      monsterTypeId: 'goblin',
      behaviorState: 'alerted',
      lastKnownTarget: { x: 10, y: 10 },
    };
    expect(EntitySchema.safeParse(entity).success).toBe(true);
  });

  describe('state/field coherence', () => {
    it('rejects alerted state without lastKnownTarget', () => {
      const entity = {
        id: 'goblin-1',
        type: 'monster',
        x: 5,
        y: 5,
        areaId: 'area-1',
        hp: 5,
        maxHp: 5,
        name: 'Goblin',
        attack: 2,
        defense: 0,
        speed: 100,
        monsterTypeId: 'goblin',
        behaviorState: 'alerted',
        // missing lastKnownTarget
      };
      expect(EntitySchema.safeParse(entity).success).toBe(false);
    });

    it('rejects hunt state without lastKnownTarget', () => {
      const entity = {
        id: 'goblin-1',
        type: 'monster',
        x: 5,
        y: 5,
        areaId: 'area-1',
        hp: 5,
        maxHp: 5,
        name: 'Goblin',
        attack: 2,
        defense: 0,
        speed: 100,
        monsterTypeId: 'goblin',
        behaviorState: 'hunt',
        // missing lastKnownTarget
      };
      expect(EntitySchema.safeParse(entity).success).toBe(false);
    });

    it('accepts hunt state with lastKnownTarget', () => {
      const entity = {
        id: 'goblin-1',
        type: 'monster',
        x: 5,
        y: 5,
        areaId: 'area-1',
        hp: 5,
        maxHp: 5,
        name: 'Goblin',
        attack: 2,
        defense: 0,
        speed: 100,
        monsterTypeId: 'goblin',
        behaviorState: 'hunt',
        lastKnownTarget: { x: 10, y: 10 },
      };
      expect(EntitySchema.safeParse(entity).success).toBe(true);
    });

    it('rejects search state without lastKnownTarget', () => {
      const entity = {
        id: 'orc-1',
        type: 'monster',
        x: 5,
        y: 5,
        areaId: 'area-1',
        hp: 10,
        maxHp: 10,
        name: 'Orc',
        attack: 3,
        defense: 1,
        speed: 90,
        monsterTypeId: 'orc',
        behaviorState: 'search',
        searchTurnsRemaining: 5,
        // missing lastKnownTarget
      };
      expect(EntitySchema.safeParse(entity).success).toBe(false);
    });

    it('rejects search state without searchTurnsRemaining', () => {
      const entity = {
        id: 'orc-1',
        type: 'monster',
        x: 5,
        y: 5,
        areaId: 'area-1',
        hp: 10,
        maxHp: 10,
        name: 'Orc',
        attack: 3,
        defense: 1,
        speed: 90,
        monsterTypeId: 'orc',
        behaviorState: 'search',
        lastKnownTarget: { x: 8, y: 8 },
        // missing searchTurnsRemaining
      };
      expect(EntitySchema.safeParse(entity).success).toBe(false);
    });

    it('accepts search state with both lastKnownTarget and searchTurnsRemaining', () => {
      const entity = {
        id: 'orc-1',
        type: 'monster',
        x: 5,
        y: 5,
        areaId: 'area-1',
        hp: 10,
        maxHp: 10,
        name: 'Orc',
        attack: 3,
        defense: 1,
        speed: 90,
        monsterTypeId: 'orc',
        behaviorState: 'search',
        lastKnownTarget: { x: 8, y: 8 },
        searchTurnsRemaining: 5,
      };
      expect(EntitySchema.safeParse(entity).success).toBe(true);
    });
  });
});

describe('getEntityVisionRadius', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('returns vision radius for monster with monsterTypeId', () => {
    const skeleton = createMonster('skeleton', { x: 5, y: 5 }, { width: 10, height: 10 });
    expect(getEntityVisionRadius(skeleton)).toBe(8);
  });

  it('returns vision radius for each monster type', () => {
    expect(getEntityVisionRadius(createMonster('rat', { x: 5, y: 5 }, { width: 10, height: 10 }))).toBe(4);
    expect(getEntityVisionRadius(createMonster('goblin', { x: 5, y: 5 }, { width: 10, height: 10 }))).toBe(6);
    expect(getEntityVisionRadius(createMonster('orc', { x: 5, y: 5 }, { width: 10, height: 10 }))).toBe(5);
    expect(getEntityVisionRadius(createMonster('troll', { x: 5, y: 5 }, { width: 10, height: 10 }))).toBe(6);
  });

  it('returns DEFAULT_VISION_RADIUS for entity without monsterTypeId', () => {
    const crawler: Entity = {
      id: 'player',
      type: 'crawler',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Player',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    expect(getEntityVisionRadius(crawler)).toBe(DEFAULT_VISION_RADIUS);
  });

  it('returns DEFAULT_VISION_RADIUS for monster with invalid monsterTypeId', () => {
    const invalidMonster = {
      id: 'dragon-1',
      type: 'monster',
      x: 5,
      y: 5,
      hp: 20,
      maxHp: 20,
      name: 'Dragon',
      attack: 5,
      defense: 3,
      speed: 100,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      monsterTypeId: 'dragon' as any,
    } as Entity;
    expect(getEntityVisionRadius(invalidMonster)).toBe(DEFAULT_VISION_RADIUS);
  });
});

describe('getSearchDuration', () => {
  it('returns search duration for monster type', () => {
    expect(getSearchDuration('rat')).toBe(3);
    expect(getSearchDuration('goblin')).toBe(5);
    expect(getSearchDuration('orc')).toBe(6);
    expect(getSearchDuration('skeleton')).toBe(10);
    expect(getSearchDuration('troll')).toBe(8);
  });

  it('throws for invalid monster type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidType = 'dragon' as any;
    expect(() => getSearchDuration(invalidType)).toThrow();
  });
});

describe('MonsterType tags', () => {
  it('troll has objective_target tag', () => {
    expect(MONSTER_TYPES.troll.tags).toContain('objective_target');
  });

  it('rat has no objective tags', () => {
    expect(MONSTER_TYPES.rat.tags).toBeUndefined();
  });
});

describe('goblin_archer (CRA-132)', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('has same stats as regular goblin', () => {
    const goblinArcher = MONSTER_TYPES.goblin_archer;
    const goblin = MONSTER_TYPES.goblin;

    expect(goblinArcher.level).toBe(goblin.level);
    expect(goblinArcher.baseStats.hp).toBe(goblin.baseStats.hp);
    expect(goblinArcher.baseStats.attack).toBe(goblin.baseStats.attack);
    expect(goblinArcher.baseStats.defense).toBe(goblin.baseStats.defense);
    expect(goblinArcher.baseStats.speed).toBe(goblin.baseStats.speed);
    expect(goblinArcher.visionRadius).toBe(goblin.visionRadius);
    expect(goblinArcher.searchDuration).toBe(goblin.searchDuration);
    expect(goblinArcher.defaultBehavior).toBe(goblin.defaultBehavior);
  });

  it('has canHaveEquipment enabled', () => {
    expect(MONSTER_TYPES.goblin_archer.canHaveEquipment).toBe(true);
  });

  it('has correct appearance (lime green)', () => {
    const appearance = MONSTER_APPEARANCE.goblin_archer;
    expect(appearance.char).toBe('g');
    expect(appearance.fg).toBe('#32CD32');
  });

  it('createMonster works for goblin_archer', () => {
    const bounds = { width: 10, height: 10 };
    const pos = { x: 5, y: 5 };

    const goblinArcher = createMonster('goblin_archer', pos, bounds);
    expect(goblinArcher.name).toBe('Goblin Archer');
    expect(goblinArcher.hp).toBe(5);
    expect(goblinArcher.monsterTypeId).toBe('goblin_archer');
  });

  it('goblin_archer spawns with guaranteed ranged equipment', () => {
    const bounds = { width: 10, height: 10 };
    const pos = { x: 5, y: 5 };

    const goblinArcher = createMonster('goblin_archer', pos, bounds);

    // Should have shortbow equipped
    expect(goblinArcher.equippedWeapon).not.toBeNull();
    expect(goblinArcher.equippedWeapon?.templateId).toBe('shortbow');

    // Should have leather_quiver in offhand
    expect(goblinArcher.equippedOffhand).not.toBeNull();
    expect(goblinArcher.equippedOffhand?.templateId).toBe('leather_quiver');

    // Quiver should have full ammo
    expect(goblinArcher.equippedOffhand?.currentAmmo).toBe(20);
  });

  it('regular goblin does not spawn with guaranteed equipment', () => {
    const bounds = { width: 10, height: 10 };
    const pos = { x: 5, y: 5 };

    const goblin = createMonster('goblin', pos, bounds);

    // Regular goblin should not have guaranteed equipment
    // (it may have rolled equipment, but that's handled by separate system)
    // For this test, we just verify it didn't get the archer's loadout
    expect(goblin.equippedWeapon?.templateId !== 'shortbow' || goblin.equippedOffhand?.templateId !== 'leather_quiver').toBe(true);
  });
});

describe('new monster types (CRA-105)', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  describe('bat', () => {
    it('is level 1 with high speed', () => {
      const bat = MONSTER_TYPES.bat;
      expect(bat.level).toBe(1);
      expect(bat.baseStats.speed).toBe(140);
      expect(bat.baseStats.hp).toBe(2);
    });

    it('has correct appearance', () => {
      const appearance = MONSTER_APPEARANCE.bat;
      expect(appearance.char).toBe('b');
      expect(appearance.fg).toBe('#8B008B');
    });
  });

  describe('snake', () => {
    it('is level 2 glass cannon', () => {
      const snake = MONSTER_TYPES.snake;
      expect(snake.level).toBe(2);
      expect(snake.baseStats.attack).toBe(4);
      expect(snake.baseStats.defense).toBe(0);
      expect(snake.defaultBehavior).toBe('patrol');
    });

    it('has correct appearance', () => {
      const appearance = MONSTER_APPEARANCE.snake;
      expect(appearance.char).toBe('S');
      expect(appearance.fg).toBe('#228B22');
    });
  });

  describe('minotaur', () => {
    it('is level 3 tank', () => {
      const minotaur = MONSTER_TYPES.minotaur;
      expect(minotaur.level).toBe(3);
      expect(minotaur.baseStats.hp).toBe(20);
      expect(minotaur.baseStats.defense).toBe(3);
      expect(minotaur.baseStats.speed).toBe(70);
    });

    it('has correct appearance', () => {
      const appearance = MONSTER_APPEARANCE.minotaur;
      expect(appearance.char).toBe('M');
      expect(appearance.fg).toBe('#8B4513');
    });
  });

  describe('demon', () => {
    it('is level 3 with high attack', () => {
      const demon = MONSTER_TYPES.demon;
      expect(demon.level).toBe(3);
      expect(demon.baseStats.attack).toBe(6);
      expect(demon.baseStats.speed).toBe(100);
    });

    it('has correct appearance', () => {
      const appearance = MONSTER_APPEARANCE.demon;
      expect(appearance.char).toBe('D');
      expect(appearance.fg).toBe('#DC143C');
    });
  });

  it('createMonster works for all new types', () => {
    const bounds = { width: 10, height: 10 };
    const pos = { x: 5, y: 5 };

    const bat = createMonster('bat', pos, bounds);
    expect(bat.name).toBe('Bat');
    expect(bat.hp).toBe(2);

    const snake = createMonster('snake', pos, bounds);
    expect(snake.name).toBe('Snake');
    expect(snake.behaviorState).toBe('patrol');

    const minotaur = createMonster('minotaur', pos, bounds);
    expect(minotaur.name).toBe('Minotaur');
    expect(minotaur.hp).toBe(20);

    const demon = createMonster('demon', pos, bounds);
    expect(demon.name).toBe('Demon');
    expect(demon.attack).toBe(6);
  });
});

