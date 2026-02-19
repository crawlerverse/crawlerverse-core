/**
 * Tests for the Targeting System
 *
 * Tests cover:
 * - getEquippedRangedWeapon: detecting bow/thrown weapons with ammo
 * - findValidTargets: finding monsters in range, FOV, and LOS
 * - enterTargetingMode: initializing targeting state
 * - cycleTargetNext/Prev: cycling through targets
 * - getCurrentTargetId: getting the selected target
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEquippedRangedWeapon,
  findValidTargets,
  enterTargetingMode,
  cycleTargetNext,
  cycleTargetPrev,
  getCurrentTargetId,
  INACTIVE_TARGETING,
  type TargetingState,
} from '../targeting';
import { createTestCrawler, createTestMonster } from './test-helpers';
import type { Entity } from '../types';
import type { DungeonMap, Tile } from '../map';
import { entityId } from '../scheduler';
import { clearFOVCache } from '../fov';

// --- Test Helpers ---

/**
 * Create a simple test map with all floor tiles and boundary walls.
 */
function createTestMap(
  width: number = 20,
  height: number = 20,
  walls: Array<{ x: number; y: number }> = []
): DungeonMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      // Boundary walls
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        tiles[y][x] = { type: 'wall' };
      } else {
        tiles[y][x] = { type: 'floor' };
      }
    }
  }

  // Add custom walls
  for (const wall of walls) {
    if (wall.y >= 0 && wall.y < height && wall.x >= 0 && wall.x < width) {
      tiles[wall.y][wall.x] = { type: 'wall' };
    }
  }

  return {
    width,
    height,
    tiles,
    rooms: [{ x: 1, y: 1, width: width - 2, height: height - 2, center: { x: Math.floor(width / 2), y: Math.floor(height / 2) }, tags: ['starting'] }],
    seed: 12345,
  };
}

/**
 * Create a crawler with a shortbow and quiver.
 */
function createBowCrawler(
  position: { x: number; y: number },
  ammo: number = 20
): Entity {
  return createTestCrawler({
    x: position.x,
    y: position.y,
    equippedWeapon: {
      id: 'bow-1',
      templateId: 'shortbow',
      x: 0,
      y: 0,
      areaId: 'area-1',
    },
    equippedOffhand: {
      id: 'quiver-1',
      templateId: 'leather_quiver',
      x: 0,
      y: 0,
      areaId: 'area-1',
      currentAmmo: ammo,
    },
  });
}

/**
 * Create a crawler with throwing daggers.
 */
function createThrownCrawler(
  position: { x: number; y: number },
  quantity: number = 5
): Entity {
  return createTestCrawler({
    x: position.x,
    y: position.y,
    equippedWeapon: {
      id: 'dagger-1',
      templateId: 'throwing_dagger',
      x: 0,
      y: 0,
      areaId: 'area-1',
      quantity: quantity,
    },
  });
}

/**
 * Create a monster at a position.
 */
function createMonsterAt(
  position: { x: number; y: number },
  id: string = 'monster-1',
  hp: number = 5
): Entity {
  return createTestMonster({
    id,
    x: position.x,
    y: position.y,
    hp,
    maxHp: hp,
    monsterTypeId: 'goblin',
  });
}

// --- Tests ---

