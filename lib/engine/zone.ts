/**
 * Zone Factory Functions
 *
 * Functions for creating and generating multi-area zones.
 */

import type { Area, Zone, AreaId, DungeonMap, Room } from './map';
import { ZoneSchema, isPassable, generateDungeon, placePortal, findFarthestRoom, DEFAULT_DUNGEON_CONFIG } from './map';

// --- Types ---

export interface CreateZoneConfig {
  /** Unique zone identifier */
  id: string;
  /** Display name */
  name: string;
  /** Pre-built areas */
  areas: Area[];
  /** Which area players start in */
  entryAreaId: AreaId;
  /** Which areas must be reached for victory */
  victoryAreaIds: AreaId[];
}

// --- Factory Functions ---

/**
 * Create a Zone from pre-built Areas.
 * Use for loading stored zones or assembling custom scenarios.
 *
 * @param config - Zone configuration
 * @returns Validated Zone
 * @throws Error if validation fails
 */
export function createZone(config: CreateZoneConfig): Zone {
  const { id, name, areas, entryAreaId, victoryAreaIds } = config;

  // Check for duplicate area IDs
  const seenIds = new Set<string>();
  for (const area of areas) {
    if (seenIds.has(area.metadata.id)) {
      throw new Error(`Duplicate area ID: "${area.metadata.id}"`);
    }
    seenIds.add(area.metadata.id);
  }

  // Convert areas array to record
  const areasRecord: Record<string, Area> = {};
  for (const area of areas) {
    areasRecord[area.metadata.id] = area;
  }

  // Validate entryAreaId exists
  if (!(entryAreaId in areasRecord)) {
    throw new Error(`entryAreaId "${entryAreaId}" not found in areas`);
  }

  // Validate all victoryAreaIds exist
  for (const victoryId of victoryAreaIds) {
    if (!(victoryId in areasRecord)) {
      throw new Error(`victoryAreaId "${victoryId}" not found in areas`);
    }
  }

  // Validate portal connections
  for (const area of areas) {
    for (const row of area.map.tiles) {
      for (const tile of row) {
        if (tile.type === 'portal' && tile.connection) {
          const targetAreaId = tile.connection.targetAreaId;
          const targetArea = areasRecord[targetAreaId];

          if (!targetArea) {
            throw new Error(
              `Portal in area "${area.metadata.id}" references non-existent area "${targetAreaId}"`
            );
          }

          const { x, y } = tile.connection.targetPosition;
          if (!isPassable(targetArea.map, x, y)) {
            throw new Error(
              `Portal in area "${area.metadata.id}" targets impassable position (${x}, ${y}) in area "${targetAreaId}"`
            );
          }
        }
      }
    }
  }

  const zone: Zone = {
    id,
    name,
    entryAreaId,
    victoryAreaIds,
    areas: areasRecord,
  };

  // Final validation with Zod schema
  ZoneSchema.parse(zone);

  return zone;
}

// --- Procedural Zone Generation ---

export interface ProceduralZoneConfig {
  /** Unique zone identifier */
  id: string;
  /** Display name */
  name: string;
  /** Number of areas to generate */
  areaCount: number;
  /** RNG seed for reproducibility */
  seed: number;
  /** Optional: custom danger levels per area (default: depth-based) */
  dangerLevels?: number[];
  /** Optional: prefix for area names (default: "Level") */
  areaNamePrefix?: string;
  /** Optional: victory condition type (default: 'clear_all') */
  victoryObjectiveType?: 'clear_all' | 'find_exit';
}

/**
 * Generate a multi-area Zone procedurally.
 * Creates linear progression: Area 1 → Area 2 → ... → Victory
 *
 * @param config - Zone generation configuration
 * @returns Zone with connected areas and portals placed
 */
export function generateProceduralZone(config: ProceduralZoneConfig): Zone {
  const {
    id,
    name,
    areaCount,
    seed,
    dangerLevels,
    areaNamePrefix = 'Level',
  } = config;

  if (areaCount < 1) {
    throw new Error('areaCount must be at least 1');
  }

  if (dangerLevels && dangerLevels.length !== areaCount) {
    throw new Error(`dangerLevels length (${dangerLevels.length}) must match areaCount (${areaCount})`);
  }

  // Generate all area maps
  const areaMaps: DungeonMap[] = [];
  for (let i = 0; i < areaCount; i++) {
    const map = generateDungeon({
      ...DEFAULT_DUNGEON_CONFIG,
      seed: seed + i * 1000, // Offset seed for each area
    });
    areaMaps.push(map);
  }

  // Find starting rooms for each area (first room or tagged 'starting')
  const startingRooms: Room[] = areaMaps.map(map => {
    const startingRoom = map.rooms.find(r => r.tags.includes('starting'));
    return startingRoom ?? map.rooms[0];
  });

  // Place portals connecting areas
  const areasWithPortals: DungeonMap[] = areaMaps.map((map, index) => {
    let updatedMap = map;

    // Place down portal (except for last area)
    if (index < areaCount - 1) {
      const farthestRoom = findFarthestRoom(map.rooms, startingRooms[index].center);
      const nextStartingRoom = startingRooms[index + 1];

      updatedMap = placePortal(updatedMap, {
        position: farthestRoom.center,
        direction: 'down',
        connection: {
          targetAreaId: `area-${index + 2}`,
          targetPosition: nextStartingRoom.center,
          returnAllowed: true,
        },
      });
    }

    // Place up portal (except for first area)
    if (index > 0) {
      const prevFarthestRoom = findFarthestRoom(areaMaps[index - 1].rooms, startingRooms[index - 1].center);

      updatedMap = placePortal(updatedMap, {
        position: startingRooms[index].center,
        direction: 'up',
        connection: {
          targetAreaId: `area-${index}`,
          targetPosition: prevFarthestRoom.center,
          returnAllowed: true,
        },
      });
    }

    return updatedMap;
  });

  // Build areas
  const areas: Area[] = areasWithPortals.map((map, index) => ({
    metadata: {
      id: `area-${index + 1}`,
      name: `${areaNamePrefix} ${index + 1}`,
      dangerLevel: dangerLevels ? dangerLevels[index] : index + 1,
    },
    map,
  }));

  // Assemble zone using createZone for validation
  return createZone({
    id,
    name,
    areas,
    entryAreaId: 'area-1',
    victoryAreaIds: [`area-${areaCount}`],
  });
}

// --- Test Dungeon Configuration ---

/**
 * Test dungeon configuration for CRA-22.
 * 5-floor linear descent with procedural generation.
 */
export const TEST_DUNGEON_CONFIG: ProceduralZoneConfig = {
  id: 'test-dungeon',
  name: 'The Depths',
  areaCount: 5,
  seed: 12345,
  areaNamePrefix: 'Dungeon Level',
};
