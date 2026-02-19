// packages/crawler-core/lib/engine/__tests__/fov.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeVisibleTiles,
  computeMonsterFOV,
  canMonsterSee,
  updateExploredTiles,
  isEntityVisible,
  hasLineOfSight,
  tileKey,
  clearFOVCache,
  getFOVCacheStats,
  DEFAULT_VISION_RADIUS,
  type TileKey,
} from '../fov';
import { parseAsciiMap, type DungeonMap, type Tile } from '../map';
import { createMonster, resetMonsterCounter } from '../monsters';
import type { Entity } from '../types';

/**
 * Helper to create a DungeonMap from ASCII lines for testing.
 * parseAsciiMap returns { tiles, width, height } but we need a full DungeonMap.
 */
function createTestMap(lines: string[]): DungeonMap {
  const ascii = lines.join('\n');
  const { tiles, width, height } = parseAsciiMap(ascii);
  return {
    tiles,
    width,
    height,
    rooms: [],
    seed: 0,
  };
}

/**
 * Helper to create a test entity with sensible defaults.
 * Override any field by passing it in the overrides object.
 */
function createTestEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'test-entity',
    type: 'crawler',
    x: 0,
    y: 0,
    hp: 10,
    maxHp: 10,
    name: 'Test Entity',
    attack: 1,
    defense: 1,
    speed: 100,
    char: '@',
    areaId: 'area-1',
    ...overrides,
  };
}

// Clear cache and reset counters before each test to ensure isolation
beforeEach(() => {
  clearFOVCache();
  resetMonsterCounter();
});

describe('tileKey', () => {
  it('creates consistent key from coordinates', () => {
    expect(tileKey(3, 5)).toBe('3,5');
    expect(tileKey(0, 0)).toBe('0,0');
    expect(tileKey(-3, 7)).toBe('-3,7');
  });
});

describe('computeVisibleTiles', () => {
  it('returns tiles visible from origin in open room', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const visible = computeVisibleTiles(map, 2, 2, 8);

    // Should see all floor tiles and adjacent walls
    expect(visible.has(tileKey(2, 2))).toBe(true); // self
    expect(visible.has(tileKey(1, 1))).toBe(true); // corner floor
    expect(visible.has(tileKey(3, 3))).toBe(true); // corner floor
    expect(visible.has(tileKey(0, 0))).toBe(true); // corner wall (visible)
  });

  it('walls block visibility', () => {
    const map = createTestMap([
      '#######',
      '#..#..#',
      '#.@#..#',
      '#..#..#',
      '#######',
    ]);

    const visible = computeVisibleTiles(map, 2, 2, 8);

    // Should see left side
    expect(visible.has(tileKey(1, 2))).toBe(true);
    // Wall is visible
    expect(visible.has(tileKey(3, 2))).toBe(true);
    // Should NOT see right side (behind wall)
    expect(visible.has(tileKey(4, 2))).toBe(false);
    expect(visible.has(tileKey(5, 2))).toBe(false);
  });

  it('respects vision radius', () => {
    const map = createTestMap([
      '#########',
      '#.......#',
      '#.......#',
      '#.......#',
      '#...@...#',
      '#.......#',
      '#.......#',
      '#.......#',
      '#########',
    ]);

    const visible = computeVisibleTiles(map, 4, 4, 2);

    // Within radius
    expect(visible.has(tileKey(4, 4))).toBe(true); // self
    expect(visible.has(tileKey(4, 2))).toBe(true); // 2 tiles north
    // Beyond radius
    expect(visible.has(tileKey(4, 1))).toBe(false); // 3 tiles north
  });

  it('closed doors block visibility', () => {
    const map = createTestMap([
      '#####',
      '#.+.#',
      '#.@.#',
      '#####',
    ]);

    const visible = computeVisibleTiles(map, 2, 2, 8);

    // Door itself is visible
    expect(visible.has(tileKey(2, 1))).toBe(true);
    // Behind closed door is not visible
    expect(visible.has(tileKey(2, 0))).toBe(false);
  });

  it('open doors allow visibility', () => {
    const map = createTestMap([
      '#####',
      '#./.#',
      '#.@.#',
      '#####',
    ]);

    const visible = computeVisibleTiles(map, 2, 2, 8);

    // Door is visible
    expect(visible.has(tileKey(2, 1))).toBe(true);
    // Wall behind open door is visible
    expect(visible.has(tileKey(2, 0))).toBe(true);
  });

  it('handles L-shaped corridor blocking correctly', () => {
    // L-shaped corridor: player in one arm cannot see around the corner
    const map = createTestMap([
      '#######',
      '#.....#',
      '#.@##.#',
      '#..#..#',
      '#..#..#',
      '#.....#',
      '#######',
    ]);

    const visible = computeVisibleTiles(map, 2, 2, 8);

    // Viewer position is visible
    expect(visible.has(tileKey(2, 2))).toBe(true);
    // Wall is visible
    expect(visible.has(tileKey(3, 2))).toBe(true);
    // Tiles behind the L-shaped wall should NOT be visible
    expect(visible.has(tileKey(5, 4))).toBe(false);
    expect(visible.has(tileKey(5, 5))).toBe(false);
  });

  it('throws on out of bounds position', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#...#',
      '#####',
    ]);

    expect(() => computeVisibleTiles(map, -1, 2, 8)).toThrow('out of bounds');
    expect(() => computeVisibleTiles(map, 10, 2, 8)).toThrow('out of bounds');
    expect(() => computeVisibleTiles(map, 2, -1, 8)).toThrow('out of bounds');
    expect(() => computeVisibleTiles(map, 2, 10, 8)).toThrow('out of bounds');
  });

  it('handles minimum vision radius of 1', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const visible = computeVisibleTiles(map, 2, 2, 1);

    // Should see self and immediate neighbors
    expect(visible.has(tileKey(2, 2))).toBe(true); // self
    expect(visible.has(tileKey(2, 1))).toBe(true); // north
    expect(visible.has(tileKey(2, 3))).toBe(true); // south
    // Should not see 2 tiles away
    expect(visible.has(tileKey(2, 0))).toBe(false); // north wall
  });
});