describe('getEquippedRangedWeapon', () => {
  describe('bow weapons', () => {
    it('returns weapon info for bow with quiver containing arrows', () => {
      const crawler = createBowCrawler({ x: 5, y: 5 }, 15);

      const result = getEquippedRangedWeapon(crawler);

      expect(result).not.toBeNull();
      expect(result!.templateId).toBe('shortbow');
      expect(result!.range).toBe(6);
      expect(result!.rangedType).toBe('bow');
      expect(result!.ammoAvailable).toBe(15);
    });

    it('returns null for bow without quiver equipped', () => {
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: {
          id: 'bow-1',
          templateId: 'shortbow',
          x: 0,
          y: 0,
          areaId: 'area-1',
        },
        equippedOffhand: null,
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });

    it('returns null for bow with empty quiver', () => {
      const crawler = createBowCrawler({ x: 5, y: 5 }, 0);

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });
  });

  describe('thrown weapons', () => {
    it('returns weapon info for thrown weapon with quantity > 0', () => {
      const crawler = createThrownCrawler({ x: 5, y: 5 }, 3);

      const result = getEquippedRangedWeapon(crawler);

      expect(result).not.toBeNull();
      expect(result!.templateId).toBe('throwing_dagger');
      expect(result!.range).toBe(4);
      expect(result!.rangedType).toBe('thrown');
      expect(result!.ammoAvailable).toBe(3);
    });

    it('returns null for thrown weapon with quantity 0', () => {
      const crawler = createThrownCrawler({ x: 5, y: 5 }, 0);

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });

    it('returns null for thrown weapon with undefined quantity', () => {
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: {
          id: 'dagger-1',
          templateId: 'throwing_dagger',
          x: 0,
          y: 0,
          areaId: 'area-1',
          // quantity intentionally omitted
        },
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });
  });

  describe('no weapon or melee weapon', () => {
    it('returns null when no weapon equipped', () => {
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: null,
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });

    it('returns null when equippedWeapon is undefined', () => {
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });

    it('returns null for melee weapon', () => {
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: {
          id: 'sword-1',
          templateId: 'short_sword',
          x: 0,
          y: 0,
          areaId: 'area-1',
        },
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });
  });

  describe('rogue configuration (melee weapon + thrown offhand)', () => {
    it('returns thrown weapon info when sword in main slot and throwing daggers in offhand', () => {
      // This is the rogue starting loadout: short_sword + throwing_dagger
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: {
          id: 'sword-1',
          templateId: 'short_sword',
          x: 0,
          y: 0,
          areaId: 'area-1',
        },
        equippedOffhand: {
          id: 'dagger-1',
          templateId: 'throwing_dagger',
          x: 0,
          y: 0,
          areaId: 'area-1',
          quantity: 5,
        },
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).not.toBeNull();
      expect(result!.templateId).toBe('throwing_dagger');
      expect(result!.range).toBe(4);
      expect(result!.rangedType).toBe('thrown');
      expect(result!.ammoAvailable).toBe(5);
    });

    it('returns null when offhand thrown weapon has no quantity', () => {
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: {
          id: 'sword-1',
          templateId: 'short_sword',
          x: 0,
          y: 0,
          areaId: 'area-1',
        },
        equippedOffhand: {
          id: 'dagger-1',
          templateId: 'throwing_dagger',
          x: 0,
          y: 0,
          areaId: 'area-1',
          quantity: 0,
        },
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).toBeNull();
    });

    it('prioritizes main weapon slot ranged weapon over offhand thrown', () => {
      // If player has bow in main slot and throwing daggers in offhand,
      // the bow should be returned (but this would need quiver, not daggers, to work)
      // So this tests that thrown in main slot takes priority
      const crawler = createTestCrawler({
        x: 5,
        y: 5,
        equippedWeapon: {
          id: 'dagger-main',
          templateId: 'throwing_dagger',
          x: 0,
          y: 0,
          areaId: 'area-1',
          quantity: 3,
        },
        equippedOffhand: {
          id: 'dagger-off',
          templateId: 'throwing_dagger',
          x: 0,
          y: 0,
          areaId: 'area-1',
          quantity: 5,
        },
      });

      const result = getEquippedRangedWeapon(crawler);

      expect(result).not.toBeNull();
      expect(result!.templateId).toBe('throwing_dagger');
      // Should use main slot's quantity (3), not offhand (5)
      expect(result!.ammoAvailable).toBe(3);
    });
  });
});

