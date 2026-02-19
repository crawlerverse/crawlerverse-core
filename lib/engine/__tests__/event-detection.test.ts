import { describe, it, expect, vi } from 'vitest';
import { createInitialState, DEFAULT_AREA_ID } from '../state';
import { simulate } from '../simulation';
import { GameEventEmitter, EventType, type GameEvent } from '../events';
import { queueCommand, createBubble, bubbleId } from '../bubble';
import { entityId, type EntityId } from '../scheduler';
import type { Entity } from '../types';

describe('Event Detection - KILL', () => {
  it('should emit KILL event when entity dies in combat', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.KILL, handler);

    // Create simple bubble with player and weak monster
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue attack command for player
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill weak goblin',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10, // High attack to ensure kill
        defense: 2,
        speed: 120,
        equippedWeapon: {
          id: 'sword-1',
          templateId: 'sword',
          x: 5,
          y: 5,
          areaId: DEFAULT_AREA_ID,
        },
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6, // Adjacent to player (east)
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 1, // Will die in one hit
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should attack and kill the goblin
    const result = simulate(state);

    // Verify goblin is dead (removed from entities)
    expect(result.state.entities['goblin-1']).toBeUndefined();

    // Verify KILL event was emitted
    expect(handler).toHaveBeenCalled();

    const killCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.KILL
    );

    expect(killCalls.length).toBeGreaterThan(0);

    const killEvent: GameEvent = killCalls[0][0];
    expect(killEvent.type).toBe(EventType.KILL);
    expect(killEvent.timestamp).toBeGreaterThan(0);
    expect(killEvent.context).toBeDefined();
    expect(killEvent.entities).toHaveLength(2); // attacker and defender
    expect(killEvent.metadata.damage).toBeGreaterThan(0);
    expect(killEvent.metadata.isCritical).toBeDefined();

    // Verify weapon is included in metadata if equipped
    if (killEvent.metadata.weapon) {
      expect(killEvent.metadata.weapon).toMatchObject({
        id: 'sword-1',
        templateId: 'sword',
      });
    }
  });
});

describe('Event Detection - FIRST_BLOOD', () => {
  it('should emit FIRST_BLOOD event on first damage in encounter', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.FIRST_BLOOD, handler);

    // Create bubble with player and goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue attack command for player
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'first attack in encounter',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10,
        defense: 2,
        speed: 120,
        equippedWeapon: null,
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6, // Adjacent to player (east)
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should attack the goblin
    const result = simulate(state);

    // Verify FIRST_BLOOD event was emitted
    expect(handler).toHaveBeenCalled();

    const firstBloodCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.FIRST_BLOOD
    );

    expect(firstBloodCalls.length).toBe(1);

    const firstBloodEvent: GameEvent = firstBloodCalls[0][0];
    expect(firstBloodEvent.type).toBe(EventType.FIRST_BLOOD);
    expect(firstBloodEvent.timestamp).toBeGreaterThan(0);
    expect(firstBloodEvent.context).toBeDefined();
    expect(firstBloodEvent.entities).toHaveLength(2); // attacker and defender
    expect(firstBloodEvent.metadata.damage).toBeGreaterThan(0);
    expect(firstBloodEvent.metadata.isCritical).toBeDefined();
  });

  it('should only emit FIRST_BLOOD once per encounter', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.FIRST_BLOOD, handler);

    // Create bubble with player and goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue TWO attack commands
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'first attack',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'second attack',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 5, // Lower attack to not kill in one hit
        defense: 2,
        speed: 120,
        equippedWeapon: null,
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6, // Adjacent to player (east)
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 20, // High HP to survive both hits
        maxHp: 20,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should attack twice
    const result = simulate(state);

    // Verify FIRST_BLOOD was only emitted once (not twice)
    const firstBloodCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.FIRST_BLOOD
    );

    expect(firstBloodCalls.length).toBe(1); // Only once, not twice
  });
});

