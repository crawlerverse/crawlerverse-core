import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState, getPlayer, getMonsters, getCurrentArea, DEFAULT_AREA_ID, type Entity, type GameState } from '../state';
import { processAction } from '../actions';
import { isPassable, validateConnectivity, parseAsciiMap, type DungeonMap } from '../map';
import { crawlerIdFromIndex } from '../crawler-id';
import { simulateBubble } from '../simulation';
import { createBubble, bubbleId, queueCommand, type Bubble } from '../bubble';
import { entityId } from '../scheduler';
import { createMonster, resetMonsterCounter } from '../monsters';
import { resetLootCounter } from '../monster-equipment';
import { clearFOVCache } from '../fov';
import { createTestZone } from './test-helpers';
import * as ROT from 'rot-js';

// Primary player ID constant for tests
const PLAYER_ID = crawlerIdFromIndex(1);

describe('Procedural Dungeon Integration', () => {
  it('creates playable game with procedural dungeon', () => {
    const state = createInitialState({ seed: 12345 });
    const player = getPlayer(state)!;
    const monsters = getMonsters(state);

    // Map is connected
    expect(validateConnectivity(getCurrentArea(state).map)).toBe(true);

    // Player is on passable tile
    expect(isPassable(getCurrentArea(state).map, player.x, player.y)).toBe(true);

    // Monsters are on passable tiles
    for (const monster of monsters) {
      expect(isPassable(getCurrentArea(state).map, monster.x, monster.y)).toBe(true);
    }

    // Game is playable
    expect(state.gameStatus.status).toBe('playing');
  });

  it('player can move through procedural dungeon', () => {
    const state = createInitialState({ seed: 12345 });
    const player = getPlayer(state)!;

    // Try to move in each cardinal direction
    const directions = ['north', 'south', 'east', 'west'] as const;
    let movedSuccessfully = false;

    for (const dir of directions) {
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        direction: dir,
        reasoning: 'testing movement'
      });

      if (result.success) {
        const newState = result.state;
        const newPlayer = getPlayer(newState)!;
        // If player moved, we succeeded
        if (newPlayer.x !== player.x || newPlayer.y !== player.y) {
          movedSuccessfully = true;
          break;
        }
      }
    }

    expect(movedSuccessfully).toBe(true);
  });

  it('generates different dungeons with different seeds', () => {
    const state1 = createInitialState({ seed: 11111 });
    const state2 = createInitialState({ seed: 22222 });
    const player1 = getPlayer(state1)!;
    const player2 = getPlayer(state2)!;

    // Different seeds should produce different player positions
    // (or at least different dungeon layouts)
    const playersSamePosition =
      player1.x === player2.x &&
      player1.y === player2.y;

    // Count floor tiles in each dungeon
    const map1 = getCurrentArea(state1).map;
    const map2 = getCurrentArea(state2).map;
    let floors1 = 0, floors2 = 0;
    for (let y = 0; y < map1.height; y++) {
      for (let x = 0; x < map1.width; x++) {
        if (map1.tiles[y][x].type === 'floor') floors1++;
        if (map2.tiles[y][x].type === 'floor') floors2++;
      }
    }

    // At least one of these should differ (extremely unlikely to be identical)
    const dungeonsDiffer = !playersSamePosition || floors1 !== floors2;
    expect(dungeonsDiffer).toBe(true);
  });

  it('same seed produces identical dungeons', () => {
    const state1 = createInitialState({ seed: 99999 });
    const state2 = createInitialState({ seed: 99999 });
    const player1 = getPlayer(state1)!;
    const player2 = getPlayer(state2)!;
    const monsters1 = getMonsters(state1);
    const monsters2 = getMonsters(state2);

    // Same seed should produce identical player positions
    expect(player1.x).toBe(player2.x);
    expect(player1.y).toBe(player2.y);

    // Same seed should produce identical monster positions
    expect(monsters1.length).toBe(monsters2.length);
    for (let i = 0; i < monsters1.length; i++) {
      expect(monsters1[i].x).toBe(monsters2[i].x);
      expect(monsters1[i].y).toBe(monsters2[i].y);
    }

    // Same seed should produce identical map
    expect(getCurrentArea(state1).map.seed).toBe(getCurrentArea(state2).map.seed);
    expect(getCurrentArea(state1).map.rooms.length).toBe(getCurrentArea(state2).map.rooms.length);
  });

  it('all entities have unique positions', () => {
    const state = createInitialState({ seed: 54321 });
    const player = getPlayer(state)!;
    const monsters = getMonsters(state);

    const positions = new Set<string>();

    // Add player position
    const playerKey = `${player.x},${player.y}`;
    positions.add(playerKey);

    // Check monsters don't overlap with player or each other
    for (const monster of monsters) {
      const key = `${monster.x},${monster.y}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }

    // Total unique positions should equal player + monsters
    expect(positions.size).toBe(1 + monsters.length);
  });

  it('player can complete a sequence of actions', () => {
    let state = createInitialState({ seed: 12345 });

    // Perform several actions to simulate gameplay
    const actions = [
      { action: 'wait', reasoning: 'observing surroundings' },
      { action: 'move', direction: 'north', reasoning: 'exploring' },
      { action: 'move', direction: 'south', reasoning: 'returning' },
      { action: 'wait', reasoning: 'resting' },
    ] as const;

    for (const action of actions) {
      const result = processAction(state, PLAYER_ID, action);
      expect(result.success).toBe(true);
      if (result.success) {
        state = result.state;
      }
    }

    // Game should still be playing (or ended normally)
    // Turn counter should have advanced
    expect(state.turn).toBe(actions.length);
  });
});

// --- Monster Ranged Combat Integration Tests ---

// Larger test map for ranged combat (need distance for range testing)
const RANGED_TEST_MAP_ASCII = `
####################
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
####################
`.trim();

/**
 * Create a test state with a goblin_archer and player for ranged combat testing.
 */
function createRangedMonsterTestState(options: {
  archerPos: { x: number; y: number };
  playerPos: { x: number; y: number };
  playerHp?: number;
  archerVisionRadius?: number;
}): GameState {
  const { archerPos, playerPos, playerHp = 20, archerVisionRadius } = options;
  const { tiles, width, height } = parseAsciiMap(RANGED_TEST_MAP_ASCII);
  const map: DungeonMap = {
    width,
    height,
    tiles,
    rooms: [{ x: 1, y: 1, width: width - 2, height: height - 2, center: { x: 10, y: 10 }, tags: ['starting'] }],
    seed: 12345,
  };

  // Create the goblin_archer - automatically equipped with shortbow + quiver (20 arrows)
  let archer = createMonster('goblin_archer', archerPos, { width, height }, {
    areaId: DEFAULT_AREA_ID,
    idSuffix: 'test',
  });

  // Override vision radius if specified (for testing out-of-range scenarios)
  if (archerVisionRadius !== undefined) {
    archer = { ...archer, visionRadius: archerVisionRadius };
  }

  // Create player
  const player: Entity = {
    id: 'player',
    type: 'crawler',
    x: playerPos.x,
    y: playerPos.y,
    areaId: DEFAULT_AREA_ID,
    hp: playerHp,
    maxHp: 20,
    name: 'Player',
    char: '@',
    attack: 5,
    defense: 5,
    speed: 100,
  };

  const bubble = createBubble({
    id: bubbleId('test'),
    entityIds: [entityId('player'), entityId(archer.id)],
    entities: [
      { id: entityId('player'), speed: 100 },
      { id: entityId(archer.id), speed: 100 },
    ],
    center: playerPos,
  });

  return {
    zone: createTestZone(map),
    currentAreaId: DEFAULT_AREA_ID,
    entities: { 'player': player, [archer.id]: archer },
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

describe('Monster ranged combat integration', () => {
  beforeEach(() => {
    clearFOVCache();
    resetMonsterCounter();
    resetLootCounter();
  });

  it('goblin archer shoots when player is in range', () => {
    // Create goblin_archer at (10, 10), player at (10, 6) - 4 tiles away
    // Shortbow has range 6, so this is within range
    const state = createRangedMonsterTestState({
      archerPos: { x: 10, y: 10 },
      playerPos: { x: 10, y: 6 },
    });

    // Queue a 'wait' action for the player so the simulation continues to monster's turn
    const bubble = queueCommand(state.bubbles[0], entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    // Use a fixed RNG for deterministic results
    const rng = ROT.RNG.clone();
    rng.setSeed(99999);

    // Simulate until archer acts
    const result = simulateBubble(bubble, state.entities, {
      maxIterations: 50,
      gameState: { ...state, bubbles: [bubble] },
      combatRng: rng,
    });

    // Archer should have shot at player (either hit or miss message)
    const shootMessages = result.messages.filter(m =>
      m.text.includes('shoots') || m.text.includes('hits')
    );
    expect(shootMessages.length).toBeGreaterThan(0);
  });

  it('goblin archer moves closer when player is out of range', () => {
    // Create goblin_archer at (10, 10), player at (10, 2) - 8 tiles away (beyond range 6)
    // Give archer extended vision (10) so it can see the player and choose to move closer
    const state = createRangedMonsterTestState({
      archerPos: { x: 10, y: 10 },
      playerPos: { x: 10, y: 2 },
      archerVisionRadius: 10, // Need larger vision to see player at distance 8
    });

    const archerId = Object.keys(state.entities).find(id => id.startsWith('goblin_archer'))!;
    const archerBefore = state.entities[archerId];
    expect(archerBefore.y).toBe(10);

    // Queue a 'wait' action for the player so the simulation continues to monster's turn
    const bubble = queueCommand(state.bubbles[0], entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    // Simulate until archer acts
    const result = simulateBubble(bubble, state.entities, {
      maxIterations: 50,
      gameState: { ...state, bubbles: [bubble] },
    });

    // Archer should have moved closer (north, toward player)
    const archerAfter = result.entities[archerId];
    expect(archerAfter).toBeDefined();
    // Archer moved north (y decreased)
    expect(archerAfter.y).toBeLessThan(archerBefore.y);
  });

  it('goblin archer falls back to melee when adjacent', () => {
    // Create goblin_archer at (10, 10), player at (10, 9) - adjacent
    const state = createRangedMonsterTestState({
      archerPos: { x: 10, y: 10 },
      playerPos: { x: 10, y: 9 },
    });

    // Queue a 'wait' action for the player so the simulation continues to monster's turn
    const bubble = queueCommand(state.bubbles[0], entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    // Use a fixed RNG for deterministic results
    const rng = ROT.RNG.clone();
    rng.setSeed(99999);

    // Simulate until archer acts
    const result = simulateBubble(bubble, state.entities, {
      maxIterations: 50,
      gameState: { ...state, bubbles: [bubble] },
      combatRng: rng,
    });

    // Archer should have used melee attack (hits/misses Player, not shoots)
    const meleeMessages = result.messages.filter(m =>
      (m.text.includes('hits Player') || m.text.includes('misses Player')) && !m.text.includes('shoots')
    );
    const shootMessages = result.messages.filter(m =>
      m.text.includes('shoots')
    );

    expect(meleeMessages.length).toBeGreaterThan(0);
    expect(shootMessages.length).toBe(0);
  });

  it('goblin archer consumes ammo when shooting', () => {
    // Create goblin_archer at (10, 10), player at (10, 6) - 4 tiles away
    const state = createRangedMonsterTestState({
      archerPos: { x: 10, y: 10 },
      playerPos: { x: 10, y: 6 },
    });

    const archerId = Object.keys(state.entities).find(id => id.startsWith('goblin_archer'))!;
    const archerBefore = state.entities[archerId];

    // Verify archer starts with 20 arrows
    expect(archerBefore.equippedOffhand?.currentAmmo).toBe(20);

    // Queue a 'wait' action for the player so the simulation continues to monster's turn
    const bubble = queueCommand(state.bubbles[0], entityId('player'), {
      action: 'wait',
      reasoning: 'test',
    }).bubble;

    // Use a fixed RNG for deterministic results
    const rng = ROT.RNG.clone();
    rng.setSeed(99999);

    // Simulate until archer acts
    const result = simulateBubble(bubble, state.entities, {
      maxIterations: 50,
      gameState: { ...state, bubbles: [bubble] },
      combatRng: rng,
    });

    // Verify archer shot (message present)
    const shootMessages = result.messages.filter(m =>
      m.text.includes('shoots') || m.text.includes('hits')
    );
    expect(shootMessages.length).toBeGreaterThan(0);

    // Verify ammo was consumed
    const archerAfter = result.entities[archerId];
    expect(archerAfter.equippedOffhand?.currentAmmo).toBe(19);
  });
});
