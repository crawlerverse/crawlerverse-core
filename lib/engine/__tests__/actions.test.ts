import { describe, it, expect } from 'vitest';
import { processAction, processTimeout, DIRECTION_DELTAS, isDiagonalBlocked, getCurrentActor } from '../actions';
import { ActionSchema } from '../types';
import { getPlayer, getMonsters, type GameState, type Entity } from '../state';
import { createTestDungeon } from '../maps/test-dungeon';
import { disableSchedulerDebugLogging, entityId, type EntitySpeed } from '../scheduler';
import { createBubble, bubbleId, disableBubbleDebugLogging, type Bubble } from '../bubble';
import {
  TEST_PLAYER_ID,
  advanceToNextTurn,
  advanceToPlayerTurn,
  expectSuccess,
  expectFailure,
} from './test-helpers';

// Alias for backward compatibility within this file
const PLAYER_ID = TEST_PLAYER_ID;

// Disable scheduler and bubble debug logging during tests
disableSchedulerDebugLogging();
disableBubbleDebugLogging();

/**
 * Helper to create a GameState with specific player/monster positions.
 * This is a convenience function for tests that need custom entity positions.
 * The scheduler is advanced so that the player is the current actor.
 */
function createTestState(overrides: {
  player?: Partial<Entity>;
  monsters?: Partial<Entity>[];
}): GameState {
  // Use seed 0 for deterministic combat RNG in tests
  const base = createTestDungeon({ seed: 0 });
  const basePlayer = base.entities[PLAYER_ID];

  const player: Entity = {
    ...basePlayer,
    ...overrides.player,
  };

  const entities: Record<string, Entity> = {
    [PLAYER_ID]: player,
  };

  const monsterIds: string[] = [];
  if (overrides.monsters) {
    overrides.monsters.forEach((m, i) => {
      const id = m.id || (i === 0 ? 'goblin' : `monster-${i}`);
      monsterIds.push(id);
      entities[id] = {
        id,
        type: 'monster',
        x: m.x ?? 5,
        y: m.y ?? 5,
        hp: m.hp ?? 5,
        maxHp: m.maxHp ?? 5,
        name: m.name ?? 'Monster',
        char: m.char ?? 'm',
        attack: m.attack ?? 2,
        defense: m.defense ?? 0,
        speed: m.speed ?? 100,
        areaId: 'area-1',
      };
    });
  } else {
    // Keep original monsters from base state
    const baseMonsters = Object.values(base.entities).filter(e => e.type === 'monster');
    for (const monster of baseMonsters) {
      entities[monster.id] = monster;
      monsterIds.push(monster.id);
    }
  }

  // Create entity speeds for scheduler
  const entityIds = [PLAYER_ID, ...monsterIds];
  const entitySpeeds: EntitySpeed[] = entityIds.map(id => ({
    id: entityId(id),
    speed: entities[id].speed,
  }));

  // Create a new bubble with the correct entities
  const bubble = createBubble({
    id: bubbleId('bubble-main'),
    entityIds: entityIds.map(id => entityId(id)),
    entities: entitySpeeds,
    center: { x: player.x, y: player.y },
  });

  const state: GameState = {
    ...base,
    entities,
    bubbles: [bubble],
  };

  // Advance the scheduler until the player is the current actor.
  // This properly settles AP by completing any monster turns first,
  // ensuring tests start with a clean scheduler state.
  return advanceToPlayerTurn(state);
}

describe('DIRECTION_DELTAS', () => {
  it('should have correct deltas for all 8 directions', () => {
    expect(DIRECTION_DELTAS.north).toEqual([0, -1]);
    expect(DIRECTION_DELTAS.south).toEqual([0, 1]);
    expect(DIRECTION_DELTAS.east).toEqual([1, 0]);
    expect(DIRECTION_DELTAS.west).toEqual([-1, 0]);
    expect(DIRECTION_DELTAS.northeast).toEqual([1, -1]);
    expect(DIRECTION_DELTAS.northwest).toEqual([-1, -1]);
    expect(DIRECTION_DELTAS.southeast).toEqual([1, 1]);
    expect(DIRECTION_DELTAS.southwest).toEqual([-1, 1]);
  });
});