describe('findValidTargets', () => {
  beforeEach(() => {
    clearFOVCache();
  });

  describe('basic targeting', () => {
    it('finds monsters within weapon range', () => {
      const map = createTestMap();
      const player = createBowCrawler({ x: 10, y: 10 });
      const monster1 = createMonsterAt({ x: 10, y: 5 }, 'monster-1'); // 5 tiles north (in range)
      const monster2 = createMonsterAt({ x: 10, y: 3 }, 'monster-2'); // 7 tiles north (out of range for shortbow, range=6)

      const result = findValidTargets(player, [monster1, monster2], map, 6);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(entityId('monster-1'));
    });

    it('excludes monsters beyond weapon range', () => {
      const map = createTestMap();
      const player = createBowCrawler({ x: 10, y: 10 });
      const monster = createMonsterAt({ x: 10, y: 2 }, 'monster-1'); // 8 tiles away

      const result = findValidTargets(player, [monster], map, 6);

      expect(result).toHaveLength(0);
    });

    it('sorts targets by distance (closest first)', () => {
      const map = createTestMap();
      const player = createBowCrawler({ x: 10, y: 10 });
      const monster1 = createMonsterAt({ x: 10, y: 5 }, 'far-monster'); // 5 tiles
      const monster2 = createMonsterAt({ x: 10, y: 8 }, 'near-monster'); // 2 tiles
      const monster3 = createMonsterAt({ x: 10, y: 7 }, 'mid-monster'); // 3 tiles

      const result = findValidTargets(player, [monster1, monster2, monster3], map, 6);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(entityId('near-monster'));
      expect(result[1]).toBe(entityId('mid-monster'));
      expect(result[2]).toBe(entityId('far-monster'));
    });

    it('excludes dead monsters (hp <= 0)', () => {
      const map = createTestMap();
      const player = createBowCrawler({ x: 10, y: 10 });
      const deadMonster = createMonsterAt({ x: 10, y: 7 }, 'dead-monster', 0);
      const aliveMonster = createMonsterAt({ x: 10, y: 8 }, 'alive-monster', 5);

      const result = findValidTargets(player, [deadMonster, aliveMonster], map, 6);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(entityId('alive-monster'));
    });

    it('excludes adjacent monsters (melee range)', () => {
      const map = createTestMap();
      const player = createBowCrawler({ x: 10, y: 10 });
      const adjacentMonster = createMonsterAt({ x: 10, y: 9 }, 'adjacent'); // 1 tile away
      const rangedMonster = createMonsterAt({ x: 10, y: 7 }, 'ranged'); // 3 tiles away

      const result = findValidTargets(player, [adjacentMonster, rangedMonster], map, 6);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(entityId('ranged'));
    });
  });

  describe('line of sight', () => {
    it('excludes monsters blocked by walls', () => {
      // Create a wall between player and monster
      const walls = [{ x: 10, y: 8 }]; // Wall blocking path
      const map = createTestMap(20, 20, walls);
      const player = createBowCrawler({ x: 10, y: 10 });
      const blockedMonster = createMonsterAt({ x: 10, y: 6 }, 'blocked'); // Behind wall
      const clearMonster = createMonsterAt({ x: 12, y: 8 }, 'clear'); // Clear LOS

      const result = findValidTargets(player, [blockedMonster, clearMonster], map, 6);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(entityId('clear'));
    });
  });

  describe('field of view', () => {
    it('excludes monsters outside player FOV', () => {
      const map = createTestMap(30, 30);
      // Player with limited vision radius
      const player = createTestCrawler({
        x: 10,
        y: 10,
        visionRadius: 4, // Can only see 4 tiles
        equippedWeapon: {
          id: 'bow-1',
          templateId: 'shortbow',
          x: 0,
          y: 0,
          areaId: 'area-1',
        },
        equippedOffhand: {
          id: 'quiver-1',
          templateId: 'leather_quiver',
          x: 0,
          y: 0,
          areaId: 'area-1',
          currentAmmo: 20,
        },
      });
      const visibleMonster = createMonsterAt({ x: 10, y: 7 }, 'visible'); // 3 tiles (in FOV)
      const invisibleMonster = createMonsterAt({ x: 10, y: 4 }, 'invisible'); // 6 tiles (outside FOV)

      const result = findValidTargets(player, [visibleMonster, invisibleMonster], map, 10);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(entityId('visible'));
    });
  });

  describe('area filtering', () => {
    it('excludes monsters in different areas', () => {
      const map = createTestMap();
      const player = createBowCrawler({ x: 10, y: 10 });
      const sameAreaMonster = createMonsterAt({ x: 10, y: 7 }, 'same-area');
      const differentAreaMonster = createTestMonster({
        id: 'different-area',
        x: 10,
        y: 8,
        areaId: 'area-2', // Different area
        hp: 5,
        maxHp: 5,
        monsterTypeId: 'goblin',
      });

      const result = findValidTargets(player, [sameAreaMonster, differentAreaMonster], map, 6);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(entityId('same-area'));
    });
  });
});

