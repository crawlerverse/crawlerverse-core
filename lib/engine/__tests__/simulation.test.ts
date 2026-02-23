import { describe, it, expect, beforeEach } from 'vitest';
import { simulateBubble, simulate } from '../simulation';
import { createBubble, bubbleId, queueCommand, type Bubble } from '../bubble';
import { entityId, type EntityId } from '../scheduler';
import { DEFAULT_AREA_ID, type Entity, type Action, type GameState } from '../state';
import { parseAsciiMap, type DungeonMap } from '../map';
import { createTestZone } from './test-helpers';
import { tileKey, clearFOVCache } from '../fov';
import { createReachObjective } from '../objective';
import { crawlerIdFromIndex } from '../crawler-id';
import { resetMonsterCounter, createMonster } from '../monsters';
import { resetLootCounter } from '../monster-equipment';
import * as ROT from 'rot-js';

// Simple test map for simulation tests
const TEST_MAP_ASCII = `
##########
#........#
#........#
#........#
#........#
#........#
#........#
#........#
#........#
##########
`.trim();

// Helper to create test entities
const createTestEntities = (): Record<string, Entity> => ({
  player: {
    id: 'player',
    type: 'crawler',
    x: 5,
    y: 5,
    hp: 10,
    maxHp: 10,
    name: 'Player',
    char: '@',
    attack: 2,
    defense: 0,
    speed: 100,
    areaId: 'area-1',
  },
  rat: {
    id: 'rat',
    type: 'monster',
    x: 7,
    y: 5,
    hp: 2,
    maxHp: 2,
    name: 'Rat',
    char: 'r',
    attack: 1,
    defense: 0,
    speed: 120,
    areaId: 'area-1',
  },
});

// Helper to create a test GameState
function createTestGameState(entities: Record<string, Entity>, bubble: Bubble): GameState {
  const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
  const map: DungeonMap = {
    width,
    height,
    tiles,
    rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
    seed: 0,
  };
  return {
    zone: createTestZone(map),
    currentAreaId: DEFAULT_AREA_ID,
    entities,
    items: [],
    bubbles: [bubble],
    hibernating: [],
    exploredTiles: {},
    objectives: [],
    turn: 0,
    messages: [],
    gameStatus: { status: 'playing' },
  };
}