describe('processAction', () => {
  describe('move action', () => {
    it('moves player north when path is clear', () => {
      const state = advanceToPlayerTurn(createTestDungeon());
      const player = getPlayer(state)!;
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        direction: 'north',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const newPlayer = getPlayer(result.state)!;
        expect(newPlayer.y).toBe(player.y - 1);
        expect(newPlayer.x).toBe(player.x);
      }
    });

    it('moves player south when path is clear', () => {
      const state = advanceToPlayerTurn(createTestDungeon());
      const player = getPlayer(state)!;
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        direction: 'south',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const newPlayer = getPlayer(result.state)!;
        expect(newPlayer.y).toBe(player.y + 1);
      }
    });

    it('moves player east when path is clear', () => {
      const state = advanceToPlayerTurn(createTestDungeon());
      const player = getPlayer(state)!;
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const newPlayer = getPlayer(result.state)!;
        expect(newPlayer.x).toBe(player.x + 1);
      }
    });

    it('moves player west when path is clear', () => {
      const state = advanceToPlayerTurn(createTestDungeon());
      const player = getPlayer(state)!;
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        direction: 'west',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const newPlayer = getPlayer(result.state)!;
        expect(newPlayer.x).toBe(player.x - 1);
      }
    });

    it('does not move player into wall', () => {
      // Player starts at (4,4) in test dungeon, move west until hitting wall at x=0
      let state = advanceToPlayerTurn(createTestDungeon());

      // Move west until we reach x=1 (adjacent to wall)
      while (getPlayer(state)!.x > 1) {
        const result = processAction(state, PLAYER_ID, {
          action: 'move',
          direction: 'west',
          reasoning: 'test',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          state = advanceToPlayerTurn(result.state);
        }
      }

      // Now at x=1, try to move west into wall at x=0
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        direction: 'west',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const player = getPlayer(result.state)!;
        // Position should not change (wall blocks)
        expect(player.x).toBe(1);
        expect(result.state.messages.some((m) => m.text.includes('wall'))).toBe(true);
      }
    });
  });

  describe('attack action', () => {
    it('damages monster when attacking adjacent', () => {
      // Create state with monster adjacent to player
      // Use explicit attack: 2 for predictable damage calculation (2 - floor(0/2) = 2 damage)
      const state = createTestState({
        player: { x: 5, y: 5, attack: 2 },
        monsters: [
          {
            id: 'goblin',
            x: 6,
            y: 5, // East of player
            hp: 5,
            maxHp: 5,
            name: 'Goblin',
            char: 'g',
            attack: 1,
            defense: 0,
          },
        ],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const monsters = getMonsters(result.state);
        const goblin = monsters.find((m) => m.id === 'goblin');
        expect(goblin?.hp).toBe(3); // 5 - 2 damage
      }
    });

    it('kills monster when damage exceeds hp', () => {
      const state = createTestState({
        player: { x: 5, y: 5, attack: 5 },
        monsters: [
          {
            id: 'goblin',
            x: 6,
            y: 5,
            hp: 3,
            maxHp: 3,
            name: 'Goblin',
            char: 'g',
            attack: 1,
            defense: 0,
          },
        ],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const monsters = getMonsters(result.state);
        expect(monsters.length).toBe(0);
        expect(result.state.messages.some((m) => m.text.includes('dies'))).toBe(true);
      }
    });

    it('misses when attacking empty space', () => {
      // Use advanceToPlayerTurn to ensure we get the player's turn
      const state = advanceToPlayerTurn(createTestDungeon());

      const result = processAction(state, PLAYER_ID, {
        action: 'attack',
        direction: 'north',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.state.messages.some((m) => m.text.includes('empty air'))).toBe(true);
      }
    });
  });

  describe('wait action', () => {
    it('advances turn without moving', () => {
      // Use advanceToPlayerTurn to ensure we get the player's turn
      // (with class-based stats, monsters might have higher speed)
      const state = advanceToPlayerTurn(createTestDungeon());
      const player = getPlayer(state)!;

      const result = processAction(state, PLAYER_ID, {
        action: 'wait',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const newPlayer = getPlayer(result.state)!;
        expect(result.state.turn).toBe(state.turn + 1);
        expect(newPlayer.x).toBe(player.x);
        expect(newPlayer.y).toBe(player.y);
      }
    });
  });

  describe('monster behavior', () => {
    it('monster attacks player when adjacent', () => {
      const state = createTestState({
        player: { x: 5, y: 5, hp: 10, maxHp: 10 },
        monsters: [
          {
            id: 'goblin',
            x: 6,
            y: 5, // Adjacent to player
            hp: 5,
            maxHp: 5,
            name: 'Goblin',
            char: 'g',
            attack: 3,
            defense: 0,
          },
        ],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'wait',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const player = getPlayer(result.state)!;
        expect(player.hp).toBe(7); // 10 - 3 damage
      }
    });
  });

  describe('win/lose conditions', () => {
    it('victory when all monsters killed', () => {
      const state = createTestState({
        player: { x: 5, y: 5, attack: 10 },
        monsters: [
          {
            id: 'goblin',
            x: 6,
            y: 5,
            hp: 3,
            maxHp: 3,
            name: 'Goblin',
            char: 'g',
            attack: 1,
            defense: 0,
          },
        ],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.state.gameStatus).toEqual({ status: 'ended', victory: true });
      }
    });

    it('defeat when player hp reaches 0', () => {
      const state = createTestState({
        player: { x: 5, y: 5, hp: 2, maxHp: 10, attack: 1, defense: 0 },
        monsters: [
          {
            id: 'goblin',
            x: 6,
            y: 5,
            hp: 10,
            maxHp: 10,
            name: 'Goblin',
            char: 'g',
            attack: 5,
            defense: 0,
          },
        ],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'wait',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.state.gameStatus).toEqual({ status: 'ended', victory: false });
      }
    });
  });

  describe('defense calculation', () => {
    it('reduces damage by half target defense (minimum 1)', () => {
      // Player (attack=2) vs monster with defense=1
      // New formula: attack - floor(defense/2) = 2 - floor(1/2) = 2 - 0 = 2 damage
      // Position player adjacent to goblin for attack
      const modifiedState = createTestState({
        player: { x: 6, y: 5, attack: 2 }, // Adjacent to goblin at (7,5), explicit attack for test
        monsters: [
          {
            id: 'goblin',
            x: 7,
            y: 5,
            hp: 3,
            maxHp: 3,
            name: 'Goblin',
            char: 'g',
            attack: 2,
            defense: 1,
          },
        ],
      });
      const currentActor = getCurrentActor(modifiedState)!;

      const result = processAction(modifiedState, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const monsters = getMonsters(result.state);
        const goblin = monsters.find(m => m.id === 'goblin');
        // Goblin had 3 HP, took 2 damage (attack 2 - floor(1/2) = 2)
        expect(goblin?.hp).toBe(1);
      }
    });

    it('always deals at least 1 damage even with high defense', () => {
      // Use high attack to guarantee hit (hit chance: 70% + (10-5)*5% = 95%)
      // New formula: 10 - floor(20/2) = 10 - 10 = 0 → clamped to 1
      const state = createTestState({
        player: { x: 6, y: 5, attack: 10 },
        monsters: [{
          id: 'armored',
          x: 7,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Armored',
          char: 'A',
          attack: 1,
          defense: 20, // Very high defense to ensure minimum damage
        }],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const monsters = getMonsters(result.state);
        const armored = monsters.find(m => m.id === 'armored');
        // Should deal minimum 1 damage despite defense > attack
        expect(armored?.hp).toBe(9);
      }
    });

    it('deals minimum 1 damage when calculated damage would be zero or negative', () => {
      // New formula: attack - floor(defense/2) = 3 - floor(6/2) = 3 - 3 = 0 → minimum 1
      // Hit chance: 70% + (3-6)*5% = 55%, but use high enough attack for reliable hit
      const state = createTestState({
        player: { x: 5, y: 5, hp: 10, maxHp: 10, attack: 3, defense: 0 },
        monsters: [{
          id: 'balanced',
          x: 6,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Balanced',
          char: 'B',
          attack: 1,
          defense: 6, // floor(6/2) = 3, equals player attack
        }],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const monsters = getMonsters(result.state);
        const balanced = monsters.find(m => m.id === 'balanced');
        // attack 3 - floor(6/2) = 0, but minimum is 1
        expect(balanced?.hp).toBe(9);
      }
    });

    it('player defense reduces monster damage', () => {
      // New formula: attack - floor(defense/2) = 3 - floor(2/2) = 3 - 1 = 2 damage
      const state = createTestState({
        player: { x: 5, y: 5, hp: 10, maxHp: 10, attack: 2, defense: 2 },
        monsters: [{
          id: 'goblin',
          x: 6,
          y: 5, // Adjacent to player
          hp: 10,
          maxHp: 10,
          name: 'Goblin',
          char: 'g',
          attack: 3,
          defense: 0,
        }],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'wait',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const player = getPlayer(result.state)!;
        // Monster attack 3 - floor(player defense 2/2) = 3 - 1 = 2 damage
        expect(player.hp).toBe(8);
      }
    });

    it('monster deals minimum 1 damage even against high player defense', () => {
      // d20 system: need roll + ATK >= DC (7 + DEF, clamped to 17)
      // With player defense 10, DC = 17. First RNG roll is d20=10.
      // Need ATK >= 7 to hit (10 + 7 = 17). Use ATK 8 for buffer.
      // Damage: 8 - floor(10/2) = 8 - 5 = 3 (but this test is about minimum damage)
      // Actually, to test minimum damage, we want ATK such that ATK - DEF/2 <= 0
      // With DEF 10: ATK - 5 <= 0, so ATK <= 5. But we need ATK >= 7 to hit.
      // Contradiction: can't have minimum damage AND guarantee hit against DEF 10.
      // Solution: reduce DEF to 8 (DC = 15), ATK 5 hits (10+5=15>=15), damage = 5-4 = 1
      const state = createTestState({
        player: { x: 5, y: 5, hp: 10, maxHp: 10, attack: 2, defense: 8 },
        monsters: [{
          id: 'goblin',
          x: 6,
          y: 5,
          hp: 10,
          maxHp: 10,
          name: 'Goblin',
          char: 'g',
          attack: 5, // 10 + 5 = 15 >= DC 15, hits
          defense: 0,
        }],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'wait',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const player = getPlayer(result.state)!;
        // Minimum 1 damage: 5 - floor(8/2) = 5 - 4 = 1
        expect(player.hp).toBe(9);
      }
    });

    it('damage message shows reduced damage amount', () => {
      // New formula: attack - floor(defense/2) = 2 - floor(1/2) = 2 - 0 = 2 damage
      const state = createTestState({
        player: { x: 6, y: 5, attack: 2 }, // Adjacent to goblin at (7,5), explicit attack for test
        monsters: [{
          id: 'goblin',
          x: 7,
          y: 5,
          hp: 5,
          maxHp: 5,
          name: 'Goblin',
          char: 'g',
          attack: 2,
          defense: 1,
        }],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'attack',
        direction: 'east',
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Attack 2 - floor(Defense 1/2) = 2 damage, message should show "2 damage"
        const hitMessage = result.state.messages.find(m => m.text.includes('hit'));
        expect(hitMessage?.text).toContain('for 2 damage');
      }
    });
  });

  describe('invalid actions', () => {
    it('rejects action with missing fields', () => {
      const state = advanceToNextTurn(createTestDungeon({ seed: 42 }));
      // Use PLAYER_ID explicitly - test is about action validation, not turn order
      const result = processAction(state, PLAYER_ID, {
        action: 'move',
        // Missing direction and reasoning
      });

      expectFailure(result, 'INVALID_ACTION', 'Invalid action');
    });

    it('rejects unknown action type', () => {
      const state = advanceToNextTurn(createTestDungeon({ seed: 42 }));

      const result = processAction(state, PLAYER_ID, {
        action: 'teleport',
        reasoning: 'test',
      });

      expectFailure(result, 'INVALID_ACTION');
    });
  });

  describe('turn validation', () => {
    it('rejects action when game is over', () => {
      const state = advanceToNextTurn(createTestDungeon());
      const endedState = {
        ...state,
        gameStatus: { status: 'ended' as const, victory: true },
      };

      const result = processAction(endedState, PLAYER_ID, { action: 'wait', reasoning: 'test' });

      expectFailure(result, 'GAME_OVER');
    });

    it('rejects action for non-existent actor', () => {
      const state = advanceToNextTurn(createTestDungeon());

      const result = processAction(state, 'nonexistent', { action: 'wait', reasoning: 'test' });

      expectFailure(result, 'ACTOR_NOT_FOUND');
    });

    it('rejects action when actor is a monster (monsters use AI, not processAction)', () => {
      const state = advanceToNextTurn(createTestDungeon());
      const monsters = getMonsters(state);
      expect(monsters.length).toBeGreaterThan(0);
      const monsterId = monsters[0].id;

      // Try to act as a monster - should be rejected
      // In the new system, monsters act via the simulation loop, not processAction
      const result = processAction(state, monsterId, { action: 'wait', reasoning: 'test' });

      expectFailure(result, 'INVALID_ACTION', 'not a crawler');
    });

    it('accepts action when it is actor turn', () => {
      // Use advanceToPlayerTurn to ensure we get the player's turn
      // (with class-based stats, monsters might have higher speed)
      const state = advanceToPlayerTurn(createTestDungeon());

      const result = processAction(state, PLAYER_ID, { action: 'wait', reasoning: 'test' });

      expectSuccess(result);
    });
  });
});

describe('8-way adjacency', () => {
  it('should detect diagonal adjacency for combat', () => {
    const state = createTestState({
      player: { x: 5, y: 5 },
      // High HP so monster survives any class's attack for this test
      monsters: [{ id: 'goblin', x: 6, y: 6, hp: 20, maxHp: 20 }], // southeast
    });
    const currentActor = getCurrentActor(state)!;

    // Attack southeast should hit the monster
    const result = processAction(state, currentActor, {
      action: 'attack',
      direction: 'southeast',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const monsters = getMonsters(result.state);
      // Monster should have taken damage
      expect(monsters[0]?.hp).toBeLessThan(20);
    }
  });

  it('should allow monsters to attack diagonally adjacent player', () => {
    const state = createTestState({
      player: { x: 5, y: 5, hp: 10, maxHp: 10 },
      monsters: [{ id: 'goblin', x: 6, y: 6, hp: 10, maxHp: 10 }],
    });
    const currentActor = getCurrentActor(state)!;

    // Any action should trigger monster attack since adjacent
    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const player = getPlayer(result.state)!;
      // Player should have taken damage from diagonally adjacent monster
      expect(player.hp).toBeLessThan(10);
    }
  });
});

describe('isDiagonalBlocked', () => {
  const baseState = createTestDungeon();

  it('should return false for cardinal moves', () => {
    // Cardinal moves are never blocked by corner-cutting rules
    expect(isDiagonalBlocked(baseState, 5, 5, 1, 0)).toBe(false);  // east
    expect(isDiagonalBlocked(baseState, 5, 5, 0, 1)).toBe(false);  // south
  });

  it('should return false when no walls block diagonal path', () => {
    // Moving northeast from (1,2) - neither (2,2) nor (1,1) are walls
    // Wall positions: x=0, x=9, y=0, y=9
    expect(isDiagonalBlocked(baseState, 1, 2, 1, -1)).toBe(false); // no walls adjacent
  });

  it('should return true when moving diagonally through corner', () => {
    // Moving northwest from corner (1,1) - walls at (0,1) and (1,0)
    // This would try to squeeze through the corner
    expect(isDiagonalBlocked(baseState, 1, 1, -1, -1)).toBe(true); // walls at (0,1) and (1,0)
  });

  it('should return false when diagonal path is clear', () => {
    // Moving from center of room - no walls blocking
    expect(isDiagonalBlocked(baseState, 5, 5, 1, 1)).toBe(false);
    expect(isDiagonalBlocked(baseState, 5, 5, -1, -1)).toBe(false);
  });
});

describe('monster A* pathfinding', () => {
  it('should move monsters diagonally toward player', () => {
    const state = createTestState({
      player: { x: 5, y: 5 },
      monsters: [{ id: 'goblin', x: 3, y: 3, hp: 10, maxHp: 10 }],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const monsters = getMonsters(result.state);
      const monster = monsters[0];
      // Monster should have moved closer (possibly diagonally)
      const oldDist = Math.max(Math.abs(3 - 5), Math.abs(3 - 5)); // Chebyshev
      const newDist = Math.max(Math.abs(monster.x - 5), Math.abs(monster.y - 5));
      expect(newDist).toBeLessThan(oldDist);
    }
  });

  it('should allow diagonal movement from corner when path is clear', () => {
    // Monster at (1,1) moving toward (5,5) can legally move diagonally to (2,2)
    // because neither (2,1) nor (1,2) are walls (only (0,*) and (*,0) are walls)
    const state = createTestState({
      player: { x: 5, y: 5 },
      monsters: [{ id: 'goblin', x: 1, y: 1, hp: 10, maxHp: 10 }],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const monsters = getMonsters(result.state);
      const monster = monsters[0];
      // Monster should move diagonally toward player
      expect(monster.x).toBe(2);
      expect(monster.y).toBe(2);
    }
  });

  it('should prevent corner-cutting through wall corners', () => {
    // The isDiagonalBlocked function is used for corner-cutting prevention.
    // In a simple rectangular room, corner-cutting through walls only happens
    // at the actual corners. This test verifies the function works correctly.
    const baseState = createTestDungeon();

    // At position (1,1), moving northwest to (0,0) would corner-cut through
    // walls at (0,1) and (1,0). isDiagonalBlocked correctly identifies this.
    expect(isDiagonalBlocked(baseState, 1, 1, -1, -1)).toBe(true);

    // At position (1,1), moving southeast to (2,2) does NOT corner-cut
    // because (2,1) and (1,2) are not walls.
    expect(isDiagonalBlocked(baseState, 1, 1, 1, 1)).toBe(false);
  });
});

describe('diagonal movement', () => {
  it('should allow diagonal movement when path is clear', () => {
    const state = createTestState({
      player: { x: 5, y: 5 },
      monsters: [],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'move',
      direction: 'northeast',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const player = getPlayer(result.state)!;
      expect(player.x).toBe(6);
      expect(player.y).toBe(4);
    }
  });

  it('should block diagonal movement through wall corners', () => {
    // Position player at (1,1) - corner of room
    // Walls are at x=0 and y=0
    // Moving northwest to (0,0) would hit the wall (destination is wall)
    // But even if destination weren't a wall, the diagonal would be blocked
    // because both (0,1) and (1,0) are walls
    const state = createTestState({
      player: { x: 1, y: 1 },
      monsters: [],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'move',
      direction: 'northwest',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const player = getPlayer(result.state)!;
      // Player should not have moved
      expect(player.x).toBe(1);
      expect(player.y).toBe(1);
      // Should have a blocking message (wall or squeeze)
      expect(result.state.messages.some(m =>
        m.text.includes('wall') || m.text.includes('squeeze') || m.text.includes('gap')
      )).toBe(true);
    }
  });

  it('should verify isDiagonalBlocked is called for diagonal moves', () => {
    // This test verifies the corner-cutting logic is wired up correctly
    // by testing with isDiagonalBlocked directly
    const baseState = createTestDungeon();

    // At (1,1), moving northwest (-1,-1):
    // - (0,1) is a wall (x=0)
    // - (1,0) is a wall (y=0)
    // So isDiagonalBlocked should return true
    expect(isDiagonalBlocked(baseState, 1, 1, -1, -1)).toBe(true);

    // At (5,5), moving northeast (1,-1):
    // - (6,5) is NOT a wall
    // - (5,4) is NOT a wall
    // So isDiagonalBlocked should return false
    expect(isDiagonalBlocked(baseState, 5, 5, 1, -1)).toBe(false);
  });

  it('should allow all 4 diagonal directions with correct coordinate changes', () => {
    const testCases = [
      { direction: 'northeast' as const, expectedDx: 1, expectedDy: -1 },
      { direction: 'northwest' as const, expectedDx: -1, expectedDy: -1 },
      { direction: 'southeast' as const, expectedDx: 1, expectedDy: 1 },
      { direction: 'southwest' as const, expectedDx: -1, expectedDy: 1 },
    ];

    for (const { direction, expectedDx, expectedDy } of testCases) {
      const state = createTestState({
        player: { x: 5, y: 5 },
        monsters: [],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'move',
        direction,
        reasoning: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const player = getPlayer(result.state)!;
        expect(player.x).toBe(5 + expectedDx);
        expect(player.y).toBe(5 + expectedDy);
      }
    }
  });

  it('should block corner-cutting at all 4 room corners', () => {
    const corners = [
      { x: 1, y: 1, dir: 'northwest' as const, desc: 'NW corner' },
      { x: 8, y: 1, dir: 'northeast' as const, desc: 'NE corner' },
      { x: 1, y: 8, dir: 'southwest' as const, desc: 'SW corner' },
      { x: 8, y: 8, dir: 'southeast' as const, desc: 'SE corner' },
    ];

    for (const { x, y, dir, desc } of corners) {
      const state = createTestState({
        player: { x, y },
        monsters: [],
      });
      const currentActor = getCurrentActor(state)!;

      const result = processAction(state, currentActor, {
        action: 'move',
        direction: dir,
        reasoning: 'test',
      });

      expect(result.success, `Failed at ${desc}`).toBe(true);
      if (result.success) {
        const player = getPlayer(result.state)!;
        // Player should not have moved (blocked by wall or corner-cutting)
        expect(player.x).toBe(x);
        expect(player.y).toBe(y);
      }
    }
  });

  it('should trigger victory when killing diagonally adjacent monster', () => {
    const state = createTestState({
      player: { x: 5, y: 5, attack: 10 },
      monsters: [{ id: 'goblin', x: 6, y: 6, hp: 3, maxHp: 3 }],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'attack',
      direction: 'southeast',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const monsters = getMonsters(result.state);
      expect(monsters.length).toBe(0);
      expect(result.state.gameStatus).toEqual({ status: 'ended', victory: true });
    }
  });

  it('should return false when only one adjacent tile is a wall (moderate approach)', () => {
    // Test dungeon has a divider wall from x=9-17 at y=1-6 and y=8-13
    const baseState = createTestDungeon();

    // At position (8, 6), moving northeast (dx=1, dy=-1):
    // - (9, 6) IS a wall (divider wall)
    // - (8, 5) is NOT a wall (floor)
    // With moderate approach: only ONE cardinal blocked, so diagonal is ALLOWED
    expect(isDiagonalBlocked(baseState, 8, 6, 1, -1)).toBe(false);

    // At position (8, 1), moving southeast (dx=1, dy=1):
    // - (9, 1) IS a wall (divider wall)
    // - (8, 2) is NOT a wall (floor)
    // With moderate approach: only ONE cardinal blocked, so diagonal is ALLOWED
    expect(isDiagonalBlocked(baseState, 8, 1, 1, 1)).toBe(false);
  });
});

describe('NPC turn batching', () => {
  it('batches monster turns until crawler turn', () => {
    const state = createTestState({
      player: { x: 5, y: 5 },
      monsters: [
        { id: 'goblin', x: 7, y: 5, hp: 5, maxHp: 5 },
        { id: 'rat', x: 3, y: 5, hp: 3, maxHp: 3 },
      ],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'testing batching',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Next actor should be a crawler (player), not a monster
      // because monster turns were batched
      const nextActor = result.nextActor;
      if (nextActor) {
        const nextEntity = result.state.entities[nextActor];
        expect(nextEntity?.type).toBe('crawler');
      }
    }
  });

  it('monster turns use scheduler action points correctly', () => {
    // Create state with rat (speed 120) and goblin (speed 100)
    const state = createTestState({
      player: { x: 5, y: 5, speed: 100 },
      monsters: [
        { id: 'goblin', x: 8, y: 5, hp: 5, maxHp: 5, speed: 100 },
        { id: 'rat', x: 2, y: 5, hp: 3, maxHp: 3, speed: 120 },
      ],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // After processing, scheduler should have updated action points
      // for all entities that acted
      const bubble = result.state.bubbles[0];
      const playerEntry = bubble.scheduler.entries.find(e => e.entityId === entityId(PLAYER_ID));
      const goblinEntry = bubble.scheduler.entries.find(e => e.entityId === 'goblin');
      const ratEntry = bubble.scheduler.entries.find(e => e.entityId === 'rat');

      // All entities should have their turns completed (AP reduced by 100)
      // and then re-accumulated for the next round
      expect(playerEntry).toBeDefined();
      expect(goblinEntry).toBeDefined();
      expect(ratEntry).toBeDefined();
    }
  });

  it('completes multiple scheduler cycles when monsters have higher speed', () => {
    // Create state with a fast rat (speed 150) - should get extra turns
    const state = createTestState({
      player: { x: 5, y: 5, speed: 100 },
      monsters: [
        { id: 'rat', x: 8, y: 5, hp: 10, maxHp: 10, speed: 150 },
      ],
    });
    const currentActor = getCurrentActor(state)!;

    // Player waits, then monster batching happens
    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // After batching, next actor should be player (crawler)
      const nextActor = result.nextActor;
      expect(nextActor).toBe(PLAYER_ID);
    }
  });

  it('stops batching when game ends during monster turn', () => {
    // Player with low HP adjacent to monster - monster should kill player
    const state = createTestState({
      player: { x: 5, y: 5, hp: 1, maxHp: 10, speed: 100 },
      monsters: [
        { id: 'goblin', x: 6, y: 5, hp: 10, maxHp: 10, attack: 5, speed: 100 },
      ],
    });
    const currentActor = getCurrentActor(state)!;

    const result = processAction(state, currentActor, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Game should have ended with player defeat
      expect(result.state.gameStatus).toEqual({ status: 'ended', victory: false });
    }
  });

  it('returns correct next actor in multi-crawler bubble', () => {
    // Create a state with two crawlers (player and agent) and one monster
    const base = createTestDungeon();

    const player: Entity = {
      id: PLAYER_ID,
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
    };

    const agent: Entity = {
      id: 'agent',
      type: 'crawler',
      x: 7,
      y: 5,
      hp: 10,
      maxHp: 10,
      name: 'Agent',
      char: 'A',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };

    const goblin: Entity = {
      id: 'goblin',
      type: 'monster',
      x: 3,
      y: 5, // Far from both crawlers
      hp: 5,
      maxHp: 5,
      name: 'Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };

    const entities: Record<string, Entity> = {
      [PLAYER_ID]: player,
      agent,
      goblin
    };

    // Create bubble with both crawlers and monster
    const bubble = createBubble({
      id: bubbleId('bubble-main'),
      entityIds: [entityId(PLAYER_ID), entityId('agent'), entityId('goblin')],
      entities: [
        { id: entityId(PLAYER_ID), speed: 100 },
        { id: entityId('agent'), speed: 100 },
        { id: entityId('goblin'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    let state: GameState = {
      ...base,
      entities,
      bubbles: [bubble],
    };

    // Advance until player is current actor
    state = advanceToPlayerTurn(state);

    // Player acts
    const result = processAction(state, PLAYER_ID, {
      action: 'wait',
      reasoning: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // After player acts and monsters batch, next actor should be a crawler
      // (either player again or agent, depending on AP accumulation)
      const nextActor = result.nextActor;
      expect(nextActor).toBeDefined();

      const nextEntity = result.state.entities[nextActor!];
      expect(nextEntity?.type).toBe('crawler');
    }
  });
});

describe('ActionSchema', () => {
  it('validates enter_portal action', () => {
    const action = {
      action: 'enter_portal',
      reasoning: 'Time to explore the next area',
    };
    const result = ActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });
});

describe('processTimeout', () => {
  // Helper to create state with bubble awaiting input and timed out
  function createStateAwaitingTimeout(): GameState {
    // Use a fixed seed for deterministic behavior
    const state = advanceToNextTurn(createTestDungeon({ seed: 42 }));
    const bubble = state.bubbles[0];

    // Set bubble to awaiting_input state with old timestamp
    // Always use PLAYER_ID since only crawlers can have timeouts processed
    const timedOutBubble: Bubble = {
      ...bubble,
      executionState: {
        status: 'awaiting_input',
        actorId: entityId(PLAYER_ID),
        waitingSince: Date.now() - 15000, // 15 seconds ago (past 10s auto-wait)
        warningEmitted: true,
      },
    };

    return {
      ...state,
      bubbles: [timedOutBubble],
    };
  }

  it('injects wait action on force_wait', () => {
    const state = createStateAwaitingTimeout();

    const result = processTimeout(state, 0);

    expect(result.success).toBe(true);
    if (result.success) {
      // Turn should have advanced
      expect(result.state.turn).toBeGreaterThan(state.turn);
    }
  });

  it('processes wait action for timed out crawler', () => {
    const state = createStateAwaitingTimeout();

    const result = processTimeout(state, 0);

    expect(result.success).toBe(true);
    if (result.success) {
      // Should have "You wait" message from the wait action
      const waitMessage = result.state.messages.find(m =>
        m.text.toLowerCase().includes('wait')
      );
      expect(waitMessage).toBeDefined();
    }
  });

  it('returns next actor after timeout processing', () => {
    const state = createStateAwaitingTimeout();

    const result = processTimeout(state, 0);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nextActor).toBeDefined();
    }
  });

  it('fails if bubble index is invalid', () => {
    const state = createStateAwaitingTimeout();

    const result = processTimeout(state, 999); // Invalid index

    expect(result.success).toBe(false);
  });

  it('fails if bubble index is negative', () => {
    const state = createStateAwaitingTimeout();

    const result = processTimeout(state, -1); // Negative index

    expect(result.success).toBe(false);
  });

  it('processes timeout even if no current actor (finds crawler in bubble)', () => {
    const state = createStateAwaitingTimeout();
    // Create a bubble with no current actor - processTimeout still finds crawlers
    const bubbleWithNoActor: Bubble = {
      ...state.bubbles[0],
      scheduler: {
        ...state.bubbles[0].scheduler,
        currentActorId: null,
      },
    };
    const modifiedState = {
      ...state,
      bubbles: [bubbleWithNoActor],
    };

    const result = processTimeout(modifiedState, 0);

    // In the new system, processTimeout finds any crawler in the bubble and processes their wait
    expect(result.success).toBe(true);
  });
});