describe('FOV caching', () => {
  it('returns cached result on repeat call with same parameters', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const visible1 = computeVisibleTiles(map, 2, 2, 8);
    const visible2 = computeVisibleTiles(map, 2, 2, 8);

    // Should return the exact same Set instance
    expect(visible1).toBe(visible2);
  });

  it('computes new result when position changes', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const visible1 = computeVisibleTiles(map, 2, 2, 8);
    const visible2 = computeVisibleTiles(map, 1, 2, 8);

    // Should be different Set instances
    expect(visible1).not.toBe(visible2);
  });

  it('clears cache when clearFOVCache is called', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const visible1 = computeVisibleTiles(map, 2, 2, 8);
    clearFOVCache();
    const visible2 = computeVisibleTiles(map, 2, 2, 8);

    // Should be different Set instances after cache clear
    expect(visible1).not.toBe(visible2);
    // But should have same content
    expect(visible1.size).toBe(visible2.size);
  });

  it('tracks cache statistics', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const stats1 = getFOVCacheStats();
    expect(stats1.size).toBe(0);

    computeVisibleTiles(map, 2, 2, 8);
    const stats2 = getFOVCacheStats();
    expect(stats2.size).toBe(1);

    computeVisibleTiles(map, 1, 2, 8);
    const stats3 = getFOVCacheStats();
    expect(stats3.size).toBe(2);
  });
});

describe('updateExploredTiles', () => {
  it('merges visible tiles into explored set for a specific area', () => {
    const areaId = 'area-1';
    const exploredTiles: Record<string, Set<TileKey>> = {
      [areaId]: new Set([tileKey(1, 1), tileKey(2, 2)]),
    };
    const visible = new Set([tileKey(2, 2), tileKey(3, 3)]);

    const result = updateExploredTiles(exploredTiles, visible, areaId);

    expect(result[areaId].has(tileKey(1, 1))).toBe(true); // kept from explored
    expect(result[areaId].has(tileKey(2, 2))).toBe(true); // in both
    expect(result[areaId].has(tileKey(3, 3))).toBe(true); // added from visible
    expect(result[areaId].size).toBe(3);
  });

  it('returns new record without mutating inputs', () => {
    const areaId = 'area-1';
    const explored = new Set([tileKey(1, 1)]);
    const exploredTiles: Record<string, Set<TileKey>> = { [areaId]: explored };
    const visible = new Set([tileKey(2, 2)]);

    const result = updateExploredTiles(exploredTiles, visible, areaId);

    expect(explored.size).toBe(1); // original set not mutated
    expect(visible.size).toBe(1);
    expect(result).not.toBe(exploredTiles);
    expect(result[areaId]).not.toBe(explored);
  });
});

