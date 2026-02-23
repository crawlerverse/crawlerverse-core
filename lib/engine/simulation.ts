/**
 * Bubble Simulation
 *
 * Runs the turn-based simulation loop for a single bubble.
 * Processes entities in turn order, executing actions from queues
 * or AI for monsters.
 *
 * ## Scheduler Abstraction
 *
 * The simulation loop is decoupled from the specific turn scheduling algorithm.
 * The `Scheduler<TState>` interface in scheduler.ts defines the contract:
 * - `canAct(state)` - Query who can act now
 * - `completeAction(state, entityId)` - Mark an action as complete
 * - `advanceTime(state)` - Advance time when no one can act
 *
 * Different scheduler implementations can provide different turn paradigms:
 * - **APScheduler** (default): Action Point accumulation for speed-based turns
 * - Future: Initiative-based, real-time, etc.
 *
 * ## Default Scheduler: AP Accumulation
 *
 * The default `APScheduler` uses Action Point accumulation where faster entities
 * act more frequently. This creates emergent turn ratios based on relative speeds.
 *
 * ### Core Mechanics
 *
 * 1. **AP Accumulation**: Each scheduler tick, every entity gains AP equal to their
 *    speed. The entity with the highest accumulated AP acts next (costs 100 AP).
 *
 * 2. **Speed Baseline**: Speed 100 is the baseline. A speed-120 rat gets ~1.2 turns
 *    per speed-100 player turn. A speed-80 troll gets ~0.8 turns per player turn.
 *
 * 3. **Tie Breaking**: When multiple entities have equal AP, the first in the
 *    scheduler's entry list wins. By convention, crawlers (players) are listed
 *    first, giving them priority in ties.
 *
 * ### Turn Ratio Examples (APScheduler)
 *
 * Over 10 player (speed 100) turns:
 * - Speed 120 rat: ~12 turns (1.2x player)
 * - Speed 100 goblin: ~10 turns (1.0x player)
 * - Speed 80 troll: ~8 turns (0.8x player)
 * - Speed 50 slug: ~5 turns (0.5x player)
 *
 * These are approximate - actual ratios emerge from AP dynamics and may vary
 * slightly based on starting conditions and tie-breaking.
 *
 * ### Slow Monster Fairness
 *
 * The AP accumulation system naturally handles "slow monster fairness". Unlike
 * simple alternating turn systems where a slow monster might never act, the AP
 * system guarantees that every entity eventually accumulates enough AP to act.
 *
 * Example: A speed-50 slug vs speed-100 player:
 * - Tick 1: Player 100 AP (acts), Slug 50 AP
 * - Tick 2: Player 100 AP (acts), Slug 100 AP
 * - Tick 3: Player 100 AP, Slug 150 AP (slug acts due to higher AP)
 * - Result: Slug gets 1 turn per 2 player turns (0.5x ratio as expected)
 */

import * as ROT from 'rot-js';
import type { Entity, Action, Direction, GameState, GameStatus, Message, ExploredTiles, Position, AIMetadata, CombatDetails, EventTracking } from './state';
import { isCrawler, createMessage, getCurrentArea, deltaToPosition, getCrawlersInArea } from './state';
import { computeVisibleTiles, updateExploredTiles, type TileKey, hasLineOfSight, tileKey } from './fov';
import { computeMonsterFOV, isEntityVisible } from './fov';
import {
  updateBehaviorState,
  reachedHuntTarget,
  selectRangedAction,
} from './behavior';
import type { Bubble } from './bubble';
import { dequeueCommand, wakeNearbyEntities } from './bubble';
import { canAct, completeAction, advanceScheduler, removeFromScheduler, entityId, type EntityId, type SchedulerState } from './scheduler';
import { isPassable } from './map';
import { processPickup, processDrop, processUse, processEquip } from './inventory';
import { resolveAttack, resolveCombatWithRoll } from './combat';
import { dropLoot, rollLootTableDrop } from './monster-equipment';
import type { ItemInstance } from './items';
import { getItemTemplate, isEquipmentTemplate, type EquipmentTemplate } from './items';
import { createLogger } from '../logging';
import { updateObjectivesForCrawlers } from './objective';
import { isCrawlerId, toCrawlerId, type CrawlerId } from './crawler-id';
import { EventType, GameEventEmitter } from './events';
import { tickEffects, hasEffect, removeEffectsFromSource, type ActiveEffect } from './effects';
import { getEffectiveVisionRadius } from './stats';

// --- Structured Logging ---
const simulationLogger = createLogger({ module: 'simulation' });

// --- Combat Event Emission Helper ---

/**
 * Emit combat events (FIRST_BLOOD, CRITICAL_HP, KILL, CRAWLER_DEATH) for an attack.
 * Consolidates event emission logic shared between melee, ranged, and future attack types.
 *
 * @param state - Current game state (will be mutated for event tracking)
 * @param actor - Attacking entity
 * @param target - Target entity being hit
 * @param combatResult - Result of combat resolution (damage, hit, critical, etc.)
 * @returns Modified target entity (with updated HP) if target died, otherwise undefined
 */
function emitCombatEvents(
  state: GameState,
  actor: Entity,
  target: Entity,
  combatResult: { damage: number; hit: boolean; isCritical: boolean }
): Entity | undefined {
  const newHp = target.hp - combatResult.damage;
  const currentAreaId = actor.areaId;
  const areaTracking = state.eventTracking?.combatState?.[currentAreaId];

  // If no event emitter, just return deadEntity if target died
  if (!state.eventEmitter) {
    return newHp <= 0 ? { ...target, hp: 0 } : undefined;
  }

  // Early return if no damage dealt
  if (combatResult.damage === 0) {
    return undefined;
  }

  // 1. FIRST_BLOOD - first damage in encounter
  if (combatResult.damage > 0 && !areaTracking?.combatStarted) {
    const { eventEmitter, ...stateWithoutEmitter } = state;
    state.eventEmitter.emit({
      type: EventType.FIRST_BLOOD,
      timestamp: Date.now(),
      context: structuredClone(stateWithoutEmitter) as GameState,
      entities: [actor, target],
      metadata: {
        damage: combatResult.damage,
        isCritical: combatResult.isCritical,
        ...(actor.equippedWeapon && { weapon: actor.equippedWeapon }),
      },
    });
  }

  // 2. CRITICAL_HP - crossing 25% HP threshold
  const hpPercent = target.hp / target.maxHp;
  const newHpPercent = newHp / target.maxHp;
  const wasCritical = state.eventTracking?.entitiesBelowCritical.has(entityId(target.id)) ?? false;

  if (hpPercent >= 0.25 && newHpPercent < 0.25 && !wasCritical) {
    const { eventEmitter, ...stateWithoutEmitter } = state;
    state.eventEmitter.emit({
      type: EventType.CRITICAL_HP,
      timestamp: Date.now(),
      context: structuredClone(stateWithoutEmitter) as GameState,
      entities: [target],
      metadata: {
        currentHp: newHp,
        maxHp: target.maxHp,
        hpPercentage: (newHpPercent * 100),
      },
    });

    // Track this entity as being below critical HP
    if (!state.eventTracking) {
      throw new Error('eventTracking is undefined - cannot track critical HP');
    }
    state.eventTracking.entitiesBelowCritical.add(entityId(target.id));
  }

  // 3. KILL - target died
  if (newHp <= 0) {
    const deadEntity = { ...target, hp: 0 };
    const { eventEmitter, ...stateWithoutEmitter } = state;

    state.eventEmitter.emit({
      type: EventType.KILL,
      timestamp: Date.now(),
      context: structuredClone(stateWithoutEmitter) as GameState,
      entities: [actor, deadEntity],
      metadata: {
        damage: combatResult.damage,
        isCritical: combatResult.isCritical,
        ...(actor.equippedWeapon && { weapon: actor.equippedWeapon }),
        killsThisEncounter: (areaTracking?.killsThisEncounter ?? 0) + 1,
      },
    });

    // Increment kills counter for this encounter
    if (state.eventTracking) {
      if (areaTracking) {
        state.eventTracking.combatState = {
          ...state.eventTracking.combatState,
          [currentAreaId]: {
            ...areaTracking,
            killsThisEncounter: (areaTracking.killsThisEncounter ?? 0) + 1,
          },
        };
      } else {
        // Initialize combat state if it doesn't exist yet (kill before FIRST_BLOOD)
        state.eventTracking.combatState = {
          ...state.eventTracking.combatState,
          [currentAreaId]: {
            combatStarted: false,
            wasInCombat: false,
            killsThisEncounter: 1,
          },
        };
      }
    }

    // 4. CRAWLER_DEATH - crawler died
    if (isCrawler(target)) {
      state.eventEmitter.emit({
        type: EventType.CRAWLER_DEATH,
        timestamp: Date.now(),
        context: structuredClone(stateWithoutEmitter) as GameState,
        entities: [deadEntity],
        metadata: {
          killedBy: actor.name,
        },
      });
    }

    return deadEntity;
  }

  return undefined;
}

// --- Direction Deltas ---
export const DIRECTION_DELTAS: Record<Direction, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};

/**
 * Check if diagonal movement is blocked by corner-cutting.
 * A diagonal move is blocked only if BOTH adjacent cardinal tiles are walls.
 *
 * This follows the "moderate" roguelike convention (used by NetHack corridors):
 * - You CAN squeeze past a single wall corner (one cardinal blocked)
 * - You CANNOT squeeze through a gap where both cardinals are blocked
 *
 * @param state - Current game state (for map access)
 * @param fromX - Starting X position
 * @param fromY - Starting Y position
 * @param dx - X direction delta (-1, 0, or 1)
 * @param dy - Y direction delta (-1, 0, or 1)
 * @returns true if the diagonal move is blocked, false otherwise
 */
