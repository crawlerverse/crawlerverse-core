// packages/crawler-core/lib/engine/__tests__/map.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import * as ROT from 'rot-js';
import { logger } from '../../logging';
import {
  TileSchema,
  TilePositionSchema,
  PortalConnectionSchema,
  AreaMetadataSchema,
  AreaSchema,
  ZoneSchema,
  DungeonMapSchema,
  isPassable,
  parseAsciiMap,
  getTileAppearance,
  extractRooms,
  selectStartingRooms,
  validateConnectivity,
  getPlayerSpawnPositions,
  getMonsterSpawnPositions,
  generateDungeon,
  createRoom,
  validateDungeonMap,
  placePortal,
  findFarthestRoom,
  DEFAULT_DUNGEON_CONFIG,
  DungeonConfigSchema,
  DungeonGenerationError,
  SpawnPositionError,
  type DungeonConfig,
  type DungeonMap,
  type Tile,
  type Room,
  type PortalPlacementConfig,
} from '../map';

describe('TileSchema', () => {
  it('parses wall tile', () => {
    const tile = TileSchema.parse({ type: 'wall' });
    expect(tile).toEqual({ type: 'wall' });
  });

  it('parses floor tile', () => {
    const tile = TileSchema.parse({ type: 'floor' });
    expect(tile).toEqual({ type: 'floor' });
  });

  it('parses closed door tile', () => {
    const tile = TileSchema.parse({ type: 'door', open: false });
    expect(tile).toEqual({ type: 'door', open: false });
  });

  it('parses open door tile', () => {
    const tile = TileSchema.parse({ type: 'door', open: true });
    expect(tile).toEqual({ type: 'door', open: true });
  });

  it('parses portal up tile', () => {
    const tile = TileSchema.parse({ type: 'portal', direction: 'up' });
    expect(tile).toEqual({ type: 'portal', direction: 'up' });
  });

  it('parses portal down tile', () => {
    const tile = TileSchema.parse({ type: 'portal', direction: 'down' });
    expect(tile).toEqual({ type: 'portal', direction: 'down' });
  });

  it('parses portal without direction', () => {
    const tile = TileSchema.parse({ type: 'portal' });
    expect(tile).toEqual({ type: 'portal' });
  });

  it('rejects invalid tile type', () => {
    expect(() => TileSchema.parse({ type: 'lava' })).toThrow();
  });

  it('infers correct type from parsed result', () => {
    const tile: Tile = TileSchema.parse({ type: 'floor' });
    expect(tile.type).toBe('floor');
  });
});

