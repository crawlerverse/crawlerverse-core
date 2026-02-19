/**
 * Replay Agent
 *
 * Reads actions from a recorded trace file to reproduce exact game sequences.
 * This agent is useful for:
 * - Validating game determinism (same seed + same actions = same outcome)
 * - Debugging specific game states
 * - Replaying interesting or problematic games
 */

import type { AgentAdapter, AgentResponse, GameTrace } from '../types';
import type { GameState } from '../../engine/state';
import type { CrawlerId } from '../../engine/crawler-id';
import { readTraceFile } from '../traces/file-writer';

/**
 * ReplayAgent - Replays actions from a recorded trace file.
 *
 * Reads a trace file on construction and returns each recorded action
 * in sequence. Throws when all actions have been replayed.
 */
export class ReplayAgent implements AgentAdapter {
  private readonly trace: GameTrace;
  private currentTurnIndex: number = 0;

  /**
   * Create a ReplayAgent from a trace file.
   *
   * @param filePath - Path to the JSONL trace file
   * @throws If the file doesn't exist or is invalid
   */
  constructor(filePath: string) {
    this.trace = readTraceFile(filePath);
  }

  /**
   * Get the seed from the trace file.
   * This allows the game to be initialized with the same seed for determinism validation.
   */
  getSeed(): number {
    return this.trace.seed;
  }

  async getAction(
    _crawlerId: CrawlerId,
    _prompt: string,
    _state: GameState
  ): Promise<AgentResponse> {
    // Check if we've exhausted all turns
    if (this.currentTurnIndex >= this.trace.turns.length) {
      throw new Error(
        `Trace exhausted: replayed all ${this.trace.turns.length} turns from trace ${this.trace.id}`
      );
    }

    // Get the current turn's response
    const turn = this.trace.turns[this.currentTurnIndex];
    this.currentTurnIndex++;

    // Return the recorded response, ensuring modelId is set
    return {
      ...turn.response,
      modelId: turn.response.modelId ?? 'replay-agent',
    };
  }
}
