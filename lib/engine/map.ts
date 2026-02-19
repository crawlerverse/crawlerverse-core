// packages/crawler-core/lib/engine/map.ts
import { z } from 'zod';
import * as ROT from 'rot-js';
import { logger } from '../logging';

// --- Position Schema ---

/** Position schema for tile/map coordinates (integer-constrained). Use this for grid-based positions. */
export const TilePositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

// --- Area Identification ---

/**
 * Unique identifier for an area within a zone.
 * Examples: "area-1", "catacombs-entrance", "town-square"
 */
export type AreaId = string;

// --- Portal Connection ---

/** Defines where a portal leads and whether return is allowed */
export const PortalConnectionSchema = z.object({
  /** Target area this portal leads to */
  targetAreaId: z.string().min(1),
  /** Position where entity spawns on target area */
  targetPosition: TilePositionSchema,
  /** If true, a return portal should exist on target area. Advisory flag for game logic. */
  returnAllowed: z.boolean(),
});

export type PortalConnection = z.infer<typeof PortalConnectionSchema>;

/** Configuration for placing a portal on a map */
export interface PortalPlacementConfig {
  /** Position to place the portal */
  readonly position: { readonly x: number; readonly y: number };
  /** Visual direction hint (< for up, > for down) */
  readonly direction: 'up' | 'down';
  /** Where this portal leads */
  readonly connection: PortalConnection;
}

// --- Area Metadata ---

/** Metadata describing an area's identity and characteristics */
export const AreaMetadataSchema = z.object({
  /** Unique identifier within the zone */
  id: z.string().min(1),
  /** Display name shown to player: "Dungeon Level 1", "Town Square" */
  name: z.string().min(1),
  /** Danger level for difficulty scaling (0 = safe, higher = more dangerous) */
  dangerLevel: z.number().int().nonnegative(),
  /** Optional theme affecting generation/monsters (future use) */
  theme: z.string().optional(),
});

export type AreaMetadata = z.infer<typeof AreaMetadataSchema>;

// --- Dungeon Configuration ---

/** Schema for validating DungeonConfig at runtime boundaries */
export const DungeonConfigSchema = z.object({
  /** Map width in tiles (10-200) */
  width: z.number().int().min(10).max(200),
  /** Map height in tiles (10-200) */
  height: z.number().int().min(10).max(200),
  /** Seed for deterministic generation */
  seed: z.number().int(),
  /** [min, max] room size range (3-50, min <= max) */
  roomSizeRange: z.tuple([z.number().int().min(3), z.number().int().max(50)])
    .refine(([min, max]) => min <= max, 'roomSizeRange min must be <= max'),
  /** Percentage of map to dig out (0.1-0.9) */
  dugPercentage: z.number().min(0.1).max(0.9),
  /** Number of rooms to mark as starting rooms (1-10) */
  startingRoomCount: z.number().int().min(1).max(10),
  /** Strategy for selecting starting rooms */
  startingRoomStrategy: z.enum(['first', 'spread', 'random']),
  /** Number of monsters to spawn (0-50) */
  monsterCount: z.number().int().min(0).max(50),
});

/** DungeonConfig type derived from schema to ensure they stay in sync */
export type DungeonConfig = Readonly<z.infer<typeof DungeonConfigSchema>>;

export const DEFAULT_DUNGEON_CONFIG: Omit<DungeonConfig, 'seed'> = {
  width: 50,
  height: 50,
  roomSizeRange: [5, 10],
  dugPercentage: 0.3,
  startingRoomCount: 1,
  startingRoomStrategy: 'first',
  monsterCount: 2,
};

// --- Tile Types (Discriminated Union) ---
export const TileSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wall') }),
  z.object({ type: z.literal('floor') }),
  z.object({ type: z.literal('door'), open: z.boolean() }),
  z.object({
    type: z.literal('portal'),
    /** Visual hint for rendering (< for up, > for down) */
    direction: z.enum(['up', 'down']).optional(),
    /** Where this portal leads. Required for functional portals; optional for placeholder tiles. */
    connection: PortalConnectionSchema.optional(),
  }),
]);