describe('enterTargetingMode', () => {
  beforeEach(() => {
    clearFOVCache();
  });

  it('returns targeting state with valid targets', () => {
    const map = createTestMap();
    const player = createBowCrawler({ x: 10, y: 10 });
    const monster1 = createMonsterAt({ x: 10, y: 7 }, 'monster-1');
    const monster2 = createMonsterAt({ x: 10, y: 8 }, 'monster-2');

    const result = enterTargetingMode(player, [monster1, monster2], map);

    expect(result.failureReason).toBeNull();
    expect(result.state.active).toBe(true);
    expect(result.state.validTargets).toHaveLength(2);
    expect(result.state.currentIndex).toBe(0);
    expect(result.state.weaponRange).toBe(6); // Shortbow range
  });

  it('returns failure reason when player has no ranged weapon', () => {
    const map = createTestMap();
    const player = createTestCrawler({
      x: 10,
      y: 10,
      equippedWeapon: null,
    });
    const monster = createMonsterAt({ x: 10, y: 7 }, 'monster-1');

    const result = enterTargetingMode(player, [monster], map);

    expect(result.failureReason).toBe('no_ranged_weapon');
    expect(result.state.active).toBe(false);
  });

  it('returns failure reason when no ammo available', () => {
    const map = createTestMap();
    const player = createBowCrawler({ x: 10, y: 10 }, 0); // No ammo
    const monster = createMonsterAt({ x: 10, y: 7 }, 'monster-1');

    const result = enterTargetingMode(player, [monster], map);

    expect(result.failureReason).toBe('no_ranged_weapon');
    expect(result.state.active).toBe(false);
  });

  it('returns failure reason when no valid targets exist', () => {
    const map = createTestMap();
    const player = createBowCrawler({ x: 10, y: 10 });
    // No monsters

    const result = enterTargetingMode(player, [], map);

    expect(result.failureReason).toBe('no_targets');
    expect(result.state.active).toBe(false);
  });

  it('returns failure reason when all monsters are out of range', () => {
    const map = createTestMap(30, 30);
    const player = createBowCrawler({ x: 10, y: 10 });
    const farMonster = createMonsterAt({ x: 10, y: 2 }, 'far-monster'); // 8 tiles away

    const result = enterTargetingMode(player, [farMonster], map);

    expect(result.failureReason).toBe('no_targets');
    expect(result.state.active).toBe(false);
  });

  it('returns failure reason when all monsters are adjacent (melee range)', () => {
    const map = createTestMap();
    const player = createBowCrawler({ x: 10, y: 10 });
    const adjacentMonster = createMonsterAt({ x: 10, y: 9 }, 'adjacent');

    const result = enterTargetingMode(player, [adjacentMonster], map);

    expect(result.failureReason).toBe('no_targets');
    expect(result.state.active).toBe(false);
  });
});

describe('cycleTargetNext', () => {
  it('cycles to the next target', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [entityId('a'), entityId('b'), entityId('c')],
      currentIndex: 0,
      weaponRange: 6,
    };

    const result = cycleTargetNext(state);

    expect(result.currentIndex).toBe(1);
  });

  it('wraps around to the beginning', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [entityId('a'), entityId('b'), entityId('c')],
      currentIndex: 2, // Last index
      weaponRange: 6,
    };

    const result = cycleTargetNext(state);

    expect(result.currentIndex).toBe(0);
  });

  it('returns unchanged state when targeting is inactive', () => {
    const state = INACTIVE_TARGETING;

    const result = cycleTargetNext(state);

    expect(result).toBe(state);
  });

  it('returns unchanged state when no targets', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [],
      currentIndex: 0,
      weaponRange: 6,
    };

    const result = cycleTargetNext(state);

    expect(result).toBe(state);
  });
});