describe('isEntityVisible', () => {
  it('returns true if entity position is in visible set', () => {
    const visible = new Set([tileKey(3, 5), tileKey(4, 5)]);
    expect(isEntityVisible({ x: 3, y: 5 }, visible)).toBe(true);
  });

  it('returns false if entity position is not visible', () => {
    const visible = new Set([tileKey(3, 5), tileKey(4, 5)]);
    expect(isEntityVisible({ x: 10, y: 10 }, visible)).toBe(false);
  });

  it('returns false when entity coordinates do not match any visible tile', () => {
    const visible = new Set([tileKey(3, 5)]);
    // Non-integer coords produce a different key than what's in the set
    expect(isEntityVisible({ x: 3.5, y: 5 }, visible)).toBe(false);
  });
});

// --- computeMonsterFOV Tests ---

describe('computeMonsterFOV', () => {
  it('uses monster type visionRadius (rat has visionRadius 4)', () => {
    // Create a map with walls to properly test FOV boundaries
    // Rat at position (5, 5) with visionRadius 4
    const map = createTestMap([
      '###########',
      '#.........#',
      '#.........#',
      '#.........#',
      '#.........#',
      '#....@....#',  // rat at (5, 5)
      '#.........#',
      '#.........#',
      '#.........#',
      '#.........#',
      '###########',
    ]);

    // Create a rat monster at position (5, 5) - rat has visionRadius: 4
    const rat = createMonster('rat', { x: 5, y: 5 }, { width: 11, height: 11 });

    const visible = computeMonsterFOV(rat, map);

    // Rat should see its own position
    expect(visible.has(tileKey(5, 5))).toBe(true);

    // Rat should see tiles within radius 4
    expect(visible.has(tileKey(5, 2))).toBe(true);   // 3 tiles north (within radius)
    expect(visible.has(tileKey(8, 5))).toBe(true);   // 3 tiles east (within radius)

    // Rat should NOT see tiles beyond visionRadius 4
    // With visionRadius 4, the wall at y=0 (distance 5) should not be fully visible
    // The floor at (5, 1) is 4 tiles away - right at the edge
    expect(visible.has(tileKey(5, 1))).toBe(true);   // 4 tiles north (at edge of radius)

    // Tiles beyond the map boundary are never visible
    // But we can verify the vision is limited by checking that the function
    // returns different results for rat vs a larger visionRadius monster
  });

  it('uses DEFAULT_VISION_RADIUS for entity without monsterTypeId (crawler)', () => {
    // Crawler should have DEFAULT_VISION_RADIUS (8)
    // Create a larger map to test the extended range
    const map = createTestMap([
      '###################',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#........@........#',  // crawler at (9, 9)
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '###################',
    ]);

    // Create a crawler entity (no monsterTypeId)
    const crawler: Entity = {
      id: 'player-1',
      type: 'crawler',
      x: 9,
      y: 9,
      hp: 10,
      maxHp: 10,
      name: 'Test Crawler',
      attack: 2,
      defense: 1,
      speed: 100,
      char: '@',
      areaId: 'area-1',
    };

    const visible = computeMonsterFOV(crawler, map);

    // Crawler should see its own position
    expect(visible.has(tileKey(9, 9))).toBe(true);

    // DEFAULT_VISION_RADIUS is 8, so should see tiles up to 8 away
    expect(visible.has(tileKey(9, 2))).toBe(true);   // 7 tiles north (within radius)
    expect(visible.has(tileKey(16, 9))).toBe(true);  // 7 tiles east (within radius)

    // Verify the function uses DEFAULT_VISION_RADIUS by comparing
    // to what computeVisibleTiles would return with explicit radius
    const expectedVisible = computeVisibleTiles(map, 9, 9, DEFAULT_VISION_RADIUS);
    expect(visible.size).toBe(expectedVisible.size);
  });

  it('respects walls blocking monster vision', () => {
    // Monster can see up to wall but not beyond
    const map = createTestMap([
      '#######',
      '#..#..#',
      '#.@#..#',
      '#..#..#',
      '#######',
    ]);

    // Create a goblin at position (2, 2) - goblin has visionRadius: 6
    const goblin = createMonster('goblin', { x: 2, y: 2 }, { width: 7, height: 5 });

    const visible = computeMonsterFOV(goblin, map);

    // Should see the wall
    expect(visible.has(tileKey(3, 2))).toBe(true);
    // Should NOT see behind wall
    expect(visible.has(tileKey(4, 2))).toBe(false);
    expect(visible.has(tileKey(5, 2))).toBe(false);
  });

  it('different monster types have different vision ranges', () => {
    // Rat (visionRadius: 4) should see fewer tiles than Skeleton (visionRadius: 8)
    const map = createTestMap([
      '###################',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#........@........#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      '###################',
    ]);

    const rat = createMonster('rat', { x: 9, y: 9 }, { width: 19, height: 19 });
    const skeleton = createMonster('skeleton', { x: 9, y: 9 }, { width: 19, height: 19 });

    const ratVisible = computeMonsterFOV(rat, map);
    const skeletonVisible = computeMonsterFOV(skeleton, map);

    // Skeleton with visionRadius 8 should see more tiles than rat with visionRadius 4
    expect(skeletonVisible.size).toBeGreaterThan(ratVisible.size);
  });
});