describe('TilePositionSchema', () => {
  it('validates valid positions', () => {
    const result = TilePositionSchema.safeParse({ x: 5, y: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ x: 5, y: 10 });
    }
  });

  it('accepts negative coordinates', () => {
    const result = TilePositionSchema.safeParse({ x: -3, y: -7 });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer x', () => {
    const result = TilePositionSchema.safeParse({ x: 5.5, y: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer y', () => {
    const result = TilePositionSchema.safeParse({ x: 5, y: 10.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing x', () => {
    const result = TilePositionSchema.safeParse({ y: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects missing y', () => {
    const result = TilePositionSchema.safeParse({ x: 5 });
    expect(result.success).toBe(false);
  });
});

describe('PortalConnectionSchema', () => {
  it('validates valid portal connection', () => {
    const connection = {
      targetAreaId: 'area-2',
      targetPosition: { x: 10, y: 15 },
      returnAllowed: true,
    };
    const result = PortalConnectionSchema.safeParse(connection);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(connection);
    }
  });

  it('validates one-way portal (returnAllowed: false)', () => {
    const connection = {
      targetAreaId: 'boss-lair',
      targetPosition: { x: 5, y: 5 },
      returnAllowed: false,
    };
    const result = PortalConnectionSchema.safeParse(connection);
    expect(result.success).toBe(true);
  });

  it('rejects empty targetAreaId', () => {
    const connection = {
      targetAreaId: '',
      targetPosition: { x: 10, y: 15 },
      returnAllowed: true,
    };
    const result = PortalConnectionSchema.safeParse(connection);
    expect(result.success).toBe(false);
  });

  it('rejects missing targetPosition', () => {
    const connection = {
      targetAreaId: 'area-2',
      returnAllowed: true,
    };
    const result = PortalConnectionSchema.safeParse(connection);
    expect(result.success).toBe(false);
  });

  it('rejects missing returnAllowed', () => {
    const connection = {
      targetAreaId: 'area-2',
      targetPosition: { x: 10, y: 15 },
    };
    const result = PortalConnectionSchema.safeParse(connection);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer position coordinates', () => {
    const connection = {
      targetAreaId: 'area-2',
      targetPosition: { x: 10.5, y: 15 },
      returnAllowed: true,
    };
    const result = PortalConnectionSchema.safeParse(connection);
    expect(result.success).toBe(false);
  });
});

describe('AreaMetadataSchema', () => {
  it('validates valid area metadata', () => {
    const metadata = {
      id: 'area-1',
      name: 'Dungeon Level 1',
      dangerLevel: 1,
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(metadata);
    }
  });

  it('validates metadata with optional theme', () => {
    const metadata = {
      id: 'catacombs',
      name: 'The Catacombs',
      dangerLevel: 3,
      theme: 'undead',
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.theme).toBe('undead');
    }
  });

  it('validates safe area with dangerLevel 0', () => {
    const metadata = {
      id: 'town-square',
      name: 'Town Square',
      dangerLevel: 0,
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
  });

  it('rejects empty id', () => {
    const metadata = {
      id: '',
      name: 'Dungeon Level 1',
      dangerLevel: 1,
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const metadata = {
      id: 'area-1',
      name: '',
      dangerLevel: 1,
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(false);
  });

  it('rejects negative dangerLevel', () => {
    const metadata = {
      id: 'area-1',
      name: 'Dungeon Level 1',
      dangerLevel: -1,
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer dangerLevel', () => {
    const metadata = {
      id: 'area-1',
      name: 'Dungeon Level 1',
      dangerLevel: 1.5,
    };
    const result = AreaMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(false);
  });
});

describe('isPassable', () => {
  const createTestMap = (tiles: Tile[][]): DungeonMap => ({
    width: tiles[0].length,
    height: tiles.length,
    tiles,
    rooms: [],
    seed: 0,
  });

  it('returns false for wall', () => {
    const map = createTestMap([[{ type: 'wall' }]]);
    expect(isPassable(map, 0, 0)).toBe(false);
  });

  it('returns true for floor', () => {
    const map = createTestMap([[{ type: 'floor' }]]);
    expect(isPassable(map, 0, 0)).toBe(true);
  });

  it('returns false for closed door', () => {
    const map = createTestMap([[{ type: 'door', open: false }]]);
    expect(isPassable(map, 0, 0)).toBe(false);
  });

  it('returns true for open door', () => {
    const map = createTestMap([[{ type: 'door', open: true }]]);
    expect(isPassable(map, 0, 0)).toBe(true);
  });

  it('returns true for portal', () => {
    const map = createTestMap([[{ type: 'portal', direction: 'up' }]]);
    expect(isPassable(map, 0, 0)).toBe(true);
  });

  it('returns true for portal', () => {
    const map = createTestMap([[{
      type: 'portal',
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: true,
      },
    }]]);
    expect(isPassable(map, 0, 0)).toBe(true);
  });

  it('returns false for out of bounds (negative)', () => {
    const map = createTestMap([[{ type: 'floor' }]]);
    expect(isPassable(map, -1, 0)).toBe(false);
  });

  it('returns false for out of bounds (too large)', () => {
    const map = createTestMap([[{ type: 'floor' }]]);
    expect(isPassable(map, 1, 0)).toBe(false);
  });
});

describe('parseAsciiMap', () => {
  it('parses walls and floors', () => {
    const result = parseAsciiMap(
      `
###
#.#
###
    `.trim()
    );

    expect(result.width).toBe(3);
    expect(result.height).toBe(3);
    expect(result.tiles[0][0]).toEqual({ type: 'wall' });
    expect(result.tiles[1][1]).toEqual({ type: 'floor' });
  });

  it('parses doors', () => {
    const result = parseAsciiMap('#+/');
    expect(result.tiles[0][1]).toEqual({ type: 'door', open: false });
    expect(result.tiles[0][2]).toEqual({ type: 'door', open: true });
  });

  it('parses portals', () => {
    const result = parseAsciiMap('<>');
    expect(result.tiles[0][0]).toEqual({ type: 'portal', direction: 'up' });
    expect(result.tiles[0][1]).toEqual({ type: 'portal', direction: 'down' });
  });

  it('treats entity markers as floor', () => {
    const result = parseAsciiMap('@rgT');
    expect(result.tiles[0][0]).toEqual({ type: 'floor' });
    expect(result.tiles[0][1]).toEqual({ type: 'floor' });
    expect(result.tiles[0][2]).toEqual({ type: 'floor' });
    expect(result.tiles[0][3]).toEqual({ type: 'floor' });
  });

  it('treats spaces as walls', () => {
    const result = parseAsciiMap('#  #');
    expect(result.tiles[0][1]).toEqual({ type: 'wall' });
    expect(result.tiles[0][2]).toEqual({ type: 'wall' });
  });

  it('handles multi-line maps correctly', () => {
    const result = parseAsciiMap(
      `
##
..
    `.trim()
    );

    expect(result.height).toBe(2);
    expect(result.tiles[0][0]).toEqual({ type: 'wall' });
    expect(result.tiles[1][0]).toEqual({ type: 'floor' });
  });
});

describe('DungeonConfig', () => {
  it('DEFAULT_DUNGEON_CONFIG has sensible defaults', () => {
    expect(DEFAULT_DUNGEON_CONFIG.width).toBe(50);
    expect(DEFAULT_DUNGEON_CONFIG.height).toBe(50);
    expect(DEFAULT_DUNGEON_CONFIG.roomSizeRange).toEqual([5, 10]);
    expect(DEFAULT_DUNGEON_CONFIG.dugPercentage).toBe(0.3);
    expect(DEFAULT_DUNGEON_CONFIG.startingRoomCount).toBe(1);
    expect(DEFAULT_DUNGEON_CONFIG.startingRoomStrategy).toBe('first');
    expect(DEFAULT_DUNGEON_CONFIG.monsterCount).toBe(2);
  });
});

describe('DungeonConfigSchema', () => {
  it('validates a correct config', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
    };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects width below minimum', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, width: 5 };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects width above maximum', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, width: 250 };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid dugPercentage (too low)', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, dugPercentage: 0.05 };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid dugPercentage (too high)', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, dugPercentage: 0.95 };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid roomSizeRange (min > max)', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, roomSizeRange: [10, 5] as [number, number] };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid startingRoomStrategy', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, startingRoomStrategy: 'invalid' };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects negative monsterCount', () => {
    const config = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345, monsterCount: -1 };
    const result = DungeonConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('Tile Appearance', () => {
  it('getTileAppearance returns correct appearance for wall', () => {
    const tile: Tile = { type: 'wall' };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('#');
    expect(appearance.fg).toBe('#666666');
  });

  it('getTileAppearance returns correct appearance for floor', () => {
    const tile: Tile = { type: 'floor' };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('.');
    expect(appearance.fg).toBe('#333333');
  });

  it('getTileAppearance returns correct appearance for closed door', () => {
    const tile: Tile = { type: 'door', open: false };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('+');
    expect(appearance.fg).toBe('#8B4513');
  });

  it('getTileAppearance returns correct appearance for open door', () => {
    const tile: Tile = { type: 'door', open: true };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('/');
    expect(appearance.fg).toBe('#8B4513');
  });

  it('getTileAppearance returns correct appearance for portal up', () => {
    const tile: Tile = { type: 'portal', direction: 'up' };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('<');
    expect(appearance.fg).toBe('#FFD700');
  });

  it('getTileAppearance returns correct appearance for portal down', () => {
    const tile: Tile = { type: 'portal', direction: 'down' };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('>');
    expect(appearance.fg).toBe('#FFD700');
  });

  it('getTileAppearance returns correct appearance for portal without direction', () => {
    const tile: Tile = { type: 'portal' };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('O');
    expect(appearance.fg).toBe('#FFD700');
  });

  it('getTileAppearance returns correct appearance for portal up', () => {
    const tile: Tile = {
      type: 'portal',
      direction: 'up',
      connection: {
        targetAreaId: 'area-1',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: true,
      },
    };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('<');
    expect(appearance.fg).toBe('#FFD700');
  });

  it('getTileAppearance returns correct appearance for portal down', () => {
    const tile: Tile = {
      type: 'portal',
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 10, y: 15 },
        returnAllowed: false,
      },
    };
    const appearance = getTileAppearance(tile);
    expect(appearance.char).toBe('>');
    expect(appearance.fg).toBe('#FFD700');
  });
});

describe('extractRooms', () => {
  it('extracts rooms with correct metadata', () => {
    // Create a digger and extract rooms
    const digger = new ROT.Map.Digger(20, 20, {
      roomWidth: [3, 5],
      roomHeight: [3, 5],
    });
    digger.create(() => {}); // Generate the map

    const rooms = extractRooms(digger);

    expect(rooms.length).toBeGreaterThan(0);

    // Check first room has correct structure
    const room = rooms[0];
    expect(room.x).toBeGreaterThanOrEqual(0);
    expect(room.y).toBeGreaterThanOrEqual(0);
    expect(room.width).toBeGreaterThan(0);
    expect(room.height).toBeGreaterThan(0);
    expect(room.center.x).toBe(Math.floor((room.x * 2 + room.width - 1) / 2));
    expect(room.center.y).toBe(Math.floor((room.y * 2 + room.height - 1) / 2));
    expect(room.tags).toEqual([]);
  });

  it('calculates center correctly for various room sizes', () => {
    const digger = new ROT.Map.Digger(30, 30, {
      roomWidth: [3, 8],
      roomHeight: [3, 8],
    });
    digger.create(() => {});

    const rooms = extractRooms(digger);

    // Verify center calculation for all rooms
    for (const room of rooms) {
      const expectedCenterX = Math.floor((room.x + room.x + room.width - 1) / 2);
      const expectedCenterY = Math.floor((room.y + room.y + room.height - 1) / 2);
      expect(room.center.x).toBe(expectedCenterX);
      expect(room.center.y).toBe(expectedCenterY);
    }
  });

  it('extracts rooms with positive dimensions', () => {
    const digger = new ROT.Map.Digger(25, 25);
    digger.create(() => {});

    const rooms = extractRooms(digger);

    for (const room of rooms) {
      expect(room.width).toBeGreaterThan(0);
      expect(room.height).toBeGreaterThan(0);
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('selectStartingRooms', () => {
  const testRooms: Room[] = [
    { x: 0, y: 0, width: 5, height: 5, center: { x: 2, y: 2 }, tags: [] },
    { x: 10, y: 0, width: 5, height: 5, center: { x: 12, y: 2 }, tags: [] },
    { x: 0, y: 10, width: 5, height: 5, center: { x: 2, y: 12 }, tags: [] },
    { x: 10, y: 10, width: 5, height: 5, center: { x: 12, y: 12 }, tags: [] },
  ];

  it('first strategy selects first N rooms', () => {
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const selected = selectStartingRooms(testRooms, 2, 'first', rng);

    expect(selected).toHaveLength(2);
    expect(selected[0]).toBe(testRooms[0]);
    expect(selected[1]).toBe(testRooms[1]);
  });

  it('spread strategy maximizes distance between rooms', () => {
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const selected = selectStartingRooms(testRooms, 2, 'spread', rng);

    expect(selected).toHaveLength(2);
    // First room is always first
    expect(selected[0]).toBe(testRooms[0]);
    // Second should be furthest from first (diagonal corner)
    expect(selected[1]).toBe(testRooms[3]);
  });

  it('random strategy selects random rooms', () => {
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const selected1 = selectStartingRooms(testRooms, 2, 'random', rng);

    rng.setSeed(99999);
    const selected2 = selectStartingRooms(testRooms, 2, 'random', rng);

    expect(selected1).toHaveLength(2);
    expect(selected2).toHaveLength(2);
  });

  it('returns empty array for empty rooms', () => {
    const rng = ROT.RNG.clone();
    const selected = selectStartingRooms([], 2, 'first', rng);
    expect(selected).toEqual([]);
  });

  it('limits count to available rooms', () => {
    const rng = ROT.RNG.clone();
    const selected = selectStartingRooms(testRooms, 10, 'first', rng);
    expect(selected).toHaveLength(4);
  });

  it('returns empty array when count is 0', () => {
    const rng = ROT.RNG.clone();
    const selected = selectStartingRooms(testRooms, 0, 'first', rng);
    expect(selected).toEqual([]);
  });

  it('random strategy produces deterministic results with same seed', () => {
    const rng1 = ROT.RNG.clone();
    rng1.setSeed(12345);
    const selected1 = selectStartingRooms(testRooms, 2, 'random', rng1);

    const rng2 = ROT.RNG.clone();
    rng2.setSeed(12345);
    const selected2 = selectStartingRooms(testRooms, 2, 'random', rng2);

    expect(selected1).toEqual(selected2);
  });
});

describe('validateConnectivity', () => {
  it('returns true for fully connected map', () => {
    const { tiles, width, height } = parseAsciiMap(`
#####
#...#
#...#
#...#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    expect(validateConnectivity(map)).toBe(true);
  });

  it('returns false for disconnected map', () => {
    const { tiles, width, height } = parseAsciiMap(`
#####
#.#.#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    expect(validateConnectivity(map)).toBe(false);
  });

  it('returns false for map with no passable tiles', () => {
    const { tiles, width, height } = parseAsciiMap(`
###
###
###
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    expect(validateConnectivity(map)).toBe(false);
  });

  it('considers open doors as passable', () => {
    const { tiles, width, height } = parseAsciiMap(`
#####
#./.#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    expect(validateConnectivity(map)).toBe(true);
  });

  it('considers closed doors as impassable', () => {
    const { tiles, width, height } = parseAsciiMap(`
#####
#.+.#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    expect(validateConnectivity(map)).toBe(false);
  });

  it('returns true for single passable tile', () => {
    const { tiles, width, height } = parseAsciiMap(`
###
#.#
###
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    expect(validateConnectivity(map)).toBe(true);
  });
});

describe('getPlayerSpawnPositions', () => {
  it('returns center of starting room', () => {
    const map: DungeonMap = {
      width: 20,
      height: 20,
      tiles: [],
      rooms: [
        { x: 1, y: 1, width: 5, height: 5, center: { x: 3, y: 3 }, tags: ['starting'] },
        { x: 10, y: 10, width: 5, height: 5, center: { x: 12, y: 12 }, tags: [] },
      ],
      seed: 0,
    };

    const positions = getPlayerSpawnPositions(map, 1);

    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({ x: 3, y: 3 });
  });

  it('returns multiple positions for multiple players', () => {
    const map: DungeonMap = {
      width: 20,
      height: 20,
      tiles: [],
      rooms: [
        { x: 1, y: 1, width: 5, height: 5, center: { x: 3, y: 3 }, tags: ['starting'] },
        { x: 10, y: 10, width: 5, height: 5, center: { x: 12, y: 12 }, tags: ['starting'] },
      ],
      seed: 0,
    };

    const positions = getPlayerSpawnPositions(map, 2);

    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual({ x: 3, y: 3 });
    expect(positions[1]).toEqual({ x: 12, y: 12 });
  });

  it('falls back to any room if no starting rooms', () => {
    const map: DungeonMap = {
      width: 20,
      height: 20,
      tiles: [],
      rooms: [
        { x: 5, y: 5, width: 5, height: 5, center: { x: 7, y: 7 }, tags: [] },
      ],
      seed: 0,
    };

    const positions = getPlayerSpawnPositions(map, 1);

    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({ x: 7, y: 7 });
  });

  it('throws SpawnPositionError when map has no rooms', () => {
    const map: DungeonMap = {
      width: 10,
      height: 10,
      tiles: [],
      rooms: [],
      seed: 12345,
    };

    expect(() => getPlayerSpawnPositions(map, 1)).toThrow(SpawnPositionError);
  });

  it('SpawnPositionError includes seed for debugging', () => {
    const map: DungeonMap = {
      width: 10,
      height: 10,
      tiles: [],
      rooms: [],
      seed: 54321,
    };

    try {
      getPlayerSpawnPositions(map, 1);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SpawnPositionError);
      const error = e as SpawnPositionError;
      expect(error.seed).toBe(54321);
      expect(error.requested).toBe(1);
      expect(error.available).toBe(0);
      expect(error.message).toContain('54321');
    }
  });
});

describe('getMonsterSpawnPositions', () => {
  it('returns passable positions excluding player positions', () => {
    const { tiles, width, height } = parseAsciiMap(`
#####
#...#
#...#
#...#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const playerPositions = [{ x: 1, y: 1 }];
    const positions = getMonsterSpawnPositions(map, 2, playerPositions, rng);

    expect(positions).toHaveLength(2);
    for (const pos of positions) {
      expect(isPassable(map, pos.x, pos.y)).toBe(true);
      expect(pos).not.toEqual({ x: 1, y: 1 });
    }
  });

  it('returns fewer positions if not enough passable tiles', () => {
    const { tiles, width, height } = parseAsciiMap(`
###
#.#
###
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const positions = getMonsterSpawnPositions(map, 5, [], rng);

    expect(positions).toHaveLength(1); // Only one floor tile
  });

  it('returns unique positions for each monster', () => {
    const { tiles, width, height } = parseAsciiMap(`
#######
#.....#
#.....#
#.....#
#######
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const positions = getMonsterSpawnPositions(map, 5, [], rng);
    const positionSet = new Set(positions.map(p => `${p.x},${p.y}`));

    expect(positionSet.size).toBe(positions.length); // All unique
  });

  it('produces deterministic results with same seed', () => {
    const { tiles, width, height } = parseAsciiMap(`
#####
#...#
#...#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };

    const rng1 = ROT.RNG.clone();
    rng1.setSeed(12345);
    const positions1 = getMonsterSpawnPositions(map, 3, [], rng1);

    const rng2 = ROT.RNG.clone();
    rng2.setSeed(12345);
    const positions2 = getMonsterSpawnPositions(map, 3, [], rng2);

    expect(positions1).toEqual(positions2);
  });
});

describe('generateDungeon', () => {
  it('generates a dungeon with correct dimensions', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      width: 30,
      height: 25,
      seed: 12345,
    };

    const map = generateDungeon(config);

    expect(map.width).toBe(30);
    expect(map.height).toBe(25);
  });

  it('generates reproducible dungeons with same seed', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
    };

    const map1 = generateDungeon(config);
    const map2 = generateDungeon(config);

    expect(map1.seed).toBe(map2.seed);
    expect(map1.rooms.length).toBe(map2.rooms.length);
    // Tiles should be identical
    for (let y = 0; y < map1.height; y++) {
      for (let x = 0; x < map1.width; x++) {
        expect(map1.tiles[y][x]).toEqual(map2.tiles[y][x]);
      }
    }
  });

  it('generates different dungeons with different seeds', () => {
    const config1: DungeonConfig = { ...DEFAULT_DUNGEON_CONFIG, seed: 12345 };
    const config2: DungeonConfig = { ...DEFAULT_DUNGEON_CONFIG, seed: 99999 };

    const map1 = generateDungeon(config1);
    const map2 = generateDungeon(config2);

    // Very unlikely to have identical layouts with different seeds
    let differences = 0;
    for (let y = 0; y < map1.height; y++) {
      for (let x = 0; x < map1.width; x++) {
        if (map1.tiles[y][x].type !== map2.tiles[y][x].type) {
          differences++;
        }
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('generates connected dungeon', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
    };

    const map = generateDungeon(config);

    expect(validateConnectivity(map)).toBe(true);
  });

  it('tags starting rooms correctly', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
      startingRoomCount: 2,
      startingRoomStrategy: 'first',
    };

    const map = generateDungeon(config);

    const startingRooms = map.rooms.filter(r => r.tags.includes('starting'));
    expect(startingRooms.length).toBe(Math.min(2, map.rooms.length));
  });

  it('stores seed in map', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
    };

    const map = generateDungeon(config);

    expect(map.seed).toBe(12345);
  });

  it('throws DungeonGenerationError for invalid config (width too small)', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
      width: 5,  // Below minimum
    };

    expect(() => generateDungeon(config)).toThrow(/Invalid dungeon config/);

    // Also verify it's the correct error type
    try {
      generateDungeon(config);
      expect.fail('Should have thrown');
    } catch (e) {
      // The error is wrapped, so just check the message
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('Invalid dungeon config');
    }
  });

  it('throws DungeonGenerationError with config context on failure', () => {
    // This test verifies the DungeonGenerationError type is usable
    const error = new DungeonGenerationError(
      'Test error message',
      { ...DEFAULT_DUNGEON_CONFIG, seed: 12345 },
      10
    );
    expect(error.name).toBe('DungeonGenerationError');
    expect(error.config.seed).toBe(12345);
    expect(error.attempts).toBe(10);
  });

  it('throws DungeonGenerationError for invalid config (dugPercentage out of range)', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
      dugPercentage: 1.5,  // Out of range
    };

    expect(() => generateDungeon(config)).toThrow(/Invalid dungeon config/);
  });

  it('throws when room size exceeds map dimensions', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
      width: 15,
      height: 15,
      roomSizeRange: [5, 14],  // Max room too large for 15x15 map
    };

    expect(() => generateDungeon(config)).toThrow(/Room max size/);
  });

  it('does not affect global RNG state after generation', () => {
    // Set a known RNG state before generation
    ROT.RNG.setSeed(99999);
    const beforeValue = ROT.RNG.getUniform();

    // Reset to known state
    ROT.RNG.setSeed(99999);

    // Generate a dungeon with a different seed
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
    };
    generateDungeon(config);

    // After generation, the global RNG should be in same state as before
    const afterValue = ROT.RNG.getUniform();
    expect(afterValue).toBe(beforeValue);
  });

  it('uses monsterCount from config', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
      monsterCount: 5,
    };

    const map = generateDungeon(config);

    // The map is generated - monsterCount is used in createInitialState, not here
    // But verify the config validates correctly
    expect(map).toBeDefined();
  });

  it('throws DungeonGenerationError (not plain Error) for validation failures', () => {
    const config: DungeonConfig = {
      ...DEFAULT_DUNGEON_CONFIG,
      seed: 12345,
      width: 5, // Too small
    };

    try {
      generateDungeon(config);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DungeonGenerationError);
      const error = e as DungeonGenerationError;
      expect(error.config.seed).toBe(12345);
      expect(error.attempts).toBe(0); // Validation fails before any attempts
    }
  });
});