describe('simulateBubble', () => {
  it('advances tick when no one can act', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });
    const entities = { player: createTestEntities().player };
    const gameState = createTestGameState(entities, bubble);

    const result = simulateBubble(bubble, entities, { maxIterations: 1, gameState });

    expect(result.bubble.tick).toBe(1);
  });

  it('processes crawler action from queue', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    // Queue a wait action
    const action: Action = { action: 'wait', reasoning: 'test' };
    bubble = queueCommand(bubble, entityId('player'), action).bubble;

    const entities = { player: createTestEntities().player };
    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Queue should be empty after processing
    expect(result.bubble.commandQueues.get(entityId('player'))?.commands.length ?? 0).toBe(0);
  });

  it('stops when crawler has empty queue (waitingFor)', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    const entities = { player: createTestEntities().player };
    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    expect(result.waitingFor).toContain(entityId('player'));
  });

  it('respects maxIterations limit', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    const entities = { player: createTestEntities().player };
    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 5, gameState });

    expect(result.iterationsUsed).toBeLessThanOrEqual(5);
  });

  it('generates unique message IDs when multiple entities act', () => {
    // Setup: player and rat both adjacent and ready to act
    // The rat is adjacent to the player (at x:6, y:5)
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('rat'), speed: 120 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue a move action that will bump into the wall
    const action: Action = { action: 'move', direction: 'west', reasoning: 'test' };
    bubble = queueCommand(bubble, entityId('player'), action).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
      rat: {
        id: 'rat',
        type: 'monster',
        x: 6, // Adjacent to player
        y: 5,
        hp: 2,
        maxHp: 2,
        name: 'Rat',
        char: 'r',
        attack: 1,
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Should have at least 2 messages (player action + rat attack)
    expect(result.messages.length).toBeGreaterThanOrEqual(2);

    // All message IDs should be unique
    const ids = result.messages.map(m => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('monster attacks player when adjacent', () => {
    // Create bubble with player and monster already adjacent
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('rat'), speed: 120 }, // Rat is faster, acts first
      ],
      center: { x: 5, y: 5 },
    });

    // Queue a wait action so player doesn't block simulation
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'wait',
      reasoning: 'waiting',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
      rat: {
        id: 'rat',
        type: 'monster',
        x: 6, // Adjacent to player
        y: 5,
        hp: 5,
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Player should have taken damage from rat
    const playerAfter = result.entities['player'];
    expect(playerAfter).toBeDefined();
    expect(playerAfter.hp).toBeLessThan(10);

    // Should have a message about the rat attacking
    const attackMessage = result.messages.find(m => m.text.includes('Rat hits'));
    expect(attackMessage).toBeDefined();
  });

  it('monster moves toward player when not adjacent', () => {
    // Create bubble with player and monster far apart
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('rat'), speed: 120 }, // Rat is faster
      ],
      center: { x: 5, y: 5 },
    });

    // Queue a wait action so player doesn't block simulation
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'wait',
      reasoning: 'waiting',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
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
        areaId: 'area-1',
      },
      rat: {
        id: 'rat',
        type: 'monster',
        x: 7, // Far from player
        y: 7,
        hp: 5,
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Rat should have moved closer to player
    const ratAfter = result.entities['rat'];
    expect(ratAfter).toBeDefined();
    expect(ratAfter.x).toBeLessThan(7);
    expect(ratAfter.y).toBeLessThan(7);
  });

  it('returns game over when player is killed', () => {
    // Create bubble with player at low HP adjacent to a strong monster
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('troll')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('troll'), speed: 120 }, // Troll is faster
      ],
      center: { x: 5, y: 5 },
    });

    // Queue a wait action
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'wait',
      reasoning: 'waiting',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 1, // Very low HP
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
      troll: {
        id: 'troll',
        type: 'monster',
        x: 6, // Adjacent
        y: 5,
        hp: 20,
        maxHp: 20,
        name: 'Troll',
        char: 'T',
        attack: 5, // Strong enough to kill in one hit
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Game should be over with defeat
    expect(result.gameStatus.status).toBe('ended');
    if (result.gameStatus.status === 'ended') {
      expect(result.gameStatus.victory).toBe(false);
    }

    // Should have death message
    const deathMessage = result.messages.find(m => m.text.includes('died'));
    expect(deathMessage).toBeDefined();
  });

  it('returns victory when last monster is killed', () => {
    // Create bubble with player adjacent to a weak monster
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 120 }, // Player is faster
        { id: entityId('rat'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue an attack action
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill the rat',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 10, // Strong enough to one-shot
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
      rat: {
        id: 'rat',
        type: 'monster',
        x: 6, // Adjacent (east of player)
        y: 5,
        hp: 1, // Low HP
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Game should be over with victory
    expect(result.gameStatus.status).toBe('ended');
    if (result.gameStatus.status === 'ended') {
      expect(result.gameStatus.victory).toBe(true);
    }

    // Rat should be removed from entities
    expect(result.entities['rat']).toBeUndefined();

    // Should have victory message
    const victoryMessage = result.messages.find(m => m.text.includes('Victory'));
    expect(victoryMessage).toBeDefined();
  });

  it('removes killed entity from scheduler', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 120 }, // Player is faster
        { id: entityId('rat'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue an attack action to kill the rat
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill the rat',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 10,
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
      rat: {
        id: 'rat',
        type: 'monster',
        x: 6,
        y: 5,
        hp: 1,
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Rat should be removed from scheduler
    const ratEntry = result.bubble.scheduler.entries.find(e => e.entityId === entityId('rat'));
    expect(ratEntry).toBeUndefined();
  });

  it('sets truncated to true when hitting max iterations while still playing', () => {
    // Create a scenario where multiple entities keep taking turns
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('rat'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue lots of wait actions to keep the simulation going
    for (let i = 0; i < 5; i++) {
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'test',
      }).bubble;
    }

    const entities = createTestEntities();
    // Move rat far away so it just chases without hitting
    entities.rat = { ...entities.rat, x: 8, y: 8 };

    const gameState = createTestGameState(entities, bubble);
    // Use very low max iterations
    const result = simulateBubble(bubble, entities, { maxIterations: 2, gameState });

    // Should be truncated since we hit max iterations while game is playing
    expect(result.truncated).toBe(true);
    expect(result.gameStatus.status).toBe('playing');
  });

  it('sets truncated to false when simulation completes normally', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    // Queue one action
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    const entities = { player: createTestEntities().player };
    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, { maxIterations: 100, gameState });

    // Should not be truncated - stopped because waiting for input
    expect(result.truncated).toBe(false);
    expect(result.waitingFor.length).toBe(1);
  });

  it('monster waits when no target exists', () => {
    // Create bubble with only a monster, no crawlers
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('rat')],
      entities: [{ id: entityId('rat'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    const entities: Record<string, Entity> = {
      rat: {
        id: 'rat',
        type: 'monster',
        x: 5,
        y: 5,
        hp: 5,
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
    };

    const gameState = createTestGameState(entities, bubble);
    // Should complete without errors
    const result = simulateBubble(bubble, entities, { maxIterations: 5, gameState });

    // Monster should have taken turns (AP deducted) but no crash
    expect(result.gameStatus.status).toBe('playing');
    expect(result.waitingFor.length).toBe(0); // No crawlers to wait for
  });
});

describe('simulate', () => {
  it('returns unchanged state when no bubbles exist', () => {
    const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
      seed: 0,
    };
    const state: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player: createTestEntities().player },
      items: [],
      bubbles: [], // No bubbles
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
    };

    const result = simulate(state);

    expect(result.state).toBe(state); // Should be same object reference
    expect(result.waitingFor).toEqual([]);
  });

  it('merges updated entities back to global state', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    // Queue a move action
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'move',
      direction: 'east',
      reasoning: 'test',
    }).bubble;

    const entities = { player: createTestEntities().player };
    const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
      seed: 0,
    };
    const state: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
    };

    const result = simulate(state);

    // Player should have moved east
    expect(result.state.entities.player.x).toBe(6);
    expect(result.state.entities.player.y).toBe(5);
  });

  it('removes killed entities from global state', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 120 },
        { id: entityId('rat'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue an attack to kill the rat
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill rat',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 10,
        defense: 0,
        speed: 120,
        areaId: 'area-1',
      },
      rat: {
        id: 'rat',
        type: 'monster',
        x: 6,
        y: 5,
        hp: 1,
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
    };

    const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
      seed: 0,
    };
    const state: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
    };

    const result = simulate(state);

    // Rat should be removed from global entities
    expect(result.state.entities.rat).toBeUndefined();
    // Player should still be there
    expect(result.state.entities.player).toBeDefined();
  });

  it('increments turn when iterations are used', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    bubble = queueCommand(bubble, entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    const entities = { player: createTestEntities().player };
    const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
      seed: 0,
    };
    const state: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 5,
      messages: [],
      gameStatus: { status: 'playing' },
    };

    const result = simulate(state);

    // Turn should increment
    expect(result.state.turn).toBe(6);
  });

  it('accumulates messages from bubble simulation', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    bubble = queueCommand(bubble, entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    const entities = { player: createTestEntities().player };
    const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
    const map: DungeonMap = {
      width,
      height,
      tiles,
      rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
      seed: 0,
    };
    const state: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [{ id: 'msg-0-0', text: 'Previous message', turn: 0 }],
      gameStatus: { status: 'playing' },
    };

    const result = simulate(state);

    // Should have both previous message and new message
    expect(result.state.messages.length).toBeGreaterThan(1);
    expect(result.state.messages[0].text).toBe('Previous message');
    // New message about waiting
    const waitMessage = result.state.messages.find(m => m.text.includes('wait'));
    expect(waitMessage).toBeDefined();
  });

  describe('multiple independent bubbles (CRA-46)', () => {
    const createMultiBubbleState = (): GameState => {
      // Create two bubbles with separate entities
      const bubble1 = createBubble({
        id: bubbleId('bubble-1'),
        entityIds: [entityId('agent1')],
        entities: [{ id: entityId('agent1'), speed: 100 }],
        center: { x: 2, y: 2 },
      });

      const bubble2 = createBubble({
        id: bubbleId('bubble-2'),
        entityIds: [entityId('agent2')],
        entities: [{ id: entityId('agent2'), speed: 100 }],
        center: { x: 8, y: 8 },
      });

      const entities: Record<string, Entity> = {
        agent1: {
          id: 'agent1',
          type: 'crawler',
          x: 2,
          y: 2,
          hp: 10,
          maxHp: 10,
          name: 'Agent 1',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        agent2: {
          id: 'agent2',
          type: 'crawler',
          x: 8,
          y: 8,
          hp: 10,
          maxHp: 10,
          name: 'Agent 2',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      return {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble1, bubble2],
        hibernating: [],
        exploredTiles: {},
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };
    };

    it('simulates both bubbles independently', () => {
      const state = createMultiBubbleState();

      // Queue actions for both agents
      const bubble1 = queueCommand(state.bubbles[0], entityId('agent1'), {
        action: 'wait',
        reasoning: 'test-1',
      }).bubble;
      const bubble2 = queueCommand(state.bubbles[1], entityId('agent2'), {
        action: 'wait',
        reasoning: 'test-2',
      }).bubble;

      const stateWithCommands = {
        ...state,
        bubbles: [bubble1, bubble2],
      };

      const result = simulate(stateWithCommands);

      // Both bubbles should have been simulated
      expect(result.state.bubbles.length).toBe(2);
      // Both agents should have their actions processed (no one waiting)
      expect(result.waitingFor.length).toBe(2);
      expect(result.waitingFor).toContain('agent1' as EntityId);
      expect(result.waitingFor).toContain('agent2' as EntityId);
    });

    it('aggregates messages from all bubbles', () => {
      const state = createMultiBubbleState();

      // Queue wait actions for both agents
      const bubble1 = queueCommand(state.bubbles[0], entityId('agent1'), {
        action: 'wait',
        reasoning: 'Agent 1 waits',
      }).bubble;
      const bubble2 = queueCommand(state.bubbles[1], entityId('agent2'), {
        action: 'wait',
        reasoning: 'Agent 2 waits',
      }).bubble;

      const stateWithCommands = {
        ...state,
        bubbles: [bubble1, bubble2],
      };

      const result = simulate(stateWithCommands);

      // Should have messages from both agents
      const agent1Wait = result.state.messages.find(m => m.text.includes('wait'));
      expect(agent1Wait).toBeDefined();
    });

    it('handles one bubble with command, one waiting', () => {
      const state = createMultiBubbleState();

      // Only queue action for agent1, agent2 has no commands
      const bubble1 = queueCommand(state.bubbles[0], entityId('agent1'), {
        action: 'wait',
        reasoning: 'test',
      }).bubble;

      const stateWithCommands = {
        ...state,
        bubbles: [bubble1, state.bubbles[1]],
      };

      const result = simulate(stateWithCommands);

      // Both agents should be in waitingFor after simulation
      // (agent1 processes action then waits for next, agent2 waits immediately)
      expect(result.waitingFor).toContain('agent1' as EntityId);
      expect(result.waitingFor).toContain('agent2' as EntityId);
    });

    it('preserves bubble independence after simulation', () => {
      const state = createMultiBubbleState();

      // Queue different actions
      const bubble1 = queueCommand(state.bubbles[0], entityId('agent1'), {
        action: 'move',
        direction: 'south',
        reasoning: 'test',
      }).bubble;
      const bubble2 = queueCommand(state.bubbles[1], entityId('agent2'), {
        action: 'move',
        direction: 'north',
        reasoning: 'test',
      }).bubble;

      const stateWithCommands = {
        ...state,
        bubbles: [bubble1, bubble2],
      };

      const result = simulate(stateWithCommands);

      // Verify entities moved independently
      expect(result.state.entities['agent1'].y).toBe(3); // moved south from 2
      expect(result.state.entities['agent2'].y).toBe(7); // moved north from 8
    });
  });

  describe('orphaned scheduler entries', () => {
    it('handles bubble with entity ID that no longer exists in entities', () => {
      // Create a bubble that references an entity that doesn't exist
      // This tests the orphan cleanup path
      const bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('ghost')], // entity doesn't exist in entities map
        entities: [{ id: entityId('ghost'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities: {}, // Empty - no entities exist
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      // Should not throw - should handle gracefully by cleaning up orphaned entries
      const result = simulate(state);

      // Scheduler entry should have been removed
      expect(result.state.bubbles[0].scheduler.entries.length).toBe(0);
    });

    it('continues simulation after cleaning up orphaned entity', () => {
      // Create bubble with ghost (doesn't exist, faster so acts first) and player (exists)
      const player = createTestEntities().player;
      const bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('ghost'), entityId('player')],
        entities: [
          { id: entityId('ghost'), speed: 120 }, // Faster, will be checked first
          { id: entityId('player'), speed: 100 },
        ],
        center: { x: 5, y: 5 },
      });

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities: { player }, // Only player exists, ghost is missing
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Simulation should complete, player should be waiting for input
      expect(result.waitingFor).toContain('player' as EntityId);
      // Ghost should have been removed from scheduler (it was orphaned)
      const hasGhost = result.state.bubbles[0].scheduler.entries.some(
        e => e.entityId === 'ghost'
      );
      expect(hasGhost).toBe(false);
    });
  });

  describe('explored tiles tracking', () => {
    it('updates exploredTiles when crawler moves', () => {
      // Create a player at position (5, 5)
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a move action to move east
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'move',
        direction: 'east',
        reasoning: 'test',
      }).bubble;

      const entities: Record<string, Entity> = {
        player: {
          id: 'player',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Player',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {}, // Start with no explored tiles
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Player should have moved east to (6, 5)
      expect(result.state.entities.player.x).toBe(6);
      expect(result.state.entities.player.y).toBe(5);

      // ExploredTiles should be updated for the area (shared by all crawlers)
      const areaExplored = result.state.exploredTiles[DEFAULT_AREA_ID];
      expect(areaExplored).toBeDefined();
      expect(areaExplored.length).toBeGreaterThan(0);

      // New position (6, 5) should be in explored tiles
      expect(areaExplored).toContain(tileKey(6, 5));

      // Some tiles visible from new position should be explored
      // At minimum, adjacent tiles should be visible
      expect(areaExplored).toContain(tileKey(7, 5)); // East of player
    });

    it('sets lastMoveDirection on crawler after move', () => {
      // Create a player at position (5, 5)
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a move action to move southeast
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'move',
        direction: 'southeast',
        reasoning: 'test',
      }).bubble;

      const entities: Record<string, Entity> = {
        player: {
          id: 'player',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Player',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Player should have moved southeast to (6, 6)
      expect(result.state.entities.player.x).toBe(6);
      expect(result.state.entities.player.y).toBe(6);

      // lastMoveDirection should be set to 'southeast'
      expect(result.state.entities.player.lastMoveDirection).toBe('southeast');
    });

    it('accumulates explored tiles across multiple moves', () => {
      // Create a player and queue two moves
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 2, y: 2 },
      });

      // Queue two move actions
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'move',
        direction: 'east',
        reasoning: 'first move',
      }).bubble;
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'move',
        direction: 'east',
        reasoning: 'second move',
      }).bubble;

      const entities: Record<string, Entity> = {
        player: {
          id: 'player',
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
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Player should have moved twice to (4, 2)
      expect(result.state.entities.player.x).toBe(4);

      // ExploredTiles should contain tiles from both positions (keyed by areaId)
      const areaExplored = result.state.exploredTiles[DEFAULT_AREA_ID];
      expect(areaExplored).toBeDefined();

      // Tiles from original position (2, 2) should still be explored
      expect(areaExplored).toContain(tileKey(2, 2));

      // Tiles from final position (4, 2) should be explored
      expect(areaExplored).toContain(tileKey(4, 2));
    });

    it('preserves existing explored tiles when moving', () => {
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      bubble = queueCommand(bubble, entityId('player'), {
        action: 'move',
        direction: 'east',
        reasoning: 'test',
      }).bubble;

      const entities: Record<string, Entity> = {
        player: {
          id: 'player',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Player',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      // Start with some pre-explored tiles (keyed by areaId)
      const preExplored = ['99,99', '88,88']; // Arbitrary tiles that wouldn't naturally be visible

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: { [DEFAULT_AREA_ID]: preExplored },
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      const areaExplored = result.state.exploredTiles[DEFAULT_AREA_ID];

      // Pre-explored tiles should still be there
      expect(areaExplored).toContain('99,99');
      expect(areaExplored).toContain('88,88');

      // New tiles should also be added
      expect(areaExplored).toContain(tileKey(6, 5));
    });

    it('preserves explored tiles when crawler dies', () => {
      // Test that exploredTiles are NOT cleaned up when a crawler dies
      // This is useful for game-over stats, replays, or spectator mode
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player'), entityId('troll')],
        entities: [
          { id: entityId('player'), speed: 100 },
          { id: entityId('troll'), speed: 120 }, // Troll is faster, acts first
        ],
        center: { x: 5, y: 5 },
      });

      // Queue a wait action so player doesn't block simulation
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'waiting',
      }).bubble;

      const entities: Record<string, Entity> = {
        player: {
          id: 'player',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 1, // Very low HP - will die
          maxHp: 10,
          name: 'Player',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        troll: {
          id: 'troll',
          type: 'monster',
          x: 6, // Adjacent to player
          y: 5,
          hp: 20,
          maxHp: 20,
          name: 'Troll',
          char: 'T',
          attack: 5, // Strong enough to kill in one hit
          defense: 0,
          speed: 120,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      // Player had explored some tiles before dying
      const playerExploredBefore = [tileKey(5, 5), tileKey(4, 5), tileKey(6, 5)];

      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: { player: playerExploredBefore },
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Game should be over
      expect(result.state.gameStatus.status).toBe('ended');

      // Player's explored tiles should be preserved even after death
      // (useful for game over screen showing what player discovered)
      const playerExploredAfter = result.state.exploredTiles['player'];
      expect(playerExploredAfter).toBeDefined();
      expect(playerExploredAfter).toContain(tileKey(5, 5));
      expect(playerExploredAfter).toContain(tileKey(4, 5));
      expect(playerExploredAfter).toContain(tileKey(6, 5));
    });

    it('maintains separate explored tiles when one crawler dies in multi-crawler game', () => {
      // In a multi-crawler game, each crawler has independent explored tiles
      // If one dies, the other's explored tiles should not be affected
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player1'), entityId('player2'), entityId('troll')],
        entities: [
          { id: entityId('player1'), speed: 100 },
          { id: entityId('player2'), speed: 100 },
          { id: entityId('troll'), speed: 120 },
        ],
        center: { x: 5, y: 5 },
      });

      // Queue wait actions
      bubble = queueCommand(bubble, entityId('player1'), {
        action: 'wait',
        reasoning: 'waiting',
      }).bubble;
      bubble = queueCommand(bubble, entityId('player2'), {
        action: 'wait',
        reasoning: 'waiting',
      }).bubble;

      const entities: Record<string, Entity> = {
        player1: {
          id: 'player1',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 1, // Will die
          maxHp: 10,
          name: 'Player 1',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        player2: {
          id: 'player2',
          type: 'crawler',
          x: 2,
          y: 2, // Far from troll - will survive
          hp: 10,
          maxHp: 10,
          name: 'Player 2',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
        troll: {
          id: 'troll',
          type: 'monster',
          x: 6, // Adjacent to player1
          y: 5,
          hp: 20,
          maxHp: 20,
          name: 'Troll',
          char: 'T',
          attack: 5,
          defense: 0,
          speed: 120,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      // Both players have explored different tiles
      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {
          player1: [tileKey(5, 5), tileKey(6, 5)],
          player2: [tileKey(2, 2), tileKey(3, 2)],
        },
        objectives: [],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Player1 died (game may or may not be over depending on win condition)
      expect(result.state.entities['player1']).toBeUndefined();

      // Both crawlers' explored tiles should still exist
      expect(result.state.exploredTiles['player1']).toBeDefined();
      expect(result.state.exploredTiles['player2']).toBeDefined();

      // Player2's explored tiles should be intact (and possibly expanded)
      expect(result.state.exploredTiles['player2']).toContain(tileKey(2, 2));
      expect(result.state.exploredTiles['player2']).toContain(tileKey(3, 2));
    });
  });

  describe('Objectives integration', () => {
    it('updates objectives after crawler action', () => {
      // Create a crawler at position (5, 5) with a reach objective to (6, 5)
      const crawlerId = crawlerIdFromIndex(1);
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('crawler-1')],
        entities: [{ id: entityId('crawler-1'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a move action to move east (toward target)
      bubble = queueCommand(bubble, entityId('crawler-1'), {
        action: 'move',
        direction: 'east',
        reasoning: 'moving to objective',
      }).bubble;

      const entities: Record<string, Entity> = {
        'crawler-1': {
          id: 'crawler-1',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Crawler 1',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      // Create objective one step to the east
      const targetX = 6;
      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        objectives: [
          createReachObjective({
            id: 'obj-1',
            description: 'Go east',
            target: { x: targetX, y: 5 },
            assignee: crawlerId,
          }),
        ],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Crawler should have moved east to (6, 5)
      expect(result.state.entities['crawler-1'].x).toBe(6);
      expect(result.state.entities['crawler-1'].y).toBe(5);

      // Objective should be completed
      expect(result.state.objectives[0].status).toBe('completed');
    });

    it('does not complete objective if crawler moves elsewhere', () => {
      const crawlerId = crawlerIdFromIndex(1);
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('crawler-1')],
        entities: [{ id: entityId('crawler-1'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a move action to move west (away from target)
      bubble = queueCommand(bubble, entityId('crawler-1'), {
        action: 'move',
        direction: 'west',
        reasoning: 'moving away',
      }).bubble;

      const entities: Record<string, Entity> = {
        'crawler-1': {
          id: 'crawler-1',
          type: 'crawler',
          x: 5,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Crawler 1',
          char: '@',
          attack: 2,
          defense: 0,
          speed: 100,
          areaId: 'area-1',
        },
      };

      const { tiles, width, height } = parseAsciiMap(TEST_MAP_ASCII);
      const map: DungeonMap = {
        width,
        height,
        tiles,
        rooms: [{ x: 1, y: 1, width: 8, height: 8, center: { x: 5, y: 5 }, tags: ['starting'] }],
        seed: 0,
      };

      // Create objective to the east (opposite direction of move)
      const state: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        objectives: [
          createReachObjective({
            id: 'obj-1',
            description: 'Go east',
            target: { x: 6, y: 5 },
            assignee: crawlerId,
          }),
        ],
        turn: 0,
        messages: [],
        gameStatus: { status: 'playing' },
      };

      const result = simulate(state);

      // Crawler moved west to (4, 5)
      expect(result.state.entities['crawler-1'].x).toBe(4);

      // Objective should still be active
      expect(result.state.objectives[0].status).toBe('active');
    });
  });
});

// Helper to create test maps from ASCII art
function createTestMap(lines: string[]): DungeonMap {
  // Replace M and P with floor tiles for parsing
  const normalized = lines.map(line => line.replace(/[MP]/g, '.'));
  const ascii = normalized.join('\n');
  const { tiles, width, height } = parseAsciiMap(ascii);
  return { tiles, width, height, rooms: [], seed: 0 };
}

describe('patrol movement', () => {
  beforeEach(() => {
    resetMonsterCounter();
    clearFOVCache();
  });

  it('patrolling monster moves randomly', () => {
    // Skeleton in patrol state in open area
    const mapLines = [
      '#######',
      '#.....#',
      '#..M..#',
      '#.....#',
      '#######',
    ];
    const map = createTestMap(mapLines);

    // Create skeleton which defaults to patrol behavior
    const monster = createMonster('skeleton', { x: 3, y: 2 }, { width: 7, height: 5 });
    expect(monster.behaviorState).toBe('patrol');

    // Player far away and not visible (behind walls conceptually)
    const player: Entity = {
      id: 'player',
      type: 'crawler',
      x: 100, y: 100, // Far away
      hp: 20, maxHp: 20,
      name: 'Player',
      attack: 5, defense: 0, speed: 100,
      char: '@',
      areaId: 'area-1',
    };

    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId(monster.id)],
      entities: [
        { id: entityId(monster.id), speed: 100 },
      ],
      center: { x: 3, y: 2 },
    });

    const entities: Record<string, Entity> = {
      player,
      [monster.id]: monster,
    };

    const gameState: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
      objectives: [],
    };

    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    // Monster should have moved (patrol = random wander)
    const monsterAfter = result.entities[monster.id];
    expect(monsterAfter).toBeDefined();
    // Should have moved to an adjacent tile
    const moved = monsterAfter.x !== 3 || monsterAfter.y !== 2;
    expect(moved).toBe(true);
    // Should still be in patrol state
    expect(monsterAfter.behaviorState).toBe('patrol');
  });

  it('patrolling monster avoids walls', () => {
    // Monster in corner with limited options
    const mapLines = [
      '#######',
      '##...##',
      '##.M.##',
      '##...##',
      '#######',
    ];
    const map = createTestMap(mapLines);

    const monster = createMonster('skeleton', { x: 3, y: 2 }, { width: 7, height: 5 });
    expect(monster.behaviorState).toBe('patrol');

    const player: Entity = {
      id: 'player',
      type: 'crawler',
      x: 100, y: 100,
      hp: 20, maxHp: 20,
      name: 'Player',
      attack: 5, defense: 0, speed: 100,
      char: '@',
      areaId: 'area-1',
    };

    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId(monster.id)],
      entities: [
        { id: entityId(monster.id), speed: 100 },
      ],
      center: { x: 3, y: 2 },
    });

    const entities: Record<string, Entity> = {
      player,
      [monster.id]: monster,
    };

    const gameState: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
      objectives: [],
    };

    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    const monsterAfter = result.entities[monster.id];
    expect(monsterAfter).toBeDefined();

    // Valid positions are only the floor tiles: (2,1), (3,1), (4,1), (2,2), (4,2), (2,3), (3,3), (4,3)
    // Monster started at (3,2), so valid adjacent moves are:
    // north: (3,1), south: (3,3), east: (4,2), west: (2,2)
    // Corner diagonals would be blocked by walls
    const validPositions = [
      { x: 3, y: 1 },  // north
      { x: 3, y: 3 },  // south
      { x: 4, y: 2 },  // east
      { x: 2, y: 2 },  // west
    ];

    const isValidMove = validPositions.some(
      pos => pos.x === monsterAfter.x && pos.y === monsterAfter.y
    );
    expect(isValidMove).toBe(true);
  });

  it('patrolling monster stays in place when cornered', () => {
    // Monster completely surrounded by walls
    const mapLines = [
      '#####',
      '##M##',
      '#####',
    ];
    const map = createTestMap(mapLines);

    const monster = createMonster('skeleton', { x: 2, y: 1 }, { width: 5, height: 3 });
    expect(monster.behaviorState).toBe('patrol');

    const player: Entity = {
      id: 'player',
      type: 'crawler',
      x: 100, y: 100,
      hp: 20, maxHp: 20,
      name: 'Player',
      attack: 5, defense: 0, speed: 100,
      char: '@',
      areaId: 'area-1',
    };

    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId(monster.id)],
      entities: [
        { id: entityId(monster.id), speed: 100 },
      ],
      center: { x: 2, y: 1 },
    });

    const entities: Record<string, Entity> = {
      player,
      [monster.id]: monster,
    };

    const gameState: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
      objectives: [],
    };

    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    const monsterAfter = result.entities[monster.id];
    expect(monsterAfter).toBeDefined();
    // Should not have moved (nowhere to go)
    expect(monsterAfter.x).toBe(2);
    expect(monsterAfter.y).toBe(1);
  });

  it('patrolling monster avoids other monsters', () => {
    // Two monsters - one should avoid the other
    const mapLines = [
      '#######',
      '#.....#',
      '#.M.M.#',
      '#.....#',
      '#######',
    ];
    const map = createTestMap(mapLines);

    const monster1 = createMonster('skeleton', { x: 2, y: 2 }, { width: 7, height: 5 });
    const monster2 = createMonster('skeleton', { x: 4, y: 2 }, { width: 7, height: 5 });

    const player: Entity = {
      id: 'player',
      type: 'crawler',
      x: 100, y: 100,
      hp: 20, maxHp: 20,
      name: 'Player',
      attack: 5, defense: 0, speed: 100,
      char: '@',
      areaId: 'area-1',
    };

    // Only include monster1 in the bubble (monster2 is obstacle)
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId(monster1.id)],
      entities: [
        { id: entityId(monster1.id), speed: 100 },
      ],
      center: { x: 3, y: 2 },
    });

    const entities: Record<string, Entity> = {
      player,
      [monster1.id]: monster1,
      [monster2.id]: monster2,
    };

    const gameState: GameState = {
      zone: createTestZone(map),
      currentAreaId: DEFAULT_AREA_ID,
      entities,
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
      objectives: [],
    };

    const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

    const monster1After = result.entities[monster1.id];
    expect(monster1After).toBeDefined();

    // Monster1 should not move to monster2's position (4,2)
    expect(monster1After.x !== 4 || monster1After.y !== 2).toBe(true);
  });

  it('patrol movement is deterministic for same turn and entity', () => {
    // Running the same scenario twice should produce the same result
    const mapLines = [
      '#######',
      '#.....#',
      '#..M..#',
      '#.....#',
      '#######',
    ];
    const map = createTestMap(mapLines);

    const createScenario = () => {
      resetMonsterCounter();
      const monster = createMonster('skeleton', { x: 3, y: 2 }, { width: 7, height: 5 });

      const player: Entity = {
        id: 'player',
        type: 'crawler',
        x: 100, y: 100,
        hp: 20, maxHp: 20,
        name: 'Player',
        attack: 5, defense: 0, speed: 100,
        char: '@',
        areaId: 'area-1',
      };

      const bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId(monster.id)],
        entities: [
          { id: entityId(monster.id), speed: 100 },
        ],
        center: { x: 3, y: 2 },
      });

      const entities: Record<string, Entity> = {
        player,
        [monster.id]: monster,
      };

      const gameState: GameState = {
        zone: createTestZone(map),
        currentAreaId: DEFAULT_AREA_ID,
        entities,
        items: [],
        bubbles: [bubble],
        hibernating: [],
        exploredTiles: {},
        turn: 5, // Specific turn number
        messages: [],
        gameStatus: { status: 'playing' },
        objectives: [],
      };

      return { bubble, entities, gameState, monsterId: monster.id };
    };

    // Run twice
    const scenario1 = createScenario();
    const result1 = simulateBubble(scenario1.bubble, scenario1.entities, {
      maxIterations: 10,
      gameState: scenario1.gameState,
    });

    const scenario2 = createScenario();
    const result2 = simulateBubble(scenario2.bubble, scenario2.entities, {
      maxIterations: 10,
      gameState: scenario2.gameState,
    });

    // Results should be identical
    const monster1 = result1.entities[scenario1.monsterId];
    const monster2 = result2.entities[scenario2.monsterId];
    expect(monster1.x).toBe(monster2.x);
    expect(monster1.y).toBe(monster2.y);
  });
});

