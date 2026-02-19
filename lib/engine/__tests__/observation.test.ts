import { describe, it, expect } from 'vitest';
import {
  createObservation,
  CrawlerObservationSchema,
} from '../observation';
import { createEntity, getCurrentArea, getCrawlers, DEFAULT_AREA_ID, type GameState } from '../state';
import { createTestDungeon } from '../maps/test-dungeon';
import { createTestZone } from './test-helpers';
import { advanceScheduler, completeCurrentTurn, entityId } from '../scheduler';
import { parseAsciiMap, type DungeonMap, type Zone } from '../map';
import { createBubble, bubbleId } from '../bubble';
import { crawlerIdFromIndex } from '../crawler-id';
import { CrawlerCharacterSystem } from '../character-system';

// Primary player ID constant for tests
const PLAYER_ID = crawlerIdFromIndex(1);

// Helper to advance scheduler in first bubble
function advanceToNextTurn(state: GameState): GameState {
  if (state.bubbles.length === 0) return state;
  const bubble = state.bubbles[0];
  const advancedScheduler = advanceScheduler(bubble.scheduler);
  return {
    ...state,
    bubbles: [{ ...bubble, scheduler: advancedScheduler }, ...state.bubbles.slice(1)],
  };
}

describe('CrawlerObservation', () => {
  it('includes turn info', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.turn).toBe(state.turn);
    expect(typeof observation.yourTurn).toBe('boolean');
    expect(observation.currentActor).toBeDefined();
  });

  it('includes self info', () => {
    const state = advanceToNextTurn(createTestDungeon({ seed: 42 }));
    const crawler = getCrawlers(state)[0]!;

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.self.id).toBe(PLAYER_ID);
    expect(observation.self.position).toEqual({ x: 4, y: 4 }); // Test dungeon player position
    // HP should match crawler's class-appropriate stats
    expect(observation.self.hp).toBe(crawler.hp);
    expect(observation.self.maxHp).toBe(crawler.maxHp);
  });

  it('scopes visible entities to bubble', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));

    // Should see 2 monsters (in same bubble) with dynamic IDs
    expect(observation.visibleEntities.length).toBe(2);
    expect(observation.visibleEntities.every(e => e.type === 'monster')).toBe(true);
    // Monster IDs follow the pattern 'type-counter'
    expect(observation.visibleEntities.every(e => e.id.match(/^(rat|goblin|orc|skeleton|troll)-\d+$/))).toBe(true);
  });

  it('excludes self from visible entities', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.visibleEntities.map(e => e.id)).not.toContain(PLAYER_ID);
  });

  it('includes game status', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.gameStatus.status).toBe('playing');
  });

  it('validates with schema', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));
    const result = CrawlerObservationSchema.safeParse(observation);

    expect(result.success).toBe(true);
  });

  it('yourTurn is true when current actor matches', () => {
    let state = createTestDungeon();
    // Simulate proper turn cycles (advance + complete) until player's turn
    // The rat (speed 120) goes first, then player/goblin (speed 100) compete
    for (let i = 0; i < 20; i++) {
      state = advanceToNextTurn(state);
      const currentActor = state.bubbles[0]?.scheduler.currentActorId;
      if (currentActor === entityId(PLAYER_ID)) break;
      // Complete the current turn so AP is consumed
      if (currentActor) {
        const bubble = state.bubbles[0];
        const completedScheduler = completeCurrentTurn(bubble.scheduler);
        state = {
          ...state,
          bubbles: [{ ...bubble, scheduler: completedScheduler }, ...state.bubbles.slice(1)],
        };
      }
    }

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.yourTurn).toBe(true);
  });

  it('yourTurn is false when current actor does not match', () => {
    // Use a seed that produces a slower class (warrior: speed 80 < rats: speed 120)
    // This ensures monsters get turns before the player after advancing
    let state = createTestDungeon({ seed: 1 }); // Try different seeds if needed
    // Keep advancing until NOT player's turn (or use up all attempts)
    let foundNonPlayerTurn = false;
    for (let i = 0; i < 20; i++) {
      state = advanceToNextTurn(state);
      if (state.bubbles[0]?.scheduler.currentActorId !== entityId(PLAYER_ID)) {
        foundNonPlayerTurn = true;
        break;
      }
    }

    // If we found a non-player turn, test the observation
    // If all turns were player turns (due to high player speed), skip assertion
    if (foundNonPlayerTurn) {
      const observation = createObservation(state, entityId(PLAYER_ID));
      expect(observation.yourTurn).toBe(false);
    } else {
      // Player always had the turn - this can happen with fast classes
      // Create a manual state where it's not the player's turn
      const bubble = state.bubbles[0];
      const monsterIds = bubble.entityIds.filter(id => (id as string) !== PLAYER_ID);
      if (monsterIds.length > 0) {
        const manualState = {
          ...state,
          bubbles: [{
            ...bubble,
            scheduler: { ...bubble.scheduler, currentActorId: monsterIds[0] }
          }]
        };
        const observation = createObservation(manualState, entityId(PLAYER_ID));
        expect(observation.yourTurn).toBe(false);
      }
    }
  });

  it('throws error for non-existent crawler', () => {
    const state = advanceToNextTurn(createTestDungeon());

    expect(() => createObservation(state, entityId('nonexistent'))).toThrow(
      'Crawler nonexistent not found in state'
    );
  });

  it('includes map dimensions', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.mapWidth).toBe(getCurrentArea(state).map.width);
    expect(observation.mapHeight).toBe(getCurrentArea(state).map.height);
  });

  it('includes visible entity details', () => {
    const state = advanceToNextTurn(createTestDungeon());

    const observation = createObservation(state, entityId(PLAYER_ID));

    // Get the first visible monster (type is now random based on seed)
    const monster = observation.visibleEntities[0];
    expect(monster).toBeDefined();
    expect(monster.type).toBe('monster');
    // Position should be a valid coordinate
    expect(monster.position.x).toBeGreaterThanOrEqual(0);
    expect(monster.position.y).toBeGreaterThanOrEqual(0);
    // Name should be one of the valid monster names
    expect(['Rat', 'Goblin', 'Orc', 'Skeleton', 'Troll']).toContain(monster.name);
    // Char should be a single character
    expect(monster.char.length).toBe(1);
    // HP should be positive
    expect(monster.hp).toBeGreaterThan(0);
    expect(monster.maxHp).toBeGreaterThan(0);
    expect(monster.hp).toBeLessThanOrEqual(monster.maxHp);
  });

  it('includes self combat stats matching character class', () => {
    const state = advanceToNextTurn(createTestDungeon({ seed: 42 }));
    const crawler = getCrawlers(state)[0]!;

    const observation = createObservation(state, entityId(PLAYER_ID));

    // Stats should match the crawler's class-appropriate stats
    expect(observation.self.attack).toBe(crawler.attack);
    expect(observation.self.defense).toBe(crawler.defense);
    expect(observation.self.speed).toBe(crawler.speed);
  });
});

