/**
 * Action Processing
 *
 * Pure functions for processing crawler and monster actions.
 * Actions are validated and queued to the bubble's command queue,
 * then the simulation loop processes them in AP order.
 *
 * No side effects - takes state, returns new state.
 *
 * ## Action Economy Overview
 *
 * The game uses an Action Point (AP) accumulation system where faster entities
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
 * ### Turn Ratio Examples
 *
 * Over 10 player (speed 100) turns:
 * - Speed 120 rat: ~12 turns (1.2x player)
 * - Speed 100 goblin: ~10 turns (1.0x player)
 * - Speed 80 troll: ~8 turns (0.8x player)
 * - Speed 50 slug: ~5 turns (0.5x player)
 *
 * These are approximate - actual ratios emerge from AP dynamics and may vary
 * slightly based on starting conditions and tie-breaking.
 */

import {
  ActionSchema,
  isCrawler,
} from './state';
import type { GameState } from './state';
import { queueCommand } from './bubble';
import { entityId } from './scheduler';
import { simulate, DIRECTION_DELTAS, isDiagonalBlocked } from './simulation';
import { calculateDamage } from './combat';

// Re-export from simulation and combat for backwards compatibility
export { DIRECTION_DELTAS, calculateDamage, isDiagonalBlocked };

// --- Error Codes ---
export type ActionErrorCode = 'NOT_YOUR_TURN' | 'INVALID_ACTION' | 'ACTOR_NOT_FOUND' | 'GAME_OVER';

// --- Action Result Type ---
export type ActionResult =
  | { readonly success: true; readonly state: GameState; readonly nextActor: string | null }
  | { readonly success: false; readonly error: string; readonly code: ActionErrorCode };

/**
 * Get the current actor from the first bubble's scheduler.
 * Returns null if no bubbles exist or no current actor is set.
 */
export function getCurrentActor(state: GameState): string | null {
  if (state.bubbles.length === 0) return null;
  return state.bubbles[0].scheduler.currentActorId;
}

/**
 * Find the index of the bubble containing a given entity.
 * Returns -1 if the entity is not found in any bubble.
 */
export function findBubbleForEntity(state: GameState, entityIdParam: string): number {
  // entityIds are EntityId branded strings, but we accept plain strings for convenience
  // Use some() with equality check instead of includes() with cast
  return state.bubbles.findIndex(b => b.entityIds.some(id => id === entityIdParam));
}

// --- Main Action Processor ---
/**
 * Process an action for an actor.
 *
 * This is the main entry point for handling player/agent actions.
 * It validates the action, queues it to the bubble's command queue,
 * then runs the simulation loop to process turns.
 *
 * The new simulation-based approach:
 * 1. Validates the actor and action
 * 2. Queues the command using queueCommand
 * 3. Runs simulate() to process all turns until input is needed
 * 4. Returns the updated GameState
 *
 * @param state - Current game state
 * @param actorId - ID of the actor taking the action
 * @param rawAction - The action to process (will be validated)
 * @returns ActionResult with success/failure and updated state
 */
export function processAction(state: GameState, actorId: string, rawAction: unknown): ActionResult {
  // Check game over
  if (state.gameStatus.status === 'ended') {
    return { success: false, error: 'Game has ended', code: 'GAME_OVER' };
  }

  // Check actor exists
  const actor = state.entities[actorId];
  if (!actor) {
    return { success: false, error: `Actor ${actorId} not found`, code: 'ACTOR_NOT_FOUND' };
  }

  // Only crawlers can submit actions through this API
  if (!isCrawler(actor)) {
    return { success: false, error: `Actor ${actorId} is not a crawler`, code: 'INVALID_ACTION' };
  }

  // Find actor's bubble
  const bubbleIndex = findBubbleForEntity(state, actorId);
  if (bubbleIndex === -1) {
    return { success: false, error: `Actor ${actorId} not in any bubble`, code: 'ACTOR_NOT_FOUND' };
  }

  // Validate action at runtime
  const parseResult = ActionSchema.safeParse(rawAction);
  if (!parseResult.success) {
    return {
      success: false,
      error: `Invalid action: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
      code: 'INVALID_ACTION',
    };
  }

  const action = parseResult.data;
  const bubble = state.bubbles[bubbleIndex];

  // Queue the command
  const queueResult = queueCommand(bubble, entityId(actorId), action);
  if (!queueResult.success) {
    return {
      success: false,
      error: queueResult.error ?? 'Failed to queue command',
      code: 'INVALID_ACTION',
    };
  }

  // Update state with the new bubble
  const stateWithQueuedCommand: GameState = {
    ...state,
    bubbles: state.bubbles.map((b, i) => i === bubbleIndex ? queueResult.bubble : b),
  };

  // Run the simulation
  const result = simulate(stateWithQueuedCommand);

  // Determine next actor from the updated bubble
  const finalBubble = result.state.bubbles[bubbleIndex];
  const nextActorId = finalBubble?.scheduler.currentActorId ?? null;

  // Check if game is waiting for input from a specific actor
  // If waitingFor is not empty, the first entry is the next actor
  const waitingActor = result.waitingFor.length > 0 ? result.waitingFor[0] : nextActorId;

  return {
    success: true,
    state: result.state,
    nextActor: waitingActor as string | null,
  };
}

/**
 * Process a timeout for a player/agent who failed to submit an action in time.
 *
 * When a bubble is in 'awaiting_input' state and the timeout threshold is reached,
 * this function injects a wait action for the timed-out actor and processes
 * their turn normally.
 *
 * In the simulation-based model, we first run a simulation to determine which
 * crawler is actually waiting for input, then force a wait action for them.
 *
 * @param state - Current game state
 * @param bubbleIndex - Index of the bubble with the timed-out actor
 * @returns ActionResult with the updated state after processing the forced wait
 */
export function processTimeout(
  state: GameState,
  bubbleIndex: number
): ActionResult {
  // Validate bubble index
  if (bubbleIndex < 0 || bubbleIndex >= state.bubbles.length) {
    return {
      success: false,
      error: `Invalid bubble index: ${bubbleIndex}`,
      code: 'INVALID_ACTION',
    };
  }

  const bubble = state.bubbles[bubbleIndex];

  // If bubble is in awaiting_input state, use that actorId
  if (bubble.executionState.status === 'awaiting_input') {
    const timedOutActorId = bubble.executionState.actorId;
    const waitAction = {
      action: 'wait' as const,
      reasoning: 'Action timed out',
    };
    return processAction(state, timedOutActorId, waitAction);
  }

  // Otherwise, run simulation to find who's waiting
  const simResult = simulate(state);

  // Check if game ended during simulation
  if (simResult.state.gameStatus.status === 'ended') {
    return {
      success: true,
      state: simResult.state,
      nextActor: null,
    };
  }

  if (simResult.waitingFor.length === 0) {
    // No one is waiting for input - this shouldn't happen in a timeout scenario
    const bubbleState = simResult.state.bubbles[bubbleIndex]?.executionState.status ?? 'unknown';
    return {
      success: false,
      error: `No crawler awaiting input in bubble ${bubbleIndex} (state: ${bubbleState}) - simulation may have completed unexpectedly`,
      code: 'INVALID_ACTION',
    };
  }

  // Force a wait action for the first waiting crawler
  const timedOutActorId = simResult.waitingFor[0] as string;
  const waitAction = {
    action: 'wait' as const,
    reasoning: 'Action timed out',
  };

  return processAction(simResult.state, timedOutActorId, waitAction);
}