// Test reasoning and aiMetadata threading
it('threads reasoning and aiMetadata from crawler actions to messages', () => {
  clearFOVCache();

  let bubble = createBubble({
    id: bubbleId('test'),
    entityIds: [entityId('player')],
    entities: [{ id: entityId('player'), speed: 100 }],
    center: { x: 5, y: 5 },
  });

  const testAiMetadata = {
    durationMs: 1234,
    outputTokens: 50,
    modelId: 'test-model',
  };

  // Queue a move action with reasoning and aiMetadata
  bubble = queueCommand(bubble, entityId('player'), {
    action: 'move',
    direction: 'north',
    reasoning: 'Moving to explore the dungeon',
    aiMetadata: testAiMetadata,
  }).bubble;

  const entities: Record<string, Entity> = {
    player: {
      id: 'player',
      type: 'crawler',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'TestCrawler',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    },
  };

  const gameState = createTestGameState(entities, bubble);
  const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

  // Find the move message
  const moveMessage = result.messages.find(m => m.text.includes('moves north'));
  expect(moveMessage).toBeDefined();
  expect(moveMessage!.reasoning).toBe('Moving to explore the dungeon');
  expect(moveMessage!.aiMetadata).toEqual(testAiMetadata);
});

it('threads reasoning and aiMetadata from attack actions to messages', () => {
  clearFOVCache();

  let bubble = createBubble({
    id: bubbleId('test'),
    entityIds: [entityId('player'), entityId('rat')],
    entities: [
      { id: entityId('player'), speed: 120 },
      { id: entityId('rat'), speed: 100 },
    ],
    center: { x: 5, y: 5 },
  });

  const testAiMetadata = {
    durationMs: 2000,
    outputTokens: 30,
    modelId: 'attack-model',
  };

  // Queue an attack action with reasoning and aiMetadata
  bubble = queueCommand(bubble, entityId('player'), {
    action: 'attack',
    direction: 'east',
    reasoning: 'Kill the rat before it attacks',
    aiMetadata: testAiMetadata,
  }).bubble;

  const entities: Record<string, Entity> = {
    player: {
      id: 'player',
      type: 'crawler',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'TestCrawler',
      char: '@',
      attack: 10,
      defense: 0,
      speed: 120,
      areaId: 'area-1',
    },
    rat: {
      id: 'rat',
      type: 'monster',
      x: 6,
      y: 5,
      hp: 5,
      maxHp: 5,
      name: 'Rat',
      char: 'r',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    },
  };

  const gameState = createTestGameState(entities, bubble);
  const result = simulateBubble(bubble, entities, { maxIterations: 2, gameState });

  // Find the attack message (hit or miss)
  const attackMessage = result.messages.find(m =>
    m.text.includes('TestCrawler hits') || m.text.includes('TestCrawler misses')
  );
  expect(attackMessage).toBeDefined();
  expect(attackMessage!.reasoning).toBe('Kill the rat before it attacks');
  expect(attackMessage!.aiMetadata).toEqual(testAiMetadata);
});

