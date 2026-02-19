/**
 * Speed-based Turn Scheduler
 *
 * Implements action point accumulation where faster entities act more often.
 * Each tick, all entities gain action points equal to their speed. The entity
 * with the highest accumulated points acts (costing 100 AP).
 *
 * Speed 100 is the baseline. Turn ratios depend on the competitive field:
 * - Two entities (100 vs 120): ~1.2x emergent turn ratio for the faster entity
 *   (directly reflects the 120/100 speed ratio via AP accumulation)
 * - Larger speed gaps create proportionally larger advantages
 * - In multi-entity scenarios, differences compound further
 *
 * ## Error Handling Philosophy
 *
 * This module uses a "warn and continue" pattern for edge cases that may
 * indicate logic errors but are not fatal:
 *
 * - `advanceScheduler` on empty scheduler: returns unchanged, logs warning
 * - `completeCurrentTurn` with no actor: returns unchanged, logs warning
 * - `addToScheduler` with duplicate entity: ignores, logs warning
 * - `removeFromScheduler` for non-existent entity: continues, logs warning
 *
 * This approach prevents mid-game crashes in production. All warnings are
 * logged via structured logging (Pino) for debugging. If warnings appear
 * frequently, investigate the game loop logic. Fatal errors (invalid speed,
 * empty IDs) still throw exceptions.
 */

import { z } from 'zod';
import { createLogger } from '../logging';

// --- Branded Types ---

/**
 * Branded type for entity IDs to prevent mixing with other string types.
 * Use `entityId()` to create a valid EntityId from a string.
 */
export type EntityId = string & { readonly __brand: 'EntityId' };

/**
 * Creates a branded EntityId from a string.
 * @param id - The entity ID string
 * @returns A branded EntityId
 * @throws Error if id is empty or whitespace-only
 */
export function entityId(id: string): EntityId {
  if (!id || id.trim().length === 0) {
    throw new Error('EntityId cannot be empty');
  }
  return id as EntityId;
}

// --- Zod Schemas ---

export const EntitySpeedSchema = z.object({
  id: z.string().min(1),
  speed: z.number().int().positive(),
});

export const SchedulerEntrySchema = z.object({
  entityId: z.string().min(1),
  speed: z.number().int().positive(),
  actionPoints: z.number().int(),
});

export const SchedulerStateSchema = z.object({
  entries: z.array(SchedulerEntrySchema),
  currentActorId: z.string().nullable(),
});

// --- Types ---

/**
 * Branded type for entity speed values.
 *
 * Speed must be a positive integer. Speed 100 is the baseline:
 * - Speed 120: ~1.2x turns vs speed 100
 * - Speed 80: ~0.8x turns vs speed 100
 *
 * Use `speed()` to create a valid Speed from a number.
 */
export type Speed = number & { readonly __brand: 'Speed' };

/**
 * Creates a branded Speed from a number.
 * @param value - The speed value (must be a positive integer)
 * @returns A branded Speed
 * @throws Error if value is not a positive finite integer
 */
