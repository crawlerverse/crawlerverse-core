import { describe, it, expect } from 'vitest';
import { createZone, generateProceduralZone } from '../zone';
import type { ProceduralZoneConfig } from '../zone';
import type { Area, PortalConnection, Tile } from '../map';
import { generateDungeon, DEFAULT_DUNGEON_CONFIG, placePortal } from '../map';

// Helper to create a simple test area
function createTestArea(id: string, name: string): Area {
  const map = generateDungeon({ ...DEFAULT_DUNGEON_CONFIG, seed: 12345 });
  return {
    metadata: { id, name, dangerLevel: 1 },
    map,
  };
}

// Helper to create a test area with a portal at the first room's center
function createTestAreaWithPortal(
  id: string,
  name: string,
  connection: PortalConnection
): Area {
  const map = generateDungeon({ ...DEFAULT_DUNGEON_CONFIG, seed: 12345 });
  // Place portal at the center of the first room (guaranteed to be a floor tile)
  const firstRoom = map.rooms[0];
  const mapWithPortal = placePortal(map, {
    position: firstRoom.center,
    direction: 'down',
    connection,
  });
  return {
    metadata: { id, name, dangerLevel: 1 },
    map: mapWithPortal,
  };
}

describe('createZone', () => {
  it('creates a valid zone from areas array', () => {
    const area1 = createTestArea('area-1', 'First Area');
    const area2 = createTestArea('area-2', 'Second Area');

    const zone = createZone({
      id: 'test-zone',
      name: 'Test Zone',
      areas: [area1, area2],
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-2'],
    });

    expect(zone.id).toBe('test-zone');
    expect(zone.name).toBe('Test Zone');
    expect(zone.entryAreaId).toBe('area-1');
    expect(zone.victoryAreaIds).toEqual(['area-2']);
    expect(Object.keys(zone.areas)).toHaveLength(2);
    expect(zone.areas['area-1']).toBe(area1);
    expect(zone.areas['area-2']).toBe(area2);
  });

  it('throws if entryAreaId not in areas', () => {
    const area1 = createTestArea('area-1', 'First Area');

    expect(() => createZone({
      id: 'test-zone',
      name: 'Test Zone',
      areas: [area1],
      entryAreaId: 'nonexistent',
      victoryAreaIds: ['area-1'],
    })).toThrow('entryAreaId "nonexistent" not found in areas');
  });

  it('throws if victoryAreaId not in areas', () => {
    const area1 = createTestArea('area-1', 'First Area');

    expect(() => createZone({
      id: 'test-zone',
      name: 'Test Zone',
      areas: [area1],
      entryAreaId: 'area-1',
      victoryAreaIds: ['nonexistent'],
    })).toThrow('victoryAreaId "nonexistent" not found in areas');
  });

  it('throws if duplicate area IDs', () => {
    const area1 = createTestArea('area-1', 'First Area');
    const area1Dup = createTestArea('area-1', 'Duplicate');

    expect(() => createZone({
      id: 'test-zone',
      name: 'Test Zone',
      areas: [area1, area1Dup],
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-1'],
    })).toThrow('Duplicate area ID: "area-1"');
  });

  it('throws if portal references non-existent area', () => {
    // Create an area with a portal pointing to 'nonexistent-area'
    const area1 = createTestAreaWithPortal('area-1', 'First Area', {
      targetAreaId: 'nonexistent-area',
      targetPosition: { x: 5, y: 5 },
      returnAllowed: true,
    });

    expect(() => createZone({
      id: 'test-zone',
      name: 'Test Zone',
      areas: [area1],
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-1'],
    })).toThrow('Portal in area "area-1" references non-existent area "nonexistent-area"');
  });

  it('throws if portal target position is not passable', () => {
    // Create area1 with a portal pointing to a wall position (0,0) in area2
    const area1 = createTestAreaWithPortal('area-1', 'First Area', {
      targetAreaId: 'area-2',
      targetPosition: { x: 0, y: 0 }, // This should be a wall
      returnAllowed: true,
    });
    const area2 = createTestArea('area-2', 'Second Area');

    expect(() => createZone({
      id: 'test-zone',
      name: 'Test Zone',
      areas: [area1, area2],
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-2'],
    })).toThrow('Portal in area "area-1" targets impassable position (0, 0) in area "area-2"');
  });
});