describe('createRoom', () => {
  it('creates a room with correct properties', () => {
    const room = createRoom({ x: 5, y: 10, width: 8, height: 6 });

    expect(room.x).toBe(5);
    expect(room.y).toBe(10);
    expect(room.width).toBe(8);
    expect(room.height).toBe(6);
    expect(room.tags).toEqual([]);
  });

  it('calculates center correctly', () => {
    const room = createRoom({ x: 0, y: 0, width: 5, height: 5 });
    // Center of a 5x5 room at (0,0) should be (2, 2)
    expect(room.center.x).toBe(2);
    expect(room.center.y).toBe(2);
  });

  it('calculates center correctly for even dimensions', () => {
    const room = createRoom({ x: 0, y: 0, width: 4, height: 4 });
    // Center of a 4x4 room at (0,0) - (0+0+4-1)/2 = 1.5 -> floor = 1
    expect(room.center.x).toBe(1);
    expect(room.center.y).toBe(1);
  });

  it('includes provided tags', () => {
    const room = createRoom({ x: 0, y: 0, width: 5, height: 5, tags: ['starting'] });
    expect(room.tags).toContain('starting');
  });

  it('throws for zero width', () => {
    expect(() => createRoom({ x: 0, y: 0, width: 0, height: 5 })).toThrow('width must be positive');
  });

  it('throws for negative height', () => {
    expect(() => createRoom({ x: 0, y: 0, width: 5, height: -1 })).toThrow('height must be positive');
  });

  it('throws for negative position', () => {
    expect(() => createRoom({ x: -1, y: 0, width: 5, height: 5 })).toThrow('non-negative');
  });

  it('returns frozen (immutable) room', () => {
    const room = createRoom({ x: 0, y: 0, width: 5, height: 5 });
    expect(Object.isFrozen(room)).toBe(true);
    expect(Object.isFrozen(room.center)).toBe(true);
  });
});