export function speed(value: number): Speed {
  if (value <= 0) {
    throw new Error(`Speed must be positive, got ${value}`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Speed must be finite, got ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Speed must be an integer, got ${value}`);
  }
  return value as Speed;
}

export interface SchedulerEntry {
  readonly entityId: EntityId;
  /**
   * Speed value (positive integer). See `Speed` type for details.
   *
   * Note: While this is typed as `number` for compatibility with JSON/Zod,
   * values should be validated via `speed()` before use when coming from
   * untrusted sources.
   */
  readonly speed: number;
  /** Current action points. Can be negative after completing an action. */
  readonly actionPoints: number;
}

/**
 * Scheduler state container.
 *
 * ## Invariants (maintained by scheduler functions)
 *
 * - `entries` contains no duplicate entityIds
 * - All entries have positive integer `speed` values
 * - `currentActorId` when non-null references an entry in `entries`
 * - The array is immutable (frozen at creation)
 */
export interface SchedulerState {
  readonly entries: readonly SchedulerEntry[];
  readonly currentActorId: EntityId | null;
}

/**
 * Minimal entity info needed for scheduler operations.
 *
 * This interface represents the minimum data needed to add an entity
 * to the scheduler. The `speed` value determines turn frequency via
 * AP accumulation.
 */
export interface EntitySpeed {
  readonly id: EntityId;
  /**
   * Speed value (positive integer). See `Speed` type for details.
   *
   * Note: While this is typed as `number` for JSON/Zod compatibility,
   * validate via `speed()` when coming from untrusted sources.
   */
  readonly speed: number;
}

// --- Scheduler Interface ---

/**
 * Scheduler interface for pluggable turn paradigms.
 *
 * This interface allows different scheduling strategies (AP accumulation,
 * initiative order, etc.) to be swapped without changing the simulation loop.
 *
 * The default implementation is AP accumulation (roguelike style) where
 * faster entities get proportionally more turns.
 *
 * ## Implementing a Custom Scheduler
 *
 * To create a new scheduler paradigm:
 * 1. Define a state type that holds your scheduler's data
 * 2. Implement all methods of this interface
 * 3. Use your scheduler implementation in bubble creation
 *
 * ## Contract
 *
 * Implementations must satisfy these invariants:
 * - `canAct` is a pure query - it must not modify state
 * - `canAct` must return the same entity until `completeAction` is called
 * - After `completeAction`, the completed entity should not be returned by
 *   `canAct` until conditions are met (e.g., enough AP accumulated)
 * - `advanceTime` should only be called when `canAct` returns null
 * - Tie-breaking must be deterministic for reproducible gameplay
 *
 * @typeParam TState - The scheduler state type
 */
export interface Scheduler<TState> {
  /**
   * Query: Who can act right now?
   *
   * Returns the entity ID of whoever should act next, or null if no entity
   * can currently afford an action. When null is returned, callers should
   * invoke `advanceTime` to progress the simulation.
   *
   * This is a pure query that must not modify state. Implementations must
   * break ties deterministically for reproducible gameplay.
   *
   * @param state - Current scheduler state
   * @returns EntityId of next actor, or null if time must advance
   */
  canAct(state: TState): EntityId | null;

  /**
   * Complete an entity's action.
   *
   * Called after an entity has taken their action. This typically deducts
   * the action cost (e.g., 100 AP in the default scheduler) from the entity.
   *
   * After this call, the entity should not be returned by `canAct` until
   * they can afford another action.
   *
   * @param state - Current scheduler state
   * @param entityId - ID of the entity that completed their action
   * @returns Updated scheduler state with action cost deducted
   */
  completeAction(state: TState, entityId: EntityId): TState;

  /**
   * Advance time when no one can act.
   *
   * Called when `canAct` returns null. This typically grants resources to
   * all entities (e.g., AP based on speed in the default scheduler) until
   * at least one entity can act.
   *
   * @param state - Current scheduler state
   * @returns Updated scheduler state with time advanced
   */
  advanceTime(state: TState): TState;

  /**
   * Add an entity to the scheduler.
   *
   * Called when a new entity enters the bubble (e.g., monster wakes up,
   * crawler joins). The entity typically starts with zero resources.
   *
   * @param state - Current scheduler state
   * @param entity - Entity to add with ID and speed
   * @returns Updated scheduler state with entity added
   */
  addEntity(state: TState, entity: EntitySpeed): TState;

  /**
   * Remove an entity from the scheduler.
   *
   * Called when an entity leaves the bubble (e.g., dies, splits off).
   *
   * @param state - Current scheduler state
   * @param entityId - ID of the entity to remove
   * @returns Updated scheduler state with entity removed
   */
  removeEntity(state: TState, entityId: EntityId): TState;

  /**
   * Create initial scheduler state from a list of entities.
   *
   * Called when creating a new bubble. All entities typically start with
   * zero resources.
   *
   * @param entities - Array of entities with their ID and speed values
   * @returns Initial scheduler state ready for use
   */
  createState(entities: readonly EntitySpeed[]): TState;
}

/**
 * AP Accumulation scheduler implementation.
 *
 * Implements the roguelike-style scheduler where entities gain AP equal
 * to their speed each tick, and spend 100 AP to take a turn.
 *
 * ## How It Works
 *
 * 1. Each entity accumulates action points (AP) equal to their speed per tick
 * 2. When AP >= 100, the entity can act (spending 100 AP)
 * 3. Faster entities accumulate AP faster, getting more turns over time
 *
 * ## Speed Examples
 *
 * - Speed 100 (baseline): 1 turn per tick cycle
 * - Speed 120: ~1.2 turns per tick cycle (20% faster)
 * - Speed 80: ~0.8 turns per tick cycle (20% slower)
 * - Speed 50: ~0.5 turns per tick cycle (half speed)
 *
 * ## Usage
 *
 * ```typescript
 * // Create initial state with entities
 * const scheduler = APScheduler.createState([
 *   { id: entityId('player'), speed: 100 },
 *   { id: entityId('rat'), speed: 120 },
 * ]);
 *
 * // Check who can act
 * const actorId = APScheduler.canAct(scheduler);
 * if (actorId) {
 *   // Process action...
 *   scheduler = APScheduler.completeAction(scheduler, actorId);
 * } else {
 *   // No one can act, advance time
 *   scheduler = APScheduler.advanceTime(scheduler);
 * }
 * ```
 */
export const APScheduler: Scheduler<SchedulerState> = {
  canAct,
  completeAction,
  advanceTime: advanceScheduler,
  addEntity: addToScheduler,
  removeEntity: removeFromScheduler,
  createState: createScheduler,
};

// --- Constants ---

/** The cost in action points to take a turn. */
export const ACTION_COST = 100;

// --- Structured Logging ---

const schedulerLogger = createLogger({ module: 'scheduler' });

/**
 * Warning logger for scheduler operations that may indicate logic errors.
 * Uses structured logging (Pino) by default. Can be overridden for testing.
 */
export let schedulerWarnLog: (message: string, context?: Record<string, unknown>) => void =
  (message: string, context?: Record<string, unknown>) => {
    schedulerLogger.warn(context ?? {}, message);
  };

/**
 * Set custom warning logger for scheduler operations.
 * Pass a no-op function to silence warnings (not recommended in production).
 */
export function setSchedulerWarnLog(logger: (message: string, context?: Record<string, unknown>) => void): void {
  schedulerWarnLog = logger;
}

/**
 * Reset warning logger to default structured logging behavior.
 */
export function resetSchedulerWarnLog(): void {
  schedulerWarnLog = (message: string, context?: Record<string, unknown>) => {
    schedulerLogger.warn(context ?? {}, message);
  };
}

// Test-only functions to capture warning output as strings for assertions
export function enableSchedulerDebugLogging(logger: (message: string) => void = () => {}): void {
  schedulerWarnLog = (message: string, context?: Record<string, unknown>) => {
    // Format message with context for test compatibility
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    logger(`${message}${contextStr}`);
  };
}
export function disableSchedulerDebugLogging(): void {
  schedulerWarnLog = () => {};
}

// --- Helper Functions ---

/**
 * Validates that an entity's speed is a positive finite integer.
 * @throws Error if speed is invalid
 */
function validateSpeed(entityId: EntityId, speed: number): void {
  if (speed <= 0) {
    throw new Error(
      `Entity ${entityId} has invalid speed ${speed}: speed must be positive`
    );
  }
  if (!Number.isFinite(speed)) {
    throw new Error(
      `Entity ${entityId} has invalid speed ${speed}: speed must be a finite number`
    );
  }
  if (!Number.isInteger(speed)) {
    throw new Error(
      `Entity ${entityId} has invalid speed ${speed}: speed must be an integer`
    );
  }
}

// --- Factory Functions ---

/**
 * Creates a new scheduler with the given entities.
 * All entities start with 0 action points and no current actor.
 *
 * @param entities - Array of entities with their ID and speed values
 * @returns A new SchedulerState ready for use with advanceScheduler
 * @throws Error if any entity has non-positive, non-finite, or non-integer speed
 */
export function createScheduler(entities: readonly EntitySpeed[]): SchedulerState {
  // Validate entities
  for (const entity of entities) {
    validateSpeed(entity.id, entity.speed);
  }

  return Object.freeze({
    entries: Object.freeze(entities.map(e => Object.freeze({
      entityId: e.id,
      speed: e.speed,
      actionPoints: 0,
    }))),
    currentActorId: null,
  });
}

// --- Scheduler Operations ---

/**
 * Advances the scheduler by one tick.
 *
 * Each entity gains action points equal to their speed. The entity with the
 * highest accumulated action points becomes the current actor. Ties are broken
 * by entry order (first entity in the list wins).
 *
 * @param scheduler - Current scheduler state
 * @returns Updated scheduler with new action points and currentActorId set
 *
 * @remarks
 * Returns unchanged state if scheduler is empty. This is intentional to
 * handle edge cases gracefully, but callers should check entries.length
 * before calling if they need to detect this condition.
 */
export function advanceScheduler(scheduler: SchedulerState): SchedulerState {
  if (scheduler.entries.length === 0) {
    schedulerWarnLog('advanceScheduler called on empty scheduler', { action: 'advanceScheduler' });
    return scheduler;
  }

  // Accumulate action points based on speed
  const updatedEntries = scheduler.entries.map(entry => Object.freeze({
    ...entry,
    actionPoints: entry.actionPoints + entry.speed,
  }));

  // Find entity with highest action points (first in list wins ties)
  let maxAP = -1;
  let nextActorId: EntityId | null = null;
  for (const entry of updatedEntries) {
    if (entry.actionPoints > maxAP) {
      maxAP = entry.actionPoints;
      nextActorId = entry.entityId;
    }
  }

  return Object.freeze({
    entries: Object.freeze(updatedEntries),
    currentActorId: nextActorId,
  });
}

/**
 * Completes the current actor's turn by deducting the action cost.
 *
 * Deducts ACTION_COST (100) from the current actor's action points and
 * clears currentActorId. Call advanceScheduler after this to determine
 * the next actor.
 *
 * @param scheduler - Current scheduler state with a currentActorId
 * @returns Updated scheduler with reduced AP and null currentActorId
 *
 * @remarks
 * Returns unchanged state if there is no current actor. This logs a warning
 * as it may indicate a logic error in the game loop.
 */
export function completeCurrentTurn(scheduler: SchedulerState): SchedulerState {
  const currentId = scheduler.currentActorId;
  if (currentId === null) {
    schedulerWarnLog('completeCurrentTurn called with no current actor', {
      action: 'completeCurrentTurn',
      hint: 'This may indicate a logic error - call advanceScheduler first',
    });
    return scheduler;
  }

  return Object.freeze({
    entries: Object.freeze(scheduler.entries.map(entry =>
      entry.entityId === currentId
        ? Object.freeze({ ...entry, actionPoints: entry.actionPoints - ACTION_COST })
        : entry
    )),
    currentActorId: null,
  });
}

/**
 * Adds a new entity to the scheduler.
 *
 * The entity starts with 0 action points. If an entity with the same ID
 * already exists, the scheduler is returned unchanged (duplicates are ignored).
 *
 * @param scheduler - Current scheduler state
 * @param entity - Entity to add with ID and speed
 * @returns Updated scheduler with the new entity, or unchanged if duplicate
 *
 * @remarks
 * Logs a warning when a duplicate entity is detected, as this may indicate
 * a logic error. Note that adding a duplicate does NOT update the speed -
 * the original entry is preserved.
 */
export function addToScheduler(
  scheduler: SchedulerState,
  entity: EntitySpeed
): SchedulerState {
  // Don't add duplicates
  if (scheduler.entries.some(e => e.entityId === entity.id)) {
    schedulerWarnLog('addToScheduler: entity already exists', {
      action: 'addToScheduler',
      entityId: entity.id,
      hint: 'Original speed preserved - use a different operation to update speed',
    });
    return scheduler;
  }

  // Validate speed
  validateSpeed(entity.id, entity.speed);

  return Object.freeze({
    ...scheduler,
    entries: Object.freeze([
      ...scheduler.entries,
      Object.freeze({
        entityId: entity.id,
        speed: entity.speed,
        actionPoints: 0,
      }),
    ]),
  });
}

/**
 * Query: Who can act right now?
 *
 * Returns the entity with the highest action points if they have >= ACTION_COST,
 * otherwise returns null. This is a pure query that does not modify state.
 *
 * Ties are broken by entry order (first in list wins).
 *
 * @param scheduler - Current scheduler state
 * @returns EntityId of actor who can act, or null if no one can
 */
export function canAct(scheduler: SchedulerState): EntityId | null {
  if (scheduler.entries.length === 0) {
    return null;
  }

  let maxAP = -1;
  let actorId: EntityId | null = null;

  for (const entry of scheduler.entries) {
    if (entry.actionPoints > maxAP) {
      maxAP = entry.actionPoints;
      actorId = entry.entityId;
    }
  }

  // Only return actor if they have enough AP to act
  if (maxAP >= ACTION_COST) {
    return actorId;
  }

  return null;
}

/**
 * Complete an entity's action by deducting ACTION_COST from their AP.
 *
 * Unlike completeCurrentTurn, this takes an explicit entityId parameter,
 * allowing the caller to specify which entity completed their action.
 * This is the preferred API for the new scheduler model.
 *
 * @param scheduler - Current scheduler state
 * @param entityIdToComplete - ID of the entity that completed their action
 * @returns Updated scheduler with reduced AP for the specified entity
 *
 * @remarks
 * If the entity is not found, logs a warning and returns unchanged state.
 * If the completed entity was currentActorId, clears currentActorId.
 */
export function completeAction(
  scheduler: SchedulerState,
  entityIdToComplete: EntityId
): SchedulerState {
  const exists = scheduler.entries.some(e => e.entityId === entityIdToComplete);
  if (!exists) {
    schedulerWarnLog('completeAction: entity not found', {
      action: 'completeAction',
      entityId: entityIdToComplete,
      hint: 'Check entity ID or verify entity was added to scheduler',
    });
    return scheduler;
  }

  return Object.freeze({
    entries: Object.freeze(scheduler.entries.map(entry =>
      entry.entityId === entityIdToComplete
        ? Object.freeze({ ...entry, actionPoints: entry.actionPoints - ACTION_COST })
        : entry
    )),
    currentActorId: scheduler.currentActorId === entityIdToComplete
      ? null
      : scheduler.currentActorId,
  });
}

/**
 * Removes an entity from the scheduler.
 *
 * If the entity is the current actor, currentActorId is cleared.
 * If the entity does not exist, the scheduler is returned unchanged
 * and a warning is logged.
 *
 * @param scheduler - Current scheduler state
 * @param entityIdToRemove - ID of the entity to remove
 * @returns Updated scheduler without the specified entity, or unchanged if not found
 *
 * @remarks
 * Logs a warning when attempting to remove a non-existent entity, as this
 * may indicate a logic error (typo in ID, double-removal, etc.).
 */
export function removeFromScheduler(
  scheduler: SchedulerState,
  entityIdToRemove: EntityId
): SchedulerState {
  const exists = scheduler.entries.some(e => e.entityId === entityIdToRemove);
  if (!exists) {
    schedulerWarnLog('removeFromScheduler: entity not found', {
      action: 'removeFromScheduler',
      entityId: entityIdToRemove,
      hint: 'Check for typos or double-removal',
    });
  }

  return Object.freeze({
    entries: Object.freeze(scheduler.entries.filter(e => e.entityId !== entityIdToRemove)),
    currentActorId: scheduler.currentActorId === entityIdToRemove ? null : scheduler.currentActorId,
  });
}