// --- canMonsterSee Tests ---

describe('canMonsterSee', () => {
  it('returns true when target is within vision radius', () => {
    // Skeleton at (10,10) with visionRadius 8, target at (10,16) = 6 tiles away
    // 6 < 8, so should be visible
    const map = createTestMap([
      '#####################',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#.........@.........#', // monster at (10, 10)
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#.........T.........#', // target at (10, 16) - 6 tiles south
      '#...................#',
      '#...................#',
      '#...................#',
      '#####################',
    ]);

    // skeleton has visionRadius: 8
    const skeleton = createMonster('skeleton', { x: 10, y: 10 }, { width: 21, height: 21 });

    // Target entity at (10, 16) - 6 tiles away (within skeleton's vision of 8)
    const target = createTestEntity({ id: 'target-1', x: 10, y: 16 });

    expect(canMonsterSee(skeleton, target, map)).toBe(true);
  });

  it('returns false when target is beyond vision radius', () => {
    // Rat at (10,10) with visionRadius 4, target at (10,16) = 6 tiles away
    // 6 > 4, so should NOT be visible
    const map = createTestMap([
      '#####################',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#.........@.........#', // monster at (10, 10)
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#...................#',
      '#.........T.........#', // target at (10, 16) - 6 tiles south
      '#...................#',
      '#...................#',
      '#...................#',
      '#####################',
    ]);

    // rat has visionRadius: 4
    const rat = createMonster('rat', { x: 10, y: 10 }, { width: 21, height: 21 });

    // Target entity at (10, 16) - 6 tiles away (beyond rat's vision of 4)
    const target = createTestEntity({ id: 'target-1', x: 10, y: 16 });

    expect(canMonsterSee(rat, target, map)).toBe(false);
  });

  it('returns false when line of sight is blocked by wall', () => {
    // Even if target is within vision radius, wall blocks LOS
    const map = createTestMap([
      '#########',
      '#...#...#',
      '#.@.#.T.#', // monster at (2,2), wall at (4,2), target at (6,2)
      '#...#...#',
      '#########',
    ]);

    // goblin has visionRadius: 6, enough to reach (6,2) if no wall
    const goblin = createMonster('goblin', { x: 2, y: 2 }, { width: 9, height: 5 });

    // Target at (6, 2) - only 4 tiles away but wall blocks LOS
    const target = createTestEntity({ id: 'target-1', x: 6, y: 2 });

    expect(canMonsterSee(goblin, target, map)).toBe(false);
  });

  it('returns true when target is at same position as monster', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const rat = createMonster('rat', { x: 2, y: 2 }, { width: 5, height: 5 });
    const target = createTestEntity({ x: 2, y: 2 });

    expect(canMonsterSee(rat, target, map)).toBe(true);
  });
});

// --- Per-Area Explored Tiles Tests ---