describe('Event Detection - CRITICAL_HP', () => {
  it('should emit CRITICAL_HP event when entity drops below 25% HP', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.CRITICAL_HP, handler);

    // Create bubble with player and goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue attack command for player
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'attack goblin',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10,
        defense: 2,
        speed: 120,
        equippedWeapon: null,
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6, // Adjacent to player (east)
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10, // Start at 50% HP (10/20) - one hit will bring below 25%
        maxHp: 20,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should attack and bring goblin below 25% HP
    const result = simulate(state);

    // Verify CRITICAL_HP event was emitted
    expect(handler).toHaveBeenCalled();

    const criticalHpCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.CRITICAL_HP
    );

    expect(criticalHpCalls.length).toBe(1);

    const criticalHpEvent: GameEvent = criticalHpCalls[0][0];
    expect(criticalHpEvent.type).toBe(EventType.CRITICAL_HP);
    expect(criticalHpEvent.timestamp).toBeGreaterThan(0);
    expect(criticalHpEvent.context).toBeDefined();
    expect(criticalHpEvent.entities).toHaveLength(1); // defender only
    expect(criticalHpEvent.metadata.currentHp).toBeLessThan(5); // Less than 25% of 20
    expect(criticalHpEvent.metadata.maxHp).toBe(20);
    expect(criticalHpEvent.metadata.hpPercentage).toBeLessThan(25);
  });

  it('should NOT emit duplicate CRITICAL_HP events for same entity', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.CRITICAL_HP, handler);

    // Create bubble with player and goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue TWO attack commands to hit goblin multiple times while below 25%
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'first attack',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'second attack',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 5, // Higher attack to ensure damage
        defense: 2,
        speed: 120,
        equippedWeapon: null,
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6, // Adjacent to player (east)
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10, // Start at 50% HP (10/20) - first hit will bring below 25%, second hit keeps it below
        maxHp: 20,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should attack twice, but only emit CRITICAL_HP once
    const result = simulate(state);

    // Verify CRITICAL_HP was only emitted once (not twice)
    const criticalHpCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.CRITICAL_HP
    );

    expect(criticalHpCalls.length).toBe(1); // Only once, not twice
  });
});

describe('Event Detection - COMBAT_END', () => {
  it('should emit COMBAT_END event when all enemies defeated', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.COMBAT_END, handler);

    // Create bubble with player and TWO goblins
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1'), entityId('goblin-2')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
        { id: entityId('goblin-2'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue TWO attack commands to kill both goblins
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill first goblin',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'north',
      reasoning: 'kill second goblin',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10, // High attack to ensure kills
        defense: 2,
        speed: 120,
        equippedWeapon: null,
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6, // Adjacent to player (east)
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 1, // Will die in one hit
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
      'goblin-2': {
        id: 'goblin-2',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 5, // Adjacent to player (north)
        y: 4,
        areaId: DEFAULT_AREA_ID,
        hp: 1, // Will die in one hit
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should kill both goblins
    const result = simulate(state);

    // Verify both goblins are dead
    expect(result.state.entities['goblin-1']).toBeUndefined();
    expect(result.state.entities['goblin-2']).toBeUndefined();

    // Verify COMBAT_END event was emitted
    expect(handler).toHaveBeenCalled();

    const combatEndCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.COMBAT_END
    );

    expect(combatEndCalls.length).toBe(1);

    const combatEndEvent: GameEvent = combatEndCalls[0][0];
    expect(combatEndEvent.type).toBe(EventType.COMBAT_END);
    expect(combatEndEvent.timestamp).toBeGreaterThan(0);
    expect(combatEndEvent.context).toBeDefined();
    expect(combatEndEvent.entities).toHaveLength(1); // Crawler who cleared the area
    expect(combatEndEvent.entities[0].id).toBe('crawler-1');
    expect(combatEndEvent.metadata.totalKills).toBe(2); // Killed 2 goblins
  });
});

