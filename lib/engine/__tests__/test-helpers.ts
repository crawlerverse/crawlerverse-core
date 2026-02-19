/**
 * Shared test utilities for engine tests
 *
 * This module provides reusable helpers for creating test fixtures,
 * making assertions, and managing game state in tests.
 */
import { expect } from 'vitest';
import { DEFAULT_AREA_ID, type GameState } from '../state';
import { type DungeonMap, type Zone } from '../map';
import { type Entity } from '../types';
import { type ItemInstance } from '../items';
import { advanceScheduler, completeCurrentTurn, entityId } from '../scheduler';
import { crawlerIdFromIndex } from '../crawler-id';
import { type ActionResult } from '../actions';
import { type InventoryActionResult } from '../inventory';

// --- Constants ---

/** Primary player ID used in tests */
export const TEST_PLAYER_ID = crawlerIdFromIndex(1);

// --- Zone Helpers ---

/**
 * Creates a Zone from a DungeonMap for testing purposes.
 * Wraps the map in a single-area zone with default metadata.
 */
export function createTestZone(map: DungeonMap): Zone {
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
    },
  };
}

// --- Entity Factories ---

/** Default crawler configuration for tests */
export const DEFAULT_TEST_CRAWLER: Entity = {
  id: 'crawler-1',
  type: 'crawler',
  x: 5,
  y: 5,
  areaId: DEFAULT_AREA_ID,
  hp: 10,
  maxHp: 10,
  name: 'Test Crawler',
  attack: 2,
  defense: 0,
  speed: 100,
  char: '@',
  inventory: [],
  equippedWeapon: null,
  equippedArmor: null,
  equippedOffhand: null,
};

/** Default monster configuration for tests */
export const DEFAULT_TEST_MONSTER: Entity = {
  id: 'monster-1',
  type: 'monster',
  x: 7,
  y: 7,
  areaId: DEFAULT_AREA_ID,
  hp: 5,
  maxHp: 5,
  name: 'Test Monster',
  attack: 2,
  defense: 0,
  speed: 100,
  char: 'm',
};

/** Create a test entity with optional overrides */
export function createTestEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'test-entity',
    type: 'crawler',
    x: 0,
    y: 0,
    hp: 10,
    maxHp: 10,
    name: 'Test Entity',
    attack: 5,
    defense: 2,
    speed: 100,
    char: '@',
    areaId: DEFAULT_AREA_ID,
    ...overrides,
  };
}

/** Create a test crawler with optional overrides */
export function createTestCrawler(overrides: Partial<Entity> = {}): Entity {
  return { ...DEFAULT_TEST_CRAWLER, ...overrides };
}

/** Create a test monster with optional overrides */
export function createTestMonster(overrides: Partial<Entity> = {}): Entity {
  return { ...DEFAULT_TEST_MONSTER, ...overrides };
}

// --- Item Factories ---

/** Create a test item instance */
export function createTestItem(
  templateId: string,
  id?: string,
  position?: { x: number; y: number }
): ItemInstance {
  return {
    id: id ?? `item-${templateId}`,
    templateId,
    x: position?.x ?? 0,
    y: position?.y ?? 0,
    areaId: DEFAULT_AREA_ID,
  };
}

// --- GameState Factories ---

/** Create a minimal test GameState with floor tiles */
export function createMinimalGameState(overrides: Partial<GameState> = {}): GameState {
  const map: DungeonMap = {
    width: 10,
    height: 10,
    tiles: Array(10).fill(null).map(() => Array(10).fill({ type: 'floor' })),
    rooms: [],
    seed: 12345,
  };

  return {
    zone: createTestZone(map),
    currentAreaId: DEFAULT_AREA_ID,
    entities: { 'crawler-1': createTestCrawler() },
    items: [],
    bubbles: [],
    hibernating: [],
    exploredTiles: {},
    turn: 0,
    messages: [],
    gameStatus: { status: 'playing' },
    ...overrides,
  } as GameState;
}

/** Create test state with custom crawler configuration */
export function createTestStateWithCrawler(
  crawlerOverrides: Partial<Entity> = {},
  stateOverrides: Partial<GameState> = {}
): GameState {
  return createMinimalGameState({
    entities: { 'crawler-1': createTestCrawler(crawlerOverrides) },
    ...stateOverrides,
  });
}

// --- Scheduler Helpers ---

/**
 * Advance the scheduler in the first bubble to the next turn.
 * Sets up currentActorId so processAction can validate turns.
 */
export function advanceToNextTurn(state: GameState): GameState {
  if (state.bubbles.length === 0) return state;
  const bubble = state.bubbles[0];
  const advancedScheduler = advanceScheduler(bubble.scheduler);
  return {
    ...state,
    bubbles: [{ ...bubble, scheduler: advancedScheduler }, ...state.bubbles.slice(1)],
  };
}

/**
 * Advance scheduler until it's the player's turn.
 * Simulates monster turns passing until the player can act.
 */
export function advanceToPlayerTurn(
  state: GameState,
  playerId: string = TEST_PLAYER_ID
): GameState {
  let currentState = state;
  let iterations = 0;
  const maxIterations = 100;

  while (iterations < maxIterations) {
    iterations++;
    if (currentState.bubbles.length === 0) return currentState;

    const bubble = currentState.bubbles[0];
    const advancedScheduler = advanceScheduler(bubble.scheduler);
    currentState = {
      ...currentState,
      bubbles: [{ ...bubble, scheduler: advancedScheduler }, ...currentState.bubbles.slice(1)],
    };

    if (advancedScheduler.currentActorId === entityId(playerId)) {
      return currentState;
    }

    if (advancedScheduler.currentActorId) {
      const completedScheduler = completeCurrentTurn(advancedScheduler);
      currentState = {
        ...currentState,
        bubbles: [{ ...currentState.bubbles[0], scheduler: completedScheduler }, ...currentState.bubbles.slice(1)],
      };
    }
  }

  return currentState;
}

// --- Assertion Helpers ---

/** Union type for any action result (processAction or inventory operations) */
type AnyActionResult = ActionResult | InventoryActionResult;

/**
 * Assert that a result is successful and run assertions on the state.
 * Handles TypeScript narrowing automatically.
 *
 * @example
 * const result = processPickup(state, 'crawler-1');
 * expectSuccess(result, (state) => {
 *   expect(state.entities['crawler-1'].inventory).toHaveLength(1);
 * });
 */
export function expectSuccess(
  result: AnyActionResult,
  assertions?: (state: GameState) => void
): void {
  expect(result.success).toBe(true);
  if (result.success && assertions) {
    assertions(result.state);
  }
}

/**
 * Assert that a result is a failure with expected code and optional message.
 *
 * @example
 * const result = processPickup(state, 'crawler-1');
 * expectFailure(result, 'NO_ITEM');
 *
 * @example
 * const result = processAction(state, 'invalid', action);
 * expectFailure(result, 'ACTOR_NOT_FOUND', 'invalid');
 */
export function expectFailure(
  result: AnyActionResult,
  expectedCode: string,
  expectedMessagePart?: string
): void {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.code).toBe(expectedCode);
    if (expectedMessagePart) {
      expect(result.error).toContain(expectedMessagePart);
    }
  }
}