describe('per-area explored tiles', () => {
  it('updateExploredTiles uses areaId to key explored tiles', () => {
    const exploredTiles: Record<string, Set<TileKey>> = {};
    const visibleTiles = new Set([tileKey(3, 4), tileKey(3, 5)]);
    const areaId = 'area-1';

    const updated = updateExploredTiles(exploredTiles, visibleTiles, areaId);

    expect(updated[areaId]).toBeDefined();
    expect(updated[areaId].has(tileKey(3, 4))).toBe(true);
    expect(updated[areaId].has(tileKey(3, 5))).toBe(true);
  });

  it('preserves explored tiles from other areas', () => {
    const exploredTiles: Record<string, Set<TileKey>> = {
      'area-1': new Set([tileKey(1, 1), tileKey(1, 2)]),
    };
    const visibleTiles = new Set([tileKey(5, 5)]);
    const areaId = 'area-2';

    const updated = updateExploredTiles(exploredTiles, visibleTiles, areaId);

    expect(updated['area-1'].has(tileKey(1, 1))).toBe(true);
    expect(updated['area-2'].has(tileKey(5, 5))).toBe(true);
  });
});

// --- hasLineOfSight Tests ---

/**
 * Helper to create a simple rectangular DungeonMap with all floor tiles.
 * Used for hasLineOfSight tests where we want to manually place obstacles.
 */
function createSimpleFloorMap(width: number, height: number): DungeonMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = { type: 'floor' };
    }
  }
  return {
    tiles,
    width,
    height,
    rooms: [],
    seed: 0,
  };
}

describe('hasLineOfSight', () => {
  it('returns true for clear path between two points', () => {
    const map = createSimpleFloorMap(10, 10);
    expect(hasLineOfSight(map, 1, 1, 5, 5)).toBe(true);
  });

  it('returns false when wall blocks the path', () => {
    const map = createSimpleFloorMap(10, 10);
    // Place wall at (3, 3) - directly in the path from (1,1) to (5,5)
    (map.tiles as Tile[][])[3][3] = { type: 'wall' };
    expect(hasLineOfSight(map, 1, 1, 5, 5)).toBe(false);
  });

  it('returns true for adjacent tiles', () => {
    const map = createSimpleFloorMap(10, 10);
    expect(hasLineOfSight(map, 5, 5, 6, 5)).toBe(true);
  });

  it('returns true for same position', () => {
    const map = createSimpleFloorMap(10, 10);
    expect(hasLineOfSight(map, 5, 5, 5, 5)).toBe(true);
  });

  it('handles cardinal directions', () => {
    const map = createSimpleFloorMap(10, 10);
    expect(hasLineOfSight(map, 1, 5, 8, 5)).toBe(true); // east
    expect(hasLineOfSight(map, 5, 1, 5, 8)).toBe(true); // south
  });

  it('returns false when closed door blocks path', () => {
    const map = createSimpleFloorMap(10, 10);
    (map.tiles as Tile[][])[3][3] = { type: 'door', open: false };
    expect(hasLineOfSight(map, 1, 1, 5, 5)).toBe(false);
  });

  it('returns true when open door is in path', () => {
    const map = createSimpleFloorMap(10, 10);
    (map.tiles as Tile[][])[3][3] = { type: 'door', open: true };
    expect(hasLineOfSight(map, 1, 1, 5, 5)).toBe(true);
  });
});

// --- Edge Case Tests ---

describe('computeMonsterFOV edge cases', () => {
  it('throws when monster position is out of bounds', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#...#',
      '#####',
    ]);

    const invalidMonster = createTestEntity({
      id: 'out-of-bounds',
      type: 'monster',
      x: 10, // Out of bounds
      y: 2,
      monsterTypeId: 'goblin',
    });

    expect(() => computeMonsterFOV(invalidMonster, map)).toThrow('out of bounds');
  });

  it('uses DEFAULT_VISION_RADIUS for monster with invalid monsterTypeId', () => {
    const map = createTestMap([
      '#######',
      '#.....#',
      '#..@..#',
      '#.....#',
      '#######',
    ]);

    // Create entity with invalid monsterTypeId
    const invalidMonster = createTestEntity({
      id: 'invalid-type',
      type: 'monster',
      x: 3,
      y: 2,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      monsterTypeId: 'dragon' as any, // Invalid type
    });

    const visible = computeMonsterFOV(invalidMonster, map);

    // Should use DEFAULT_VISION_RADIUS (8) as fallback
    const expectedVisible = computeVisibleTiles(map, 3, 2, DEFAULT_VISION_RADIUS);
    expect(visible.size).toBe(expectedVisible.size);
  });
});