describe('Event Detection - AREA_ENTERED', () => {
  it('should emit AREA_ENTERED event when crawler moves to new area', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.AREA_ENTERED, handler);

    // Helper to create a tile grid
    function createTileGrid<T>(width: number, height: number, factory: (x: number, y: number) => T): T[][] {
      return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => factory(x, y))
      );
    }

    // Create first area's map with a portal at (2,2)
    const area1Map = {
      width: 10,
      height: 10,
      seed: 12345,
      rooms: [{ x: 1, y: 1, width: 3, height: 3, center: { x: 2, y: 2 }, tags: [] }],
      tiles: createTileGrid(10, 10, (x: number, y: number) => {
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
    const area2Map = {
      width: 10,
      height: 10,
      seed: 67890,
      rooms: [{ x: 4, y: 4, width: 3, height: 3, center: { x: 5, y: 5 }, tags: [] }],
      tiles: createTileGrid(10, 10, (x: number, y: number) =>
        (x >= 4 && x <= 6 && y >= 4 && y <= 6)
          ? { type: 'floor' as const }
          : { type: 'wall' as const }
      ),
    };

    const area1 = {
      metadata: {
        id: 'area-1',
        name: 'First Area',
        dangerLevel: 0,
      },
      map: area1Map,
    };

    const area2 = {
      metadata: {
        id: 'area-2',
        name: 'Second Area',
        dangerLevel: 1,
      },
      map: area2Map,
    };

    const zone = {
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
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    // Create bubble with crawler positioned on portal tile
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
      ],
      center: { x: 2, y: 2 },
    });

    // Queue enter_portal command
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'enter_portal',
      reasoning: 'entering new area',
    }).bubble;

    const state = {
      zone,
      currentAreaId: 'area-1',
      entities: { 'crawler-1': crawler },
      items: [],
      hibernating: [],
      exploredTiles: { 'area-1': [] }, // area-1 is explored (not first visit to area-2)
      bubbles: [bubble],
      objectives: [],
      gameStatus: { status: 'playing' as const },
      turn: 1,
      messages: [],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should enter portal and move to new area
    const result = simulate(state);

    // Verify AREA_ENTERED event was emitted
    expect(handler).toHaveBeenCalled();

    const areaEnteredCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.AREA_ENTERED
    );

    expect(areaEnteredCalls.length).toBe(1);

    const areaEnteredEvent: GameEvent = areaEnteredCalls[0][0];
    expect(areaEnteredEvent.type).toBe(EventType.AREA_ENTERED);
    expect(areaEnteredEvent.timestamp).toBeGreaterThan(0);
    expect(areaEnteredEvent.context).toBeDefined();
    expect(areaEnteredEvent.entities).toHaveLength(1); // crawler only
    expect(areaEnteredEvent.metadata.previousArea).toBe('area-1');
    expect(areaEnteredEvent.metadata.newArea).toBe('area-2');
    expect(areaEnteredEvent.metadata.isFirstVisit).toBe(true); // First visit to area-2
  });
});

describe('Event Detection - ITEM_FOUND', () => {
  it('should emit ITEM_FOUND event when item is picked up', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.ITEM_FOUND, handler);

    // Create bubble with crawler
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue pickup command
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'pickup',
      reasoning: 'picking up item',
    }).bubble;

    const item = {
      id: 'item-1',
      templateId: 'health_potion',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      quantity: 1,
    };

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 5,
      speed: 100,
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities, items, and bubble
    state = {
      ...state,
      entities: { 'crawler-1': crawler },
      items: [item],
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should pick up the item
    const result = simulate(state);

    // Verify item was picked up
    expect(result.state.items).toHaveLength(0);
    expect(result.state.entities['crawler-1'].inventory).toHaveLength(1);

    // Verify ITEM_FOUND event was emitted
    expect(handler).toHaveBeenCalled();

    const itemFoundCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.ITEM_FOUND
    );

    expect(itemFoundCalls.length).toBe(1);

    const itemFoundEvent: GameEvent = itemFoundCalls[0][0];
    expect(itemFoundEvent.type).toBe(EventType.ITEM_FOUND);
    expect(itemFoundEvent.timestamp).toBeGreaterThan(0);
    expect(itemFoundEvent.context).toBeDefined();
    expect(itemFoundEvent.entities).toHaveLength(1); // crawler only
    expect(itemFoundEvent.metadata.itemType).toBe('health_potion');
    expect(itemFoundEvent.metadata.quantity).toBe(1);
  });
});

describe('Event Detection - CRAWLER_DEATH', () => {
  it('should emit CRAWLER_DEATH event when crawler dies', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.CRAWLER_DEATH, handler);

    // Create bubble with crawler and monster
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
        { id: entityId('goblin-1'), speed: 120 },
      ],
      center: { x: 5, y: 5 },
    });

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 1, // Will die in one hit
      maxHp: 10,
      attack: 5,
      defense: 2,
      speed: 100,
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const goblin: Entity = {
      id: 'goblin-1',
      type: 'monster',
      monsterTypeId: 'goblin',
      x: 6, // Adjacent to crawler (east)
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      name: 'Goblin',
      attack: 10, // High attack to ensure kill
      defense: 1,
      speed: 120,
      behaviorState: 'chase',
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities: { 'crawler-1': crawler, 'goblin-1': goblin },
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - goblin should attack and kill crawler (goblin acts first due to higher speed)
    const result = simulate(state);

    // Verify crawler is dead (removed from entities)
    expect(result.state.entities['crawler-1']).toBeUndefined();

    // Verify CRAWLER_DEATH event was emitted
    expect(handler).toHaveBeenCalled();

    const crawlerDeathCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.CRAWLER_DEATH
    );

    expect(crawlerDeathCalls.length).toBe(1);

    const crawlerDeathEvent: GameEvent = crawlerDeathCalls[0][0];
    expect(crawlerDeathEvent.type).toBe(EventType.CRAWLER_DEATH);
    expect(crawlerDeathEvent.timestamp).toBeGreaterThan(0);
    expect(crawlerDeathEvent.context).toBeDefined();
    expect(crawlerDeathEvent.entities).toHaveLength(1); // crawler only
    expect(crawlerDeathEvent.entities[0].hp).toBe(0);
    expect(crawlerDeathEvent.metadata.killedBy).toBe('Goblin');
  });
});