/**
 * Helper to create a DungeonMap from ASCII lines for testing.
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
 * Helper to create a test game state with custom map and entity placements.
 */
function createTestState(config: {
  map: DungeonMap;
  player: { x: number; y: number };
  monsters: Array<{ x: number; y: number; name: string; char: string }>;
}): GameState {
  const bounds = { width: config.map.width, height: config.map.height };

  const player = createEntity(
    {
      id: PLAYER_ID,
      type: 'crawler',
      x: config.player.x,
      y: config.player.y,
      hp: 10,
      maxHp: 10,
      name: 'Player',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    },
    bounds
  );

  const monsters = config.monsters.map((m, i) =>
    createEntity(
      {
        id: `monster-${i}`,
        type: 'monster',
        x: m.x,
        y: m.y,
        hp: 3,
        maxHp: 3,
        name: m.name,
        char: m.char,
        attack: 2,
        defense: 1,
        speed: 100,
        areaId: 'area-1',
      },
      bounds
    )
  );

  const entities: Record<string, typeof player> = { [PLAYER_ID]: player };
  for (const monster of monsters) {
    entities[monster.id] = monster;
  }

  const allEntityIds = [entityId(PLAYER_ID), ...monsters.map(m => entityId(m.id))];
  const allEntitySpeeds = [
    { id: entityId(PLAYER_ID), speed: player.speed },
    ...monsters.map(m => ({ id: entityId(m.id), speed: m.speed })),
  ];

  const bubble = createBubble({
    id: bubbleId('bubble-main'),
    entityIds: allEntityIds,
    entities: allEntitySpeeds,
    center: { x: player.x, y: player.y },
  });

  // Advance scheduler so it has a current actor
  const advancedBubble = {
    ...bubble,
    scheduler: advanceScheduler(bubble.scheduler),
  };

  return {
    zone: createTestZone(config.map),
    currentAreaId: DEFAULT_AREA_ID,
    entities,
    items: [],
    bubbles: [advancedBubble],
    hibernating: [],
    exploredTiles: {},
    objectives: [],
    turn: 0,
    messages: [],
    gameStatus: { status: 'playing' },
  };
}

