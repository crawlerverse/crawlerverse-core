import { describe, it, expect, beforeEach } from 'vitest';
import { simulateBubble } from '../simulation';
import { createBubble, bubbleId, queueCommand, type Bubble } from '../bubble';
import { entityId, type EntityId } from '../scheduler';
import { DEFAULT_AREA_ID, type Entity, type Action, type GameState } from '../state';
import { parseAsciiMap, type DungeonMap } from '../map';
import { createTestZone } from './test-helpers';
import { clearFOVCache } from '../fov';
import { applyEffect, resetEffectIdCounter, type ActiveEffect } from '../effects';

// Simple test map for effects integration tests
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

describe('effects integration in simulation loop', () => {
  beforeEach(() => {
    clearFOVCache();
    resetEffectIdCounter();
  });

  describe('stunned entity skips turn', () => {
    it('stunned crawler skips turn and stun duration decrements', () => {
      // Create a stunned crawler with long stun so it doesn't wear off during simulation
      let player: Entity = {
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
        areaId: DEFAULT_AREA_ID,
      };

      // Apply stun effect with long duration (10 turns) so it persists through simulation
      player = applyEffect(player, 'stunned', { label: 'test stun' }, 10);

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a move action - should be ignored because of stun
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'move',
        direction: 'north',
        reasoning: 'test move',
      }).bubble;

      const entities: Record<string, Entity> = { player };
      const gameState = createTestGameState(entities, bubble);

      // Use limited iterations — just enough for 1 stun turn + time advance
      const result = simulateBubble(bubble, entities, { maxIterations: 3, gameState });

      // Player should NOT have moved (stun skips their turn)
      const playerAfter = result.entities['player'];
      expect(playerAfter).toBeDefined();
      expect(playerAfter.x).toBe(5);
      expect(playerAfter.y).toBe(5);

      // Stun duration should have decremented (from 10 to 9)
      const stunEffect = (playerAfter.activeEffects ?? []).find(
        (e: ActiveEffect) => e.name === 'Stunned'
      );
      expect(stunEffect).toBeDefined();
      expect(stunEffect!.duration).toBe(9);
    });

    it('stunned monster skips turn and does not attack', () => {
      const player: Entity = {
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
        areaId: DEFAULT_AREA_ID,
      };

      let rat: Entity = {
        id: 'rat',
        type: 'monster',
        x: 3,
        y: 2, // Adjacent to player
        hp: 5,
        maxHp: 5,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 120, // Faster - acts first
        areaId: DEFAULT_AREA_ID,
      };

      // Stun the rat with long duration so it doesn't wear off
      rat = applyEffect(rat, 'stunned', { label: 'test stun' }, 10);

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player'), entityId('rat')],
        entities: [
          { id: entityId('player'), speed: 100 },
          { id: entityId('rat'), speed: 120 },
        ],
        center: { x: 2, y: 2 },
      });

      // Queue a wait action for the player
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'waiting',
      }).bubble;

      const entities: Record<string, Entity> = { player, rat };
      const gameState = createTestGameState(entities, bubble);

      const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

      // Rat was stunned so should NOT have attacked — player should be at full HP
      const playerAfter = result.entities['player'];
      expect(playerAfter).toBeDefined();
      expect(playerAfter.hp).toBe(10);

      // Rat's stun should have decremented
      const ratAfter = result.entities['rat'];
      expect(ratAfter).toBeDefined();
      const stunEffect = (ratAfter.activeEffects ?? []).find(
        (e: ActiveEffect) => e.name === 'Stunned'
      );
      expect(stunEffect).toBeDefined();
      // Duration decremented from 10 (rat acts multiple times due to speed 120)
      expect(stunEffect!.duration).toBeLessThan(10);
    });
  });

  describe('poisoned entity takes DoT after action', () => {
    it('poisoned crawler takes damage after action', () => {
      let player: Entity = {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        name: 'Player',
        char: '@',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: DEFAULT_AREA_ID,
      };

      // Apply poison (3 damage per tick, duration 5)
      player = applyEffect(player, 'poisoned', { label: 'spider bite' });

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a wait action (simple action to trigger post-action tick)
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'test',
      }).bubble;

      const entities: Record<string, Entity> = { player };
      const gameState = createTestGameState(entities, bubble);

      const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

      // Player should have taken 3 poison damage (20 -> 17)
      const playerAfter = result.entities['player'];
      expect(playerAfter).toBeDefined();
      expect(playerAfter.hp).toBe(17);

      // Should have a poison damage message
      const poisonMsg = result.messages.find(m => m.text.includes('Poisoned damage'));
      expect(poisonMsg).toBeDefined();

      // Poison duration should have decremented (5 -> 4)
      const poisonEffect = (playerAfter.activeEffects ?? []).find(
        (e: ActiveEffect) => e.name === 'Poisoned'
      );
      expect(poisonEffect).toBeDefined();
      expect(poisonEffect!.duration).toBe(4);
    });

    it('poisoned monster takes damage after action', () => {
      const player: Entity = {
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
        areaId: DEFAULT_AREA_ID,
      };

      let rat: Entity = {
        id: 'rat',
        type: 'monster',
        x: 7,
        y: 7,
        hp: 20,
        maxHp: 20,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 100, // Same speed as player for predictable turn order
        areaId: DEFAULT_AREA_ID,
      };

      // Poison the rat
      rat = applyEffect(rat, 'poisoned', { entityId: 'player', label: 'venom strike' });

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player'), entityId('rat')],
        entities: [
          { id: entityId('player'), speed: 100 },
          { id: entityId('rat'), speed: 100 },
        ],
        center: { x: 5, y: 5 },
      });

      // Queue a wait action for the player
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'waiting',
      }).bubble;

      const entities: Record<string, Entity> = { player, rat };
      const gameState = createTestGameState(entities, bubble);

      const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

      // Rat should have taken poison damage (at least 3 HP lost from 1 tick)
      const ratAfter = result.entities['rat'];
      expect(ratAfter).toBeDefined();
      expect(ratAfter.hp).toBeLessThan(20);
      expect(ratAfter.hp).toBeLessThanOrEqual(17); // At least 1 tick of 3 damage

      // Should have a poison damage message for the rat
      const poisonMsg = result.messages.find(m =>
        m.text.includes('Rat') && m.text.includes('Poisoned damage')
      );
      expect(poisonMsg).toBeDefined();
    });
  });

  describe('dead source cleanup', () => {
    it('removes feared effect when source entity no longer exists', () => {
      let player: Entity = {
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
        areaId: DEFAULT_AREA_ID,
      };

      // Apply feared effect from a monster that doesn't exist in the bubble
      player = applyEffect(player, 'feared', {
        entityId: 'dead-monster',
        label: 'terrifying presence',
      });

      // Verify player has the feared effect before simulation
      expect((player.activeEffects ?? []).length).toBe(1);
      expect((player.activeEffects ?? [])[0].name).toBe('Feared');

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a wait action
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'test',
      }).bubble;

      // 'dead-monster' is NOT in entities — it's dead/removed
      const entities: Record<string, Entity> = { player };
      const gameState = createTestGameState(entities, bubble);

      const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

      // Player should have feared effect removed (source is dead)
      const playerAfter = result.entities['player'];
      expect(playerAfter).toBeDefined();
      const fearedEffect = (playerAfter.activeEffects ?? []).find(
        (e: ActiveEffect) => e.name === 'Feared'
      );
      expect(fearedEffect).toBeUndefined();
    });
  });

  describe('death from DoT', () => {
    it('crawler dies from poison damage after action', () => {
      let player: Entity = {
        id: 'player',
        type: 'crawler',
        x: 5,
        y: 5,
        hp: 2, // Very low HP
        maxHp: 10,
        name: 'Player',
        char: '@',
        attack: 2,
        defense: 0,
        speed: 100,
        areaId: DEFAULT_AREA_ID,
      };

      // Apply poison (3 damage per tick — will kill player at 2 HP)
      player = applyEffect(player, 'poisoned', { label: 'deadly venom' });

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 5, y: 5 },
      });

      // Queue a wait action to trigger the post-action tick
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'test',
      }).bubble;

      const entities: Record<string, Entity> = { player };
      const gameState = createTestGameState(entities, bubble);

      const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

      // Player should be dead — removed from entities
      expect(result.entities['player']).toBeUndefined();

      // Game should be over (no crawlers alive)
      expect(result.gameStatus.status).toBe('ended');
      if (result.gameStatus.status === 'ended') {
        expect(result.gameStatus.victory).toBe(false);
      }

      // Should have death message
      const deathMsg = result.messages.find(m => m.text.includes('succumbed'));
      expect(deathMsg).toBeDefined();
    });

    it('monster dies from poison during stunned turn', () => {
      const player: Entity = {
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
        areaId: DEFAULT_AREA_ID,
      };

      let rat: Entity = {
        id: 'rat',
        type: 'monster',
        x: 7,
        y: 7,
        hp: 2, // Very low HP
        maxHp: 10,
        name: 'Rat',
        char: 'r',
        attack: 2,
        defense: 0,
        speed: 120, // Acts first
        areaId: DEFAULT_AREA_ID,
      };

      // Both stunned and poisoned — poison ticks during stun skip
      rat = applyEffect(rat, 'stunned', { label: 'concussion' });
      rat = applyEffect(rat, 'poisoned', { entityId: 'player', label: 'venom' });

      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player'), entityId('rat')],
        entities: [
          { id: entityId('player'), speed: 100 },
          { id: entityId('rat'), speed: 120 },
        ],
        center: { x: 5, y: 5 },
      });

      // Queue a wait for the player
      bubble = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'test',
      }).bubble;

      const entities: Record<string, Entity> = { player, rat };
      const gameState = createTestGameState(entities, bubble);

      const result = simulateBubble(bubble, entities, { maxIterations: 10, gameState });

      // Rat should be dead from poison during stun
      expect(result.entities['rat']).toBeUndefined();

      // Should have death message
      const deathMsg = result.messages.find(m => m.text.includes('succumbed'));
      expect(deathMsg).toBeDefined();

      // Player should still be alive
      expect(result.entities['player']).toBeDefined();
      expect(result.entities['player'].hp).toBe(10);
    });
  });
});
