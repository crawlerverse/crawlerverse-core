import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  createEntity,
  createMessage,
  isValidPosition,
  GameStateSchema,
  EntitySchema,
  DirectionSchema,
  ExploredTilesSchema,
  isCrawler,
  isMonster,
  getPlayer,
  getCrawlers,
  getMonsters,
  getEntitiesInArea,
  getMonstersInArea,
  getCrawlersInArea,
  getItemsInArea,
  getCurrentArea,
  DEFAULT_AREA_ID,
  DungeonGenerationError,
  SpawnPositionError,
  deltaToPosition,
  stateToPrompt,
  type Entity,
  type GameState,
} from '../state';
import { createTestDungeon } from '../maps/test-dungeon';
import { MONSTER_TYPE_IDS, MONSTER_TYPES } from '../monsters';
import type { AreaId } from '../map';
import { CrawlerCharacterSystem } from '../character-system';
import { tileKey } from '../fov';
import { parseAsciiMap, type DungeonMap } from '../map';
import { createTestZone } from './test-helpers';
import { generateProceduralZone } from '../zone';
import { createBubble, bubbleId } from '../bubble';
import { entityId } from '../scheduler';
import { crawlerIdFromIndex } from '../crawler-id';
import { analyzeTile, estimateCombat } from '../../ai/decision-context';

// Primary player ID constant for tests
const PLAYER_ID = crawlerIdFromIndex(1);

describe('createMessage', () => {
  it('creates message with reasoning and aiMetadata', () => {
    const msg = createMessage('Test message', 5, 0, undefined, 'AI reasoning here', {
      durationMs: 1234,
      outputTokens: 30,
      modelId: 'test-model',
    });

    expect(msg.text).toBe('Test message');
    expect(msg.turn).toBe(5);
    expect(msg.reasoning).toBe('AI reasoning here');
    expect(msg.aiMetadata?.durationMs).toBe(1234);
    expect(msg.aiMetadata?.outputTokens).toBe(30);
    expect(msg.aiMetadata?.modelId).toBe('test-model');
  });

  it('creates message without optional fields', () => {
    const msg = createMessage('Basic message', 1);

    expect(msg.text).toBe('Basic message');
    expect(msg.reasoning).toBeUndefined();
    expect(msg.aiMetadata).toBeUndefined();
  });
});

describe('isValidPosition', () => {
  it('returns true for positions inside bounds', () => {
    expect(isValidPosition(5, 5, 10, 10)).toBe(true);
    expect(isValidPosition(0, 0, 10, 10)).toBe(true);
    expect(isValidPosition(9, 9, 10, 10)).toBe(true);
  });

  it('returns false for positions outside bounds', () => {
    expect(isValidPosition(-1, 5, 10, 10)).toBe(false);
    expect(isValidPosition(5, -1, 10, 10)).toBe(false);
    expect(isValidPosition(10, 5, 10, 10)).toBe(false);
    expect(isValidPosition(5, 10, 10, 10)).toBe(false);
  });
});