export function isDiagonalBlocked(
  state: GameState,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number
): boolean {
  // Cardinal moves are never blocked by this rule
  if (dx === 0 || dy === 0) return false;
  // Block only if BOTH adjacent cardinal tiles are impassable
  const { map } = getCurrentArea(state);
  return !isPassable(map, fromX + dx, fromY) && !isPassable(map, fromX, fromY + dy);
}

/**
 * Options for the public simulate() function.
 */
export interface SimulateOptions {
  /** Maximum iterations before stopping (prevents runaway) */
  readonly maxIterations?: number;
}

/**
 * Internal options for bubble simulation (includes required gameState).
 */
interface BubbleSimulationOptions {
  /** Maximum iterations before stopping (prevents runaway) */
  readonly maxIterations?: number;
  /** Current game state (required for map access and monster AI) */
  readonly gameState: GameState;
  /** Optional RNG for combat rolls (for testing). If not provided, uses seeded RNG. */
  readonly combatRng?: typeof ROT.RNG;
}

/**
 * Result of simulating a bubble.
 */
export interface SimulationResult {
  /** Updated bubble state */
  readonly bubble: Bubble;
  /** Updated entities */
  readonly entities: Record<string, Entity>;
  /** Updated items (after pickup/drop actions) */
  readonly items: readonly import('./items').ItemInstance[];
  /** Messages generated during simulation */
  readonly messages: readonly Message[];
  /** Crawlers with empty queues who could act (need input) */
  readonly waitingFor: readonly EntityId[];
  /** Number of iterations used */
  readonly iterationsUsed: number;
  /** Game status (win/lose/playing) */
  readonly gameStatus: GameStatus;
  /**
   * Whether simulation was interrupted due to iteration limit.
   * If true, the simulation did not complete naturally - it hit maxIterations
   * while the game was still playing. This may indicate:
   * - Runaway monster AI
   * - Scheduler bugs
   * - Need for higher maxIterations value
   *
   * Callers should check this flag and potentially warn or retry.
   */
  readonly truncated: boolean;
  /** Updated explored tiles for crawlers who moved */
  readonly exploredTilesUpdates: ExploredTiles;
}

const DEFAULT_MAX_ITERATIONS = 100;

// --- Helper Functions ---

function monsterAt(monsters: readonly Entity[], x: number, y: number): Entity | undefined {
  return monsters.find((m) => m.x === x && m.y === y);
}

/**
 * Check if two entities are adjacent (8-way).
 * Returns true if entities are within Chebyshev distance of 1 (but not overlapping).
 */
function isAdjacent(a: Entity, b: Entity): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && (dx + dy > 0);
}

/**
 * Calculate next position for monster moving toward target using A* pathfinding.
 * Returns null if no valid path exists or if A* suggests a corner-cutting
 * move that would violate the diagonal blocking rules.
 */
