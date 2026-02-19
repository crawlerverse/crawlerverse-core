import { describe, it, expect } from 'vitest';
import { processAction } from '../actions';
import type { GameState, Entity } from '../state';
import type { Zone, Area, DungeonMap, Tile } from '../map';
import { entityId, disableSchedulerDebugLogging, advanceScheduler } from '../scheduler';
import { createBubble, bubbleId, disableBubbleDebugLogging } from '../bubble';

// Disable debug logging during tests
disableSchedulerDebugLogging();
disableBubbleDebugLogging();

// Helper to create a tile grid
function createTileGrid(width: number, height: number, factory: (x: number, y: number) => Tile): Tile[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => factory(x, y))
  );
}

// Helper to create a test state with two areas and a portal
function createTestStateWithPortal(): GameState {
  // Create first area's map with a portal at (2,2)
  const area1Map: DungeonMap = {
    width: 10,
    height: 10,
    seed: 12345,
    rooms: [{ x: 1, y: 1, width: 3, height: 3, center: { x: 2, y: 2 }, tags: [] }],
    tiles: createTileGrid(10, 10, (x, y) => {
      if (x === 2 && y === 2) {
        return {
          type: 'portal' as const,
          direction: 'down' as const,
          connection: {
            targetAreaId: 'area-2',
            targetPosition: { x: 5, y: 5 },
            returnAllowed: false,
          },
        };
      }
      return (x >= 1 && x <= 3 && y >= 1 && y <= 3)
        ? { type: 'floor' as const }
        : { type: 'wall' as const };
    }),
  };

  // Create second area's map
  const area2Map: DungeonMap = {
    width: 10,
    height: 10,
    seed: 67890,
    rooms: [{ x: 4, y: 4, width: 3, height: 3, center: { x: 5, y: 5 }, tags: [] }],
    tiles: createTileGrid(10, 10, (x, y) =>
      (x >= 4 && x <= 6 && y >= 4 && y <= 6)
        ? { type: 'floor' as const }
        : { type: 'wall' as const }
    ),
  };

  const area1: Area = {
    metadata: {
      id: 'area-1',
      name: 'First Area',
      dangerLevel: 0,
    },
    map: area1Map,
  };

  const area2: Area = {
    metadata: {
      id: 'area-2',
      name: 'Second Area',
      dangerLevel: 1,
    },
    map: area2Map,
  };

  const zone: Zone = {
    id: 'test-zone',
    name: 'Test Zone',
    entryAreaId: 'area-1',
    victoryAreaIds: ['area-2'],
    areas: {
      'area-1': area1,
      'area-2': area2,
    },
  };

  const crawler: Entity = {
    id: 'crawler-1',
    type: 'crawler',
    name: 'Test Crawler',
    char: '@',
    x: 2,
    y: 2,
    areaId: 'area-1',
    hp: 10,
    maxHp: 10,
    attack: 5,
    defense: 5,
    speed: 100,
  };

  // Create bubble using the factory function (ensures proper Map for commandQueues)
  const bubble = createBubble({
    id: bubbleId('bubble-1'),
    entityIds: [entityId('crawler-1')],
    entities: [{ id: entityId('crawler-1'), speed: 100 }],
    center: { x: 2, y: 2 },
  });

  // Advance scheduler so crawler-1 is current actor
  const advancedScheduler = advanceScheduler(bubble.scheduler);

  return {
    zone,
    currentAreaId: 'area-1',
    entities: { 'crawler-1': crawler },
    items: [],
    hibernating: [],
    exploredTiles: {},
    bubbles: [{
      ...bubble,
      scheduler: advancedScheduler,
    }],
    objectives: [],
    gameStatus: { status: 'playing' },
    turn: 1,
    messages: [],
  };
}