export type Tile = z.infer<typeof TileSchema>;

// --- Room Metadata ---

/** Valid room tags for game logic and objective generation */
export type RoomTag =
  | 'starting'      // Player spawn point
  | 'exit'          // Level exit
  | 'treasure'      // Reach objective: valuable loot
  | 'shrine'        // Reach objective: special interaction
  | 'secret'        // Reach objective: hidden area
  | 'arena'         // Clear objective: must kill all monsters
  | 'clear_required'; // Clear objective: blocks progression

export interface Room {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly center: { readonly x: number; readonly y: number };
  readonly tags: ReadonlyArray<RoomTag>;
}

/**
 * Factory function to create a Room with validation.
 * Calculates center automatically from position and dimensions.
 *
 * @param params - Room parameters (without center)
 * @returns A validated Room with calculated center
 * @throws Error if dimensions are not positive
 */
export function createRoom(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  tags?: ReadonlyArray<RoomTag>;
}): Room {
  if (params.width <= 0) {
    throw new Error(`Room width must be positive, got ${params.width}`);
  }
  if (params.height <= 0) {
    throw new Error(`Room height must be positive, got ${params.height}`);
  }
  if (params.x < 0 || params.y < 0) {
    throw new Error(`Room position must be non-negative, got (${params.x}, ${params.y})`);
  }

  return Object.freeze({
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    center: Object.freeze({
      x: Math.floor((params.x * 2 + params.width - 1) / 2),
      y: Math.floor((params.y * 2 + params.height - 1) / 2),
    }),
    tags: Object.freeze(params.tags ?? []),
  });
}

// --- DungeonMap Container ---
export interface DungeonMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<ReadonlyArray<Tile>>;
  readonly rooms: ReadonlyArray<Room>;
  readonly seed: number;
}

/** Schema for Room metadata (used for runtime validation of DungeonMap) */
export const RoomSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  center: z.object({
    x: z.number().int(),
    y: z.number().int(),
  }).readonly(),
  tags: z.array(z.enum(['starting', 'exit', 'treasure', 'shrine', 'secret', 'arena', 'clear_required'])).readonly(),
}).readonly();

/** Schema for DungeonMap container (used for runtime validation) */
export const DungeonMapSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiles: z.array(z.array(TileSchema).readonly()).readonly(),
  rooms: z.array(RoomSchema).readonly(),
  seed: z.number().int(),
});

// --- Area ---

/**
 * A generated area combining metadata with its map.
 * TODO: Consider renaming DungeonMap -> AreaMap for consistency
 */
export const AreaSchema = z.object({
  metadata: AreaMetadataSchema,
  map: DungeonMapSchema,
});

export type Area = z.infer<typeof AreaSchema>;

// --- Zone ---

/**
 * A Zone is a collection of connected Areas.
 * Examples: a multi-level dungeon, a town with districts, a forest region.
 */
export const ZoneSchema = z.object({
  /** Unique identifier for this zone */
  id: z.string().min(1),
  /** Display name: "The Catacombs", "Riverdale", "Dark Forest" */
  name: z.string().min(1),
  /** Area where players enter this zone */
  entryAreaId: z.string().min(1),
  /**
   * Area IDs that must be cleared for victory. Empty array = no victory condition
   * (e.g., peaceful zones like towns).
   */
  victoryAreaIds: z.array(z.string().min(1)),
  /** All areas in this zone, keyed by AreaId (key must match area.metadata.id) */
  areas: z.record(z.string().min(1), AreaSchema),
}).refine(
  (zone) => zone.entryAreaId in zone.areas,
  { message: 'entryAreaId must reference an existing area in areas' }
).refine(
  (zone) => zone.victoryAreaIds.every(id => id in zone.areas),
  { message: 'All victoryAreaIds must reference existing areas' }
).refine(
  (zone) => Object.entries(zone.areas).every(
    ([key, area]) => key === area.metadata.id
  ),
  { message: 'Area keys must match their metadata.id' }
);