function calculateMoveToward(
  monster: Entity,
  target: Entity,
  state: GameState,
  monsters: readonly Entity[]
): { x: number; y: number } | null {
  try {
    const { map } = getCurrentArea(state);
    const passableCallback = (x: number, y: number): boolean => {
      // Walls are impassable
      if (!isPassable(map, x, y)) return false;
      // Own position is passable (starting point)
      if (x === monster.x && y === monster.y) return true;
      // Other monsters are impassable
      if (monsterAt(monsters, x, y)) return false;
      // Player position and empty floor tiles are passable
      return true;
    };

    const astar = new ROT.Path.AStar(
      target.x,
      target.y,
      passableCallback,
      { topology: 8 }
    );

    // Collect path cells in order: [start, next, ..., goal]
    const pathCells: Array<{ x: number; y: number }> = [];

    astar.compute(monster.x, monster.y, (x, y) => {
      pathCells.push({ x, y });
    });

    if (pathCells.length < 2) {
      return null;
    }

    const nextStep = pathCells[1];

    // Validate the move doesn't corner-cut through walls
    const dx = nextStep.x - monster.x;
    const dy = nextStep.y - monster.y;
    if (isDiagonalBlocked(state, monster.x, monster.y, dx, dy)) {
      // A* suggested a corner cut, fall back to no move
      return null;
    }

    return nextStep;
  } catch (error) {
    // If A* fails for any reason, monster simply doesn't move this turn
    simulationLogger.error(
      {
        monsterId: monster.id,
        targetId: target.id,
        monsterPos: { x: monster.x, y: monster.y },
        targetPos: { x: target.x, y: target.y },
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'A* pathfinding failed - monster will not move this turn'
    );
    return null;
  }
}

/**
 * Calculate next position for monster moving toward a target position.
 * Similar to calculateMoveToward but targets a position instead of entity.
 */
function calculateMoveTowardPosition(
  monster: Entity,
  targetPos: { x: number; y: number },
  state: GameState,
  monsters: readonly Entity[]
): { x: number; y: number } | null {
  try {
    const { map } = getCurrentArea(state);
    const passableCallback = (x: number, y: number): boolean => {
      if (!isPassable(map, x, y)) return false;
      if (x === monster.x && y === monster.y) return true;
      if (monsterAt(monsters, x, y)) return false;
      return true;
    };

    const astar = new ROT.Path.AStar(
      targetPos.x,
      targetPos.y,
      passableCallback,
      { topology: 8 }
    );

    const pathCells: Array<{ x: number; y: number }> = [];
    astar.compute(monster.x, monster.y, (x, y) => {
      pathCells.push({ x, y });
    });

    if (pathCells.length < 2) {
      return null;
    }

    const nextStep = pathCells[1];
    const dx = nextStep.x - monster.x;
    const dy = nextStep.y - monster.y;
    if (isDiagonalBlocked(state, monster.x, monster.y, dx, dy)) {
      return null;
    }

    return nextStep;
  } catch (error) {
    // If A* fails for any reason, monster simply doesn't move this turn
    simulationLogger.error(
      {
        monsterId: monster.id,
        targetPos,
        monsterPos: { x: monster.x, y: monster.y },
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'A* pathfinding to position failed - monster will not move this turn'
    );
    return null;
  }
}

/**
 * Get passable adjacent tiles that aren't occupied by other monsters.
 * Used for patrol and search movement.
 */
function getPassableAdjacent(
  entity: Entity,
  state: GameState,
  monsters: readonly Entity[]
): Position[] {
  const adjacent: Position[] = [];
  const { map } = getCurrentArea(state);

  for (const [dx, dy] of Object.values(DIRECTION_DELTAS)) {
    const newX = entity.x + dx;
    const newY = entity.y + dy;

    // Check passability
    if (!isPassable(map, newX, newY)) continue;

    // Check diagonal blocking
    if (isDiagonalBlocked(state, entity.x, entity.y, dx, dy)) continue;

    // Check for other monsters
    if (monsterAt(monsters, newX, newY)) continue;

    adjacent.push({ x: newX, y: newY });
  }

  return adjacent;
}

/**
 * Chebyshev distance (chessboard distance) between two positions.
 * Used to constrain search movement within a radius.
 */
function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Helper to create message and track index */
function messageBuilder(turn: number, prefix?: string) {
  let index = 0;
  return (text: string, reasoning?: string, aiMetadata?: AIMetadata, combatDetails?: CombatDetails): Message =>
    createMessage(text, turn, index++, prefix, reasoning, aiMetadata, combatDetails);
}

/**
 * Process a single monster's AI action.
 * Monster will attack if adjacent to target, otherwise move toward target.
 * Returns updated monsters array and player, plus any messages generated.
 */
export function processMonsterAI(
  monster: Entity,
  player: Entity,
  monsters: Entity[],
  state: GameState,
  addMessage: (text: string, reasoning?: string, aiMetadata?: AIMetadata, combatDetails?: CombatDetails) => Message,
  combatRng?: typeof ROT.RNG
): {
  player: Entity;
  monsters: Entity[];
  messages: Message[];
} {
  const messages: Message[] = [];
  let updatedPlayer = player;
  let updatedMonsters = [...monsters];

  if (isAdjacent(monster, player)) {
    // Attack player - use combat RNG if provided, otherwise use global RNG
    const rng = combatRng ?? ROT.RNG;
    const roll = rng.getUniform();
    const combatResult = resolveAttack(monster, player, roll);

    if (!combatResult.hit) {
      messages.push(addMessage(`${monster.name} misses you.`, undefined, undefined, combatResult));
    } else {
      const critText = combatResult.isCritical ? ' (Critical!)' : '';
      updatedPlayer = { ...player, hp: player.hp - combatResult.damage };
      messages.push(addMessage(
        `${monster.name} hits you for ${combatResult.damage} damage.${critText}`,
        undefined,
        undefined,
        combatResult
      ));
    }
  } else {
    // Move toward player
    const newPos = calculateMoveToward(monster, player, state, monsters);
    if (newPos) {
      updatedMonsters = monsters.map((m) =>
        m.id === monster.id ? { ...m, x: newPos.x, y: newPos.y } : m
      );
    }
  }

  return { player: updatedPlayer, monsters: updatedMonsters, messages };
}

/**
 * Result of executing a single action.
 */
interface ActionExecutionResult {
  /** Updated entities */
  readonly entities: Record<string, Entity>;
  /** Messages generated */
  readonly messages: readonly Message[];
  /** Game status after action (may indicate win/lose) */
  readonly gameStatus: GameStatus;
  /** IDs of entities that were killed and should be removed from scheduler */
  readonly killedIds: readonly EntityId[];
  /** Updated items array (may include loot drops from killed monsters) */
  readonly items: readonly ItemInstance[];
}

/**
 * Execute a single action for an entity.
 *
 * Handles move, attack, and wait actions. Returns updated entities,
 * messages, and game status.
 */
function executeAction(
  entities: Record<string, Entity>,
  actorId: EntityId,
  action: Action,
  state: GameState,
  addMessage: (text: string, reasoning?: string, aiMetadata?: AIMetadata, combatDetails?: CombatDetails) => Message,
  combatRng: typeof ROT.RNG
): ActionExecutionResult {
  const messages: Message[] = [];
  const killedIds: EntityId[] = [];
  let gameStatus: GameStatus = { status: 'playing' };
  let currentItems: ItemInstance[] = [...state.items];

  const actor = entities[actorId as string];
  if (!actor) {
    simulationLogger.warn(
      { actorId },
      'executeAction called for non-existent actor - may indicate state corruption or race condition'
    );
    return { entities, messages, gameStatus, killedIds, items: currentItems };
  }

  let updatedEntities = { ...entities };

  if (action.action === 'move') {
    const [dx, dy] = DIRECTION_DELTAS[action.direction];
    const newX = actor.x + dx;
    const newY = actor.y + dy;

    if (!isPassable(getCurrentArea(state).map, newX, newY)) {
      messages.push(addMessage(`${actor.name} bumps into a wall.`));
    } else if (isDiagonalBlocked(state, actor.x, actor.y, dx, dy)) {
      messages.push(addMessage(`${actor.name} cannot squeeze through that gap.`));
    } else {
      // Check for entity at destination
      const blockingEntity = Object.values(updatedEntities).find(e => e.x === newX && e.y === newY && e.id !== actor.id);
      if (blockingEntity) {
        messages.push(addMessage(`${blockingEntity.name} blocks ${actor.name}'s path.`));
      } else {
        // Update position and track last move direction for crawlers (used for exploration anti-oscillation)
        updatedEntities[actor.id] = {
          ...actor,
          x: newX,
          y: newY,
          ...(isCrawler(actor) && { lastMoveDirection: action.direction }),
        };
        if (isCrawler(actor)) {
          messages.push(addMessage(
            `${actor.name} moves ${action.direction}.`,
            action.reasoning,
            action.aiMetadata
          ));
        }
      }
    }
  } else if (action.action === 'attack') {
    const [dx, dy] = DIRECTION_DELTAS[action.direction];
    const targetX = actor.x + dx;
    const targetY = actor.y + dy;

    // Find target at that position
    const target = Object.values(updatedEntities).find(e => e.x === targetX && e.y === targetY && e.id !== actor.id);

    if (target) {
      // Use pre-rolled d20 if provided (human player dice animation), otherwise use RNG
      const combatResult = action.preRolledD20 !== undefined
        ? resolveCombatWithRoll(action.preRolledD20, actor, target)
        : resolveAttack(actor, target, combatRng.getUniform());

      if (!combatResult.hit) {
        // Attack missed
        messages.push(addMessage(
          `${actor.name} misses ${target.name}.`,
          isCrawler(actor) ? action.reasoning : undefined,
          isCrawler(actor) ? action.aiMetadata : undefined,
          combatResult
        ));
      } else {
        // Attack hit - emit combat events and handle death
        const deadEntity = emitCombatEvents(state, actor, target, combatResult);
        const newHp = target.hp - combatResult.damage;

        // Apply damage message
        const critText = combatResult.isCritical ? ' (Critical!)' : '';
        messages.push(addMessage(
          `${actor.name} hits ${target.name} for ${combatResult.damage} damage.${critText}`,
          isCrawler(actor) ? action.reasoning : undefined,
          isCrawler(actor) ? action.aiMetadata : undefined,
          combatResult
        ));

        if (deadEntity) {
          // Target is dead - use deadEntity from emitCombatEvents

          if (isCrawler(target)) {
            messages.push(addMessage(`${target.name} died.`));
          } else {
            messages.push(addMessage(`${target.name} dies!`));

            // Drop equipped items
            let droppedItems = dropLoot(target, currentItems);

            // Roll loot table for consumables (only if monster has a type)
            if (target.monsterTypeId) {
              const lootDrops = rollLootTableDrop(
                target.monsterTypeId,
                { x: target.x, y: target.y },
                target.areaId,
                combatRng
              );
              if (lootDrops.length > 0) {
                droppedItems = [...droppedItems, ...lootDrops];
              }
            } else {
              simulationLogger.warn(
                { targetId: target.id, targetType: target.type },
                'Killed monster has no monsterTypeId - skipping loot table roll'
              );
            }

            // Message for all drops
            if (droppedItems.length > currentItems.length) {
              const droppedCount = droppedItems.length - currentItems.length;
              messages.push(addMessage(`${target.name} drops ${droppedCount} item${droppedCount > 1 ? 's' : ''}!`));
              currentItems = droppedItems;
            }
          }
          // Remove dead entity
          const newEntities = { ...updatedEntities };
          delete newEntities[target.id];
          updatedEntities = newEntities;
          killedIds.push(target.id as EntityId);

          // Check win/loss conditions across entire dungeon
          // Combine current bubble entities with rest of game state
          const allEntities = { ...state.entities, ...updatedEntities };
          // Remove killed entities
          for (const killedId of killedIds) {
            delete allEntities[killedId as string];
          }

          const remainingMonsters = Object.values(allEntities).filter(e => e.type === 'monster');
          const remainingCrawlers = Object.values(allEntities).filter(e => e.type === 'crawler');

          if (remainingCrawlers.length === 0 && gameStatus.status === 'playing') {
            // All crawlers dead - game over
            messages.push(addMessage('All crawlers have fallen. Game Over.'));
            gameStatus = { status: 'ended', victory: false };
          } else if (remainingMonsters.length === 0 && gameStatus.status === 'playing') {
            // All monsters dead - victory
            messages.push(addMessage('Victory! All monsters defeated.'));
            gameStatus = { status: 'ended', victory: true };
          }
        } else {
          updatedEntities[target.id] = { ...target, hp: newHp };
        }
      }
    } else {
      messages.push(addMessage(`${actor.name} swings at empty air.`));
    }
  } else if (action.action === 'wait') {
    if (isCrawler(actor)) {
      messages.push(addMessage(
        `${actor.name} waits.`,
        action.reasoning,
        action.aiMetadata
      ));
    }
  } else if (action.action === 'pickup') {
    // Create a temporary state for inventory processing
    const tempState: GameState = { ...state, entities: updatedEntities };
    const result = processPickup(tempState, actorId as string);
    if (result.success) {
      updatedEntities = { ...result.state.entities };
      messages.push(addMessage(
        result.message,
        isCrawler(actor) ? action.reasoning : undefined,
        isCrawler(actor) ? action.aiMetadata : undefined
      ));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: result.state.items };
    } else {
      messages.push(addMessage(result.error));
    }
  } else if (action.action === 'drop') {
    const tempState: GameState = { ...state, entities: updatedEntities };
    const result = processDrop(tempState, actorId as string, action.itemType);
    if (result.success) {
      updatedEntities = { ...result.state.entities };
      messages.push(addMessage(result.message));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: result.state.items };
    } else {
      messages.push(addMessage(result.error));
    }
  } else if (action.action === 'use') {
    const tempState: GameState = { ...state, entities: updatedEntities };
    const result = processUse(tempState, actorId as string, action.itemType);
    if (result.success) {
      updatedEntities = { ...result.state.entities };
      messages.push(addMessage(result.message));
      // Note: processUse doesn't change items array, but we return it for consistency
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: result.state.items };
    } else {
      messages.push(addMessage(result.error));
    }
  } else if (action.action === 'equip') {
    const tempState: GameState = { ...state, entities: updatedEntities };
    const result = processEquip(tempState, actorId as string, action.itemType);
    if (result.success) {
      updatedEntities = { ...result.state.entities };
      messages.push(addMessage(
        result.message,
        isCrawler(actor) ? action.reasoning : undefined,
        isCrawler(actor) ? action.aiMetadata : undefined
      ));
      // Note: processEquip doesn't change items array, but we return it for consistency
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: result.state.items };
    } else {
      messages.push(addMessage(result.error));
    }
  } else if (action.action === 'ranged_attack') {
    // Ranged attack action - shoot at a target at range
    const { map } = getCurrentArea(state);

    // 1. Find the ranged weapon - could be in main hand (bow) or offhand (thrown)
    // Check main weapon first for bows
    let rangedWeapon: ItemInstance | null = null;
    let weaponTemplate: EquipmentTemplate | null = null;

    if (actor.equippedWeapon) {
      const template = getItemTemplate(actor.equippedWeapon.templateId);
      if (template && isEquipmentTemplate(template) && template.rangedType && template.range) {
        rangedWeapon = actor.equippedWeapon;
        weaponTemplate = template;
      }
    }

    // If no ranged weapon in main hand, check offhand for thrown weapons
    if (!rangedWeapon && actor.equippedOffhand) {
      const template = getItemTemplate(actor.equippedOffhand.templateId);
      if (template && isEquipmentTemplate(template) && template.rangedType === 'thrown' && template.range) {
        rangedWeapon = actor.equippedOffhand;
        weaponTemplate = template;
      }
    }

    if (!rangedWeapon || !weaponTemplate) {
      messages.push(addMessage(`${actor.name} has no ranged weapon equipped.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // 2. For bows: check quiver is equipped and has ammo
    if (weaponTemplate.rangedType === 'bow') {
      const quiver = actor.equippedOffhand;
      if (!quiver || quiver.currentAmmo === undefined || quiver.currentAmmo <= 0) {
        messages.push(addMessage(`${actor.name} has no ammunition in quiver.`));
        return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
      }
    }

    // 3. For thrown: check weapon has quantity > 0
    if (weaponTemplate.rangedType === 'thrown') {
      const quantity = rangedWeapon.quantity ?? 0;
      if (quantity <= 0) {
        messages.push(addMessage(`${actor.name} has no throwing weapons left.`));
        return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
      }
    }

    // 4. Check distance is within weapon range (range validated at weapon detection step)
    if (action.distance > (weaponTemplate.range ?? 0)) {
      messages.push(addMessage(`Target is too far away for ${weaponTemplate.name}.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // 5. Determine target position - either from targetId or direction+distance
    let targetPos: { x: number; y: number };
    let targetFromId: Entity | undefined;

    if (action.targetId) {
      // Player attack with explicit target ID - look up directly
      targetFromId = updatedEntities[action.targetId];
      if (!targetFromId || targetFromId.areaId !== actor.areaId) {
        messages.push(addMessage(`${actor.name}'s target is no longer there.`));
        return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
      }
      targetPos = { x: targetFromId.x, y: targetFromId.y };

      // Validate actual distance is within weapon range
      // Note: weaponTemplate.range was validated at ranged weapon detection step
      const actualDistance = Math.max(Math.abs(targetPos.x - actor.x), Math.abs(targetPos.y - actor.y));
      if (actualDistance > (weaponTemplate.range ?? 0)) {
        messages.push(addMessage(`Target is too far away for ${weaponTemplate.name}.`));
        return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
      }
    } else {
      // AI attack with direction+distance - calculate position
      targetPos = deltaToPosition({ x: actor.x, y: actor.y }, action.direction, action.distance);
    }

    // 5a. Validate target is within map bounds
    if (targetPos.x < 0 || targetPos.x >= map.width || targetPos.y < 0 || targetPos.y >= map.height) {
      messages.push(addMessage(`Target position is outside the map.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // 5b. Check target is within actor's FOV
    const visibleTiles = computeVisibleTiles(map, actor.x, actor.y, getEffectiveVisionRadius(actor));
    if (!visibleTiles.has(tileKey(targetPos.x, targetPos.y))) {
      messages.push(addMessage(`${actor.name} can't see that position.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // 5c. Check line of sight (no obstacles blocking the shot)
    if (!hasLineOfSight(map, actor.x, actor.y, targetPos.x, targetPos.y)) {
      messages.push(addMessage(`${actor.name} doesn't have a clear shot.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // 6. Consume ammo before resolving attack
    let updatedActor = { ...actor };
    if (weaponTemplate.rangedType === 'bow') {
      // Consume arrow from quiver
      // Note: currentAmmo was validated at step 2, so undefined here indicates state corruption
      const currentAmmo = actor.equippedOffhand?.currentAmmo;
      if (currentAmmo === undefined) {
        simulationLogger.error(
          { actorId: actor.id, offhandId: actor.equippedOffhand?.id },
          'Quiver currentAmmo undefined after passing validation - state corruption detected'
        );
        messages.push(addMessage(`${actor.name} has no ammunition in quiver.`));
        return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
      }
      const newAmmo = currentAmmo - 1;
      updatedActor = {
        ...updatedActor,
        equippedOffhand: actor.equippedOffhand ? {
          ...actor.equippedOffhand,
          currentAmmo: newAmmo,
        } : null,
      };
    } else if (weaponTemplate.rangedType === 'thrown') {
      // Consume thrown weapon (thrown weapons are in offhand)
      // Note: quantity was validated at step 3, so undefined here indicates state corruption
      const quantity = rangedWeapon.quantity;
      if (quantity === undefined) {
        simulationLogger.error(
          { actorId: actor.id, weaponId: rangedWeapon.id },
          'Thrown weapon quantity undefined after passing validation - state corruption detected'
        );
        messages.push(addMessage(`${actor.name} has no throwing weapons left.`));
        return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
      }
      const newQuantity = quantity - 1;
      if (newQuantity <= 0) {
        // Last throwing weapon - unequip it from offhand
        updatedActor = {
          ...updatedActor,
          equippedOffhand: null,
        };
      } else {
        updatedActor = {
          ...updatedActor,
          equippedOffhand: {
            ...rangedWeapon,
            quantity: newQuantity,
          },
        };
      }
    }
    updatedEntities[actor.id] = updatedActor;

    // 7. Find target - use targetFromId if available, otherwise search by position
    const target = targetFromId ?? Object.values(updatedEntities).find(e =>
      e.x === targetPos.x && e.y === targetPos.y && e.id !== actor.id && e.areaId === actor.areaId
    );

    if (target) {
      // Resolve combat using existing d20 system
      // rangedWeapon was already determined at the start of this action handler
      const combatResult = action.preRolledD20 !== undefined
        ? resolveCombatWithRoll(action.preRolledD20, actor, target, rangedWeapon)
        : resolveAttack(actor, target, combatRng.getUniform(), rangedWeapon);

      if (!combatResult.hit) {
        messages.push(addMessage(
          `${actor.name} shoots at ${target.name} but misses.`,
          isCrawler(actor) ? action.reasoning : undefined,
          isCrawler(actor) ? action.aiMetadata : undefined,
          combatResult
        ));
      } else {
        // Attack hit - emit combat events and handle death
        const deadEntity = emitCombatEvents(state, actor, target, combatResult);
        const newHp = target.hp - combatResult.damage;

        // Apply damage message
        const critText = combatResult.isCritical ? ' (Critical!)' : '';
        messages.push(addMessage(
          `${actor.name} hits ${target.name} with ${weaponTemplate.name} for ${combatResult.damage} damage.${critText}`,
          isCrawler(actor) ? action.reasoning : undefined,
          isCrawler(actor) ? action.aiMetadata : undefined,
          combatResult
        ));

        if (deadEntity) {
          // Target is dead - use deadEntity from emitCombatEvents

          if (isCrawler(target)) {
            messages.push(addMessage(`${target.name} died.`));
          } else {
            messages.push(addMessage(`${target.name} dies!`));

            // Drop equipped items
            let droppedItems = dropLoot(target, currentItems);

            // Roll loot table for consumables (only if monster has a type)
            if (target.monsterTypeId) {
              const lootDrops = rollLootTableDrop(
                target.monsterTypeId,
                { x: target.x, y: target.y },
                target.areaId,
                combatRng
              );
              if (lootDrops.length > 0) {
                droppedItems = [...droppedItems, ...lootDrops];
              }
            } else {
              simulationLogger.warn(
                { targetId: target.id, targetType: target.type },
                'Killed monster has no monsterTypeId - skipping loot table roll'
              );
            }

            // Message for all drops
            if (droppedItems.length > currentItems.length) {
              const droppedCount = droppedItems.length - currentItems.length;
              messages.push(addMessage(`${target.name} drops ${droppedCount} item${droppedCount > 1 ? 's' : ''}!`));
              currentItems = droppedItems;
            }
          }
          // Remove dead entity
          const newEntities = { ...updatedEntities };
          delete newEntities[target.id];
          updatedEntities = newEntities;
          killedIds.push(target.id as EntityId);

          // Check win/loss conditions across entire dungeon
          const allEntities = { ...state.entities, ...updatedEntities };
          for (const killedId of killedIds) {
            delete allEntities[killedId as string];
          }

          const remainingMonsters = Object.values(allEntities).filter(e => e.type === 'monster');
          const remainingCrawlers = Object.values(allEntities).filter(e => e.type === 'crawler');

          if (remainingCrawlers.length === 0 && gameStatus.status === 'playing') {
            messages.push(addMessage('All crawlers have fallen. Game Over.'));
            gameStatus = { status: 'ended', victory: false };
          } else if (remainingMonsters.length === 0 && gameStatus.status === 'playing') {
            messages.push(addMessage('Victory! All monsters defeated.'));
            gameStatus = { status: 'ended', victory: true };
          }
        } else {
          updatedEntities[target.id] = { ...target, hp: newHp };
        }
      }
    } else {
      messages.push(addMessage(`${actor.name}'s shot flies past the target.`));
    }
  } else if (action.action === 'enter_portal') {
    // Only crawlers can use portals
    if (!isCrawler(actor)) {
      messages.push(addMessage(`${actor.name} cannot use portals.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // Check if standing on a portal tile
    const { map } = getCurrentArea(state);
    const tile = map.tiles[actor.y][actor.x];

    if (tile.type !== 'portal') {
      messages.push(addMessage(`There's no portal here.`));
      return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
    }

    // Portal must have a connection configured
    if (!tile.connection) {
      throw new Error(`Portal at (${actor.x}, ${actor.y}) has no connection configured`);
    }

    // Validate target area exists
    const targetArea = state.zone.areas[tile.connection.targetAreaId];
    if (!targetArea) {
      throw new Error(`Portal target area "${tile.connection.targetAreaId}" not found`);
    }

    // Validate target position is passable
    const { x: targetX, y: targetY } = tile.connection.targetPosition;
    if (!isPassable(targetArea.map, targetX, targetY)) {
      throw new Error(`Portal target position (${targetX}, ${targetY}) is not passable`);
    }

    // Transition the entity
    const previousAreaId = actor.areaId;
    const newAreaId = tile.connection.targetAreaId;

    updatedEntities[actor.id] = {
      ...actor,
      x: targetX,
      y: targetY,
      areaId: newAreaId,
    };

    // Emit AREA_ENTERED event when crawler moves to new area
    if (state.eventEmitter && newAreaId !== previousAreaId) {
      const isFirstVisit = !state.exploredTiles?.[newAreaId]?.length;

      const { eventEmitter, ...stateWithoutEmitter } = state;
      state.eventEmitter.emit({
        type: EventType.AREA_ENTERED,
        timestamp: Date.now(),
        context: structuredClone(stateWithoutEmitter) as GameState,
        entities: [updatedEntities[actor.id]],
        metadata: {
          previousArea: previousAreaId,
          newArea: newAreaId,
          isFirstVisit,
        },
      });
    }

    // Generate directional message
    const directionMsg = tile.direction === 'down'
      ? `${actor.name} descends deeper into the dungeon.`
      : `${actor.name} ascends toward the surface.`;
    messages.push(addMessage(directionMsg));
  }

  return { entities: updatedEntities, messages, gameStatus, killedIds, items: currentItems };
}

/**
 * Finalize an action by removing killed entities and completing the turn.
 * Returns the updated scheduler with killed entities removed and AP deducted.
 */
function finalizeAction(
  scheduler: SchedulerState,
  actorId: EntityId,
  killedIds: readonly EntityId[]
): SchedulerState {
  let updated = scheduler;
  for (const killedId of killedIds) {
    updated = removeFromScheduler(updated, killedId);
  }
  return completeAction(updated, actorId);
}

/**
 * Get the target for monster AI.
 * Returns the nearest crawler, or the player if available.
 */
function getMonsterTarget(entities: Record<string, Entity>): Entity | null {
  // For now, just return the player if they exist
  // In the future this could find the nearest crawler
  return entities['player'] ?? Object.values(entities).find(isCrawler) ?? null;
}

/**
 * Simulate a bubble until input is needed or iteration limit reached.
 *
 * The simulation loop:
 * 1. Check if anyone can act (canAct)
 * 2. If no one can act, advance time (advanceScheduler) and increment tick
 * 3. If someone can act:
 *    - Crawler: dequeue command, or add to waitingFor if queue empty
 *    - Monster: run AI
 * 4. Execute action and complete turn
 * 5. Repeat until maxIterations, waitingFor is non-empty, or game ends
 *
 * @param bubble - The bubble to simulate
 * @param entities - Entity lookup map
 * @param options - Simulation options (must include gameState for real execution)
 * @returns SimulationResult with updated state
 */
export function simulateBubble(
  bubble: Bubble,
  entities: Record<string, Entity>,
  options: BubbleSimulationOptions
): SimulationResult {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const { gameState } = options;

  // Ensure eventEmitter and eventTracking exist — both are lost when GameState is
  // serialized/deserialized (e.g. stored in Supabase then loaded back as JSON).
  // Re-creating them here protects all downstream .emit() and tracking calls.
  if (!gameState.eventEmitter) {
    (gameState as { eventEmitter: GameEventEmitter }).eventEmitter = new GameEventEmitter();
  }
  if (!gameState.eventTracking) {
    (gameState as { eventTracking: EventTracking }).eventTracking = {
      combatState: {},
      seenMonsterTypes: {},
      seenPortals: {},
      entitiesBelowCritical: new Set(),
    };
  }

  let currentBubble = bubble;
  let currentEntities = { ...entities };
  // Track items throughout simulation (for pickup/drop actions)
  let currentItems = [...gameState.items];
  // Track all entities (for win/loss conditions) - starts with full game state entities
  // and gets updated as entities are killed
  const allEntitiesForWinCheck = { ...gameState.entities };
  // Create a mutable gameState for simulation that tracks ALL entities for win/loss checks
  let currentGameState: GameState = {
    ...gameState,
    entities: allEntitiesForWinCheck,
    items: currentItems,
  };
  const messages: Message[] = [];
  const waitingFor: EntityId[] = [];
  let iterations = 0;
  let gameStatus: GameStatus = gameState.gameStatus;
  // Track explored tiles updates for crawlers who move
  const exploredTilesUpdates: ExploredTiles = {};

  // Shared message builder to ensure unique IDs across all actions in this simulation
  // Use bubble ID as prefix to avoid collisions between bubbles
  const addMessage = messageBuilder(gameState.turn + 1, bubble.id);

  // Use provided RNG or create seeded RNG for combat rolls
  // Use a non-zero offset to avoid the pathological sequence at seed 0
  // (ROT.js RNG produces very low values for several rolls at seed 0)
  const combatRng = options.combatRng ?? (() => {
    const rng = ROT.RNG.clone();
    // Add 1000 offset to avoid low seed values' pathological sequences
    // (d20 system uses 1-20 range where roll 1 is auto-miss, unlike old probability system)
    rng.setSeed(1000 + getCurrentArea(gameState).map.seed + gameState.turn);
    return rng;
  })();

  while (iterations < maxIterations && gameStatus.status === 'playing') {
    const actorId = canAct(currentBubble.scheduler);

    if (!actorId) {
      // No one can act - advance time
      currentBubble = {
        ...currentBubble,
        scheduler: advanceScheduler(currentBubble.scheduler),
        tick: currentBubble.tick + 1,
      };
      iterations++;
      continue;
    }

    const actor = currentEntities[actorId as string];
    if (!actor) {
      // Entity no longer exists - remove from scheduler and continue
      simulationLogger.warn(
        { actorId, bubbleId: currentBubble.id },
        'Entity in scheduler not found in entities - cleaning up orphaned scheduler entry'
      );
      currentBubble = {
        ...currentBubble,
        scheduler: removeFromScheduler(currentBubble.scheduler, actorId),
      };
      iterations++;
      continue;
    }

    // --- Effect pre-processing ---
    // Clean up effects from dead/removed source entities
    let effectActor = actor;
    if ((effectActor.activeEffects ?? []).length > 0) {
      // Remove effects whose source entity no longer exists
      for (const effect of effectActor.activeEffects ?? []) {
        if (effect.source.entityId && !currentEntities[effect.source.entityId]) {
          effectActor = removeEffectsFromSource(effectActor, effect.source.entityId);
        }
      }
      currentEntities = { ...currentEntities, [actorId as string]: effectActor };
    }

    // Check for stun — skip_turn forces a wait action
    if (hasEffect(effectActor, 'Stunned')) {
      // Stunned: skip turn (forced wait), tick effects, then continue
      const tickResult = tickEffects(effectActor);
      currentEntities = { ...currentEntities, [actorId as string]: tickResult.entity };
      for (const msg of tickResult.messages) {
        messages.push(addMessage(msg.text));
      }
      // Handle death from DoT while stunned
      if (tickResult.died) {
        // Remove dead entity from scheduler (don't use finalizeAction since
        // the actor IS the dead entity — completeAction would fail to find it)
        currentBubble = {
          ...currentBubble,
          scheduler: removeFromScheduler(currentBubble.scheduler, actorId),
        };
        delete allEntitiesForWinCheck[actorId as string];
        delete currentEntities[actorId as string];
        // Check win/loss for crawler death during stun
        if (effectActor.type === 'crawler') {
          const crawlersAlive = Object.values(allEntitiesForWinCheck).some(e => e.type === 'crawler');
          if (!crawlersAlive) {
            gameStatus = { status: 'ended', victory: false };
          }
        }
      } else {
        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
        };
      }
      // Update game state and continue to next iteration
      for (const [id, entity] of Object.entries(currentEntities)) {
        allEntitiesForWinCheck[id] = entity;
      }
      currentGameState = { ...currentGameState, entities: allEntitiesForWinCheck, items: currentItems };
      iterations++;
      continue;
    }

    if (isCrawler(actor)) {
      // Crawler's turn - try to dequeue command
      const dequeueResult = dequeueCommand(currentBubble, actorId);

      if (!dequeueResult.action) {
        // No command queued - add to waitingFor and stop
        waitingFor.push(actorId);
        break;
      }

      // Process crawler action
      currentBubble = dequeueResult.bubble;
      const actionResult = executeAction(
        currentEntities,
        actorId,
        dequeueResult.action,
        currentGameState,
        addMessage,
        combatRng
      );
      currentEntities = actionResult.entities;
      messages.push(...actionResult.messages);
      gameStatus = actionResult.gameStatus;
      currentItems = [...actionResult.items];

      // Mark combat as started if FIRST_BLOOD was emitted during this action
      // Check if this was an attack action that hit and dealt damage
      const updatedActor = currentEntities[actorId as string];
      if (updatedActor && (dequeueResult.action.action === 'attack' || dequeueResult.action.action === 'ranged_attack')) {
        // Check if there was a hit message in the action results (indicates successful damage)
        const hitMessage = actionResult.messages.find(m =>
          m.text.includes(' hits ') && m.text.includes(' damage')
        );
        if (hitMessage) {
          const currentAreaId = updatedActor.areaId;
          const areaTracking = currentGameState.eventTracking?.combatState?.[currentAreaId];
          if (!areaTracking?.combatStarted) {
            // Mark combat as started for this area
            currentGameState = {
              ...currentGameState,
              eventTracking: {
                combatState: {
                  ...currentGameState.eventTracking?.combatState,
                  [currentAreaId]: {
                    combatStarted: true,
                    wasInCombat: true,
                    killsThisEncounter: areaTracking?.killsThisEncounter ?? 0,
                  },
                },
                seenMonsterTypes: currentGameState.eventTracking?.seenMonsterTypes ?? {},
                seenPortals: currentGameState.eventTracking?.seenPortals ?? {},
                entitiesBelowCritical: currentGameState.eventTracking?.entitiesBelowCritical ?? new Set(),
              },
            };
          }
        }
      }

      currentBubble = {
        ...currentBubble,
        scheduler: finalizeAction(currentBubble.scheduler, actorId, actionResult.killedIds),
      };

      // Update allEntitiesForWinCheck: remove killed, sync surviving bubble entities
      for (const killedId of actionResult.killedIds) {
        delete allEntitiesForWinCheck[killedId as string];
      }
      for (const [id, entity] of Object.entries(currentEntities)) {
        allEntitiesForWinCheck[id] = entity;
      }

      // Update explored tiles for crawler after move
      const updatedActor2 = currentEntities[actorId as string];
      if (updatedActor2 && (updatedActor2.x !== actor.x || updatedActor2.y !== actor.y)) {
        // Crawler moved - compute visible tiles from new position
        const visible = computeVisibleTiles(
          getCurrentArea(currentGameState).map,
          updatedActor2.x,
          updatedActor2.y,
          getEffectiveVisionRadius(updatedActor2)
        );

        // Detect newly visible monsters
        if (currentGameState.eventEmitter && currentGameState.eventTracking && isCrawlerId(updatedActor2.id)) {
          const crawlerId = toCrawlerId(updatedActor2.id);
          const seenTypes = currentGameState.eventTracking.seenMonsterTypes[crawlerId] || new Set();

          // Find monsters on visible tiles (check all entities in game state, not just bubble)
          const visibleMonsters = Object.values(currentGameState.entities)
            .filter(e => e.type === 'monster' && e.areaId === updatedActor2.areaId && visible.has(tileKey(e.x, e.y)));

          for (const monster of visibleMonsters) {
            const typeId = monster.monsterTypeId;
            if (typeId && !seenTypes.has(typeId)) {
              const { eventEmitter, ...stateWithoutEmitter } = currentGameState;
              currentGameState.eventEmitter.emit({
                type: EventType.MONSTER_SEEN,
                timestamp: Date.now(),
                context: structuredClone(stateWithoutEmitter) as GameState,
                entities: [monster],
                metadata: {
                  monsterType: typeId,
                  position: { x: monster.x, y: monster.y },
                },
              });

              // Track as seen
              if (!currentGameState.eventTracking.seenMonsterTypes[crawlerId]) {
                currentGameState.eventTracking.seenMonsterTypes[crawlerId] = new Set();
              }
              currentGameState.eventTracking.seenMonsterTypes[crawlerId].add(typeId);
            }
          }
        }

        // Detect newly visible portals
        if (currentGameState.eventEmitter && currentGameState.eventTracking && isCrawlerId(updatedActor2.id)) {
          const crawlerId = toCrawlerId(updatedActor2.id);
          const seenPortals = currentGameState.eventTracking.seenPortals[crawlerId] || new Set();
          const currentArea = getCurrentArea(currentGameState);

          // Find portals on visible tiles
          for (const tileKeyStr of visible) {
            const [xStr, yStr] = tileKeyStr.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            const tile = currentArea.map.tiles[y]?.[x];

            if (tile?.type === 'portal' && tile.connection) {
              const portalKey = tileKey(x, y);
              if (!seenPortals.has(portalKey)) {
                const { eventEmitter, ...stateWithoutEmitter } = currentGameState;
                currentGameState.eventEmitter.emit({
                  type: EventType.PORTAL_FOUND,
                  timestamp: Date.now(),
                  context: structuredClone(stateWithoutEmitter) as GameState,
                  entities: [updatedActor2],
                  metadata: {
                    position: { x, y },
                    targetAreaId: tile.connection.targetAreaId,
                  },
                });

                // Track as seen
                if (!currentGameState.eventTracking.seenPortals[crawlerId]) {
                  currentGameState.eventTracking.seenPortals[crawlerId] = new Set();
                }
                currentGameState.eventTracking.seenPortals[crawlerId].add(portalKey);
              }
            }
          }
        }

        // Merge with existing explored tiles for this area (shared by all crawlers)
        // Cast to TileKey since explored tiles are validated by schema
        const areaId = updatedActor.areaId;
        const existingFromState = gameState.exploredTiles?.[areaId] ?? [];
        const existingFromUpdates = exploredTilesUpdates[areaId] ?? [];
        const existingSet = new Set([...existingFromState, ...existingFromUpdates] as TileKey[]);
        const updatedRecord = updateExploredTiles({ [areaId]: existingSet }, visible, areaId);

        exploredTilesUpdates[areaId] = Array.from(updatedRecord[areaId]);
      }

      // --- Post-action effect ticking ---
      const tickActor = currentEntities[actorId as string];
      if (tickActor && (tickActor.activeEffects ?? []).length > 0) {
        const tickResult = tickEffects(tickActor);
        currentEntities = { ...currentEntities, [actorId as string]: tickResult.entity };
        for (const msg of tickResult.messages) {
          messages.push(addMessage(msg.text));
        }
        if (tickResult.died) {
          const deadId = entityId(actorId as string);
          currentBubble = {
            ...currentBubble,
            scheduler: removeFromScheduler(currentBubble.scheduler, deadId),
          };
          delete allEntitiesForWinCheck[actorId as string];
          delete currentEntities[actorId as string];
          // Check win/loss
          const crawlersAlive = Object.values(allEntitiesForWinCheck).some(e => e.type === 'crawler');
          if (!crawlersAlive) {
            gameStatus = { status: 'ended', victory: false };
          }
        }
        for (const [id, entity] of Object.entries(currentEntities)) {
          allEntitiesForWinCheck[id] = entity;
        }
      }

      // Update current game state for subsequent actions
      currentGameState = {
        ...currentGameState,
        entities: allEntitiesForWinCheck,
        items: currentItems,
      };
    } else if (actor.type === 'monster') {
      // Monster's turn - use FOV and behavior state machine
      const target = getMonsterTarget(currentEntities);
      const monsters = Object.values(currentEntities).filter(e => e.type === 'monster');

      // 1. Compute monster's FOV
      const visibleTiles = computeMonsterFOV(actor, getCurrentArea(currentGameState).map);

      // 2. Check if target is visible
      const canSeeTarget = target ? isEntityVisible(target, visibleTiles) : false;
      const targetPosition = canSeeTarget && target ? { x: target.x, y: target.y } : null;

      // 3. Update behavior state machine
      let updatedMonster = updateBehaviorState(actor, canSeeTarget, targetPosition);

      // 4. Execute action based on behavior state
      const behaviorState = updatedMonster.behaviorState ?? 'chase';

      if (behaviorState === 'alerted') {
        // Alerted: wait one turn (reaction time)
        currentEntities = {
          ...currentEntities,
          [actor.id]: updatedMonster,
        };
        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
        };
      } else if (behaviorState === 'chase' && target && isAdjacent(updatedMonster, target)) {
        // Chase + adjacent: attack
        const attackAction: Action = {
          action: 'attack',
          direction: getDirectionTo(updatedMonster, target),
          reasoning: 'Adjacent to target'
        };
        const actionResult = executeAction(
          { ...currentEntities, [actor.id]: updatedMonster },
          actorId,
          attackAction,
          currentGameState,
          addMessage,
          combatRng
        );
        currentEntities = actionResult.entities;
        messages.push(...actionResult.messages);
        gameStatus = actionResult.gameStatus;

        // Mark combat as started if FIRST_BLOOD was emitted during this action
        const hitMessage = actionResult.messages.find(m =>
          m.text.includes(' hits ') && m.text.includes(' damage')
        );
        if (hitMessage) {
          const currentAreaId = updatedMonster.areaId;
          const areaTracking = currentGameState.eventTracking?.combatState?.[currentAreaId];
          if (!areaTracking?.combatStarted) {
            // Mark combat as started for this area
            currentGameState = {
              ...currentGameState,
              eventTracking: {
                combatState: {
                  ...currentGameState.eventTracking?.combatState,
                  [currentAreaId]: {
                    combatStarted: true,
                    wasInCombat: true,
                    killsThisEncounter: areaTracking?.killsThisEncounter ?? 0,
                  },
                },
                seenMonsterTypes: currentGameState.eventTracking?.seenMonsterTypes ?? {},
                seenPortals: currentGameState.eventTracking?.seenPortals ?? {},
                entitiesBelowCritical: currentGameState.eventTracking?.entitiesBelowCritical ?? new Set(),
              },
            };
          }
        }

        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, actionResult.killedIds),
        };

        for (const killedId of actionResult.killedIds) {
          delete allEntitiesForWinCheck[killedId as string];
        }
      } else if (behaviorState === 'chase' && target) {
        // Chase + not adjacent: check for ranged attack first, then fall back to movement
        const { map } = getCurrentArea(currentGameState);
        const rangedAction = selectRangedAction(updatedMonster, target, map);

        if (rangedAction && rangedAction.action === 'ranged_attack') {
          // Execute ranged attack
          const actionResult = executeAction(
            { ...currentEntities, [actor.id]: updatedMonster },
            actorId,
            rangedAction,
            currentGameState,
            addMessage,
            combatRng
          );
          currentEntities = actionResult.entities;
          messages.push(...actionResult.messages);
          gameStatus = actionResult.gameStatus;

          // Mark combat as started if FIRST_BLOOD was emitted during this action
          const hitMessage = actionResult.messages.find(m =>
            m.text.includes(' hits ') && m.text.includes(' damage')
          );
          if (hitMessage) {
            const currentAreaId = updatedMonster.areaId;
            const areaTracking = currentGameState.eventTracking?.combatState?.[currentAreaId];
            if (!areaTracking?.combatStarted) {
              // Mark combat as started for this area
              currentGameState = {
                ...currentGameState,
                eventTracking: {
                  combatState: {
                    ...currentGameState.eventTracking?.combatState,
                    [currentAreaId]: {
                      combatStarted: true,
                      wasInCombat: true,
                      killsThisEncounter: 0,
                    },
                  },
                  seenMonsterTypes: currentGameState.eventTracking?.seenMonsterTypes ?? {},
                  seenPortals: currentGameState.eventTracking?.seenPortals ?? {},
                  entitiesBelowCritical: currentGameState.eventTracking?.entitiesBelowCritical ?? new Set(),
                },
              };
            }
          }

          currentBubble = {
            ...currentBubble,
            scheduler: finalizeAction(currentBubble.scheduler, actorId, actionResult.killedIds),
          };

          for (const killedId of actionResult.killedIds) {
            delete allEntitiesForWinCheck[killedId as string];
          }
        } else if (rangedAction && rangedAction.action === 'move') {
          // Kiting or closing distance - use the direction from selectRangedAction
          const [dx, dy] = DIRECTION_DELTAS[rangedAction.direction];
          const newX = updatedMonster.x + dx;
          const newY = updatedMonster.y + dy;

          // Check passability, monster collision, and diagonal blocking (same as calculateMoveToward)
          if (isPassable(map, newX, newY) &&
            !monsterAt(monsters, newX, newY) &&
            !isDiagonalBlocked(currentGameState, updatedMonster.x, updatedMonster.y, dx, dy)) {
            updatedMonster = { ...updatedMonster, x: newX, y: newY };
          }
          currentEntities = {
            ...currentEntities,
            [actor.id]: updatedMonster,
          };
          currentBubble = {
            ...currentBubble,
            scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
          };
        } else {
          // Fall back to movement toward target (no ranged weapon or out of ammo)
          const newPos = calculateMoveToward(updatedMonster, target, currentGameState, monsters);
          if (newPos) {
            updatedMonster = { ...updatedMonster, x: newPos.x, y: newPos.y };
          }
          currentEntities = {
            ...currentEntities,
            [actor.id]: updatedMonster,
          };
          currentBubble = {
            ...currentBubble,
            scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
          };
        }
      } else if (behaviorState === 'hunt') {
        // Hunt: move toward lastKnownTarget
        const huntTarget = updatedMonster.lastKnownTarget;
        if (huntTarget) {
          const newPos = calculateMoveTowardPosition(updatedMonster, huntTarget, currentGameState, monsters);
          if (newPos) {
            updatedMonster = { ...updatedMonster, x: newPos.x, y: newPos.y };
          }
        }
        // Check if reached target -> transition to search
        updatedMonster = reachedHuntTarget(updatedMonster);
        currentEntities = {
          ...currentEntities,
          [actor.id]: updatedMonster,
        };
        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
        };
      } else if (behaviorState === 'patrol') {
        // Patrol: random wander
        const adjacent = getPassableAdjacent(updatedMonster, currentGameState, monsters);
        if (adjacent.length > 0) {
          // Use deterministic random based on turn and entity for reproducibility
          const index = Math.abs((currentGameState.turn * 31 + updatedMonster.id.charCodeAt(0)) % adjacent.length);
          const patrolTarget = adjacent[index];
          updatedMonster = { ...updatedMonster, x: patrolTarget.x, y: patrolTarget.y };
        }
        currentEntities = {
          ...currentEntities,
          [actor.id]: updatedMonster,
        };
        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
        };
      } else if (behaviorState === 'search') {
        // Search: localized wander near lastKnownTarget
        const searchRadius = 3;
        const searchCenter = updatedMonster.lastKnownTarget ?? { x: updatedMonster.x, y: updatedMonster.y };

        // Get adjacent tiles within search radius
        const searchAdjacent = getPassableAdjacent(updatedMonster, currentGameState, monsters)
          .filter(tile => chebyshevDistance(tile, searchCenter) <= searchRadius);

        if (searchAdjacent.length > 0) {
          // Deterministic random movement
          const index = Math.abs((currentGameState.turn * 37 + updatedMonster.id.charCodeAt(0)) % searchAdjacent.length);
          const searchTarget = searchAdjacent[index];
          updatedMonster = { ...updatedMonster, x: searchTarget.x, y: searchTarget.y };
        }
        currentEntities = {
          ...currentEntities,
          [actor.id]: updatedMonster,
        };
        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
        };
      } else {
        // alerted, idle, or unknown: wait (no movement)
        currentEntities = {
          ...currentEntities,
          [actor.id]: updatedMonster,
        };
        currentBubble = {
          ...currentBubble,
          scheduler: finalizeAction(currentBubble.scheduler, actorId, []),
        };
      }

      // Update allEntitiesForWinCheck
      for (const [id, entity] of Object.entries(currentEntities)) {
        allEntitiesForWinCheck[id] = entity;
      }

      // --- Post-action effect ticking for monster ---
      const tickMonster = currentEntities[actorId as string];
      if (tickMonster && (tickMonster.activeEffects ?? []).length > 0) {
        const tickResult = tickEffects(tickMonster);
        currentEntities = { ...currentEntities, [actorId as string]: tickResult.entity };
        for (const msg of tickResult.messages) {
          messages.push(addMessage(msg.text));
        }
        if (tickResult.died) {
          const deadId = entityId(actorId as string);
          currentBubble = {
            ...currentBubble,
            scheduler: removeFromScheduler(currentBubble.scheduler, deadId),
          };
          delete allEntitiesForWinCheck[actorId as string];
          delete currentEntities[actorId as string];
          messages.push(addMessage(`${tickMonster.name} dies!`));
          // Check victory condition: all monsters dead
          const monstersAlive = Object.values(allEntitiesForWinCheck).some(e => e.type === 'monster');
          if (!monstersAlive) {
            gameStatus = { status: 'ended', victory: true };
          }
        }
        for (const [id, entity] of Object.entries(currentEntities)) {
          allEntitiesForWinCheck[id] = entity;
        }
      }

      currentGameState = {
        ...currentGameState,
        entities: allEntitiesForWinCheck,
      };
    } else {
      // Unknown entity type - this is a critical error in a deterministic engine
      // We cannot silently skip or remove entities as this would produce
      // non-reproducible game state
      simulationLogger.error(
        { actorId, entityType: actor.type, expectedTypes: ['crawler', 'monster'] },
        'Unknown entity type in simulation loop - cannot proceed safely'
      );
      throw new Error(
        `Unknown entity type "${actor.type}" for entity ${actorId} - simulation cannot continue. ` +
        `Expected "crawler" or "monster". This indicates data corruption or schema mismatch.`
      );
    }

    // Check for COMBAT_END at end of turn processing
    // Only check after completing an action (not after time advancement)
    if (actor && currentGameState.eventEmitter) {
      const currentAreaId = actor.areaId;
      const areaTracking = currentGameState.eventTracking?.combatState?.[currentAreaId];

      // Get all monsters in this area (before updating wasInCombat)
      const monstersInArea = Object.values(currentEntities).filter(
        (e) => e.type === 'monster' && e.areaId === currentAreaId
      );

      // Check if combat ended: no monsters left AND we were in combat last turn
      if (monstersInArea.length === 0 && areaTracking?.wasInCombat && currentGameState.eventTracking) {
        // Get crawlers in this area (who cleared the area)
        const crawlersInArea = getCrawlersInArea(currentGameState, currentAreaId);

        // Emit COMBAT_END event
        const { eventEmitter, ...stateWithoutEmitter } = currentGameState;
        currentGameState.eventEmitter.emit({
          type: EventType.COMBAT_END,
          timestamp: Date.now(),
          context: structuredClone(stateWithoutEmitter) as GameState,
          // Include crawlers who cleared the area for narrative context
          entities: crawlersInArea,
          metadata: {
            totalKills: areaTracking.killsThisEncounter ?? 0,
          },
        });

        // Reset combat state for this area
        currentGameState.eventTracking.combatState[currentAreaId] = {
          combatStarted: false,
          wasInCombat: false,
          killsThisEncounter: 0,
        };
      }

      // Update wasInCombat for next turn (after checking for COMBAT_END)
      if (areaTracking && currentGameState.eventTracking) {
        currentGameState.eventTracking.combatState[currentAreaId] = {
          ...areaTracking,
          wasInCombat: monstersInArea.length > 0,
        };
      }
    }

    iterations++;
  }

  // Check if we hit max iterations while still playing
  const truncated = iterations >= maxIterations && gameStatus.status === 'playing';
  if (truncated) {
    simulationLogger.warn(
      { iterations, bubbleId: bubble.id, waitingForCount: waitingFor.length },
      'Simulation hit max iterations limit'
    );
  }

  return {
    bubble: currentBubble,
    entities: currentEntities,
    items: currentItems,
    messages,
    waitingFor,
    iterationsUsed: iterations,
    gameStatus,
    truncated,
    exploredTilesUpdates,
  };
}

/**
 * Get the direction from one entity to another adjacent entity.
 *
 * @param from - The source entity
 * @param to - The target entity (must be adjacent to source)
 * @returns The direction from source to target
 * @throws Error if entities are not adjacent - indicates state corruption
 *
 * @remarks
 * This function requires entities to be exactly 1 tile apart (Chebyshev distance).
 * If called with non-adjacent entities, it throws an error because this indicates
 * a logic bug in the caller (e.g., isAdjacent() check was skipped or state is
 * corrupted). In a deterministic game engine, we fail fast rather than silently
 * producing incorrect behavior.
 */
function getDirectionTo(from: Entity, to: Entity): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === -1) return 'north';
  if (dx === 0 && dy === 1) return 'south';
  if (dx === 1 && dy === 0) return 'east';
  if (dx === -1 && dy === 0) return 'west';
  if (dx === 1 && dy === -1) return 'northeast';
  if (dx === -1 && dy === -1) return 'northwest';
  if (dx === 1 && dy === 1) return 'southeast';
  if (dx === -1 && dy === 1) return 'southwest';

  // Non-adjacent entities indicate a logic error or state corruption
  simulationLogger.error(
    {
      fromId: from.id,
      toId: to.id,
      fromPos: { x: from.x, y: from.y },
      toPos: { x: to.x, y: to.y },
      dx,
      dy,
    },
    'getDirectionTo called with non-adjacent entities - indicates state corruption'
  );
  throw new Error(
    `Cannot get direction from ${from.id} at (${from.x},${from.y}) to ${to.id} at (${to.x},${to.y}) - entities not adjacent (dx=${dx}, dy=${dy})`
  );
}