describe('loot table drops', () => {
  beforeEach(() => {
    resetLootCounter();
    clearFOVCache();
  });

  it('monster death can drop consumables from loot table', () => {
    // Create a bubble with player and high-level monster (50% drop chance)
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('troll')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('troll'), speed: 80 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue attack that will kill the troll
    bubble = queueCommand(bubble, entityId('player'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'Kill troll for loot',
    }).bubble;

    const entities: Record<string, Entity> = {
      player: {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 100,
        maxHp: 100,
        name: 'TestCrawler',
        char: '@',
        attack: 50, // High attack to one-shot
        defense: 0,
        speed: 100,
        areaId: 'area-1',
      },
      troll: {
        id: 'troll',
        type: 'monster',
        x: 6,
        y: 5,
        hp: 1, // Low HP to guarantee kill
        maxHp: 15,
        name: 'Troll',
        attack: 4,
        defense: 2,
        speed: 80,
        areaId: 'area-1',
        monsterTypeId: 'troll',
      },
    };

    // Create a mock RNG that guarantees loot drops
    // First call is for combat hit roll, second is for loot table roll (< 0.50 for level 3 troll)
    // Third call would be for consumable selection (index 0)
    let callCount = 0;
    const mockRng = {
      getUniform: () => {
        callCount++;
        // First call: combat roll - return 0.5 for reliable hit
        // Second call: loot table roll - return 0.1 (< 0.50 threshold for level 3)
        // Third call: consumable selection - return 0 for first item
        if (callCount === 1) return 0.5; // Combat hit
        if (callCount === 2) return 0.1; // Loot drop succeeds (< 0.50)
        return 0; // Item selection
      },
    } as typeof ROT.RNG;

    const gameState = createTestGameState(entities, bubble);
    const result = simulateBubble(bubble, entities, {
      maxIterations: 5,
      gameState,
      combatRng: mockRng,
    });

    // Troll should be dead
    expect(result.entities['troll']).toBeUndefined();

    // Check messages for death
    const deathMessage = result.messages.find(m => m.text.includes('dies!'));
    expect(deathMessage).toBeDefined();

    // Verify loot was dropped at troll's death position (6, 5)
    expect(result.items.length).toBeGreaterThan(0);
    const droppedItem = result.items.find(item => item.x === 6 && item.y === 5);
    expect(droppedItem).toBeDefined();

    // Check for loot drop message
    const lootMessage = result.messages.find(m => m.text.includes('drops'));
    expect(lootMessage).toBeDefined();
  });
});