describe('Event Detection - VICTORY', () => {
  it('should emit VICTORY event when game ends with victory', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.VICTORY, handler);

    // Create bubble with crawler and target monster
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue attack command for crawler
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill target to complete objective',
    }).bubble;

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      attack: 10, // High attack to ensure kill
      defense: 2,
      speed: 120,
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const goblin: Entity = {
      id: 'goblin-1',
      type: 'monster',
      monsterTypeId: 'goblin',
      x: 6, // Adjacent to crawler (east)
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 1, // Will die in one hit
      maxHp: 10,
      name: 'Goblin',
      attack: 3,
      defense: 1,
      speed: 100,
      behaviorState: 'chase',
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    // Create initial state with event emitter and objective
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities, bubble, and objective that will complete
    state = {
      ...state,
      entities: { 'crawler-1': crawler, 'goblin-1': goblin },
      bubbles: [bubble],
      turn: 10,
      objectives: [
        {
          id: 'kill-goblin',
          type: 'kill',
          description: 'Kill the goblin',
          target: { entityId: 'goblin-1' },
          status: 'active',
          priority: 'primary',
          assignee: null,
        },
      ],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should kill goblin and complete objective, triggering victory
    const result = simulate(state);

    // Verify goblin is dead
    expect(result.state.entities['goblin-1']).toBeUndefined();

    // Verify VICTORY event was emitted
    expect(handler).toHaveBeenCalled();

    const victoryCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.VICTORY
    );

    expect(victoryCalls.length).toBe(1);

    const victoryEvent: GameEvent = victoryCalls[0][0];
    expect(victoryEvent.type).toBe(EventType.VICTORY);
    expect(victoryEvent.timestamp).toBeGreaterThan(0);
    expect(victoryEvent.context).toBeDefined();
    expect(victoryEvent.entities.length).toBeGreaterThan(0); // all entities
    expect(victoryEvent.metadata.floor).toBe(1); // Default area has dangerLevel 1
    expect(victoryEvent.metadata.turns).toBeGreaterThan(0);
  });
});

describe('Event Detection - MONSTER_SEEN', () => {
  it('should emit when monster first becomes visible', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.MONSTER_SEEN, handler);

    // Create bubble with crawler - will move to see monster
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
      ],
      center: { x: 2, y: 2 },
    });

    // Queue move command to get closer to monster
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'east',
      reasoning: 'exploring',
    }).bubble;

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 2,
      y: 2,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 5,
      speed: 100,
      visionRadius: 8, // Standard vision
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const goblin: Entity = {
      id: 'goblin-1',
      type: 'monster',
      monsterTypeId: 'goblin',
      x: 5, // Within vision radius after move
      y: 2,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      name: 'Goblin',
      attack: 3,
      defense: 1,
      speed: 50, // Slower than crawler
      behaviorState: 'idle',
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Initialize event tracking
    if (!state.eventTracking) {
      state = {
        ...state,
        eventTracking: {
          combatState: {},
          seenMonsterTypes: {},
          seenPortals: {},
          entitiesBelowCritical: new Set(),
        },
      };
    }

    // Override with our test entities and bubble
    state = {
      ...state,
      entities: { 'crawler-1': crawler, 'goblin-1': goblin },
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should move and see the goblin
    const result = simulate(state);

    // Verify MONSTER_SEEN event was emitted
    expect(handler).toHaveBeenCalled();

    const monsterSeenCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.MONSTER_SEEN
    );

    expect(monsterSeenCalls.length).toBe(1);

    const monsterSeenEvent: GameEvent = monsterSeenCalls[0][0];
    expect(monsterSeenEvent.type).toBe(EventType.MONSTER_SEEN);
    expect(monsterSeenEvent.timestamp).toBeGreaterThan(0);
    expect(monsterSeenEvent.context).toBeDefined();
    expect(monsterSeenEvent.entities).toHaveLength(1); // monster only
    expect(monsterSeenEvent.metadata.monsterType).toBe('goblin');
    expect(monsterSeenEvent.metadata.position).toEqual({ x: 5, y: 2 });
  });

  it('should not emit duplicate MONSTER_SEEN for same type', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.MONSTER_SEEN, handler);

    // Create bubble with crawler
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue two moves to see two goblins
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'east',
      reasoning: 'exploring',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'east',
      reasoning: 'exploring more',
    }).bubble;

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 5,
      speed: 100,
      visionRadius: 2, // Short vision radius
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const goblin1: Entity = {
      id: 'goblin-1',
      type: 'monster',
      monsterTypeId: 'goblin',
      x: 7, // Visible after first move
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      name: 'Goblin',
      attack: 3,
      defense: 1,
      speed: 50,
      behaviorState: 'idle',
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const goblin2: Entity = {
      id: 'goblin-2',
      type: 'monster',
      monsterTypeId: 'goblin', // Same type as first goblin
      x: 9, // Visible after second move
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      name: 'Goblin',
      attack: 3,
      defense: 1,
      speed: 50,
      behaviorState: 'idle',
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Initialize event tracking
    if (!state.eventTracking) {
      state = {
        ...state,
        eventTracking: {
          combatState: {},
          seenMonsterTypes: {},
          seenPortals: {},
          entitiesBelowCritical: new Set(),
        },
      };
    }

    // Override with our test entities and bubble
    state = {
      ...state,
      entities: { 'crawler-1': crawler, 'goblin-1': goblin1, 'goblin-2': goblin2 },
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should move and see both goblins, but only emit MONSTER_SEEN once
    const result = simulate(state);

    // Verify MONSTER_SEEN was only emitted once (not twice)
    const monsterSeenCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.MONSTER_SEEN
    );

    expect(monsterSeenCalls.length).toBe(1); // Only once for first goblin sighting
  });
});