/**
 * Simulate the game state, running the bubble simulation loop.
 *
 * This is the main entry point for processing game turns. It:
 * 1. Runs the simulation loop on each bubble independently
 * 2. Aggregates waitingFor across all bubbles
 * 3. Merges all results back into the full GameState
 *
 * Each bubble simulates until it needs input or reaches the iteration limit.
 * If any bubble causes a game-ending condition, simulation stops.
 *
 * @param state - Current game state
 * @param options - Simulation options
 * @returns Updated state and list of entities waiting for input (from all bubbles)
 */
export function simulate(state: GameState, options?: SimulateOptions): {
  state: GameState;
  waitingFor: EntityId[];
} {
  // Ensure eventEmitter and eventTracking exist — both are lost when GameState is
  // serialized/deserialized (e.g. stored in Supabase then loaded back as JSON).
  if (!state.eventEmitter) {
    (state as { eventEmitter: GameEventEmitter }).eventEmitter = new GameEventEmitter();
  }
  if (!state.eventTracking) {
    (state as { eventTracking: EventTracking }).eventTracking = {
      combatState: {},
      seenMonsterTypes: {},
      seenPortals: {},
      entitiesBelowCritical: new Set(),
    };
  }

  if (state.bubbles.length === 0) {
    return { state, waitingFor: [] };
  }

  // Simulate ALL bubbles independently
  // Each bubble runs to completion or until awaiting input
  const currentEntities = { ...state.entities };
  let currentItems = [...state.items];
  const newBubbles: Bubble[] = [];
  const allWaitingFor: EntityId[] = [];
  const allMessages: Message[] = [];
  const allExploredTilesUpdates: ExploredTiles = {};
  let anyIterationsUsed = false;
  let finalGameStatus: GameStatus = state.gameStatus;

  for (let i = 0; i < state.bubbles.length; i++) {
    const bubble = state.bubbles[i];

    // Filter entities to only those in this bubble
    const bubbleEntities: Record<string, Entity> = {};
    for (const eid of bubble.entityIds) {
      const entity = currentEntities[eid as string];
      if (entity) {
        bubbleEntities[eid as string] = entity;
      }
    }

    // Create game state snapshot for this bubble's simulation
    const bubbleGameState: GameState = {
      ...state,
      entities: currentEntities,
      items: currentItems,
    };

    const result = simulateBubble(bubble, bubbleEntities, {
      maxIterations: options?.maxIterations,
      gameState: bubbleGameState,
    });

    // Merge updated entities back
    for (const [id, entity] of Object.entries(result.entities)) {
      currentEntities[id] = entity;
    }
    // Remove killed entities from this bubble
    for (const eid of bubble.entityIds) {
      if (!result.entities[eid as string]) {
        delete currentEntities[eid as string];
      }
    }
    // Update items from this bubble's simulation
    currentItems = [...result.items];

    newBubbles.push(result.bubble);
    allWaitingFor.push(...result.waitingFor);
    allMessages.push(...result.messages);

    // Merge explored tiles updates from this bubble (keyed by areaId)
    for (const [areaId, tiles] of Object.entries(result.exploredTilesUpdates)) {
      // Merge tiles from this area with any existing tiles
      const existing = allExploredTilesUpdates[areaId] ?? [];
      const merged = new Set([...existing, ...tiles]);
      allExploredTilesUpdates[areaId] = Array.from(merged);
    }

    if (result.iterationsUsed > 0) {
      anyIterationsUsed = true;
    }

    // If any bubble ends the game, stop processing
    if (result.gameStatus.status === 'ended') {
      finalGameStatus = result.gameStatus;
      // Add remaining bubbles unchanged
      for (let j = i + 1; j < state.bubbles.length; j++) {
        newBubbles.push(state.bubbles[j]);
      }
      break;
    }
  }

  // Merge explored tiles updates with existing state (keyed by areaId)
  const mergedExploredTiles: ExploredTiles = { ...state.exploredTiles };
  for (const [areaId, tiles] of Object.entries(allExploredTilesUpdates)) {
    // Merge tiles from this area with any existing tiles
    const existing = mergedExploredTiles[areaId] ?? [];
    const merged = new Set([...existing, ...tiles]);
    mergedExploredTiles[areaId] = Array.from(merged);
  }

  // Follow the first crawler to their area (viewport follows player)
  // This handles area transitions via portals
  let newCurrentAreaId = state.currentAreaId;
  for (const entity of Object.values(currentEntities)) {
    if (isCrawler(entity) && entity.areaId !== state.currentAreaId) {
      newCurrentAreaId = entity.areaId;
      break;
    }
  }

  let newState: GameState = {
    ...state,
    currentAreaId: newCurrentAreaId,
    entities: currentEntities,
    items: currentItems,
    bubbles: newBubbles,
    messages: [...state.messages, ...allMessages],
    exploredTiles: mergedExploredTiles,
    gameStatus: finalGameStatus,
    turn: state.turn + (anyIterationsUsed ? 1 : 0),
  };

  // Wake hibernating entities near crawlers
  // This allows monsters to join bubbles when crawlers approach them
  if (newState.hibernating.length > 0 && newState.gameStatus.status === 'playing') {
    const updatedBubbles: Bubble[] = [];
    let hibernatingChanged = false;

    for (const bubble of newState.bubbles) {
      let currentBubble = bubble;

      // Check each crawler in this bubble
      for (const entityId of bubble.entityIds) {
        const entity = newState.entities[entityId as string];
        if (entity && isCrawler(entity)) {
          const wakeResult = wakeNearbyEntities(newState, currentBubble, { x: entity.x, y: entity.y });
          if (wakeResult.wokenIds.length > 0) {
            newState = wakeResult.state;
            currentBubble = wakeResult.bubble;
            hibernatingChanged = true;
          }
        }
      }

      updatedBubbles.push(currentBubble);
    }

    if (hibernatingChanged) {
      newState = { ...newState, bubbles: updatedBubbles };
    }
  }

  // Update objectives for all crawlers in all bubbles
  if (anyIterationsUsed && newState.objectives.length > 0) {
    const crawlerIds: CrawlerId[] = [];
    for (const bubble of newState.bubbles) {
      for (const eid of bubble.entityIds) {
        if (isCrawlerId(eid as string)) {
          crawlerIds.push(eid as string as CrawlerId);
        }
      }
    }
    if (crawlerIds.length > 0) {
      const previousObjectives = newState.objectives;
      newState = updateObjectivesForCrawlers(newState, crawlerIds);

      // Check for VICTORY: game ended with victory
      const wasNotEnded = previousObjectives.some(obj => obj.status === 'active');
      const isVictory = newState.gameStatus.status === 'ended' && newState.gameStatus.victory;

      if (isVictory && wasNotEnded && newState.eventEmitter) {
        // Get all entities for the victory event
        const allEntities = Object.values(newState.entities);
        const { eventEmitter, ...stateWithoutEmitter } = newState;
        // Get floor number from current area's danger level
        const currentArea = newState.zone.areas[newState.currentAreaId];
        const floor = currentArea?.metadata.dangerLevel ?? 1;
        newState.eventEmitter.emit({
          type: EventType.VICTORY,
          timestamp: Date.now(),
          context: structuredClone(stateWithoutEmitter) as GameState,
          entities: allEntities,
          metadata: {
            floor,
            turns: newState.turn,
          },
        });
      }
    }
  }

  return {
    state: newState,
    waitingFor: allWaitingFor,
  };
}