/**
 * Helper to create a test game state with custom visionRadius support.
 */
function createTestStateWithVision(config: {
  map: DungeonMap;
  player: { x: number; y: number; visionRadius?: number };
  monsters: Array<{ x: number; y: number; name: string; char: string }>;
}): GameState {
  const bounds = { width: config.map.width, height: config.map.height };

  const player = createEntity(
    {
      id: PLAYER_ID,
      type: 'crawler',
      x: config.player.x,
      y: config.player.y,
      hp: 10,
      maxHp: 10,
      name: 'Player',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
      ...(config.player.visionRadius !== undefined && { visionRadius: config.player.visionRadius }),
    },
    bounds
  );

  const monsters = config.monsters.map((m, i) =>
    createEntity(
      {
        id: `monster-${i}`,
        type: 'monster',
        x: m.x,
        y: m.y,
        hp: 3,
        maxHp: 3,
        name: m.name,
        char: m.char,
        attack: 2,
        defense: 1,
        speed: 100,
        areaId: 'area-1',
      },
      bounds
    )
  );

  const entities: Record<string, typeof player> = { [PLAYER_ID]: player };
  for (const monster of monsters) {
    entities[monster.id] = monster;
  }

  const allEntityIds = [entityId(PLAYER_ID), ...monsters.map(m => entityId(m.id))];
  const allEntitySpeeds = [
    { id: entityId(PLAYER_ID), speed: player.speed },
    ...monsters.map(m => ({ id: entityId(m.id), speed: m.speed })),
  ];

  const bubble = createBubble({
    id: bubbleId('bubble-main'),
    entityIds: allEntityIds,
    entities: allEntitySpeeds,
    center: { x: player.x, y: player.y },
  });

  // Advance scheduler so it has a current actor
  const advancedBubble = {
    ...bubble,
    scheduler: advanceScheduler(bubble.scheduler),
  };

  return {
    zone: createTestZone(config.map),
    currentAreaId: DEFAULT_AREA_ID,
    entities,
    items: [],
    bubbles: [advancedBubble],
    hibernating: [],
    exploredTiles: {},
    objectives: [],
    turn: 0,
    messages: [],
    gameStatus: { status: 'playing' },
  };
}