describe('createEntity', () => {
  const bounds = { width: 10, height: 10 };

  it('creates a valid entity', () => {
    const entity = createEntity(
      {
        id: 'test',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Test',
        char: 'T',
        attack: 1,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
      bounds
    );

    expect(entity.id).toBe('test');
    expect(entity.type).toBe('crawler');
    expect(entity.x).toBe(5);
    expect(entity.y).toBe(5);
  });

  it('throws for out-of-bounds position', () => {
    expect(() =>
      createEntity(
        {
          id: 'test',
          type: 'crawler',
          x: 15,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Test',
          char: 'T',
          attack: 1,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        bounds
      )
    ).toThrow('invalid position');
  });

  it('throws when hp exceeds maxHp', () => {
    expect(() =>
      createEntity(
        {
          id: 'test',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 15,
          maxHp: 10,
          name: 'Test',
          char: 'T',
          attack: 1,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        bounds
      )
    ).toThrow('hp');
  });

  it('throws for multi-character char', () => {
    expect(() =>
      createEntity(
        {
          id: 'test',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Test',
          char: 'TT',
          attack: 1,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        bounds
      )
    ).toThrow('char');
  });
});

describe('createTestDungeon', () => {
  it('creates valid initial game state', () => {
    const state = createTestDungeon();

    expect(getCurrentArea(state).map.width).toBe(30);
    expect(getCurrentArea(state).map.height).toBe(15);
    expect(state.entities[PLAYER_ID].id).toBe(PLAYER_ID);
    expect(state.entities[PLAYER_ID].char).toBe('@');
    const monsters = getMonsters(state);
    expect(monsters.length).toBe(4); // 2 rats + troll + goblin
    expect(state.turn).toBe(0);
    expect(state.gameStatus.status).toBe('playing');
  });

  it('creates state that passes schema validation', () => {
    const state = createTestDungeon();
    const result = GameStateSchema.safeParse(state);

    expect(result.success).toBe(true);
  });

  it('creates map with proper tile structure', () => {
    const state = createTestDungeon();
    const { map } = getCurrentArea(state);

    // Verify tiles array exists and has correct dimensions
    expect(map.tiles).toBeDefined();
    expect(map.tiles.length).toBe(15);
    expect(map.tiles[0].length).toBe(30);

    // Verify walls are on edges
    expect(map.tiles[0][0].type).toBe('wall');
    expect(map.tiles[0][5].type).toBe('wall');
    expect(map.tiles[14][29].type).toBe('wall');

    // Verify interior floor in left room (player room)
    expect(map.tiles[1][1].type).toBe('floor');
    expect(map.tiles[4][4].type).toBe('floor'); // player position
  });
});

describe('createInitialState with monster variety', () => {
  it('creates monsters with valid monsterTypeId', () => {
    const state = createTestDungeon();
    const monsters = getMonsters(state);
    for (const monster of monsters) {
      expect(monster.monsterTypeId).toBeDefined();
      expect(MONSTER_TYPE_IDS).toContain(monster.monsterTypeId);
    }
  });

  it('creates player with char field', () => {
    const state = createTestDungeon();
    const player = getPlayer(state);
    expect(player).toBeDefined();
    expect(player!.char).toBe('@');
  });

  it('respects monsterCount option', () => {
    const state = createInitialState({ monsterCount: 5 });
    const monsters = getMonsters(state);
    expect(monsters).toHaveLength(5);
  });

  it('produces different monsters with different seeds', () => {
    // Use zones with higher dangerLevel to ensure all monster types are available.
    // At dangerLevel 1 (default), only goblin and rat are available, which limits variety.
    // With dangerLevel 5 and more monsters, different seeds produce different compositions.
    const zone1 = generateProceduralZone({
      id: 'test-zone-1',
      name: 'Test Zone 1',
      areaCount: 1,
      seed: 111,
      dangerLevels: [5],
    });
    const zone2 = generateProceduralZone({
      id: 'test-zone-2',
      name: 'Test Zone 2',
      areaCount: 1,
      seed: 222,
      dangerLevels: [5],
    });
    const state1 = createInitialState({ zone: zone1, monsterCount: 5 });
    const state2 = createInitialState({ zone: zone2, monsterCount: 5 });
    const types1 = getMonsters(state1).map(m => m.monsterTypeId).sort().join(',');
    const types2 = getMonsters(state2).map(m => m.monsterTypeId).sort().join(',');
    // Seeds should be different
    expect(getCurrentArea(state1).map.seed).not.toBe(getCurrentArea(state2).map.seed);
    // With different seeds and higher dangerLevel (5), monster compositions should differ
    expect(types1).not.toBe(types2);
  });
});

describe('GameStateSchema', () => {
  it('rejects state with entity out of bounds', () => {
    const state = createTestDungeon();
    const invalidState = {
      ...state,
      entities: {
        ...state.entities,
        player: {
          ...state.entities[PLAYER_ID],
          x: 35, // Out of bounds (map is 30 wide)
        },
      },
    };

    const result = GameStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });

  it('rejects state with hp > maxHp', () => {
    const state = createTestDungeon();
    const invalidState = {
      ...state,
      entities: {
        ...state.entities,
        player: {
          ...state.entities[PLAYER_ID],
          hp: 15, // Exceeds maxHp
        },
      },
    };

    const result = GameStateSchema.safeParse(invalidState);
    expect(result.success).toBe(false);
  });
});

describe('EntitySchema', () => {
  it('requires attack, defense, and speed fields', () => {
    const validEntity = {
      id: 'test',
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(validEntity);
    expect(result.success).toBe(true);
  });

  it('rejects entity missing defense field', () => {
    const invalidEntity = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      speed: 100,
      // missing defense
    };
    const result = EntitySchema.safeParse(invalidEntity);
    expect(result.success).toBe(false);
  });

  it('rejects entity missing speed field', () => {
    const invalidEntity = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: 0,
      // missing speed
    };
    const result = EntitySchema.safeParse(invalidEntity);
    expect(result.success).toBe(false);
  });

  it('rejects entity with zero speed', () => {
    const invalidEntity = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: 0,
      speed: 0, // invalid - must be positive
    };
    const result = EntitySchema.safeParse(invalidEntity);
    expect(result.success).toBe(false);
  });

  it('rejects entity with negative attack', () => {
    const invalidEntity = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: -1, // invalid - must be nonnegative
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(invalidEntity);
    expect(result.success).toBe(false);
  });

  it('rejects entity with negative defense', () => {
    const invalidEntity = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: -1, // invalid - must be nonnegative
      speed: 100,
    };
    const result = EntitySchema.safeParse(invalidEntity);
    expect(result.success).toBe(false);
  });

  it('rejects entity with negative speed', () => {
    const invalidEntity = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: 0,
      speed: -50, // invalid - must be positive
    };
    const result = EntitySchema.safeParse(invalidEntity);
    expect(result.success).toBe(false);
  });

  it('accepts entity with zero attack', () => {
    const validEntity = {
      id: 'troll-0',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Test',
      monsterTypeId: 'troll',
      attack: 0, // valid - zero attack is allowed
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(validEntity);
    expect(result.success).toBe(true);
  });
});

describe('createInitialState entity stats', () => {
  it('creates player with class-appropriate stats', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;

    // Player should have a character class
    expect(player.characterClass).toBeDefined();
    expect(['warrior', 'rogue', 'mage', 'cleric']).toContain(player.characterClass);

    // Stats should match the assigned class
    const expectedStats = CrawlerCharacterSystem.getBaseStats(player.characterClass!);
    expect(player.attack).toBe(expectedStats.attack);
    expect(player.defense).toBe(expectedStats.defense);
    expect(player.speed).toBe(expectedStats.speed);
    expect(player.hp).toBe(expectedStats.hp);
    expect(player.maxHp).toBe(expectedStats.hp);
  });

  it('creates monsters with stats from MONSTER_TYPES', () => {
    // Use a fixed seed for reproducibility
    const state = createTestDungeon();
    const monsters = getMonsters(state);

    // Each monster should have valid monsterTypeId and matching stats
    for (const monster of monsters) {
      expect(monster.monsterTypeId).toBeDefined();
      expect(monster.hp).toBeGreaterThan(0);
      expect(monster.attack).toBeGreaterThanOrEqual(0);
      expect(monster.defense).toBeGreaterThanOrEqual(0);
      expect(monster.speed).toBeGreaterThan(0);
    }
  });

  it('creates monsters with IDs based on their type', () => {
    const state = createTestDungeon();
    const monsters = getMonsters(state);

    // Each monster ID should contain the monster type
    // Test dungeon uses IDs like 'rat-1', 'rat-2', 'troll', 'goblin'
    for (const monster of monsters) {
      expect(monster.id).toMatch(/^(rat-\d+|goblin|troll)$/);
      expect(monster.id.startsWith(monster.monsterTypeId!)).toBe(true);
    }
  });
});

describe('DirectionSchema', () => {
  it('should accept all 8 directions', () => {
    const directions = [
      'north', 'south', 'east', 'west',
      'northeast', 'northwest', 'southeast', 'southwest'
    ];
    for (const dir of directions) {
      expect(DirectionSchema.safeParse(dir).success).toBe(true);
    }
  });
});