// Helper to find portal tiles in an area
function findPortals(area: Area): Array<Tile & { type: 'portal' }> {
  const portals: Array<Tile & { type: 'portal' }> = [];
  for (const row of area.map.tiles) {
    for (const tile of row) {
      if (tile.type === 'portal') {
        portals.push(tile as Tile & { type: 'portal' });
      }
    }
  }
  return portals;
}

describe('generateProceduralZone', () => {
  it('generates zone with correct number of areas', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
    });

    expect(Object.keys(zone.areas)).toHaveLength(3);
  });

  it('sets entry area to first area', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
    });

    expect(zone.entryAreaId).toBe('area-1');
  });

  it('sets victory area to last area', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
    });

    expect(zone.victoryAreaIds).toEqual(['area-3']);
  });

  it('places down portals connecting areas linearly', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
    });

    // Area 1 should have a portal to area 2
    const area1Portals = findPortals(zone.areas['area-1']);
    expect(area1Portals.some(p => p.connection?.targetAreaId === 'area-2')).toBe(true);

    // Area 2 should have a portal to area 3
    const area2Portals = findPortals(zone.areas['area-2']);
    expect(area2Portals.some(p => p.connection?.targetAreaId === 'area-3')).toBe(true);

    // Area 3 (last) should have no down portal
    const area3DownPortals = findPortals(zone.areas['area-3']).filter(p => p.direction === 'down');
    expect(area3DownPortals).toHaveLength(0);
  });

  it('places up portals for return travel', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
    });

    // Area 1 (first) should have no up portal
    const area1UpPortals = findPortals(zone.areas['area-1']).filter(p => p.direction === 'up');
    expect(area1UpPortals).toHaveLength(0);

    // Area 2 should have an up portal to area 1
    const area2UpPortals = findPortals(zone.areas['area-2']).filter(p => p.direction === 'up');
    expect(area2UpPortals).toHaveLength(1);
    expect(area2UpPortals[0].connection?.targetAreaId).toBe('area-1');
    expect(area2UpPortals[0].connection?.returnAllowed).toBe(true);

    // Area 3 should have an up portal to area 2
    const area3UpPortals = findPortals(zone.areas['area-3']).filter(p => p.direction === 'up');
    expect(area3UpPortals).toHaveLength(1);
    expect(area3UpPortals[0].connection?.targetAreaId).toBe('area-2');
    expect(area3UpPortals[0].connection?.returnAllowed).toBe(true);
  });

  it('sets danger level based on depth', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
    });

    expect(zone.areas['area-1'].metadata.dangerLevel).toBe(1);
    expect(zone.areas['area-2'].metadata.dangerLevel).toBe(2);
    expect(zone.areas['area-3'].metadata.dangerLevel).toBe(3);
  });

  it('uses custom danger levels when provided', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 12345,
      dangerLevels: [1, 5, 2],
    });

    expect(zone.areas['area-1'].metadata.dangerLevel).toBe(1);
    expect(zone.areas['area-2'].metadata.dangerLevel).toBe(5);
    expect(zone.areas['area-3'].metadata.dangerLevel).toBe(2);
  });

  it('is deterministic for same seed', () => {
    const zone1 = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const zone2 = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    // Maps should be identical
    expect(zone1.areas['area-1'].map.tiles).toEqual(zone2.areas['area-1'].map.tiles);
    expect(zone1.areas['area-2'].map.tiles).toEqual(zone2.areas['area-2'].map.tiles);
  });
});

describe('ProceduralZoneConfig', () => {
  it('accepts victoryObjectiveType option', () => {
    const config: ProceduralZoneConfig = {
      id: 'test',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
      victoryObjectiveType: 'find_exit',
    };
    expect(config.victoryObjectiveType).toBe('find_exit');
  });
});