describe('validateDungeonMap', () => {
  it('passes for valid map', () => {
    const { tiles, width, height } = parseAsciiMap(`
###
#.#
###
`.trim());
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 1, y: 1, width: 1, height: 1, center: { x: 1, y: 1 }, tags: [] }],
      seed: 0,
    };

    expect(() => validateDungeonMap(map)).not.toThrow();
  });

  it('throws for tile height mismatch', () => {
    const map: DungeonMap = {
      width: 3,
      height: 5, // Says 5 but tiles has only 3 rows
      tiles: [
        [{ type: 'wall' }, { type: 'wall' }, { type: 'wall' }],
        [{ type: 'wall' }, { type: 'floor' }, { type: 'wall' }],
        [{ type: 'wall' }, { type: 'wall' }, { type: 'wall' }],
      ],
      rooms: [],
      seed: 0,
    };

    expect(() => validateDungeonMap(map)).toThrow('height mismatch');
  });

  it('throws for tile width mismatch', () => {
    const map: DungeonMap = {
      width: 5, // Says 5 but tiles has only 3 columns
      height: 3,
      tiles: [
        [{ type: 'wall' }, { type: 'wall' }, { type: 'wall' }],
        [{ type: 'wall' }, { type: 'floor' }, { type: 'wall' }],
        [{ type: 'wall' }, { type: 'wall' }, { type: 'wall' }],
      ],
      rooms: [],
      seed: 0,
    };

    expect(() => validateDungeonMap(map)).toThrow('width mismatch');
  });

  it('throws for room outside bounds', () => {
    const { tiles, width, height } = parseAsciiMap(`
###
#.#
###
`.trim());
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 5, y: 5, width: 3, height: 3, center: { x: 6, y: 6 }, tags: [] }], // Way outside
      seed: 0,
    };

    expect(() => validateDungeonMap(map)).toThrow('outside map bounds');
  });
});

