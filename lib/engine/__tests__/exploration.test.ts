// packages/crawler-core/lib/engine/__tests__/exploration.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeExplorationDepthLimit,
  computeExplorationValues,
  getExplorationRecommendation,
  type ExplorationRecommendation,
} from '../exploration';
import { parseAsciiMap, type DungeonMap } from '../map';
import { tileKey, type TileKey } from '../fov';
import type { Direction } from '../types';

describe('computeExplorationDepthLimit', () => {
  it('computes depth as diagonal/4 for medium maps', () => {
    // 40x30 map: diagonal = sqrt(40² + 30²) = 50, depth = 50/4 = 12.5 → 12
    expect(computeExplorationDepthLimit(40, 30)).toBe(12);
  });

  it('clamps to minimum of 10 for small maps', () => {
    // 20x20 map: diagonal = ~28, depth = 7 → clamped to 10
    expect(computeExplorationDepthLimit(20, 20)).toBe(10);
  });

  it('clamps to maximum of 30 for large maps', () => {
    // 200x200 map: diagonal = ~283, depth = 70 → clamped to 30
    expect(computeExplorationDepthLimit(200, 200)).toBe(30);
  });

  it('handles test dungeon size (30x15)', () => {
    // diagonal = sqrt(30² + 15²) = ~33.5, depth = ~8 → clamped to 10
    expect(computeExplorationDepthLimit(30, 15)).toBe(10);
  });
});

describe('computeExplorationValues', () => {
  function createTestMap(ascii: string): DungeonMap {
    const { tiles, width, height } = parseAsciiMap(ascii);
    return { tiles, width, height, rooms: [], seed: 1 };
  }

  function createExploredSet(exploredCoords: Array<[number, number]>): Set<TileKey> {
    return new Set(exploredCoords.map(([x, y]) => tileKey(x, y)));
  }

  it('returns higher value for direction with more unexplored tiles', () => {
    // T-junction map where east has more unexplored territory
    // #######
    // #..@..#   Player at (3, 1)
    // ###.###   Only south passage connects east and west
    // ###.###
    // #######
    const tJunctionAscii = `
#######
#..@..#
###.###
###.###
#######
`.trim();
    const map = createTestMap(tJunctionAscii);
    const position = { x: 3, y: 1 };
    // West is fully explored, east and south are not
    const explored = createExploredSet([
      [1, 1], [2, 1], [3, 1], // west side + player position explored
    ]);
    const visible = new Set(explored);

    const values = computeExplorationValues(map, position, visible, explored);

    // East has unexplored tiles (4,1 and 5,1)
    expect(values.get('east')!).toBeGreaterThan(0);
    // West is fully explored (1,1 and 2,1 are known), leads to wall at (0,1)
    // But can still reach unexplored tiles via south passage
    // The algorithm counts all reachable unexplored tiles from any direction
  });

  it('returns 0 for blocked directions', () => {
    // Simple corridor map
    const corridorAscii = `
###########
#....@....#
###########
`.trim();
    const map = createTestMap(corridorAscii);
    const position = { x: 5, y: 1 };
    const explored = createExploredSet([[5, 1]]);
    const visible = new Set(explored);

    const values = computeExplorationValues(map, position, visible, explored);

    // North and south are walls
    expect(values.get('north')).toBe(0);
    expect(values.get('south')).toBe(0);
  });

  it('counts unexplored tiles at frontier of explored area', () => {
    // Small 5x3 map with corridor
    const smallMap = createTestMap(`
#####
#...#
#####
`.trim());
    const position = { x: 1, y: 1 };
    // Only the player tile explored
    const explored = createExploredSet([[1, 1]]);
    const visible = new Set(explored);

    const values = computeExplorationValues(smallMap, position, visible, explored);

    // East leads to 2 unexplored floor tiles (2,1) and (3,1)
    expect(values.get('east')!).toBeGreaterThan(0);
  });

  it('returns 0 when all reachable tiles are explored', () => {
    // Small corridor, fully explored
    const smallMap = createTestMap(`
#####
#...#
#####
`.trim());
    const position = { x: 2, y: 1 };
    // All floor tiles explored
    const explored = createExploredSet([
      [1, 1], [2, 1], [3, 1],
    ]);
    const visible = new Set(explored);

    const values = computeExplorationValues(smallMap, position, visible, explored);

    // All directions lead to either walls or fully explored area
    expect(values.get('east')).toBe(0);
    expect(values.get('west')).toBe(0);
    expect(values.get('north')).toBe(0);
    expect(values.get('south')).toBe(0);
  });

  it('returns 0 for all directions when completely surrounded by walls', () => {
    // Edge case: player boxed in with no escape
    const boxedIn = createTestMap(`
###
#@#
###
`.trim());
    const position = { x: 1, y: 1 };
    const explored = createExploredSet([[1, 1]]);
    const visible = new Set(explored);

    const values = computeExplorationValues(boxedIn, position, visible, explored);

    // All 8 directions should be 0 (blocked by walls)
    for (const [_dir, value] of values) {
      expect(value).toBe(0);
    }
  });
});