export type Zone = z.infer<typeof ZoneSchema>;

/**
 * Validates a DungeonMap structure for internal consistency.
 * Checks that tile dimensions match width/height and rooms are within bounds.
 *
 * @param map - The DungeonMap to validate
 * @throws Error if validation fails
 */
export function validateDungeonMap(map: DungeonMap): void {
  // Validate tile array dimensions
  if (map.tiles.length !== map.height) {
    throw new Error(
      `Tile array height mismatch: expected ${map.height} rows, got ${map.tiles.length}`
    );
  }

  for (let y = 0; y < map.height; y++) {
    if (map.tiles[y].length !== map.width) {
      throw new Error(
        `Tile row ${y} width mismatch: expected ${map.width} columns, got ${map.tiles[y].length}`
      );
    }
  }

  // Validate rooms are within bounds
  for (const room of map.rooms) {
    if (room.x < 0 || room.y < 0 ||
        room.x + room.width > map.width ||
        room.y + room.height > map.height) {
      throw new Error(
        `Room at (${room.x}, ${room.y}) with size ${room.width}x${room.height} ` +
        `is outside map bounds ${map.width}x${map.height}`
      );
    }
  }
}

// --- Tile Appearance Configuration ---

export interface TileAppearance {
  /** Single ASCII character for display */
  readonly char: string;
  /** CSS color string (hex format preferred) */
  readonly fg: string;
}

/** Type-safe keys for tile appearance lookup */
type TileAppearanceKey = 'wall' | 'floor' | 'door_closed' | 'door_open' | 'portal_up' | 'portal_down' | 'portal';

export const TILE_APPEARANCE: Record<TileAppearanceKey, TileAppearance> = {
  wall:        { char: '#', fg: '#666666' },
  floor:       { char: '.', fg: '#333333' },
  door_closed: { char: '+', fg: '#8B4513' },
  door_open:   { char: '/', fg: '#8B4513' },
  portal_up:   { char: '<', fg: '#FFD700' },
  portal_down: { char: '>', fg: '#FFD700' },
  portal:      { char: 'O', fg: '#FFD700' },  // Generic portal without direction
};

export function getTileAppearance(tile: Tile): TileAppearance {
  switch (tile.type) {
    case 'wall':
      return TILE_APPEARANCE.wall;
    case 'floor':
      return TILE_APPEARANCE.floor;
    case 'portal':
      if (tile.direction === 'up') return TILE_APPEARANCE.portal_up;
      if (tile.direction === 'down') return TILE_APPEARANCE.portal_down;
      return TILE_APPEARANCE.portal;
    case 'door':
      return tile.open
        ? TILE_APPEARANCE.door_open
        : TILE_APPEARANCE.door_closed;
  }
}

// --- Helper Functions ---

/** Get tile at position, or null if out of bounds */
export function getTile(map: DungeonMap, x: number, y: number): Tile | null {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return null;
  return map.tiles[y][x];
}

/** Check if position is passable (can be walked through) */
export function isPassable(map: DungeonMap, x: number, y: number): boolean {
  const tile = getTile(map, x, y);
  if (!tile) return false;

  switch (tile.type) {
    case 'wall':
      return false;
    case 'floor':
    case 'portal':
      return true;
    case 'door':
      return tile.open;
  }
}

/**
 * Place a portal tile on the map.
 *
 * @param map - The dungeon map to modify
 * @param config - Portal placement configuration
 * @returns New map with portal placed
 * @throws Error if position is out of bounds or not a floor tile
 */