describe('Event Detection - PORTAL_FOUND', () => {
  it('should emit when portal first becomes visible', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.PORTAL_FOUND, handler);

    // Helper to create a tile grid
    function createTileGrid<T>(width: number, height: number, factory: (x: number, y: number) => T): T[][] {
      return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => factory(x, y))
      );
    }

    // Create area's map with a portal at (8,5)
    const areaMap = {
      width: 15,
      height: 15,
      seed: 12345,
      rooms: [{ x: 1, y: 1, width: 12, height: 9, center: { x: 7, y: 5 }, tags: [] }],
      tiles: createTileGrid(15, 15, (x: number, y: number) => {
        if (x === 8 && y === 5) {
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
        return (x >= 1 && x <= 12 && y >= 1 && y <= 9)
          ? { type: 'floor' as const }
          : { type: 'wall' as const };
      }),
    };

    const area = {
      metadata: {
        id: DEFAULT_AREA_ID,
        name: 'Test Area',
        dangerLevel: 0,
      },
      map: areaMap,
    };

    const zone = {
      id: 'test-zone',
      name: 'Test Zone',
      entryAreaId: DEFAULT_AREA_ID,
      victoryAreaIds: ['area-2'],
      areas: {
        [DEFAULT_AREA_ID]: area,
      },
    };

    // Create bubble with crawler - will move to see portal
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue move command to get closer to portal
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'east',
      reasoning: 'exploring',
    }).bubble;

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 5,
      speed: 100,
      visionRadius: 8, // Standard vision - after move to (6,5), portal at (8,5) is within range
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const state = {
      zone,
      currentAreaId: DEFAULT_AREA_ID,
      entities: { 'crawler-1': crawler },
      items: [],
      hibernating: [],
      exploredTiles: {},
      bubbles: [bubble],
      objectives: [],
      gameStatus: { status: 'playing' as const },
      turn: 1,
      messages: [],
      eventEmitter: emitter,
      eventTracking: {
        combatState: {},
        seenMonsterTypes: {},
        seenPortals: {},
        entitiesBelowCritical: new Set<EntityId>(),
      },
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should move and see the portal
    const result = simulate(state);

    // Verify PORTAL_FOUND event was emitted
    expect(handler).toHaveBeenCalled();

    const portalFoundCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.PORTAL_FOUND
    );

    expect(portalFoundCalls.length).toBe(1);

    const portalFoundEvent: GameEvent = portalFoundCalls[0][0];
    expect(portalFoundEvent.type).toBe(EventType.PORTAL_FOUND);
    expect(portalFoundEvent.timestamp).toBeGreaterThan(0);
    expect(portalFoundEvent.context).toBeDefined();
    expect(portalFoundEvent.entities).toHaveLength(1); // crawler only
    expect(portalFoundEvent.metadata.position).toEqual({ x: 8, y: 5 });
    expect(portalFoundEvent.metadata.targetAreaId).toBe('area-2');
  });

  it('should not emit duplicate PORTAL_FOUND for same portal', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.PORTAL_FOUND, handler);

    // Helper to create a tile grid
    function createTileGrid<T>(width: number, height: number, factory: (x: number, y: number) => T): T[][] {
      return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => factory(x, y))
      );
    }

    // Create area's map with a portal at (8,5)
    const areaMap = {
      width: 15,
      height: 15,
      seed: 12345,
      rooms: [{ x: 1, y: 1, width: 12, height: 9, center: { x: 7, y: 5 }, tags: [] }],
      tiles: createTileGrid(15, 15, (x: number, y: number) => {
        if (x === 8 && y === 5) {
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
        return (x >= 1 && x <= 12 && y >= 1 && y <= 9)
          ? { type: 'floor' as const }
          : { type: 'wall' as const };
      }),
    };

    const area = {
      metadata: {
        id: DEFAULT_AREA_ID,
        name: 'Test Area',
        dangerLevel: 0,
      },
      map: areaMap,
    };

    const zone = {
      id: 'test-zone',
      name: 'Test Zone',
      entryAreaId: DEFAULT_AREA_ID,
      victoryAreaIds: ['area-2'],
      areas: {
        [DEFAULT_AREA_ID]: area,
      },
    };

    // Create bubble with crawler
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue TWO move commands - crawler will see portal after first move, then move again with portal still visible
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'east',
      reasoning: 'exploring',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'south',
      reasoning: 'exploring more',
    }).bubble;

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 5,
      speed: 100,
      visionRadius: 8, // After move to (6,5), portal at (8,5) is visible. After move to (6,6), portal still visible
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const state = {
      zone,
      currentAreaId: DEFAULT_AREA_ID,
      entities: { 'crawler-1': crawler },
      items: [],
      hibernating: [],
      exploredTiles: {},
      bubbles: [bubble],
      objectives: [],
      gameStatus: { status: 'playing' as const },
      turn: 1,
      messages: [],
      eventEmitter: emitter,
      eventTracking: {
        combatState: {},
        seenMonsterTypes: {},
        seenPortals: {},
        entitiesBelowCritical: new Set<EntityId>(),
      },
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - crawler should move twice and see the portal both times, but only emit PORTAL_FOUND once
    const result = simulate(state);

    // Verify PORTAL_FOUND was only emitted once (not twice)
    const portalFoundCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.PORTAL_FOUND
    );

    expect(portalFoundCalls.length).toBe(1); // Only once for first portal sighting
  });
});