describe('createObservation with FOV', () => {
  it('filters out entities not visible to crawler', () => {
    // Create a map with completely separate rooms - no line of sight between them
    // Left room contains player, right room contains goblin, solid wall between
    const map = createTestMap([
      '##########',
      '#.@..#...#',
      '#....#.g.#',
      '#....#...#',
      '##########',
    ]);

    const state = createTestState({
      map,
      player: { x: 2, y: 1 },
      monsters: [{ x: 7, y: 2, name: 'Goblin', char: 'g' }],
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    // Monster is in a separate room with no line of sight
    expect(observation.visibleEntities).toHaveLength(0);
  });

  it('includes entities visible to crawler', () => {
    // Open room, no obstructions
    const map = createTestMap([
      '#######',
      '#.....#',
      '#.@.g.#',
      '#.....#',
      '#######',
    ]);

    const state = createTestState({
      map,
      player: { x: 2, y: 2 },
      monsters: [{ x: 4, y: 2, name: 'Goblin', char: 'g' }],
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    // Monster is visible, should be included
    expect(observation.visibleEntities).toHaveLength(1);
    expect(observation.visibleEntities[0].name).toBe('Goblin');
  });

  it('respects custom visionRadius when filtering visible entities', () => {
    // Large open room where default vision (8) would see the monster
    // but custom small vision (2) should not
    const map = createTestMap([
      '###########',
      '#.........#',
      '#.........#',
      '#.........#',
      '#.........#',
      '#.@.....g.#',
      '#.........#',
      '#.........#',
      '#.........#',
      '#.........#',
      '###########',
    ]);

    // Monster at x=8, player at x=2 -> distance = 6 tiles
    // Default visionRadius (8) would see it
    // Custom visionRadius (3) should NOT see it
    const state = createTestStateWithVision({
      map,
      player: { x: 2, y: 5, visionRadius: 3 },
      monsters: [{ x: 8, y: 5, name: 'Goblin', char: 'g' }],
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    // Monster is 6 tiles away, but vision radius is only 3
    expect(observation.visibleEntities).toHaveLength(0);
  });

  it('sees nearby entities with small custom visionRadius', () => {
    // Monster within custom vision range
    const map = createTestMap([
      '#######',
      '#.....#',
      '#.@g..#',
      '#.....#',
      '#######',
    ]);

    // Monster 1 tile away, visionRadius is 2, should be visible
    const state = createTestStateWithVision({
      map,
      player: { x: 2, y: 2, visionRadius: 2 },
      monsters: [{ x: 3, y: 2, name: 'Goblin', char: 'g' }],
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.visibleEntities).toHaveLength(1);
    expect(observation.visibleEntities[0].name).toBe('Goblin');
  });
});

describe('createObservation with portals', () => {
  /**
   * Helper to create a Zone with portal support
   */
  function createTestZoneWithPortal(
    map: DungeonMap,
    portalAreaId: string,
    portalAreaName: string
  ): Zone {
    return {
      id: 'zone-1',
      name: 'Test Zone',
      entryAreaId: DEFAULT_AREA_ID,
      victoryAreaIds: [DEFAULT_AREA_ID],
      areas: {
        [DEFAULT_AREA_ID]: {
          metadata: { id: DEFAULT_AREA_ID, name: 'Test Area', dangerLevel: 1 },
          map: map as Zone['areas'][string]['map'],
        },
        [portalAreaId]: {
          metadata: { id: portalAreaId, name: portalAreaName, dangerLevel: 2 },
          map: createTestMap(['###', '#.#', '###']) as Zone['areas'][string]['map'],
        },
      },
    };
  }

  /**
   * Helper to create a state with a portal at the player's position
   */
  function createStateWithPortal(config: {
    portalDirection: 'up' | 'down';
    targetAreaId: string;
    targetAreaName: string;
  }): GameState {
    // Create map with player on floor
    const baseMap = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    // Manually add portal at player position (2, 2)
    const portalTile = {
      type: 'portal' as const,
      direction: config.portalDirection,
      connection: {
        targetAreaId: config.targetAreaId,
        targetPosition: { x: 1, y: 1 },
        returnAllowed: true,
      },
    };
    const mapWithPortal: DungeonMap = {
      ...baseMap,
      tiles: baseMap.tiles.map((row, y) =>
        row.map((tile, x) => (x === 2 && y === 2 ? portalTile : tile))
      ),
    };

    const bounds = { width: mapWithPortal.width, height: mapWithPortal.height };
    const player = createEntity(
      {
        id: PLAYER_ID,
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
        areaId: DEFAULT_AREA_ID,
      },
      bounds
    );

    const entities: Record<string, typeof player> = { [PLAYER_ID]: player };

    const bubble = createBubble({
      id: bubbleId('bubble-main'),
      entityIds: [entityId(PLAYER_ID)],
      entities: [{ id: entityId(PLAYER_ID), speed: player.speed }],
      center: { x: player.x, y: player.y },
    });

    const advancedBubble = {
      ...bubble,
      scheduler: advanceScheduler(bubble.scheduler),
    };

    return {
      zone: createTestZoneWithPortal(mapWithPortal, config.targetAreaId, config.targetAreaName),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [advancedBubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  it('includes onPortal info when standing on a portal tile', () => {
    const state = createStateWithPortal({
      portalDirection: 'down',
      targetAreaId: 'level-2',
      targetAreaName: 'Dungeon Level 2',
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.onPortal).not.toBeNull();
    expect(observation.onPortal!.direction).toBe('down');
    expect(observation.onPortal!.targetAreaId).toBe('level-2');
    expect(observation.onPortal!.targetAreaName).toBe('Dungeon Level 2');
  });

  it('includes up direction for upward portals', () => {
    const state = createStateWithPortal({
      portalDirection: 'up',
      targetAreaId: 'surface',
      targetAreaName: 'Surface',
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.onPortal).not.toBeNull();
    expect(observation.onPortal!.direction).toBe('up');
  });

  it('onPortal is null when not standing on a portal', () => {
    const map = createTestMap([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);

    const state = createTestState({
      map,
      player: { x: 2, y: 2 },
      monsters: [],
    });

    const observation = createObservation(state, entityId(PLAYER_ID));

    expect(observation.onPortal).toBeNull();
  });

  it('validates with schema when on portal', () => {
    const state = createStateWithPortal({
      portalDirection: 'down',
      targetAreaId: 'level-2',
      targetAreaName: 'Level 2',
    });

    const observation = createObservation(state, entityId(PLAYER_ID));
    const result = CrawlerObservationSchema.safeParse(observation);

    expect(result.success).toBe(true);
  });
});