export function placePortal(
  map: DungeonMap,
  config: PortalPlacementConfig
): DungeonMap {
  const { position, direction, connection } = config;
  const { x, y } = position;

  // Validate bounds
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
    throw new Error(
      `Portal position (${x}, ${y}) is out of bounds for map ${map.width}x${map.height}`
    );
  }

  // Validate tile is floor (portals can only replace floor tiles)
  const currentTile = map.tiles[y][x];
  if (currentTile.type !== 'floor') {
    throw new Error(
      `Cannot place portal at (${x}, ${y}): tile is '${currentTile.type}', expected 'floor'`
    );
  }

  // Create new tiles array with portal
  const newTiles = map.tiles.map((row, rowY) =>
    rowY === y
      ? row.map((tile, colX) =>
          colX === x
            ? { type: 'portal' as const, direction, connection }
            : tile
        )
      : row
  );

  return { ...map, tiles: newTiles };
}

/**
 * Find the room farthest from a reference point.
 * Uses Manhattan distance between room centers.
 *
 * @param rooms - Array of rooms to search
 * @param from - Reference position (typically starting room center)
 * @returns The room with center farthest from the reference point
 * @throws Error if rooms array is empty
 */
export function findFarthestRoom(
  rooms: readonly Room[],
  from: { x: number; y: number }
): Room {
  if (rooms.length === 0) {
    throw new Error('Cannot find farthest room: rooms array is empty');
  }

  let farthest = rooms[0];
  let maxDistance = 0;

  for (const room of rooms) {
    const distance =
      Math.abs(room.center.x - from.x) +
      Math.abs(room.center.y - from.y);
    if (distance > maxDistance) {
      maxDistance = distance;
      farthest = room;
    }
  }

  return farthest;
}

/** Character to Tile mapping for ASCII parsing */
function charToTile(char: string): Tile {
  switch (char) {
    case '#':
    case ' ':
      return { type: 'wall' };
    case '.':
    case '@':
    case 'r':
    case 'g':
    case 'T':
      return { type: 'floor' };
    case '+':
      return { type: 'door', open: false };
    case '/':
      return { type: 'door', open: true };
    case '<':
      // Portal placeholder - connection must be set by caller during dungeon generation
      return { type: 'portal', direction: 'up' };
    case '>':
      // Portal placeholder - connection must be set by caller during dungeon generation
      return { type: 'portal', direction: 'down' };
    default:
      return { type: 'floor' };
  }
}

/** Parse ASCII map string to 2D tile array */
export function parseAsciiMap(ascii: string): {
  tiles: ReadonlyArray<ReadonlyArray<Tile>>;
  width: number;
  height: number;
} {
  const lines = ascii.split('\n');
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));

  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    const line = lines[y];
    for (let x = 0; x < width; x++) {
      const char = x < line.length ? line[x] : ' ';
      tiles[y][x] = charToTile(char);
    }
  }

  return { tiles, width, height };
}

/** Extract Room metadata from ROT.Map.Digger */
export function extractRooms(
  digger: InstanceType<typeof ROT.Map.Digger>
): Room[] {
  return digger.getRooms().map((rotRoom) => {
    const left = rotRoom.getLeft();
    const top = rotRoom.getTop();
    const right = rotRoom.getRight();
    const bottom = rotRoom.getBottom();

    return {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
      center: {
        x: Math.floor((left + right) / 2),
        y: Math.floor((top + bottom) / 2),
      },
      tags: [],
    };
  });
}

// --- Starting Room Selection ---

/**
 * Select starting rooms using the specified strategy.
 *
 * Strategies:
 * - 'first': Simple, deterministic - just take first N rooms
 * - 'spread': For multiplayer - maximize distance between starting rooms
 * - 'random': For variety - shuffle and take first N
 *
 * @param rooms - Array of rooms to select from
 * @param count - Number of rooms to select
 * @param strategy - Selection strategy
 * @param rng - ROT.RNG instance for seeded randomness
 * @returns Selected rooms
 */