describe('Player spawn warning path', () => {
  it('logs warning when fewer player positions than requested', () => {
    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const map: DungeonMap = {
      width: 20,
      height: 20,
      tiles: [],
      rooms: [
        { x: 1, y: 1, width: 5, height: 5, center: { x: 3, y: 3 }, tags: ['starting'] },
      ],
      seed: 99999,
    };

    const positions = getPlayerSpawnPositions(map, 3); // Request 3, only 1 available

    expect(positions.length).toBe(1);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      { seed: 99999, requested: 3, available: 1, returning: 1 },
      'Requested more player spawn positions than rooms available'
    );

    loggerWarnSpy.mockRestore();
  });

  it('does not log warning when all positions fulfilled', () => {
    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const map: DungeonMap = {
      width: 20,
      height: 20,
      tiles: [],
      rooms: [
        { x: 1, y: 1, width: 5, height: 5, center: { x: 3, y: 3 }, tags: ['starting'] },
        { x: 10, y: 10, width: 5, height: 5, center: { x: 12, y: 12 }, tags: ['starting'] },
      ],
      seed: 0,
    };

    const positions = getPlayerSpawnPositions(map, 2);

    expect(positions.length).toBe(2);
    expect(loggerWarnSpy).not.toHaveBeenCalled();

    loggerWarnSpy.mockRestore();
  });
});