describe('directional BFS constraint', () => {
  function createTestMap(ascii: string): DungeonMap {
    const { tiles, width, height } = parseAsciiMap(ascii);
    return { tiles, width, height, rooms: [], seed: 1 };
  }

  function createExploredSet(exploredCoords: Array<[number, number]>): Set<TileKey> {
    return new Set(exploredCoords.map(([x, y]) => tileKey(x, y)));
  }

  it('prevents oscillation by using strict directional constraints', () => {
    // This test verifies the fix for the north/south oscillation bug.
    // The map has a corridor leading east that should only be counted
    // when going south (to reach it) or east (through it), not north.
    //
    // #########
    // #.......#   Row 1: northern room area
    // #.......#   Row 2
    // #...@...#   Row 3: player at (4, 3)
    // #.......#   Row 4
    // #.......#   Row 5
    // #.......#   Row 6
    // #.........  Row 7: corridor extending east (unexplored beyond x=8)
    // #.......#   Row 8
    // #########
    const mapWithCorridor = createTestMap(`
#########
#.......#
#.......#
#...@...#
#.......#
#.......#
#.......#
#.........
#.......#
#########
`.trim());

    const position = { x: 4, y: 3 };

    // Player has explored left room (x=1-7) but corridor beyond x=8 is unexplored
    const exploredCoords: Array<[number, number]> = [];
    for (let y = 1; y <= 8; y++) {
      for (let x = 1; x <= 7; x++) {
        exploredCoords.push([x, y]);
      }
    }
    // Also mark corridor tile at (8, 7) as explored
    exploredCoords.push([8, 7]);

    const explored = createExploredSet(exploredCoords);
    const visible = new Set(explored);

    const values = computeExplorationValues(mapWithCorridor, position, visible, explored);

    // South should have access to corridor (y=7) which extends east to unexplored tiles
    // North is restricted to y < 3, which is fully explored
    // The strict constraint ensures north can't "go around" to count corridor tiles
    const northValue = values.get('north')!;
    const southValue = values.get('south')!;

    // North should be 0 or very low (all explored in the north half-plane)
    // South should be > 0 (can reach unexplored corridor extension at x=9+)
    expect(southValue).toBeGreaterThan(northValue);

    // This specific assertion catches the oscillation bug:
    // If both were equal, the AI would oscillate between north and south
    expect(northValue).toBe(0);
    expect(southValue).toBeGreaterThan(0);
  });

  it('east and west get different values based on unexplored territory', () => {
    // Corridor with unexplored area only to the east
    // ############
    // #....@.....#   Player at (5, 1)
    // ############
    const corridorMap = createTestMap(`
############
#....@.....#
############
`.trim());

    const position = { x: 5, y: 1 };

    // West side (x=1-4) is explored, east side (x=6-10) is unexplored
    const explored = createExploredSet([
      [1, 1], [2, 1], [3, 1], [4, 1], [5, 1],
    ]);
    const visible = new Set(explored);

    const values = computeExplorationValues(corridorMap, position, visible, explored);

    // East has unexplored tiles (x=6-10)
    // West is fully explored
    expect(values.get('east')!).toBeGreaterThan(0);
    expect(values.get('west')).toBe(0);
  });
});