export function selectStartingRooms(
  rooms: Room[],
  count: number,
  strategy: 'first' | 'spread' | 'random',
  rng: typeof ROT.RNG
): Room[] {
  if (rooms.length === 0) return [];
  const actualCount = Math.min(count, rooms.length);

  switch (strategy) {
    case 'first':
      return rooms.slice(0, actualCount);

    case 'random': {
      const shuffled = [...rooms];
      // Fisher-Yates shuffle with seeded RNG
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng.getUniform() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, actualCount);
    }

    case 'spread':
      return selectSpreadRooms(rooms, actualCount);
  }
}

/**
 * Validate that all passable tiles in a map are connected.
 * Uses flood-fill algorithm with 4-directional connectivity.
 *
 * @param map - The dungeon map to validate
 * @returns true if all passable tiles are reachable from any other passable tile
 */
export function validateConnectivity(map: DungeonMap): boolean {
  // Find first passable tile
  let startX = -1,
    startY = -1;
  outer: for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isPassable(map, x, y)) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }

  if (startX === -1) return false; // No passable tiles

  // Flood-fill from start
  const visited = new Set<string>();
  const queue: Array<[number, number]> = [[startX, startY]];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) {
      // This should never happen given the while condition, but ensures type safety
      break;
    }
    const [x, y] = item;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Check 4-directional neighbors
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (isPassable(map, nx, ny) && !visited.has(`${nx},${ny}`)) {
        queue.push([nx, ny]);
      }
    }
  }

  // Count total passable tiles and compare
  let totalPassable = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isPassable(map, x, y)) totalPassable++;
    }
  }

  return visited.size === totalPassable;
}

/**
 * Select rooms that are maximally spread apart.
 * Uses a greedy algorithm: start with the first room, then repeatedly
 * select the room that maximizes the minimum distance to all selected rooms.
 */
function selectSpreadRooms(rooms: Room[], count: number): Room[] {
  if (count === 1) return [rooms[0]];

  const selected: Room[] = [rooms[0]];
  const remaining = rooms.slice(1);

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestMinDist = -1;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      let minDist = Infinity;

      // Find the minimum distance from this candidate to any selected room
      for (const sel of selected) {
        const dist =
          Math.abs(candidate.center.x - sel.center.x) +
          Math.abs(candidate.center.y - sel.center.y);
        minDist = Math.min(minDist, dist);
      }

      // Keep the candidate with the largest minimum distance
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

// --- Entity Spawning ---

/**
 * Custom error for spawn position failures.
 * Includes context for debugging.
 */
export class SpawnPositionError extends Error {
  constructor(
    message: string,
    public readonly requested: number,
    public readonly available: number,
    public readonly seed: number
  ) {
    super(message);
    this.name = 'SpawnPositionError';
  }
}

/**
 * Get spawn positions for players.
 * Prefers rooms tagged as 'starting', falls back to any room if none are tagged.
 *
 * @param map - The dungeon map
 * @param count - Number of player spawn positions needed
 * @returns Array of spawn positions (room centers)
 * @throws SpawnPositionError if no rooms are available for spawning
 */
export function getPlayerSpawnPositions(
  map: DungeonMap,
  count: number = 1
): Array<{ x: number; y: number }> {
  const startingRooms = map.rooms.filter(r => r.tags.includes('starting'));
  const rooms = startingRooms.length > 0 ? startingRooms : map.rooms;

  if (rooms.length === 0) {
    throw new SpawnPositionError(
      `Cannot spawn players: dungeon has no rooms. ` +
      `Map dimensions: ${map.width}x${map.height}, seed: ${map.seed}. ` +
      `Try adjusting dugPercentage or room size parameters.`,
      count,
      0,
      map.seed
    );
  }

  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count && i < rooms.length; i++) {
    positions.push({ ...rooms[i].center });
  }

  if (positions.length < count) {
    logger.warn(
      { seed: map.seed, requested: count, available: rooms.length, returning: positions.length },
      'Requested more player spawn positions than rooms available'
    );
  }

  return positions;
}

// --- Dungeon Generation ---

const MAX_GENERATION_ATTEMPTS = 10;

