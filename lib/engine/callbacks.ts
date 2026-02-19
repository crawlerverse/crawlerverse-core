/**
 * Game Callbacks
 *
 * Optional callback types for observability integration.
 * Core package consumers can wire these to their own analytics/error tracking.
 *
 * @example
 * ```tsx
 * <PlayGame
 *   onGameStart={(sessionId, playerType) => trackGameStarted(playerType, sessionId)}
 *   onGameComplete={(data) => trackGameCompleted(data)}
 *   onError={(error, context) => reportError(error, context)}
 * />
 * ```
 */

/** Type of player controlling the game: human via keyboard or AI agent */
export type PlayerType = 'human' | 'ai';

/** Final outcome when a game ends */
export type GameOutcome = 'win' | 'loss';

/**
 * Data captured when a game session completes.
 * Used for analytics tracking and debugging AI performance.
 */
export interface GameCompleteData {
  /** Unique session ID for correlating events within a game */
  sessionId: string;
  /** Game outcome */
  outcome: GameOutcome;
  /** Total turns played (must be >= 0) */
  turns: number;
  /** Type of player that completed the game */
  playerType: PlayerType;
  /** Ratio of valid AI actions 0.0-1.0, only present for AI games */
  validActionRate?: number;
  /** Game duration in milliseconds (must be >= 0) */
  durationMs: number;
}

/**
 * Context for error reporting. Include as much context as available.
 * The component field is required to identify where errors originate.
 */
export interface ErrorContext {
  /** Required: The component or module where the error occurred */
  component: string;
  /** Session ID for correlating with game events */
  sessionId?: string;
  /** Turn number when error occurred */
  turn?: number;
  /** Action being processed when error occurred */
  action?: string;
  /** Unique error ID for user reference */
  errorId?: string;
  /** Additional context fields for extensibility */
  [key: string]: unknown;
}

/**
 * Optional callbacks for game observability.
 * All callbacks are optional - if not provided, the corresponding events are silently skipped.
 */
export interface GameCallbacks {
  /** Called when a new game starts */
  onGameStart?: (sessionId: string, playerType: PlayerType) => void;
  /** Called when a game ends */
  onGameComplete?: (data: GameCompleteData) => void;
  /** Called when AI returns an action (valid or invalid) */
  onAIAction?: (valid: boolean, actionType: string, sessionId: string) => void;
  /** Called when an error occurs that should be reported */
  onError?: (error: Error, context: ErrorContext) => void;
}

/**
 * Generate a unique session ID for correlating events within a game.
 * Uses crypto.randomUUID() for globally unique identifiers.
 *
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}