describe('Monster spawn warning path', () => {
  it('logs warning when fewer monsters can be spawned than requested', () => {
    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const { tiles, width, height } = parseAsciiMap(`
#####
#...#
#####
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 12345 };
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const positions = getMonsterSpawnPositions(map, 10, [], rng); // Request 10, only 3 available

    expect(positions.length).toBe(3);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      { seed: 12345, requested: 10, available: 3, excluded: 0, spawning: 3 },
      'Requested more monster spawn positions than valid room tiles available'
    );

    loggerWarnSpy.mockRestore();
  });

  it('does not log warning when all monsters spawned', () => {
    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const { tiles, width, height } = parseAsciiMap(`
#######
#.....#
#.....#
#######
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 0 };
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    const positions = getMonsterSpawnPositions(map, 5, [], rng);

    expect(positions.length).toBe(5);
    expect(loggerWarnSpy).not.toHaveBeenCalled();

    loggerWarnSpy.mockRestore();
  });

  it('accounts for excluded player positions in warning', () => {
    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const { tiles, width, height } = parseAsciiMap(`
###
#.#
###
`.trim());
    const map: DungeonMap = { width, height, tiles, rooms: [], seed: 12345 };
    const rng = ROT.RNG.clone();
    rng.setSeed(12345);

    // One floor tile, but exclude it
    const positions = getMonsterSpawnPositions(map, 1, [{ x: 1, y: 1 }], rng);

    expect(positions.length).toBe(0);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      { seed: 12345, requested: 1, available: 0, excluded: 1, spawning: 0 },
      'Requested more monster spawn positions than valid room tiles available'
    );

    loggerWarnSpy.mockRestore();
  });
});