describe('enter_portal action', () => {
  it('transitions crawler to target area', () => {
    const state = createTestStateWithPortal();
    const action = { action: 'enter_portal', reasoning: 'Exploring deeper' };

    const result = processAction(state, 'crawler-1', action);

    expect(result.success).toBe(true);
    if (result.success) {
      const crawler = result.state.entities['crawler-1'];
      expect(crawler.areaId).toBe('area-2');
      expect(crawler.x).toBe(5);
      expect(crawler.y).toBe(5);
    }
  });

  it('generates descend message for down portal', () => {
    const state = createTestStateWithPortal();
    const action = { action: 'enter_portal', reasoning: 'Going down' };

    const result = processAction(state, 'crawler-1', action);

    expect(result.success).toBe(true);
    if (result.success) {
      const messages = result.state.messages;
      const portalMsg = messages.find(m => m.text.includes('descends'));
      expect(portalMsg).toBeDefined();
    }
  });

  it('returns no-op when not on portal tile', () => {
    const state = createTestStateWithPortal();
    // Move crawler off portal
    const movedCrawler = { ...state.entities['crawler-1'], x: 1, y: 1 };
    const modifiedState = {
      ...state,
      entities: { ...state.entities, 'crawler-1': movedCrawler },
    };
    const action = { action: 'enter_portal', reasoning: 'Trying portal' };

    const result = processAction(modifiedState, 'crawler-1', action);

    expect(result.success).toBe(true);
    if (result.success) {
      const crawler = result.state.entities['crawler-1'];
      expect(crawler.x).toBe(1);
      expect(crawler.y).toBe(1);
      expect(crawler.areaId).toBe('area-1');
      const messages = result.state.messages;
      const noPortalMsg = messages.find(m => m.text.toLowerCase().includes('no portal'));
      expect(noPortalMsg).toBeDefined();
    }
  });

  it('updates currentAreaId to follow crawler (viewport follows player)', () => {
    const state = createTestStateWithPortal();
    const action = { action: 'enter_portal', reasoning: 'Exploring' };

    const result = processAction(state, 'crawler-1', action);

    expect(result.success).toBe(true);
    if (result.success) {
      // currentAreaId follows the crawler to the new area
      expect(result.state.currentAreaId).toBe('area-2');
    }
  });

  it('generates ascend message for up portal', () => {
    // Create state with up portal
    const state = createTestStateWithPortal();
    // Modify the portal to be an "up" portal
    const area1 = state.zone.areas['area-1'];
    const modifiedTiles = area1.map.tiles.map((row, y) =>
      row.map((tile, x) => {
        if (x === 2 && y === 2 && tile.type === 'portal') {
          return {
            ...tile,
            direction: 'up' as const,
          };
        }
        return tile;
      })
    );
    const modifiedState: GameState = {
      ...state,
      zone: {
        ...state.zone,
        areas: {
          ...state.zone.areas,
          'area-1': {
            ...area1,
            map: { ...area1.map, tiles: modifiedTiles },
          },
        },
      },
    };
    const action = { action: 'enter_portal', reasoning: 'Going up' };

    const result = processAction(modifiedState, 'crawler-1', action);

    expect(result.success).toBe(true);
    if (result.success) {
      const messages = result.state.messages;
      const portalMsg = messages.find(m => m.text.includes('ascends'));
      expect(portalMsg).toBeDefined();
    }
  });

  it('rejects non-crawler entities attempting to use portal', () => {
    const state = createTestStateWithPortal();
    // Add a monster
    const monster: Entity = {
      id: 'monster-1',
      type: 'monster' as const,
      name: 'Test Rat',
      monsterTypeId: 'rat' as const,
      x: 2,
      y: 2,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      attack: 2,
      defense: 1,
      speed: 120,
      behaviorState: 'patrol' as const,
    };
    state.entities['monster-1'] = monster;

    const action = { action: 'enter_portal', reasoning: 'Monster tries portal' };
    const result = processAction(state, 'monster-1', action);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not a crawler');
    }
  });
});