/**
 * Custom error for dungeon generation failures.
 * Includes full config context for debugging.
 */
export class DungeonGenerationError extends Error {
  constructor(
    message: string,
    public readonly config: DungeonConfig,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'DungeonGenerationError';
  }
}

/**
 * Validate dungeon config before generation.
 * @throws DungeonGenerationError with descriptive message if config is invalid
 */
function validateConfig(config: DungeonConfig): void {
  // Validate using Zod schema for comprehensive checks
  const result = DungeonConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new DungeonGenerationError(
      `[seed: ${config.seed}] Invalid dungeon config: ${issues}`,
      config,
      0  // 0 attempts since validation failed before any generation
    );
  }

  // Additional cross-field validations
  if (config.roomSizeRange[1] >= Math.min(config.width, config.height) - 2) {
    throw new DungeonGenerationError(
      `[seed: ${config.seed}] Room max size (${config.roomSizeRange[1]}) must be smaller than ` +
      `map dimensions (${config.width}x${config.height}) minus wall padding`,
      config,
      0
    );
  }
}

/**
 * Generate a procedural dungeon using ROT.Map.Digger.
 * Retries with incremented seeds if the generated dungeon fails connectivity check.
 *
 * @param config - Configuration for dungeon generation
 * @returns A fully connected DungeonMap with the actual seed used for generation
 * @throws DungeonGenerationError if unable to generate a connected dungeon after MAX_GENERATION_ATTEMPTS
 */
export function generateDungeon(config: DungeonConfig): DungeonMap {
  // Validate config before attempting generation
  validateConfig(config);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const attemptSeed = config.seed + attempt;
    const map = generateDungeonAttempt({ ...config, seed: attemptSeed });

    if (validateConnectivity(map)) {
      // Return with the actual seed used for true determinism/reproducibility
      // Note: If retries occurred, attemptSeed differs from config.seed
      return map;
    }

    // Log retry for debugging
    logger.debug(
      { seed: attemptSeed, attempt: attempt + 1, maxAttempts: MAX_GENERATION_ATTEMPTS },
      'Dungeon generation failed connectivity check, retrying'
    );
  }

  throw new DungeonGenerationError(
    `[seed: ${config.seed}] Failed to generate connected dungeon after ${MAX_GENERATION_ATTEMPTS} attempts. ` +
    `Config: width=${config.width}, height=${config.height}, dugPercentage=${config.dugPercentage}, ` +
    `roomSizeRange=[${config.roomSizeRange.join(',')}]. ` +
    `This may indicate the map is too small or dugPercentage is too low for connected rooms.`,
    config,
    MAX_GENERATION_ATTEMPTS
  );
}

/**
 * Single attempt at generating a dungeon.
 * Does not validate connectivity - caller is responsible.
 * Uses try/finally to guarantee RNG state restoration even on error.
 */
