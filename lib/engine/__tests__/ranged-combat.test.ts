/**
 * Integration tests for ranged combat system.
 * Tests the full flow from action submission to state update.
 *
 * These tests verify that:
 * 1. Bow attacks consume arrows from quiver
 * 2. Thrown weapons consume themselves and unequip when depleted
 * 3. Full combat flow works end-to-end (equip, target, hit, kill)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateBubble } from '../simulation';
import { createBubble, bubbleId, queueCommand } from '../bubble';
import { entityId } from '../scheduler';
import { DEFAULT_AREA_ID, type Entity, type Action, type GameState } from '../state';
import { type DungeonMap } from '../map';
import { createTestZone } from './test-helpers';
import { clearFOVCache, tileKey } from '../fov';

// --- Test Map Setup ---

/**
 * Create a simple open map for ranged combat tests.
 * Larger map (15x15) to allow testing at various distances.
 */
function createRangedTestMap(): DungeonMap {
  const width = 15;
  const height = 15;
  const tiles = Array(height).fill(null).map((_, y) =>
    Array(width).fill(null).map((_, x) => {
      // Boundary walls
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        return { type: 'wall' as const };
      }
      return { type: 'floor' as const };
    })
  );

  return {
    width,
    height,
    tiles,
    rooms: [{ x: 1, y: 1, width: 13, height: 13, center: { x: 7, y: 7 }, tags: ['starting'] }],
    seed: 42,
  };
}

/**
 * Create a test state for ranged combat scenarios.
 */