describe('getExplorationRecommendation', () => {
  it('returns best direction when unexplored areas exist', () => {
    const values = new Map<Direction, number>([
      ['north', 0],
      ['south', 5],
      ['east', 20],
      ['west', 3],
      ['northeast', 0],
      ['northwest', 0],
      ['southeast', 10],
      ['southwest', 0],
    ]);

    const result = getExplorationRecommendation(values);

    expect(result.type).toBe('explore');
    expect(result.bestDirection).toBe('east');
    expect(result.bestValue).toBe(20);
    expect(result.fullyExploredDirections).toEqual(['north', 'northeast', 'northwest', 'southwest']);
  });

  it('returns fully_explored when all directions have 0 value', () => {
    const values = new Map<Direction, number>([
      ['north', 0],
      ['south', 0],
      ['east', 0],
      ['west', 0],
      ['northeast', 0],
      ['northwest', 0],
      ['southeast', 0],
      ['southwest', 0],
    ]);

    const result = getExplorationRecommendation(values);

    expect(result.type).toBe('fully_explored');
    expect(result.bestDirection).toBeNull();
  });
});

describe('backtrack penalty', () => {
  function createTestMap(ascii: string): DungeonMap {
    const { tiles, width, height } = parseAsciiMap(ascii);
    return { tiles, width, height, rooms: [], seed: 1 };
  }

  function createExploredSet(exploredCoords: Array<[number, number]>): Set<TileKey> {
    return new Set(exploredCoords.map(([x, y]) => tileKey(x, y)));
  }

  it('applies penalty to opposite direction of last move', () => {
    // Simple north-south corridor with equal unexplored territory on both ends
    // ###########
    // #....?....#   ? = unexplored north
    // #....@....#   @ = player at (5, 2)
    // #....?....#   ? = unexplored south
    // ###########
    const corridorMap = createTestMap(`
###########
#.........#
#....@....#
#.........#
###########
`.trim());

    const position = { x: 5, y: 2 };

    // Only the player's current position is explored
    // Both north and south have unexplored tiles
    const explored = createExploredSet([[5, 2]]);
    const visible = createExploredSet([
      [4, 1], [5, 1], [6, 1],
      [4, 2], [5, 2], [6, 2],
      [4, 3], [5, 3], [6, 3],
    ]);

    // Without last move - north and south should have similar values
    const valuesNoLastMove = computeExplorationValues(corridorMap, position, visible, explored);
    const northNoLast = valuesNoLastMove.get('north')!;
    const southNoLast = valuesNoLastMove.get('south')!;

    // Both directions should have unexplored tiles
    expect(northNoLast).toBeGreaterThan(0);
    expect(southNoLast).toBeGreaterThan(0);

    // With last move south - north (opposite) should be penalized
    const valuesAfterSouth = computeExplorationValues(
      corridorMap,
      position,
      visible,
      explored,
      { lastMoveDirection: 'south' }
    );
    const northAfterSouth = valuesAfterSouth.get('north')!;
    const southAfterSouth = valuesAfterSouth.get('south')!;

    // North should be reduced by penalty (5), south unchanged
    expect(northAfterSouth).toBe(Math.max(0, northNoLast - 5));
    expect(southAfterSouth).toBe(southNoLast);

    // South should now be preferred over north
    expect(southAfterSouth).toBeGreaterThan(northAfterSouth);
  });

  it('applies penalty to diagonal opposites', () => {
    // 3x3 room
    const smallMap = createTestMap(`
#####
#...#
#.@.#
#...#
#####
`.trim());

    const position = { x: 2, y: 2 };
    const explored = createExploredSet([[2, 2]]);
    const visible = createExploredSet([
      [1, 1], [2, 1], [3, 1],
      [1, 2], [2, 2], [3, 2],
      [1, 3], [2, 3], [3, 3],
    ]);

    // After moving northeast, southwest should be penalized
    const values = computeExplorationValues(
      smallMap,
      position,
      visible,
      explored,
      { lastMoveDirection: 'northeast' }
    );

    const valuesNoLast = computeExplorationValues(smallMap, position, visible, explored);
    const swNoLast = valuesNoLast.get('southwest')!;
    const swAfterNE = values.get('southwest')!;

    // Southwest should be penalized after moving northeast
    expect(swAfterNE).toBe(Math.max(0, swNoLast - 5));
  });
});