describe.skip('Event Detection - Ranged Attack Events', () => {
  it('should emit KILL event for ranged weapon kills', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.KILL, handler);

    // Create bubble with player and distant goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue ranged_attack command for player
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'ranged_attack',
      direction: 'east',
      distance: 3,
      reasoning: 'kill goblin with bow',
    }).bubble;

    const bow = {
      id: 'bow-1',
      templateId: 'bow',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
    };

    const quiver = {
      id: 'quiver-1',
      templateId: 'quiver',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      quantity: 10,
    };

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10, // High attack to ensure kill
        defense: 2,
        speed: 120,
        equippedWeapon: bow,
        equippedOffhand: quiver,
        inventory: [bow, quiver],
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 8, // At range 3 from player
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 1, // Will die in one hit
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    // Create initial state with event emitter
    let state = createInitialState({ seed: 12345 });

    // Override with our test entities and bubble
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    // Clear any existing handler calls
    vi.clearAllMocks();

    // Simulate - player should shoot and kill the goblin
    const result = simulate(state);

    // Verify goblin is dead (removed from entities)
    expect(result.state.entities['goblin-1']).toBeUndefined();

    // Verify KILL event was emitted
    expect(handler).toHaveBeenCalled();

    const killCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.KILL
    );

    expect(killCalls.length).toBeGreaterThan(0);

    const killEvent: GameEvent = killCalls[0][0];
    expect(killEvent.type).toBe(EventType.KILL);
    expect(killEvent.timestamp).toBeGreaterThan(0);
    expect(killEvent.context).toBeDefined();
    expect(killEvent.entities).toHaveLength(2); // attacker and defender
    expect(killEvent.metadata.damage).toBeGreaterThan(0);

    // Verify ranged weapon is included in metadata
    expect(killEvent.metadata.weapon).toMatchObject({
      id: 'bow-1',
      templateId: 'bow',
    });
  });

  it('should emit FIRST_BLOOD event for ranged attacks', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.FIRST_BLOOD, handler);

    // Create bubble with player and distant goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    // Queue ranged_attack command
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'ranged_attack',
      direction: 'east',
      distance: 3,
      reasoning: 'first ranged attack',
    }).bubble;

    const bow = {
      id: 'bow-1',
      templateId: 'bow',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
    };

    const quiver = {
      id: 'quiver-1',
      templateId: 'quiver',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      quantity: 10,
    };

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10,
        defense: 2,
        speed: 120,
        equippedWeapon: bow,
        equippedOffhand: quiver,
        inventory: [bow, quiver],
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 8,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    let state = createInitialState({ seed: 12345 });

    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    vi.clearAllMocks();

    const result = simulate(state);

    // Verify FIRST_BLOOD event was emitted
    expect(handler).toHaveBeenCalled();

    const firstBloodCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.FIRST_BLOOD
    );

    expect(firstBloodCalls.length).toBe(1);

    const firstBloodEvent: GameEvent = firstBloodCalls[0][0];
    expect(firstBloodEvent.type).toBe(EventType.FIRST_BLOOD);
    expect(firstBloodEvent.entities).toHaveLength(2);
    expect(firstBloodEvent.metadata.damage).toBeGreaterThan(0);
  });

  it('should emit CRITICAL_HP event for ranged attacks', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.CRITICAL_HP, handler);

    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'ranged_attack',
      direction: 'east',
      distance: 3,
      reasoning: 'attack goblin',
    }).bubble;

    const bow = {
      id: 'bow-1',
      templateId: 'bow',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
    };

    const quiver = {
      id: 'quiver-1',
      templateId: 'quiver',
      x: 5,
      y: 5,
      areaId: DEFAULT_AREA_ID,
      quantity: 10,
    };

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10,
        defense: 2,
        speed: 120,
        equippedWeapon: bow,
        equippedOffhand: quiver,
        inventory: [bow, quiver],
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 8,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10, // Start at 50% HP - one hit will bring below 25%
        maxHp: 20,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    let state = createInitialState({ seed: 12345 });

    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
    };

    vi.clearAllMocks();

    const result = simulate(state);

    // Verify CRITICAL_HP event was emitted
    expect(handler).toHaveBeenCalled();

    const criticalHpCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.CRITICAL_HP
    );

    expect(criticalHpCalls.length).toBe(1);

    const criticalHpEvent: GameEvent = criticalHpCalls[0][0];
    expect(criticalHpEvent.type).toBe(EventType.CRITICAL_HP);
    expect(criticalHpEvent.entities).toHaveLength(1);
    expect(criticalHpEvent.metadata.hpRemaining).toBeLessThan(5);
  });
});