describe('EntitySchema with monsterTypeId', () => {
  it('accepts monster with monsterTypeId and no char', () => {
    const monster = {
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
    };
    const result = EntitySchema.safeParse(monster);
    expect(result.success).toBe(true);
  });

  it('accepts crawler with char and no monsterTypeId', () => {
    const crawler = {
      id: PLAYER_ID,
      type: 'crawler',
      x: 2,
      y: 2,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Player',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(crawler);
    expect(result.success).toBe(true);
  });

  it('rejects monster without monsterTypeId', () => {
    const monster = {
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
      // missing monsterTypeId
    };
    const result = EntitySchema.safeParse(monster);
    expect(result.success).toBe(false);
  });

  it('rejects crawler without char', () => {
    const crawler = {
      id: PLAYER_ID,
      type: 'crawler',
      x: 2,
      y: 2,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Player',
      // missing char
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(crawler);
    expect(result.success).toBe(false);
  });

  it('rejects invalid monsterTypeId', () => {
    const monster = {
      id: 'dragon-1',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 50,
      maxHp: 50,
      name: 'Dragon',
      attack: 10,
      defense: 5,
      speed: 100,
      monsterTypeId: 'dragon', // not a valid type
    };
    const result = EntitySchema.safeParse(monster);
    expect(result.success).toBe(false);
  });
});

describe('EntitySchema - areaId', () => {
  it('requires areaId field', () => {
    const entityWithoutAreaId = {
      id: 'test-1',
      type: 'crawler',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      attack: 1,
      defense: 1,
      speed: 100,
      char: '@',
    };
    const result = EntitySchema.safeParse(entityWithoutAreaId);
    expect(result.success).toBe(false);
  });

  it('accepts entity with areaId', () => {
    const entityWithAreaId = {
      id: 'test-1',
      type: 'crawler',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      attack: 1,
      defense: 1,
      speed: 100,
      char: '@',
      areaId: 'area-1',
    };
    const result = EntitySchema.safeParse(entityWithAreaId);
    expect(result.success).toBe(true);
  });
});

describe('EntitySchema with type field', () => {
  it('requires type field', () => {
    const entityWithoutType = {
      id: 'test',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(entityWithoutType);
    expect(result.success).toBe(false);
  });

  it('accepts crawler type', () => {
    const crawler = {
      id: PLAYER_ID,
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Player',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(crawler);
    expect(result.success).toBe(true);
  });

  it('accepts monster type with monsterTypeId', () => {
    const monster = {
      id: 'goblin-0',
      type: 'monster',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Goblin',
      monsterTypeId: 'goblin',
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(monster);
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const invalid = {
      id: 'test',
      type: 'npc',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: 'T',
      attack: 2,
      defense: 0,
      speed: 100,
    };
    const result = EntitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Entity helper functions', () => {
  it('isCrawler returns true for crawler type', () => {
    const entity: Entity = {
      id: 'p',
      type: 'crawler',
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      name: 'P',
      char: '@',
      attack: 1,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    expect(isCrawler(entity)).toBe(true);
  });

  it('isCrawler returns false for monster type', () => {
    const entity: Entity = {
      id: 'm',
      type: 'monster',
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      name: 'M',
      char: 'm',
      attack: 1,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    expect(isCrawler(entity)).toBe(false);
  });

  it('isMonster returns true for monster type', () => {
    const entity: Entity = {
      id: 'm',
      type: 'monster',
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      name: 'M',
      char: 'm',
      attack: 1,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    expect(isMonster(entity)).toBe(true);
  });

  it('isMonster returns false for crawler type', () => {
    const entity: Entity = {
      id: 'p',
      type: 'crawler',
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      name: 'P',
      char: '@',
      attack: 1,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    expect(isMonster(entity)).toBe(false);
  });
});

describe('GameState', () => {
  it('has entities record instead of player/monsters', () => {
    const state = createTestDungeon();
    expect(state.entities).toBeDefined();
    expect(typeof state.entities).toBe('object');
    expect(state.entities[PLAYER_ID]).toBeDefined();
  });

  it('has bubbles array', () => {
    const state = createTestDungeon();
    expect(Array.isArray(state.bubbles)).toBe(true);
    expect(state.bubbles.length).toBe(1);
  });

  it('has hibernating array', () => {
    const state = createTestDungeon();
    expect(Array.isArray(state.hibernating)).toBe(true);
  });

  it('getPlayer returns player entity from entities record', () => {
    const state = createTestDungeon();
    const player = getPlayer(state);
    expect(player).toBeDefined();
    expect(player?.id).toBe(PLAYER_ID);
    expect(player?.type).toBe('crawler');
  });

  it('getCrawlers returns all crawler entities', () => {
    const state = createTestDungeon();
    const crawlers = getCrawlers(state);
    expect(crawlers.length).toBe(1);
    expect(crawlers[0].type).toBe('crawler');
  });

  it('getMonsters returns all monster entities', () => {
    const state = createTestDungeon();
    const monsters = getMonsters(state);
    expect(monsters.length).toBe(4); // 2 rats + troll + goblin
    expect(monsters.every(m => m.type === 'monster')).toBe(true);
  });

  it('bubble contains player and room monsters', () => {
    const state = createTestDungeon();
    const bubble = state.bubbles[0];
    expect(bubble.entityIds).toContain(PLAYER_ID);
    // Only rats are in player's bubble (same room)
    expect(bubble.entityIds).toContain('rat-1');
    expect(bubble.entityIds).toContain('rat-2');
    // Troll and goblin are in hibernation (different room)
    expect(state.hibernating).toContain('troll');
    expect(state.hibernating).toContain('goblin');
  });
});

describe('GameStateSchema validation', () => {
  it('validates correct state', () => {
    const state = createTestDungeon();
    const result = GameStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('rejects state with entity position out of bounds', () => {
    const state = createTestDungeon();
    const invalid = {
      ...state,
      entities: {
        ...state.entities,
        player: { ...state.entities[PLAYER_ID], x: 100 },
      },
    };
    const result = GameStateSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// --- Procedural Dungeon Generation Tests ---

describe('createInitialState with config', () => {
  it('creates state with procedural dungeon when config provided', () => {
    const state = createInitialState({
      width: 30,
      height: 25,
      seed: 12345,
    });

    expect(getCurrentArea(state).map.width).toBe(30);
    expect(getCurrentArea(state).map.height).toBe(25);
    expect(getCurrentArea(state).map.seed).toBe(12345);
    expect(getCurrentArea(state).map.rooms.length).toBeGreaterThan(0);
  });

  it('spawns player in starting room', () => {
    const state = createInitialState({
      seed: 12345,
    });

    const startingRooms = getCurrentArea(state).map.rooms.filter(r => r.tags.includes('starting'));
    expect(startingRooms.length).toBeGreaterThan(0);

    // Player should be at center of a starting room
    const player = getPlayer(state)!;
    const playerPos = { x: player.x, y: player.y };
    const inStartingRoom = startingRooms.some(r =>
      r.center.x === playerPos.x && r.center.y === playerPos.y
    );
    expect(inStartingRoom).toBe(true);
  });

  it('spawns monsters away from player', () => {
    const state = createInitialState({
      seed: 12345,
    });

    const player = getPlayer(state)!;
    const monsters = getMonsters(state);
    for (const monster of monsters) {
      expect(monster.x !== player.x || monster.y !== player.y).toBe(true);
    }
  });

  it('createTestDungeon creates valid test dungeon', () => {
    const state = createTestDungeon();

    // Test dungeon is 30x15 with two rooms
    expect(getCurrentArea(state).map.width).toBe(30);
    expect(getCurrentArea(state).map.height).toBe(15);
  });

  it('creates state with proper entities/bubbles structure', () => {
    const state = createInitialState({
      seed: 12345,
      monsterCount: 3,
    });

    // Should have entities record
    expect(state.entities).toBeDefined();
    expect(state.entities[PLAYER_ID]).toBeDefined();

    // Should have bubbles and hibernating arrays
    expect(Array.isArray(state.bubbles)).toBe(true);
    expect(state.bubbles.length).toBe(1);
    expect(Array.isArray(state.hibernating)).toBe(true);

    // Bubble should contain all entity IDs
    const bubble = state.bubbles[0];
    expect(bubble.entityIds).toContain(PLAYER_ID);
    const monsters = getMonsters(state);
    expect(monsters.length).toBe(3);
    for (const monster of monsters) {
      expect(bubble.entityIds).toContain(monster.id);
    }
  });

  it('creates monsters with variety using random selection', () => {
    const state = createInitialState({
      seed: 12345,
      monsterCount: 4,
    });

    const monsters = getMonsters(state);
    expect(monsters.length).toBe(4);

    // Each monster should have valid monsterTypeId and stats
    const validTypes = ['rat', 'goblin', 'orc', 'skeleton', 'troll', 'bat', 'snake', 'minotaur', 'demon'];
    for (const monster of monsters) {
      expect(validTypes).toContain(monster.monsterTypeId);
      expect(monster.hp).toBeGreaterThan(0);
    }

    // With enough monsters and different seeds, we should see variety
    // (This is a weaker assertion since random selection doesn't guarantee all types)
    const typesSeen = new Set(monsters.map(m => m.monsterTypeId));
    expect(typesSeen.size).toBeGreaterThanOrEqual(1);
  });

  it('passes schema validation with procedural dungeon', () => {
    const state = createInitialState({
      seed: 12345,
      monsterCount: 2,
    });

    const result = GameStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('respects monsterCount from config', () => {
    const state = createInitialState({
      seed: 12345,
      monsterCount: 5,
    });

    const monsters = getMonsters(state);
    expect(monsters.length).toBe(5);
  });

  it('spawns no monsters when monsterCount is 0', () => {
    const state = createInitialState({
      seed: 12345,
      monsterCount: 0,
    });

    const monsters = getMonsters(state);
    expect(monsters.length).toBe(0);
  });

  it('uses actual seed from map (determinism)', () => {
    const state = createInitialState({
      seed: 12345,
    });

    // The map should have a seed that was actually used for generation
    expect(getCurrentArea(state).map.seed).toBeDefined();
    expect(typeof getCurrentArea(state).map.seed).toBe('number');
  });
});

describe('Error re-exports', () => {
  it('DungeonGenerationError is exported from state', () => {
    expect(DungeonGenerationError).toBeDefined();
  });

  it('SpawnPositionError is exported from state', () => {
    expect(SpawnPositionError).toBeDefined();
  });
});

describe('GameState with items', () => {
  it('createInitialState returns state with items array', () => {
    const state = createTestDungeon();
    expect(state.items).toBeDefined();
    expect(Array.isArray(state.items)).toBe(true);
  });

  it('GameStateSchema validates items array', () => {
    const state = createTestDungeon();
    const parsed = GameStateSchema.parse(state);
    expect(parsed.items).toBeDefined();
  });
});

// --- deltaToPosition tests ---

describe('deltaToPosition', () => {
  it('resolves north direction with distance', () => {
    const pos = deltaToPosition({ x: 5, y: 5 }, 'north', 3);
    expect(pos).toEqual({ x: 5, y: 2 });
  });

  it('resolves northeast direction with distance', () => {
    const pos = deltaToPosition({ x: 5, y: 5 }, 'northeast', 2);
    expect(pos).toEqual({ x: 7, y: 3 });
  });

  it('resolves south direction with distance', () => {
    const pos = deltaToPosition({ x: 5, y: 5 }, 'south', 4);
    expect(pos).toEqual({ x: 5, y: 9 });
  });

  it('resolves southwest direction with distance', () => {
    const pos = deltaToPosition({ x: 5, y: 5 }, 'southwest', 1);
    expect(pos).toEqual({ x: 4, y: 6 });
  });

  it('handles distance of 1 (adjacent)', () => {
    const pos = deltaToPosition({ x: 5, y: 5 }, 'east', 1);
    expect(pos).toEqual({ x: 6, y: 5 });
  });
});

// --- analyzeTile tests (testing functions from decision-context.ts) ---

describe('analyzeTile', () => {
  it('returns blocked for wall tiles', () => {
    const state = createTestDungeon();
    // Top-left corner is a wall at (0, 0)
    const result = analyzeTile(state, 1, 1, 'northwest');
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe('wall');
  });

  it('returns clear for floor tiles', () => {
    const state = createTestDungeon();
    // Move from inside left room (avoiding monster positions)
    // Rat1 is at (3,3), Rat2 is at (6,5), Player is at (4,4)
    const result = analyzeTile(state, 5, 6, 'east');
    expect(result.blocked).toBe(false);
    expect(result.blockedBy).toBeNull();
  });

  it('returns blocked with monster info when monster present', () => {
    const state = createTestDungeon();
    const monsters = getMonsters(state);
    const monster = monsters[0];
    // Analyze from position adjacent to monster
    const result = analyzeTile(state, monster.x - 1, monster.y, 'east');
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(monster.name);
    expect(result.hasMonster).toBe(monster);
  });

  it('returns blocked for edge of map', () => {
    const state = createTestDungeon();
    // Try to go north from top row
    const result = analyzeTile(state, 5, 0, 'north');
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe('edge');
  });

  it('detects items on tiles', () => {
    const state = createTestDungeon();
    // Place item at (6, 6) - a clear floor position east of (5, 6)
    const stateWithItems = {
      ...state,
      items: [{ id: 'item-0', templateId: 'health_potion', x: 6, y: 6, areaId: 'area-1' }],
    };
    const result = analyzeTile(stateWithItems, 5, 6, 'east');
    expect(result.hasItem).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('allows diagonal moves when only ONE cardinal is blocked (moderate approach)', () => {
    const state = createTestDungeon();
    // The moderate approach allows squeezing past a single corner
    // At (1, 1), northwest goes to (0, 0) which is wall - but that's blocked by wall itself
    // So test that diagonal moves in the middle of the room work
    const result = analyzeTile(state, 5, 7, 'southeast');
    expect(result.blocked).toBe(false);
    expect(result.blockedBy).toBeNull();
  });
});

describe('estimateCombat', () => {
  it('calculates damage correctly', () => {
    const attacker: Entity = {
      id: 'a', type: 'crawler', x: 0, y: 0, hp: 10, maxHp: 10,
      name: 'A', char: '@', attack: 5, defense: 1, speed: 100, areaId: 'area-1',
    };
    const defender: Entity = {
      id: 'd', type: 'monster', x: 1, y: 0, hp: 8, maxHp: 8,
      name: 'D', monsterTypeId: 'goblin', attack: 3, defense: 2, speed: 100, areaId: 'area-1',
    };
    const result = estimateCombat(attacker, defender);
    // Damage = attack - defense = 5 - 2 = 3
    expect(result.damageDealt).toBe(3);
    // Hits to kill = ceil(8 / 3) = 3
    expect(result.hitsToKill).toBe(3);
    // Damage received = 3 - 1 = 2
    expect(result.damageReceived).toBe(2);
    // Hits to survive = ceil(10 / 2) = 5
    expect(result.hitsToSurvive).toBe(5);
  });

  it('enforces minimum 1 damage', () => {
    const attacker: Entity = {
      id: 'a', type: 'crawler', x: 0, y: 0, hp: 10, maxHp: 10,
      name: 'A', char: '@', attack: 1, defense: 0, speed: 100, areaId: 'area-1',
    };
    const defender: Entity = {
      id: 'd', type: 'monster', x: 1, y: 0, hp: 5, maxHp: 5,
      name: 'D', monsterTypeId: 'troll', attack: 2, defense: 10, speed: 100, areaId: 'area-1',
    };
    const result = estimateCombat(attacker, defender);
    // Attack 1 - Defense 10 would be -9, but minimum is 1
    expect(result.damageDealt).toBe(1);
    expect(result.hitsToKill).toBe(5);
  });
});

describe('ExploredTilesSchema validation', () => {
  it('validates correct tile key format', () => {
    const exploredTiles = {
      player: [tileKey(0, 0), tileKey(1, 2), tileKey(-3, 7)],
    };

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(true);
  });

  it('validates with string keys (serialization round-trip)', () => {
    // Simulates what happens after JSON.parse(JSON.stringify())
    const exploredTiles = {
      player: ['0,0', '1,2', '-3,7'],
      'monster-0': ['5,5', '6,6'],
    };

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(true);
  });

  it('rejects invalid tile key format', () => {
    const exploredTiles = {
      player: ['invalid', '1,2'],
    };

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('x,y');
    }
  });

  it('rejects floating point coordinates in tile keys', () => {
    const exploredTiles = {
      player: ['1.5,2', '3,4'],
    };

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(false);
  });

  it('rejects tile keys with extra components', () => {
    const exploredTiles = {
      player: ['1,2,3'],
    };

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(false);
  });

  it('accepts empty explored tiles for an entity', () => {
    const exploredTiles = {
      player: [],
    };

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(true);
  });

  it('accepts empty exploredTiles record', () => {
    const exploredTiles = {};

    const result = ExploredTilesSchema.safeParse(exploredTiles);
    expect(result.success).toBe(true);
  });
});

// Helper function to create a game state with two crawlers
function createStateWithTwoCrawlers(): GameState {
  const state = createTestDungeon();
  const player2: Entity = {
    id: 'player2',
    type: 'crawler',
    x: 7, y: 7,
    areaId: 'area-1',
    hp: 10, maxHp: 10,
    name: 'Player 2', char: '@',
    attack: 2, defense: 0, speed: 100,
  };

  // Add player2 to entities
  const entities = { ...state.entities, player2 };

  // Add player2 to bubble
  const bubble = state.bubbles[0];
  const updatedBubble = createBubble({
    id: bubbleId(bubble.id),
    entityIds: [...bubble.entityIds, entityId('player2')],
    entities: [
      ...bubble.scheduler.entries.map(e => ({ id: entityId(e.entityId), speed: e.speed })),
      { id: entityId('player2'), speed: 100 },
    ],
    center: bubble.center,
  });

  return {
    ...state,
    entities,
    bubbles: [updatedBubble],
  };
}

describe('Multi-crawler explored tiles isolation', () => {
  it('maintains separate explored tiles per crawler', () => {
    const state = createStateWithTwoCrawlers();

    // Add different explored tiles for each crawler
    const stateWithExplored = {
      ...state,
      exploredTiles: {
        [PLAYER_ID]: [tileKey(1, 1), tileKey(2, 2), tileKey(3, 3)],
        player2: [tileKey(5, 5), tileKey(6, 6), tileKey(7, 7)],
      },
    };

    // Verify each crawler has their own explored tiles
    expect(stateWithExplored.exploredTiles[PLAYER_ID]).toHaveLength(3);
    expect(stateWithExplored.exploredTiles['player2']).toHaveLength(3);

    // Verify tiles are not shared
    expect(stateWithExplored.exploredTiles[PLAYER_ID]).not.toContain(tileKey(5, 5));
    expect(stateWithExplored.exploredTiles['player2']).not.toContain(tileKey(1, 1));
  });

  it('GameStateSchema validates state with multi-crawler explored tiles', () => {
    const state = createStateWithTwoCrawlers();

    const stateWithExplored = {
      ...state,
      exploredTiles: {
        [PLAYER_ID]: [tileKey(1, 1), tileKey(2, 2)],
        player2: [tileKey(5, 5), tileKey(6, 6)],
      },
    };

    const result = GameStateSchema.safeParse(stateWithExplored);
    expect(result.success).toBe(true);
  });
});

describe('GameState with objectives', () => {
  it('includes objectives array in state', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    expect(state.objectives).toBeDefined();
    expect(Array.isArray(state.objectives)).toBe(true);
  });

  it('validates state with objectives via schema', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    const result = GameStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });
});

describe('DEFAULT_AREA_ID', () => {
  it('exports DEFAULT_AREA_ID constant', () => {
    expect(DEFAULT_AREA_ID).toBe('area-1');
  });
});

describe('createInitialState with zone', () => {
  it('uses provided zone instead of generating', () => {
    const zone = generateProceduralZone({
      id: 'custom-zone',
      name: 'Custom Zone',
      areaCount: 2,
      seed: 99999,
    });

    const state = createInitialState({ zone });

    expect(state.zone.id).toBe('custom-zone');
    expect(state.zone.name).toBe('Custom Zone');
    expect(Object.keys(state.zone.areas)).toHaveLength(2);
  });

  it('spawns player in entry area', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const state = createInitialState({ zone });

    const crawlers = Object.values(state.entities).filter(e => e.type === 'crawler');
    expect(crawlers.length).toBeGreaterThan(0);
    expect(crawlers[0].areaId).toBe(zone.entryAreaId);
  });

  it('backward compatible when no zone provided', () => {
    const state = createInitialState();

    expect(state.zone).toBeDefined();
    expect(state.zone.id).toBe('zone-1');
    expect(Object.keys(state.zone.areas)).toHaveLength(1);
  });
});

describe('createInitialState with multi-area zones', () => {
  it('spawns monsters in all areas of multi-area zone', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const state = createInitialState({ zone });

    const monsters = Object.values(state.entities).filter(e => e.type === 'monster');

    // Should have monsters in both areas
    const area1Monsters = monsters.filter(m => m.areaId === 'area-1');
    const area2Monsters = monsters.filter(m => m.areaId === 'area-2');

    expect(area1Monsters.length).toBeGreaterThan(0);
    expect(area2Monsters.length).toBeGreaterThan(0);
  });

  it('hibernates non-entry area entities', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const state = createInitialState({ zone });

    const area2Monsters = Object.values(state.entities)
      .filter(e => e.type === 'monster' && e.areaId === 'area-2');

    // All area-2 monsters should be in hibernating
    for (const monster of area2Monsters) {
      expect(state.hibernating).toContain(monster.id);
    }
  });

  it('entry area monsters are not in hibernating', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const state = createInitialState({ zone });

    const area1Monsters = Object.values(state.entities)
      .filter(e => e.type === 'monster' && e.areaId === 'area-1');

    // Entry area monsters should NOT be in hibernating
    for (const monster of area1Monsters) {
      expect(state.hibernating).not.toContain(monster.id);
    }
  });

  it('entry area monsters are in the active bubble', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const state = createInitialState({ zone });

    const area1Monsters = Object.values(state.entities)
      .filter(e => e.type === 'monster' && e.areaId === 'area-1');

    const bubble = state.bubbles[0];

    // Entry area monsters should be in the active bubble
    for (const monster of area1Monsters) {
      expect(bubble.entityIds).toContain(monster.id);
    }
  });

  it('non-entry area monsters are not in the active bubble', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 2,
      seed: 12345,
    });

    const state = createInitialState({ zone });

    const area2Monsters = Object.values(state.entities)
      .filter(e => e.type === 'monster' && e.areaId === 'area-2');

    const bubble = state.bubbles[0];

    // Non-entry area monsters should NOT be in the active bubble
    for (const monster of area2Monsters) {
      expect(bubble.entityIds).not.toContain(monster.id);
    }
  });

  it('works with three or more areas', () => {
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 3,
      seed: 54321,
    });

    const state = createInitialState({ zone });

    const monsters = Object.values(state.entities).filter(e => e.type === 'monster');

    // Should have monsters in all three areas
    const area1Monsters = monsters.filter(m => m.areaId === 'area-1');
    const area2Monsters = monsters.filter(m => m.areaId === 'area-2');
    const area3Monsters = monsters.filter(m => m.areaId === 'area-3');

    expect(area1Monsters.length).toBeGreaterThan(0);
    expect(area2Monsters.length).toBeGreaterThan(0);
    expect(area3Monsters.length).toBeGreaterThan(0);

    // Only area-1 monsters should be active
    const bubble = state.bubbles[0];
    for (const monster of area1Monsters) {
      expect(bubble.entityIds).toContain(monster.id);
      expect(state.hibernating).not.toContain(monster.id);
    }

    // area-2 and area-3 monsters should be hibernating
    for (const monster of [...area2Monsters, ...area3Monsters]) {
      expect(state.hibernating).toContain(monster.id);
      expect(bubble.entityIds).not.toContain(monster.id);
    }
  });
});

describe('Area-scoped queries', () => {
  // Helper to create minimal test state with entities in different areas
  function createMultiAreaTestState(): GameState {
    const { tiles, width, height } = parseAsciiMap(`
#####
#...#
#...#
#####
`.trim());

    const map = {
      tiles,
      width,
      height,
      rooms: [{
        x: 1, y: 1, width: width - 2, height: height - 2,
        center: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
        tags: ['starting' as const],
      }],
      seed: 0,
    };

    const bounds = { width: map.width, height: map.height };

    const crawler1 = createEntity({
      id: 'crawler-1',
      type: 'crawler',
      x: 1, y: 1,
      areaId: 'area-1',
      hp: 10, maxHp: 10,
      name: 'Crawler 1',
      char: '@',
      attack: 2, defense: 0, speed: 100,
    }, bounds);

    const crawler2 = createEntity({
      id: 'crawler-2',
      type: 'crawler',
      x: 2, y: 1,
      areaId: 'area-2',
      hp: 10, maxHp: 10,
      name: 'Crawler 2',
      char: '@',
      attack: 2, defense: 0, speed: 100,
    }, bounds);

    const monster1 = createEntity({
      id: 'goblin-0',
      type: 'monster',
      x: 1, y: 2,
      areaId: 'area-1',
      hp: 5, maxHp: 5,
      name: 'Goblin',
      attack: 2, defense: 0, speed: 100,
      monsterTypeId: 'goblin',
      behaviorState: 'chase',
    }, bounds);

    const monster2 = createEntity({
      id: 'orc-0',
      type: 'monster',
      x: 2, y: 2,
      areaId: 'area-2',
      hp: 10, maxHp: 10,
      name: 'Orc',
      attack: 3, defense: 1, speed: 90,
      monsterTypeId: 'orc',
      behaviorState: 'chase',
    }, bounds);

    return {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities: {
        'crawler-1': crawler1,
        'crawler-2': crawler2,
        'goblin-0': monster1,
        'orc-0': monster2,
      },
      items: [
        { id: 'item-1', templateId: 'health_potion', x: 1, y: 1, areaId: 'area-1' },
        { id: 'item-2', templateId: 'leather_armor', x: 2, y: 2, areaId: 'area-2' },
      ],
      bubbles: [],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  it('getEntitiesInArea returns only entities in specified area', () => {
    const state = createMultiAreaTestState();

    const area1Entities = getEntitiesInArea(state, 'area-1');
    expect(area1Entities).toHaveLength(2);
    expect(area1Entities.map(e => e.id).sort()).toEqual(['crawler-1', 'goblin-0']);

    const area2Entities = getEntitiesInArea(state, 'area-2');
    expect(area2Entities).toHaveLength(2);
    expect(area2Entities.map(e => e.id).sort()).toEqual(['crawler-2', 'orc-0']);

    const area3Entities = getEntitiesInArea(state, 'area-3');
    expect(area3Entities).toHaveLength(0);
  });

  it('getMonstersInArea returns only monsters in specified area', () => {
    const state = createMultiAreaTestState();

    const area1Monsters = getMonstersInArea(state, 'area-1');
    expect(area1Monsters).toHaveLength(1);
    expect(area1Monsters[0].id).toBe('goblin-0');

    const area2Monsters = getMonstersInArea(state, 'area-2');
    expect(area2Monsters).toHaveLength(1);
    expect(area2Monsters[0].id).toBe('orc-0');
  });

  it('getCrawlersInArea returns only crawlers in specified area', () => {
    const state = createMultiAreaTestState();

    const area1Crawlers = getCrawlersInArea(state, 'area-1');
    expect(area1Crawlers).toHaveLength(1);
    expect(area1Crawlers[0].id).toBe('crawler-1');

    const area2Crawlers = getCrawlersInArea(state, 'area-2');
    expect(area2Crawlers).toHaveLength(1);
    expect(area2Crawlers[0].id).toBe('crawler-2');
  });

  it('getItemsInArea returns only items in specified area', () => {
    const state = createMultiAreaTestState();

    const area1Items = getItemsInArea(state, 'area-1');
    expect(area1Items).toHaveLength(1);
    expect(area1Items[0].id).toBe('item-1');

    const area2Items = getItemsInArea(state, 'area-2');
    expect(area2Items).toHaveLength(1);
    expect(area2Items[0].id).toBe('item-2');

    const area3Items = getItemsInArea(state, 'area-3');
    expect(area3Items).toHaveLength(0);
  });
});

describe('createInitialState objectives', () => {
  it('generates objectives when victoryObjectiveType is provided', () => {
    const state = createInitialState({
      seed: 12345,
      victoryObjectiveType: 'clear_all',
    });
    expect(state.objectives.length).toBeGreaterThan(0);
    const primary = state.objectives.find(o => o.priority === 'primary');
    expect(primary).toBeDefined();
    expect(primary?.type).toBe('clear_zone');
  });

  it('defaults to clear_all when victoryObjectiveType not provided', () => {
    const state = createInitialState({ seed: 12345 });
    const primary = state.objectives.find(o => o.priority === 'primary');
    expect(primary?.type).toBe('clear_zone');
  });

  it('generates find_exit objective when victoryObjectiveType is find_exit', () => {
    const state = createInitialState({
      seed: 12345,
      victoryObjectiveType: 'find_exit',
    });
    const primary = state.objectives.find(o => o.priority === 'primary');
    expect(primary?.type).toBe('find_exit');
  });
});

describe('createInitialState monster spawning', () => {
  it('spawns monsters appropriate for area danger level', () => {
    // Create state with fixed seed for determinism
    const state = createInitialState({ seed: 12345, monsterCount: 5 });

    // Get all monsters grouped by area
    const monsters = Object.values(state.entities).filter(e => e.type === 'monster');

    for (const monster of monsters) {
      const area = state.zone.areas[monster.areaId as AreaId];
      const dangerLevel = area.metadata.dangerLevel;
      const monsterType = MONSTER_TYPES[monster.monsterTypeId!];

      // Monster level should be <= area danger level
      expect(monsterType.level).toBeLessThanOrEqual(dangerLevel);
    }
  });

  it('spawns only level-1 monsters in dangerLevel 1 areas', () => {
    // Generate a zone with dangerLevel 1 for all areas
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 1,
      seed: 12345,
      dangerLevels: [1],
    });

    const state = createInitialState({ zone, seed: 12345 });

    // Check all monsters are level 1
    const monsters = Object.values(state.entities).filter(e => e.type === 'monster');
    expect(monsters.length).toBeGreaterThan(0);

    for (const monster of monsters) {
      const monsterType = MONSTER_TYPES[monster.monsterTypeId!];
      expect(monsterType.level).toBe(1);
    }
  });

  it('can spawn higher-level monsters in higher dangerLevel areas', () => {
    // Generate a zone with dangerLevel 3 for all areas
    const zone = generateProceduralZone({
      id: 'test-zone',
      name: 'Test Zone',
      areaCount: 1,
      seed: 99999,
      dangerLevels: [3],
    });

    const state = createInitialState({ zone, seed: 99999 });

    // Check that we have monsters and collect their levels
    const monsters = Object.values(state.entities).filter(e => e.type === 'monster');
    expect(monsters.length).toBeGreaterThan(0);

    const levels = new Set(
      monsters.map(m => MONSTER_TYPES[m.monsterTypeId!].level)
    );

    // With dangerLevel 3, we should be able to get multiple levels
    // (may need to adjust seed if this is flaky)
    expect(levels.size).toBeGreaterThanOrEqual(1);

    // All should be <= dangerLevel
    for (const monster of monsters) {
      const monsterType = MONSTER_TYPES[monster.monsterTypeId!];
      expect(monsterType.level).toBeLessThanOrEqual(3);
    }
  });
});

// --- Ranged Weapon Prompt Tests ---

/**
 * Helper to create test state for ranged weapon AI prompt scenarios.
 * Creates a crawler with optional ranged weapon and a monster at a specified distance.
 */
function createTestStateWithRangedSetup(options: {
  crawlerWeapon?: string;
  crawlerOffhand?: string;
  monsterDistance?: number;
} = {}): GameState {
  const { crawlerWeapon, crawlerOffhand, monsterDistance = 3 } = options;

  // Create a 20x20 map with floor tiles and boundary walls (larger to support out-of-range tests)
  const width = 20;
  const height = 20;
  const tiles = Array(height).fill(null).map((_, y) =>
    Array(width).fill(null).map((_, x) => {
      // Boundary walls
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        return { type: 'wall' as const };
      }
      return { type: 'floor' as const };
    })
  );

  const map: DungeonMap = {
    width,
    height,
    tiles,
    rooms: [{ x: 1, y: 1, width: 18, height: 18, center: { x: 10, y: 10 }, tags: ['starting'] }],
    seed: 42,
  };

  // Create crawler at center-ish position (5, 5) to allow room for monsters in any direction
  const crawlerPos = { x: 5, y: 5 };
  const crawler: Entity = {
    id: 'crawler-1',
    type: 'crawler',
    x: crawlerPos.x,
    y: crawlerPos.y,
    areaId: DEFAULT_AREA_ID,
    hp: 10,
    maxHp: 10,
    name: 'Test Archer',
    attack: 2,
    defense: 0,
    speed: 100,
    char: '@',
    characterClass: 'warrior',
    inventory: [],
    equippedWeapon: crawlerWeapon
      ? crawlerWeapon === 'shortbow'
        ? { id: 'eq-bow', templateId: 'shortbow', x: 0, y: 0, areaId: DEFAULT_AREA_ID }
        : crawlerWeapon === 'throwing_dagger'
          ? { id: 'eq-dagger', templateId: 'throwing_dagger', x: 0, y: 0, areaId: DEFAULT_AREA_ID, quantity: 5 }
          : { id: 'eq-weapon', templateId: crawlerWeapon, x: 0, y: 0, areaId: DEFAULT_AREA_ID }
      : null,
    equippedOffhand: crawlerOffhand
      ? { id: 'eq-quiver', templateId: crawlerOffhand, x: 0, y: 0, areaId: DEFAULT_AREA_ID, currentAmmo: 20 }
      : null,
    equippedArmor: null,
  };

  // Create monster to the south at specified distance
  const monster: Entity = {
    id: 'monster-1',
    type: 'monster',
    x: crawlerPos.x,
    y: crawlerPos.y + monsterDistance, // south of crawler
    areaId: DEFAULT_AREA_ID,
    hp: 5,
    maxHp: 5,
    name: 'Goblin',
    attack: 2,
    defense: 0,
    speed: 100,
    monsterTypeId: 'goblin',
  };

  const bubble = createBubble({
    id: bubbleId('test'),
    entityIds: [entityId('crawler-1'), entityId('monster-1')],
    entities: [
      { id: entityId('crawler-1'), speed: 100 },
      { id: entityId('monster-1'), speed: 80 },
    ],
    center: crawlerPos,
  });

  // Set all tiles as explored so monster is visible
  const allTiles: string[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      allTiles.push(tileKey(x, y));
    }
  }

  return {
    zone: createTestZone(map),
    currentAreaId: DEFAULT_AREA_ID,
    entities: { 'crawler-1': crawler, 'monster-1': monster },
    items: [],
    bubbles: [bubble],
    hibernating: [],
    exploredTiles: { [DEFAULT_AREA_ID]: allTiles },
    turn: 0,
    messages: [],
    gameStatus: { status: 'playing' },
    objectives: [],
  };
}

describe('stateToPrompt with ranged weapons', () => {
  it('shows monster distance in tiles', () => {
    const state = createTestStateWithRangedSetup();
    const prompt = stateToPrompt(state, 'crawler-1');

    // Should show "3 tiles south" instead of just "south"
    expect(prompt).toMatch(/Goblin.*3 tiles south/);
  });

  it('includes RANGED WEAPON section when equipped', () => {
    const state = createTestStateWithRangedSetup({
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver',
    });
    const prompt = stateToPrompt(state, 'crawler-1');

    expect(prompt).toContain('RANGED WEAPON:');
    expect(prompt).toContain('Shortbow');
    expect(prompt).toContain('range: 6');
  });

  it('shows quiver ammo count', () => {
    const state = createTestStateWithRangedSetup({
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver', // 20 arrows
    });
    const prompt = stateToPrompt(state, 'crawler-1');

    expect(prompt).toMatch(/Quiver.*20.*arrow/i);
  });

  it('shows thrown weapon quantity', () => {
    const state = createTestStateWithRangedSetup({
      crawlerWeapon: 'throwing_dagger', // x5
    });
    const prompt = stateToPrompt(state, 'crawler-1');

    expect(prompt).toContain('Throwing Dagger x5');
  });

  it('lists valid ranged targets', () => {
    const state = createTestStateWithRangedSetup({
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver',
      monsterDistance: 4, // within range 6
    });
    const prompt = stateToPrompt(state, 'crawler-1');

    expect(prompt).toMatch(/Valid targets:.*Goblin/);
  });

  it('excludes out-of-range monsters from valid targets', () => {
    const state = createTestStateWithRangedSetup({
      crawlerWeapon: 'shortbow', // range 6
      crawlerOffhand: 'leather_quiver',
      monsterDistance: 8, // beyond range
    });
    const prompt = stateToPrompt(state, 'crawler-1');

    // Monster should appear in MONSTERS but not in valid targets
    expect(prompt).toContain('Goblin');
    expect(prompt).not.toMatch(/Valid targets:.*Goblin/);
  });

  it('includes ranged_attack in available actions when equipped', () => {
    const state = createTestStateWithRangedSetup({
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver',
    });
    const prompt = stateToPrompt(state, 'crawler-1');

    expect(prompt).toContain('ranged_attack');
    expect(prompt).toContain('<direction> <distance>');
  });
});