function generateDungeonAttempt(config: DungeonConfig): DungeonMap {
  // ROT.Map.Digger uses the global ROT.RNG, so we must seed it directly
  // We save and restore state to avoid side effects
  const savedState = ROT.RNG.getState();
  ROT.RNG.setSeed(config.seed);

  try {
    const rng = ROT.RNG.clone();

    // Wrap ROT.js operations in try-catch for better error messages
    let digger: InstanceType<typeof ROT.Map.Digger>;
    try {
      digger = new ROT.Map.Digger(config.width, config.height, {
        roomWidth: config.roomSizeRange as [number, number],
        roomHeight: config.roomSizeRange as [number, number],
        dugPercentage: config.dugPercentage,
      });
    } catch (rotError) {
      throw new DungeonGenerationError(
        `[seed: ${config.seed}] ROT.Map.Digger failed to initialize: ${rotError instanceof Error ? rotError.message : String(rotError)}`,
        config,
        0
      );
    }

    // Initialize all tiles as walls
    const tiles: Tile[][] = [];
    for (let y = 0; y < config.height; y++) {
      tiles[y] = [];
      for (let x = 0; x < config.width; x++) {
        tiles[y][x] = { type: 'wall' };
      }
    }

    // Carve out floor tiles (wrapped for error handling)
    try {
      digger.create((x, y, value) => {
        if (value === 0) {
          // 0 = floor in ROT.js
          tiles[y][x] = { type: 'floor' };
        }
      });
    } catch (rotError) {
      throw new DungeonGenerationError(
        `[seed: ${config.seed}] ROT.Map.Digger.create() failed: ${rotError instanceof Error ? rotError.message : String(rotError)}`,
        config,
        0
      );
    }

    // Extract rooms and tag starting rooms
    let rooms: Room[];
    try {
      rooms = extractRooms(digger);
    } catch (rotError) {
      throw new DungeonGenerationError(
        `[seed: ${config.seed}] Failed to extract rooms: ${rotError instanceof Error ? rotError.message : String(rotError)}`,
        config,
        0
      );
    }

    const startingRooms = selectStartingRooms(
      rooms,
      config.startingRoomCount,
      config.startingRoomStrategy,
      rng
    );

    const startingRoomSet = new Set(startingRooms);
    rooms = rooms.map((room) =>
      startingRoomSet.has(room)
        ? ({
            ...room,
            tags: [...room.tags, 'starting'] as RoomTag[],
          } as Room)
        : room
    );

    return {
      width: config.width,
      height: config.height,
      tiles,
      rooms,
      seed: config.seed,
    };
  } finally {
    // ALWAYS restore the global RNG state, even if an exception was thrown
    ROT.RNG.setState(savedState);
  }
}

/**
 * Check if a position is inside a room (not in the outer 1-tile border).
 * This avoids spawning entities near walls where they might visually overlap.
 *
 * If no rooms are defined, returns true (fallback for maps without room data).
 */
function isInsideRoom(x: number, y: number, rooms: readonly Room[]): boolean {
  // Fallback: if no rooms defined, allow any passable position
  if (rooms.length === 0) {
    return true;
  }

  for (const room of rooms) {
    // Check if position is strictly inside the room (1-tile margin from edges)
    const innerLeft = room.x + 1;
    const innerTop = room.y + 1;
    const innerRight = room.x + room.width - 2;
    const innerBottom = room.y + room.height - 2;

    if (x >= innerLeft && x <= innerRight && y >= innerTop && y <= innerBottom) {
      return true;
    }
  }
  return false;
}

/**
 * Get spawn positions for monsters.
 * Selects positions inside rooms (not corridors or near walls).
 *
 * @param map - The dungeon map
 * @param count - Number of monster spawn positions needed
 * @param excludePositions - Positions to exclude (e.g., player spawn positions)
 * @param rng - ROT.RNG instance for seeded randomness
 * @returns Array of spawn positions (may be fewer than requested if not enough tiles)
 */
export function getMonsterSpawnPositions(
  map: DungeonMap,
  count: number,
  excludePositions: Array<{ x: number; y: number }>,
  rng: typeof ROT.RNG
): Array<{ x: number; y: number }> {
  const excluded = new Set(excludePositions.map(p => `${p.x},${p.y}`));

  // Collect positions that are:
  // 1. Passable (floor tiles)
  // 2. Not excluded
  // 3. Inside a room (not corridors, not near walls)
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (
        isPassable(map, x, y) &&
        !excluded.has(`${x},${y}`) &&
        isInsideRoom(x, y, map.rooms)
      ) {
        candidates.push({ x, y });
      }
    }
  }

  // Shuffle and take first N (Fisher-Yates shuffle)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng.getUniform() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const result = candidates.slice(0, count);

  if (result.length < count) {
    logger.warn(
      { seed: map.seed, requested: count, available: candidates.length, excluded: excludePositions.length, spawning: result.length },
      'Requested more monster spawn positions than valid room tiles available'
    );
  }

  return result;
}