describe.skip('Event Detection - EventTracking Edge Cases', () => {
  it('should handle kill event when eventTracking is undefined', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.KILL, handler);

    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'east',
      reasoning: 'kill weak goblin',
    }).bubble;

    const entities: Record<string, Entity> = {
      'crawler-1': {
        id: 'crawler-1',
        type: 'crawler',
        x: 5,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 10,
        maxHp: 10,
        name: 'Test Player',
        char: '@',
        attack: 10,
        defense: 2,
        speed: 120,
        equippedWeapon: {
          id: 'sword-1',
          templateId: 'sword',
          x: 5,
          y: 5,
          areaId: DEFAULT_AREA_ID,
        },
      },
      'goblin-1': {
        id: 'goblin-1',
        type: 'monster',
        monsterTypeId: 'goblin',
        x: 6,
        y: 5,
        areaId: DEFAULT_AREA_ID,
        hp: 1, // Will die in one hit (kill before FIRST_BLOOD)
        maxHp: 10,
        name: 'Goblin',
        attack: 3,
        defense: 1,
        speed: 100,
        behaviorState: 'chase',
        equippedWeapon: null,
        equippedArmor: null,
        equippedOffhand: null,
      },
    };

    let state = createInitialState({ seed: 12345 });

    // Remove eventTracking to test edge case
    state = {
      ...state,
      entities,
      bubbles: [bubble],
      eventEmitter: emitter,
      eventTracking: undefined,
    };

    vi.clearAllMocks();

    // Simulate should NOT crash even with undefined eventTracking
    expect(() => simulate(state)).not.toThrow();

    const result = simulate(state);

    // Verify goblin is dead
    expect(result.state.entities['goblin-1']).toBeUndefined();

    // Verify eventTracking was initialized
    expect(result.state.eventTracking).toBeDefined();
  });
});