describe('cycleTargetPrev', () => {
  it('cycles to the previous target', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [entityId('a'), entityId('b'), entityId('c')],
      currentIndex: 1,
      weaponRange: 6,
    };

    const result = cycleTargetPrev(state);

    expect(result.currentIndex).toBe(0);
  });

  it('wraps around to the end', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [entityId('a'), entityId('b'), entityId('c')],
      currentIndex: 0, // First index
      weaponRange: 6,
    };

    const result = cycleTargetPrev(state);

    expect(result.currentIndex).toBe(2);
  });

  it('returns unchanged state when targeting is inactive', () => {
    const state = INACTIVE_TARGETING;

    const result = cycleTargetPrev(state);

    expect(result).toBe(state);
  });

  it('returns unchanged state when no targets', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [],
      currentIndex: 0,
      weaponRange: 6,
    };

    const result = cycleTargetPrev(state);

    expect(result).toBe(state);
  });
});

describe('getCurrentTargetId', () => {
  it('returns the currently selected target', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [entityId('a'), entityId('b'), entityId('c')],
      currentIndex: 1,
      weaponRange: 6,
    };

    const result = getCurrentTargetId(state);

    expect(result).toBe(entityId('b'));
  });

  it('returns null when targeting is inactive', () => {
    const result = getCurrentTargetId(INACTIVE_TARGETING);

    expect(result).toBeNull();
  });

  it('returns null when no targets', () => {
    const state: TargetingState = {
      active: true,
      validTargets: [],
      currentIndex: 0,
      weaponRange: 6,
    };

    const result = getCurrentTargetId(state);

    expect(result).toBeNull();
  });
});

describe('INACTIVE_TARGETING constant', () => {
  it('has correct default values', () => {
    expect(INACTIVE_TARGETING.active).toBe(false);
    expect(INACTIVE_TARGETING.validTargets).toEqual([]);
    expect(INACTIVE_TARGETING.currentIndex).toBe(0);
    expect(INACTIVE_TARGETING.weaponRange).toBe(0);
  });
});

describe('integration scenarios', () => {
  beforeEach(() => {
    clearFOVCache();
  });

  it('full targeting cycle: enter, cycle through targets, exit', () => {
    const map = createTestMap();
    const player = createBowCrawler({ x: 10, y: 10 });
    const monster1 = createMonsterAt({ x: 10, y: 8 }, 'close'); // 2 tiles
    const monster2 = createMonsterAt({ x: 10, y: 6 }, 'medium'); // 4 tiles
    const monster3 = createMonsterAt({ x: 10, y: 5 }, 'far'); // 5 tiles

    // Enter targeting mode
    const result = enterTargetingMode(player, [monster1, monster2, monster3], map);
    expect(result.failureReason).toBeNull();
    expect(result.state.validTargets).toHaveLength(3);

    // First target should be closest
    let state = result.state;
    expect(getCurrentTargetId(state)).toBe(entityId('close'));

    // Cycle to next
    state = cycleTargetNext(state);
    expect(getCurrentTargetId(state)).toBe(entityId('medium'));

    // Cycle to next
    state = cycleTargetNext(state);
    expect(getCurrentTargetId(state)).toBe(entityId('far'));

    // Cycle wraps around
    state = cycleTargetNext(state);
    expect(getCurrentTargetId(state)).toBe(entityId('close'));

    // Cycle previous
    state = cycleTargetPrev(state);
    expect(getCurrentTargetId(state)).toBe(entityId('far'));
  });

  it('handles thrown weapons with limited quantity', () => {
    const map = createTestMap();
    const player = createThrownCrawler({ x: 10, y: 10 }, 2); // Only 2 daggers
    const monster = createMonsterAt({ x: 10, y: 7 }, 'monster');

    const result = enterTargetingMode(player, [monster], map);

    expect(result.failureReason).toBeNull();
    expect(result.state.weaponRange).toBe(4); // Throwing dagger range
  });
});