describe('AreaSchema', () => {
  // Helper to create minimal valid DungeonMap
  const createMinimalMap = (): z.infer<typeof DungeonMapSchema> => ({
    width: 10,
    height: 10,
    tiles: Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => ({ type: 'floor' as const }))
    ),
    rooms: [],
    seed: 12345,
  });

  it('validates valid area', () => {
    const area = {
      metadata: {
        id: 'area-1',
        name: 'Dungeon Level 1',
        dangerLevel: 1,
      },
      map: createMinimalMap(),
    };
    const result = AreaSchema.safeParse(area);
    expect(result.success).toBe(true);
  });

  it('validates area with theme', () => {
    const area = {
      metadata: {
        id: 'crypt',
        name: 'Ancient Crypt',
        dangerLevel: 2,
        theme: 'undead',
      },
      map: createMinimalMap(),
    };
    const result = AreaSchema.safeParse(area);
    expect(result.success).toBe(true);
  });

  it('rejects area with invalid metadata', () => {
    const area = {
      metadata: {
        id: '',  // Invalid: empty
        name: 'Dungeon Level 1',
        dangerLevel: 1,
      },
      map: createMinimalMap(),
    };
    const result = AreaSchema.safeParse(area);
    expect(result.success).toBe(false);
  });

  it('rejects area without map', () => {
    const area = {
      metadata: {
        id: 'area-1',
        name: 'Dungeon Level 1',
        dangerLevel: 1,
      },
    };
    const result = AreaSchema.safeParse(area);
    expect(result.success).toBe(false);
  });
});

describe('TileSchema - portal', () => {
  it('validates portal tile with connection', () => {
    const tile = {
      type: 'portal',
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 10, y: 15 },
        returnAllowed: false,
      },
    };
    const result = TileSchema.safeParse(tile);
    expect(result.success).toBe(true);
  });

  it('validates portal with direction up', () => {
    const tile = {
      type: 'portal',
      direction: 'up',
      connection: {
        targetAreaId: 'area-1',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: true,
      },
    };
    const result = TileSchema.safeParse(tile);
    expect(result.success).toBe(true);
  });

  it('accepts portal without connection (placeholder for ASCII parsing)', () => {
    const tile = {
      type: 'portal',
      direction: 'down',
    };
    const result = TileSchema.safeParse(tile);
    expect(result.success).toBe(true);
  });

  it('rejects portal with invalid direction', () => {
    const tile = {
      type: 'portal',
      direction: 'sideways',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 10, y: 15 },
        returnAllowed: false,
      },
    };
    const result = TileSchema.safeParse(tile);
    expect(result.success).toBe(false);
  });

  it('accepts portal without direction (generic portal)', () => {
    const tile = {
      type: 'portal',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 10, y: 15 },
        returnAllowed: true,
      },
    };
    const result = TileSchema.safeParse(tile);
    expect(result.success).toBe(true);
  });
});