function createRangedCombatState(params: {
  crawlerPos: { x: number; y: number };
  crawlerWeapon: 'shortbow' | 'throwing_dagger' | null;
  crawlerOffhand?: 'leather_quiver' | null;
  initialAmmo?: number;
  initialQuantity?: number;
  monsterPos: { x: number; y: number };
  monsterHp?: number;
}): GameState {
  const {
    crawlerPos,
    crawlerWeapon,
    crawlerOffhand,
    initialAmmo = 20,
    initialQuantity = 5,
    monsterPos,
    monsterHp = 5,
  } = params;

  const map = createRangedTestMap();

  // Build equipped weapon based on type
  // Note: bows go in main hand, thrown weapons go in offhand
  let equippedWeapon = null;
  if (crawlerWeapon === 'shortbow') {
    equippedWeapon = {
      id: 'eq-bow',
      templateId: 'shortbow',
      x: 0,
      y: 0,
      areaId: DEFAULT_AREA_ID,
    };
  }

  // Build equipped offhand (quiver or thrown weapons)
  let equippedOffhand = null;
  if (crawlerOffhand === 'leather_quiver') {
    equippedOffhand = {
      id: 'eq-quiver',
      templateId: 'leather_quiver',
      x: 0,
      y: 0,
      areaId: DEFAULT_AREA_ID,
      currentAmmo: initialAmmo,
    };
  } else if (crawlerWeapon === 'throwing_dagger') {
    // Thrown weapons go in offhand slot
    equippedOffhand = {
      id: 'eq-dagger',
      templateId: 'throwing_dagger',
      x: 0,
      y: 0,
      areaId: DEFAULT_AREA_ID,
      quantity: initialQuantity,
    };
  }

  // Create crawler entity
  const crawler: Entity = {
    id: 'crawler-1',
    type: 'crawler',
    x: crawlerPos.x,
    y: crawlerPos.y,
    areaId: DEFAULT_AREA_ID,
    hp: 20,
    maxHp: 20,
    name: 'Test Archer',
    attack: 5,
    defense: 2,
    speed: 100,
    char: '@',
    inventory: [],
    equippedWeapon,
    equippedOffhand,
    equippedArmor: null,
  };

  // Create weak monster (low HP for quick kills in tests)
  const monster: Entity = {
    id: 'monster-1',
    type: 'monster',
    x: monsterPos.x,
    y: monsterPos.y,
    areaId: DEFAULT_AREA_ID,
    hp: monsterHp,
    maxHp: monsterHp,
    name: 'Target Goblin',
    attack: 2,
    defense: 0,
    speed: 80,
    monsterTypeId: 'goblin',
  };

  // Create bubble with both entities
  const bubble = createBubble({
    id: bubbleId('test'),
    entityIds: [entityId('crawler-1'), entityId('monster-1')],
    entities: [
      { id: entityId('crawler-1'), speed: 100 },
      { id: entityId('monster-1'), speed: 80 },
    ],
    center: crawlerPos,
  });

  // Mark all tiles as explored for visibility
  const allTiles: string[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
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

describe('Ranged Combat Integration', () => {
  beforeEach(() => {
    clearFOVCache();
  });

  describe('full bow attack flow', () => {
    it('equip, target, hit, kill: completes full ranged combat cycle', () => {
      // Setup: crawler with shortbow and quiver, weak monster within range
      // Crawler at (5, 5), monster at (5, 8) - 3 tiles south, well within shortbow range (6)
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 5, y: 8 },
        monsterHp: 1, // 1 HP ensures kill on any hit
      });

      // Queue a ranged attack action with preRolledD20: 20 (guaranteed hit)
      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Shoot the goblin with my bow',
        preRolledD20: 20, // Critical hit, guaranteed to kill
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: ammo consumed (19 remaining from initial 20)
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter).toBeDefined();
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(19);

      // Verify: monster was killed (removed from entities)
      expect(result.entities['monster-1']).toBeUndefined();

      // Verify: message indicates hit and damage
      const hitMessage = result.messages.find(m => m.text.includes('hits'));
      expect(hitMessage).toBeDefined();
      expect(hitMessage?.text).toContain('Target Goblin');
      expect(hitMessage?.text).toContain('damage');

      // Verify: death message
      const deathMessage = result.messages.find(m => m.text.includes('dies!'));
      expect(deathMessage).toBeDefined();
    });

    it('consumes arrow on miss as well as hit', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 5, y: 8 },
        monsterHp: 10, // Higher HP so it survives
      });

      // Queue a ranged attack with preRolledD20: 1 (guaranteed miss)
      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Try to shoot the goblin',
        preRolledD20: 1, // Guaranteed miss
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: ammo consumed even on miss
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(19);

      // Verify: miss message
      const missMessage = result.messages.find(m => m.text.includes('misses'));
      expect(missMessage).toBeDefined();

      // Verify: monster still alive
      expect(result.entities['monster-1']).toBeDefined();
    });

    it('handles victory when last monster is killed with ranged attack', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 5, y: 8 },
        monsterHp: 1,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Kill the last goblin',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: game ends with victory
      expect(result.gameStatus.status).toBe('ended');
      if (result.gameStatus.status === 'ended') {
        expect(result.gameStatus.victory).toBe(true);
      }

      // Verify: victory message
      const victoryMessage = result.messages.find(m => m.text.includes('Victory'));
      expect(victoryMessage).toBeDefined();
    });
  });

  describe('thrown weapon flow', () => {
    it('thrown weapon depletes and becomes null when last one is thrown', () => {
      // Setup: crawler with throwing_dagger quantity: 1, monster within range (<=4 tiles)
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'throwing_dagger',
        initialQuantity: 1, // Last dagger
        monsterPos: { x: 5, y: 7 }, // 2 tiles south, within throwing range (4)
        monsterHp: 10, // Monster survives so we can check weapon state
      });

      // Queue ranged attack
      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 2,
        reasoning: 'Throw my last dagger',
        preRolledD20: 20, // Hit to confirm attack happened
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: equippedWeapon becomes null after last dagger thrown
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter).toBeDefined();
      expect(crawlerAfter.equippedWeapon).toBeNull();

      // Verify: attack message indicates hit
      const hitMessage = result.messages.find(m => m.text.includes('hits'));
      expect(hitMessage).toBeDefined();
    });

    it('thrown weapon decrements quantity when multiple remain', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'throwing_dagger',
        initialQuantity: 5, // Multiple daggers
        monsterPos: { x: 5, y: 7 },
        monsterHp: 10,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 2,
        reasoning: 'Throw a dagger',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: quantity decremented from 5 to 4 (thrown weapons are in offhand)
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand).not.toBeNull();
      expect(crawlerAfter.equippedOffhand?.quantity).toBe(4);
    });

    it('thrown weapon can kill target', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'throwing_dagger',
        initialQuantity: 3,
        monsterPos: { x: 5, y: 7 },
        monsterHp: 1, // Dies on any hit
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 2,
        reasoning: 'Kill with thrown dagger',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: monster killed
      expect(result.entities['monster-1']).toBeUndefined();

      // Verify: quantity decremented (thrown weapons are in offhand)
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.quantity).toBe(2);
    });
  });

  describe('error cases', () => {
    it('fails when shooting beyond weapon range', () => {
      // Shortbow has range 6, monster at distance 8
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 5, y: 13 }, // 8 tiles away
        monsterHp: 5,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 8, // Beyond shortbow range of 6
        reasoning: 'Try to shoot from too far',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: error message about range
      const rangeMessage = result.messages.find(m => m.text.includes('too far'));
      expect(rangeMessage).toBeDefined();

      // Verify: ammo NOT consumed on failed attempt
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(20);
    });

    it('fails when bow has no quiver equipped', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: null, // No quiver
        monsterPos: { x: 5, y: 8 },
        monsterHp: 5,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Try to shoot without ammo',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: error message about ammunition
      const ammoMessage = result.messages.find(m =>
        m.text.includes('ammunition') || m.text.includes('quiver')
      );
      expect(ammoMessage).toBeDefined();
    });

    it('fails when quiver is empty', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 0, // Empty quiver
        monsterPos: { x: 5, y: 8 },
        monsterHp: 5,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Try to shoot with empty quiver',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: error message about ammunition
      const ammoMessage = result.messages.find(m => m.text.includes('ammunition'));
      expect(ammoMessage).toBeDefined();
    });

    it('fails when no ranged weapon is equipped', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: null, // No weapon
        monsterPos: { x: 5, y: 8 },
        monsterHp: 5,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Try to shoot without weapon',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: error message about ranged weapon
      const weaponMessage = result.messages.find(m => m.text.includes('ranged weapon'));
      expect(weaponMessage).toBeDefined();
    });
  });

  describe('multi-shot sequences', () => {
    it('supports multiple consecutive ranged attacks with high max iterations', () => {
      // Monster far away so it spends turns moving toward player
      // This gives the player time to fire multiple shots
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 5, y: 11 }, // 6 tiles away, within range but takes time to reach
        monsterHp: 100, // High HP to survive multiple shots
      });

      // Queue two ranged attacks
      let bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), {
        action: 'ranged_attack',
        direction: 'south',
        distance: 6,
        reasoning: 'First shot',
        preRolledD20: 20,
      }).bubble;

      bubble = queueCommand(bubble, entityId('crawler-1'), {
        action: 'ranged_attack',
        direction: 'south',
        distance: 5, // Monster moved 1 tile closer
        reasoning: 'Second shot',
        preRolledD20: 20,
      }).bubble;

      state = { ...state, bubbles: [bubble] };

      // Higher max iterations to allow both player actions and monster movements
      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 20,
        gameState: state,
      });

      // Verify: ammo consumed for both shots (20 - 2 = 18)
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(18);

      // Verify: two hit messages
      const hitMessages = result.messages.filter(m => m.text.includes('hits'));
      expect(hitMessages.length).toBe(2);
    });
  });

  describe('FOV and visibility checks', () => {
    it('fails when target position is beyond vision radius', () => {
      // Create state with small vision radius and distant target
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 5, y: 11 }, // 6 tiles away - within weapon range
        monsterHp: 5,
      });

      // Override crawler's vision radius to be smaller than the distance
      const crawler = state.entities['crawler-1'];
      state = {
        ...state,
        entities: {
          ...state.entities,
          'crawler-1': { ...crawler, visionRadius: 4 }, // Can only see 4 tiles
        },
      };

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 6, // Beyond vision radius of 4
        reasoning: 'Try to shoot beyond vision',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: error message about not being able to see
      const cantSeeMessage = result.messages.find(m => m.text.includes("can't see"));
      expect(cantSeeMessage).toBeDefined();

      // Verify: ammo NOT consumed
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(20);
    });
  });

  describe('ammunition depletion', () => {
    it('fails when quiver becomes empty after multiple shots', () => {
      // Start with only 1 arrow
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 1, // Only 1 arrow
        monsterPos: { x: 5, y: 8 },
        monsterHp: 100, // High HP to survive
      });

      // First shot - should succeed
      const action1: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Fire last arrow',
        preRolledD20: 20,
      };

      let bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action1).bubble;
      state = { ...state, bubbles: [bubble] };

      const result1 = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: first shot hit
      expect(result1.messages.some(m => m.text.includes('hits'))).toBe(true);

      // Verify: quiver is now empty
      const crawlerAfterFirst = result1.entities['crawler-1'];
      expect(crawlerAfterFirst.equippedOffhand?.currentAmmo).toBe(0);

      // Update state for second attempt
      state = {
        ...state,
        entities: result1.entities,
        bubbles: [createBubble({
          id: bubbleId('test2'),
          entityIds: [entityId('crawler-1'), entityId('monster-1')],
          entities: [
            { id: entityId('crawler-1'), speed: 100 },
            { id: entityId('monster-1'), speed: 80 },
          ],
          center: { x: 5, y: 5 },
        })],
      };

      // Second shot - should fail (no ammo)
      const action2: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3,
        reasoning: 'Try to fire with no arrows',
        preRolledD20: 20,
      };

      bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action2).bubble;
      state = { ...state, bubbles: [bubble] };

      const result2 = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: error message about no ammunition
      const noAmmoMessage = result2.messages.find(m => m.text.includes('ammunition'));
      expect(noAmmoMessage).toBeDefined();
    });
  });

  describe('shooting at empty tiles', () => {
    it('allows shooting at empty tile and consumes ammo', () => {
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        initialAmmo: 20,
        monsterPos: { x: 8, y: 8 }, // Monster is not in the line of fire
        monsterHp: 5,
      });

      // Shoot at empty tile (south, no monster there)
      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 3, // Empty tile at (5, 8)
        reasoning: 'Shoot at nothing',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: message about shot missing/flying past
      const missMessage = result.messages.find(m =>
        m.text.includes('flies past') || m.text.includes('empty')
      );
      expect(missMessage).toBeDefined();

      // Verify: ammo WAS consumed (shot was fired, just missed)
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(19);
    });
  });

  describe('range boundary tests', () => {
    it('succeeds when target is at exact maximum range', () => {
      // Setup: crawler with shortbow (range 6), monster exactly 6 tiles away
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        monsterPos: { x: 5, y: 11 }, // exactly 6 tiles south
        monsterHp: 10,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 6, // exact range
        reasoning: 'Test exact range boundary',
        preRolledD20: 20, // Guaranteed hit
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: attack succeeded (hit message or damage dealt)
      const hitMessage = result.messages.find(m =>
        m.text.includes('shoots') || m.text.includes('hits') || m.text.includes('damage')
      );
      expect(hitMessage).toBeDefined();

      // Verify: ammo consumed
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(19);
    });

    it('fails when target is one tile beyond maximum range', () => {
      // Setup: crawler with shortbow (range 6), monster 7 tiles away
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        monsterPos: { x: 5, y: 12 }, // 7 tiles south - beyond range
        monsterHp: 10,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'south',
        distance: 7,
        reasoning: 'Test beyond range',
        preRolledD20: 20,
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: range error message
      const rangeMessage = result.messages.find(m =>
        m.text.includes('too far') || m.text.includes('range')
      );
      expect(rangeMessage).toBeDefined();

      // Verify: ammo NOT consumed
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(20);
    });
  });

  describe('diagonal ranged attacks', () => {
    it('hits target diagonally northeast', () => {
      // Setup: crawler at (5,5), monster at (8,2) - 3 tiles northeast (Chebyshev distance)
      let state = createRangedCombatState({
        crawlerPos: { x: 5, y: 5 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        monsterPos: { x: 8, y: 2 }, // 3 tiles northeast
        monsterHp: 5,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'northeast',
        distance: 3,
        reasoning: 'Diagonal shot',
        preRolledD20: 20, // Guaranteed hit
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: attack hit
      const hitMessage = result.messages.find(m =>
        m.text.includes('shoots') || m.text.includes('damage')
      );
      expect(hitMessage).toBeDefined();

      // Verify: ammo consumed
      const crawlerAfter = result.entities['crawler-1'];
      expect(crawlerAfter.equippedOffhand?.currentAmmo).toBe(19);
    });

    it('hits target diagonally southwest', () => {
      // Setup: crawler at (7,7), monster at (4,10) - 3 tiles southwest
      let state = createRangedCombatState({
        crawlerPos: { x: 7, y: 7 },
        crawlerWeapon: 'shortbow',
        crawlerOffhand: 'leather_quiver',
        monsterPos: { x: 4, y: 10 }, // 3 tiles southwest
        monsterHp: 5,
      });

      const action: Action = {
        action: 'ranged_attack',
        direction: 'southwest',
        distance: 3,
        reasoning: 'Diagonal shot southwest',
        preRolledD20: 20, // Guaranteed hit
      };

      const bubble = queueCommand(state.bubbles[0], entityId('crawler-1'), action).bubble;
      state = { ...state, bubbles: [bubble] };

      const result = simulateBubble(bubble, state.entities, {
        maxIterations: 5,
        gameState: state,
      });

      // Verify: attack hit
      const hitMessage = result.messages.find(m =>
        m.text.includes('shoots') || m.text.includes('damage')
      );
      expect(hitMessage).toBeDefined();
    });
  });
});