describe.skip('Event Detection - COMBAT_END After Area Transition', () => {
  it('should emit COMBAT_END when leaving area mid-combat', () => {
    const handler = vi.fn();
    const emitter = new GameEventEmitter();
    emitter.subscribe(EventType.COMBAT_END, handler);

    function createTileGrid<T>(width: number, height: number, factory: (x: number, y: number) => T): T[][] {
      return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => factory(x, y))
      );
    }

    // Create area-1 map with a portal and room with a goblin
    const area1Map = {
      width: 10,
      height: 10,
      seed: 12345,
      rooms: [{ x: 1, y: 1, width: 5, height: 5, center: { x: 3, y: 3 }, tags: [] }],
      tiles: createTileGrid(10, 10, (x: number, y: number) => {
        if (x === 5 && y === 3) {
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
        return (x >= 1 && x <= 6 && y >= 1 && y <= 5)
          ? { type: 'floor' as const }
          : { type: 'wall' as const };
      }),
    };

    // Create area-2 map (safe room)
    const area2Map = {
      width: 10,
      height: 10,
      seed: 67890,
      rooms: [{ x: 4, y: 4, width: 3, height: 3, center: { x: 5, y: 5 }, tags: [] }],
      tiles: createTileGrid(10, 10, (x: number, y: number) =>
        (x >= 4 && x <= 6 && y >= 4 && y <= 6)
          ? { type: 'floor' as const }
          : { type: 'wall' as const }
      ),
    };

    const area1 = {
      metadata: { id: 'area-1', name: 'Combat Area', dangerLevel: 0 },
      map: area1Map,
    };

    const area2 = {
      metadata: { id: 'area-2', name: 'Safe Area', dangerLevel: 1 },
      map: area2Map,
    };

    const zone = {
      id: 'test-zone',
      name: 'Test Zone',
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-2'],
      areas: { 'area-1': area1, 'area-2': area2 },
    };

    // Create bubble with crawler positioned near portal, after attacking goblin
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('crawler-1'), entityId('goblin-1')],
      entities: [
        { id: entityId('crawler-1'), speed: 120 },
        { id: entityId('goblin-1'), speed: 100 },
      ],
      center: { x: 4, y: 3 },
    });

    // Queue attack first (to start combat), then move to portal
    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'attack',
      direction: 'west',
      reasoning: 'start combat',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'move',
      direction: 'east',
      reasoning: 'move to portal',
    }).bubble;

    bubble = queueCommand(bubble, entityId('crawler-1'), {
      action: 'enter_portal',
      reasoning: 'escape combat',
    }).bubble;

    const crawler: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      char: '@',
      x: 4,
      y: 3,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      attack: 5,
      defense: 5,
      speed: 120,
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const goblin: Entity = {
      id: 'goblin-1',
      type: 'monster',
      monsterTypeId: 'goblin',
      x: 3, // Adjacent west of crawler
      y: 3,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Goblin',
      attack: 3,
      defense: 1,
      speed: 100,
      behaviorState: 'chase',
      equippedWeapon: null,
      equippedArmor: null,
      equippedOffhand: null,
    };

    const state = {
      zone,
      currentAreaId: 'area-1',
      entities: { 'crawler-1': crawler, 'goblin-1': goblin },
      items: [],
      hibernating: [],
      exploredTiles: {},
      bubbles: [bubble],
      objectives: [],
      gameStatus: { status: 'playing' as const },
      turn: 1,
      messages: [],
      scheduler: { entries: [], time: 0 },
      eventEmitter: emitter,
      eventTracking: {
        combatState: {},
        seenMonsterTypes: {},
        seenPortals: {},
        entitiesBelowCritical: new Set<EntityId>(),
      },
    };

    vi.clearAllMocks();

    // Simulate - crawler attacks goblin (starting combat), then enters portal
    const result = simulate(state);

    // Verify crawler moved to area-2
    expect(result.state.entities['crawler-1'].areaId).toBe('area-2');

    // Verify COMBAT_END was emitted for area-1 when crawler left mid-combat
    const combatEndCalls = (handler.mock.calls as Array<[GameEvent]>).filter(
      (call) => call[0].type === EventType.COMBAT_END
    );

    expect(combatEndCalls.length).toBeGreaterThan(0);

    const combatEndEvent: GameEvent = combatEndCalls[0][0];
    expect(combatEndEvent.type).toBe(EventType.COMBAT_END);

    // Verify area-1 combat state is reset
    expect(result.state.eventTracking?.combatState['area-1']).toEqual(
      expect.objectContaining({ wasInCombat: false })
    );
  });
});