describe('ZoneSchema', () => {
  // Helper to create minimal valid Area
  const createMinimalArea = (id: string, name: string, dangerLevel: number) => ({
    metadata: { id, name, dangerLevel },
    map: {
      width: 10,
      height: 10,
      tiles: Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => ({ type: 'floor' as const }))
      ),
      rooms: [],
      seed: 12345,
    },
  });

  it('validates valid zone with single area', () => {
    const zone = {
      id: 'test-dungeon',
      name: 'The Depths',
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-1'],
      areas: {
        'area-1': createMinimalArea('area-1', 'Dungeon Level 1', 1),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(true);
  });

  it('validates zone with multiple areas', () => {
    const zone = {
      id: 'catacombs',
      name: 'The Catacombs',
      entryAreaId: 'entrance',
      victoryAreaIds: ['boss-room'],
      areas: {
        'entrance': createMinimalArea('entrance', 'Catacomb Entrance', 1),
        'east-wing': createMinimalArea('east-wing', 'Eastern Crypts', 2),
        'boss-room': createMinimalArea('boss-room', 'Lich Throne', 4),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(true);
  });

  it('validates peaceful zone with empty victoryAreaIds', () => {
    const zone = {
      id: 'riverdale',
      name: 'Riverdale',
      entryAreaId: 'town-square',
      victoryAreaIds: [],  // Peaceful zone - no victory condition
      areas: {
        'town-square': createMinimalArea('town-square', 'Town Square', 0),
        'tavern': createMinimalArea('tavern', 'The Rusty Tankard', 0),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.victoryAreaIds).toEqual([]);
    }
  });

  it('validates zone with multiple victory areas', () => {
    const zone = {
      id: 'twin-bosses',
      name: 'Hall of Twin Evils',
      entryAreaId: 'entrance',
      victoryAreaIds: ['boss-a', 'boss-b'],  // Must clear both
      areas: {
        'entrance': createMinimalArea('entrance', 'Entrance Hall', 1),
        'boss-a': createMinimalArea('boss-a', 'Dragon Lair', 5),
        'boss-b': createMinimalArea('boss-b', 'Demon Pit', 5),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(true);
  });

  it('rejects empty zone id', () => {
    const zone = {
      id: '',
      name: 'The Depths',
      entryAreaId: 'area-1',
      victoryAreaIds: [],
      areas: {},
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
  });

  it('rejects empty zone name', () => {
    const zone = {
      id: 'test',
      name: '',
      entryAreaId: 'area-1',
      victoryAreaIds: [],
      areas: {},
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
  });

  it('rejects empty entryAreaId', () => {
    const zone = {
      id: 'test',
      name: 'Test Zone',
      entryAreaId: '',
      victoryAreaIds: [],
      areas: {},
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
  });

  it('rejects victoryAreaIds with empty string', () => {
    const zone = {
      id: 'test',
      name: 'Test Zone',
      entryAreaId: 'area-1',
      victoryAreaIds: [''],  // Invalid: empty string in array
      areas: {
        'area-1': createMinimalArea('area-1', 'Area 1', 1),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
  });

  it('rejects entryAreaId that does not exist in areas', () => {
    const zone = {
      id: 'test',
      name: 'Test Zone',
      entryAreaId: 'non-existent',  // Not in areas
      victoryAreaIds: [],
      areas: {
        'area-1': createMinimalArea('area-1', 'Area 1', 1),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('entryAreaId must reference an existing area');
    }
  });

  it('rejects victoryAreaIds that do not exist in areas', () => {
    const zone = {
      id: 'test',
      name: 'Test Zone',
      entryAreaId: 'area-1',
      victoryAreaIds: ['boss-room'],  // Not in areas
      areas: {
        'area-1': createMinimalArea('area-1', 'Area 1', 1),
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('victoryAreaIds must reference existing areas');
    }
  });

  it('rejects area key that does not match metadata.id', () => {
    const zone = {
      id: 'test',
      name: 'Test Zone',
      entryAreaId: 'wrong-key',
      victoryAreaIds: [],
      areas: {
        'wrong-key': createMinimalArea('actual-id', 'Area 1', 1),  // Key != metadata.id
      },
    };
    const result = ZoneSchema.safeParse(zone);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Area keys must match their metadata.id');
    }
  });
});

describe('placePortal', () => {
  // Helper to create a simple test map
  const createTestMap = (): DungeonMap => ({
    width: 10,
    height: 10,
    seed: 12345,
    rooms: [{ x: 1, y: 1, width: 3, height: 3, center: { x: 2, y: 2 }, tags: [] }],
    tiles: Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 10 }, (_, x) =>
        (x >= 1 && x <= 3 && y >= 1 && y <= 3)
          ? { type: 'floor' as const }
          : { type: 'wall' as const }
      )
    ),
  });

  it('places portal on valid floor tile', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: 2, y: 2 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    const result = placePortal(map, config);

    expect(result.tiles[2][2]).toEqual({
      type: 'portal',
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    });
  });

  it('throws on out-of-bounds position', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: 20, y: 5 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    expect(() => placePortal(map, config)).toThrow(
      'Portal position (20, 5) is out of bounds for map 10x10'
    );
  });

  it('throws on wall tile', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: 0, y: 0 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    expect(() => placePortal(map, config)).toThrow(
      "Cannot place portal at (0, 0): tile is 'wall', expected 'floor'"
    );
  });

  it('throws on existing portal tile', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: 2, y: 2 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    const mapWithPortal = placePortal(map, config);

    expect(() => placePortal(mapWithPortal, config)).toThrow(
      "Cannot place portal at (2, 2): tile is 'portal', expected 'floor'"
    );
  });

  it('handles negative x coordinate', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: -1, y: 2 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    expect(() => placePortal(map, config)).toThrow(
      'Portal position (-1, 2) is out of bounds for map 10x10'
    );
  });

  it('handles negative y coordinate', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: 2, y: -1 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    expect(() => placePortal(map, config)).toThrow(
      'Portal position (2, -1) is out of bounds for map 10x10'
    );
  });

  it('preserves other map properties', () => {
    const map = createTestMap();
    const config: PortalPlacementConfig = {
      position: { x: 2, y: 2 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    const result = placePortal(map, config);

    expect(result.width).toBe(map.width);
    expect(result.height).toBe(map.height);
    expect(result.seed).toBe(map.seed);
    expect(result.rooms).toBe(map.rooms);
  });

  it('does not mutate original map', () => {
    const map = createTestMap();
    const originalTile = map.tiles[2][2];
    const config: PortalPlacementConfig = {
      position: { x: 2, y: 2 },
      direction: 'down',
      connection: {
        targetAreaId: 'area-2',
        targetPosition: { x: 5, y: 5 },
        returnAllowed: false,
      },
    };

    placePortal(map, config);

    expect(map.tiles[2][2]).toBe(originalTile);
    expect(map.tiles[2][2].type).toBe('floor');
  });
});

describe('Room tags', () => {
  it('accepts objective-related room tags', () => {
    const room = createRoom({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      tags: ['treasure', 'arena'],
    });
    expect(room.tags).toContain('treasure');
    expect(room.tags).toContain('arena');
  });
});

describe('findFarthestRoom', () => {
  it('returns farthest room by Manhattan distance', () => {
    const rooms: Room[] = [
      { x: 0, y: 0, width: 3, height: 3, center: { x: 1, y: 1 }, tags: [] },
      { x: 10, y: 0, width: 3, height: 3, center: { x: 11, y: 1 }, tags: [] },
      { x: 10, y: 10, width: 3, height: 3, center: { x: 11, y: 11 }, tags: [] },
    ];

    const result = findFarthestRoom(rooms, { x: 1, y: 1 });

    // Room at (11, 11) is farthest: |11-1| + |11-1| = 20
    expect(result.center).toEqual({ x: 11, y: 11 });
  });

  it('throws on empty rooms array', () => {
    expect(() => findFarthestRoom([], { x: 0, y: 0 })).toThrow(
      'Cannot find farthest room: rooms array is empty'
    );
  });

  it('works with single room', () => {
    const rooms: Room[] = [
      { x: 5, y: 5, width: 3, height: 3, center: { x: 6, y: 6 }, tags: [] },
    ];

    const result = findFarthestRoom(rooms, { x: 0, y: 0 });

    expect(result.center).toEqual({ x: 6, y: 6 });
  });

  it('handles tie by returning first encountered', () => {
    const rooms: Room[] = [
      { x: 0, y: 0, width: 3, height: 3, center: { x: 1, y: 1 }, tags: [] },
      { x: 10, y: 0, width: 3, height: 3, center: { x: 11, y: 1 }, tags: [] },
      { x: 0, y: 10, width: 3, height: 3, center: { x: 1, y: 11 }, tags: [] },
    ];

    // From (6, 6), all three are distance 10: |1-6|+|1-6|=10, |11-6|+|1-6|=10, |1-6|+|11-6|=10
    // First room encountered with max distance is room[0]
    const result = findFarthestRoom(rooms, { x: 6, y: 6 });

    // Should return first one encountered with max distance (room[0])
    expect(result.center).toEqual({ x: 1, y: 1 });
  });
});