// --- Ranged Attack Tests ---

/**
 * Helper to create test state for ranged attack scenarios.
 * Creates a crawler with ranged weapon and a monster at the specified positions.
 */
function createRangedTestState(params: {
  crawlerPos: { x: number; y: number };
  crawlerWeapon: string;
  crawlerOffhand?: string;
  monsterPos: { x: number; y: number };
  wallAt?: { x: number; y: number };
}): GameState {
  const { crawlerPos, crawlerWeapon, crawlerOffhand, monsterPos, wallAt } = params;

  // Create a 15x15 map (to allow for longer ranged attacks)
  const width = 15;
  const height = 15;
  const tiles = Array(height).fill(null).map((_, y) =>
    Array(width).fill(null).map((_, x) => {
      // Add wall if specified
      if (wallAt && x === wallAt.x && y === wallAt.y) {
        return { type: 'wall' as const };
      }
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
    rooms: [{ x: 1, y: 1, width: 13, height: 13, center: { x: 7, y: 7 }, tags: ['starting'] }],
    seed: 42,
  };

  // Create crawler with ranged weapon
  // Note: Bows go in equippedWeapon, thrown weapons go in equippedOffhand
  const isThrownWeapon = crawlerWeapon === 'throwing_dagger';
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
    inventory: [],
    equippedWeapon: crawlerWeapon === 'short_sword'
      ? { id: 'eq-sword', templateId: 'short_sword', x: 0, y: 0, areaId: DEFAULT_AREA_ID }
      : crawlerWeapon === 'shortbow'
        ? { id: 'eq-bow', templateId: 'shortbow', x: 0, y: 0, areaId: DEFAULT_AREA_ID }
        : null,
    equippedOffhand: isThrownWeapon
      ? { id: 'eq-dagger', templateId: 'throwing_dagger', x: 0, y: 0, areaId: DEFAULT_AREA_ID, quantity: 5 }
      : crawlerOffhand
        ? { id: 'eq-quiver', templateId: crawlerOffhand, x: 0, y: 0, areaId: DEFAULT_AREA_ID, currentAmmo: 20 }
        : null,
    equippedArmor: null,
  };

  // Create monster at specified position
  const monster: Entity = {
    id: 'monster-1',
    type: 'monster',
    x: monsterPos.x,
    y: monsterPos.y,
    areaId: DEFAULT_AREA_ID,
    hp: 5,
    maxHp: 5,
    name: 'Target Goblin',
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

  return {
    zone: createTestZone(map),
    currentAreaId: DEFAULT_AREA_ID,
    entities: { 'crawler-1': crawler, 'monster-1': monster },
    items: [],
    bubbles: [bubble],
    hibernating: [],
    exploredTiles: {},
    turn: 0,
    messages: [],
    gameStatus: { status: 'playing' },
    objectives: [],
  };
}

describe('ranged_attack action', () => {
  beforeEach(() => {
    clearFOVCache();
  });

  it('hits target within range and LOS', () => {
    // Setup: crawler with shortbow at (2,2), quiver, goblin at (2,5) - 3 tiles south
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver',
      monsterPos: { x: 2, y: 5 },
    });

    // Queue a ranged attack action
    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 3,
      reasoning: 'test',
      preRolledD20: 20, // guaranteed hit
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    expect(result.messages.some(m => m.text.includes('hits'))).toBe(true);
  });

  it('misses when d20 roll is too low', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver',
      monsterPos: { x: 2, y: 5 },
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 3,
      reasoning: 'test',
      preRolledD20: 1, // guaranteed miss
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    expect(result.messages.some(m => m.text.includes('misses'))).toBe(true);
  });

  it('fails when target out of range', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'shortbow', // range 6
      crawlerOffhand: 'leather_quiver',
      monsterPos: { x: 2, y: 10 }, // 8 tiles away
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 8,
      reasoning: 'test',
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    expect(result.messages.some(m => m.text.includes('too far'))).toBe(true);
  });

  it('fails when wall blocks LOS', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver',
      monsterPos: { x: 2, y: 5 },
      wallAt: { x: 2, y: 3 }, // wall between crawler and monster
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 3,
      reasoning: 'test',
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    // Wall blocks both FOV and LOS - either error message is valid
    const hasBlockedMessage = result.messages.some(m =>
      m.text.includes('clear shot') || m.text.includes("can't see")
    );
    expect(hasBlockedMessage).toBe(true);
  });

  it('fails when no ranged weapon equipped', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'short_sword', // melee weapon
      monsterPos: { x: 2, y: 5 },
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 3,
      reasoning: 'test',
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    expect(result.messages.some(m => m.text.includes('ranged weapon'))).toBe(true);
  });

  it('fails when bow has no quiver', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'shortbow',
      // no quiver
      monsterPos: { x: 2, y: 5 },
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 3,
      reasoning: 'test',
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    expect(result.messages.some(m => m.text.includes('quiver') || m.text.includes('ammunition'))).toBe(true);
  });

  it('consumes arrow from quiver on valid shot', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'shortbow',
      crawlerOffhand: 'leather_quiver', // starts with 20 arrows
      monsterPos: { x: 2, y: 5 },
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 3,
      reasoning: 'test',
      preRolledD20: 20,
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    const crawler = result.entities['crawler-1'];
    // Quiver ammo should be 19 after shot
    expect(crawler.equippedOffhand?.currentAmmo).toBe(19);
  });

  it('thrown weapon consumes itself', () => {
    let state = createRangedTestState({
      crawlerPos: { x: 2, y: 2 },
      crawlerWeapon: 'throwing_dagger', // quantity 5, goes to offhand
      monsterPos: { x: 2, y: 4 }, // 2 tiles
    });

    const action: Action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 2,
      reasoning: 'test',
      preRolledD20: 20,
    };

    const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
    state = { ...state, bubbles: [bubble] };

    const result = simulateBubble(bubble, state.entities, { maxIterations: 5, gameState: state });
    const crawler = result.entities['crawler-1'];
    // Thrown weapons are in offhand, quantity should be 4 after one throw
    expect(crawler.equippedOffhand?.quantity).toBe(4);
  });
});

describe('deserialized state (no eventEmitter)', () => {
  it('simulate() does not throw when eventEmitter is undefined', () => {
    const entities = createTestEntities();
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('rat'), speed: 120 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue an attack toward the rat (east, adjacent)
    const action: Action = { action: 'attack', direction: 'east', reasoning: 'test', preRolledD20: 20 };
    bubble = queueCommand(bubble, entityId('player'), action).bubble;

    // Build state WITHOUT eventEmitter (simulates JSON deserialization)
    const gameState: GameState = {
      ...createTestGameState(entities, bubble),
      eventEmitter: undefined,
      eventTracking: undefined,
    };

    // Should not throw TypeError: Cannot read properties of undefined (reading 'emit')
    expect(() => simulate(gameState)).not.toThrow();
  });

  it('simulateBubble() does not throw when eventEmitter is undefined', () => {
    const entities = createTestEntities();
    // Place rat adjacent to player for combat
    entities.rat = { ...entities.rat, x: 6, y: 5 };

    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player'), entityId('rat')],
      entities: [
        { id: entityId('player'), speed: 100 },
        { id: entityId('rat'), speed: 120 },
      ],
      center: { x: 5, y: 5 },
    });

    const action: Action = { action: 'attack', direction: 'east', reasoning: 'test', preRolledD20: 20 };
    bubble = queueCommand(bubble, entityId('player'), action).bubble;

    // Build state WITHOUT eventEmitter (simulates JSON deserialization)
    const gameState: GameState = {
      ...createTestGameState(entities, bubble),
      eventEmitter: undefined,
      eventTracking: undefined,
    };

    // Should not throw
    expect(() => {
      simulateBubble(bubble, entities, { maxIterations: 10, gameState });
    }).not.toThrow();
  });
});
