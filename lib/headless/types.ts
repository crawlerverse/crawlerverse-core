/**
 * Headless Game Types
 *
 * Zod schemas and types for game traces, agent responses, and headless execution.
 * All types are serializable for JSONL output and Supabase persistence.
 */

import { z } from 'zod';
import type { GameState } from '../engine/state';
import { ActionSchema, BehaviorStateSchema } from '../engine/state';
import type { CrawlerId } from '../engine/crawler-id';

// --- Agent Response ---

export const AgentResponseSchema = z.object({
  action: ActionSchema,
  reasoning: z.string(),
  shortThought: z.string(),
  modelId: z.string().optional(),
  durationMs: z.number().optional(),
  outputTokens: z.number().optional(),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// --- Combat Result (for traces) ---

export const TraceCombatResultSchema = z.object({
  targetId: z.string(),
  targetName: z.string(),
  roll: z.number(),
  hit: z.boolean(),
  damage: z.number(),
  targetHpBefore: z.number(),
  targetHpAfter: z.number(),
  killed: z.boolean(),
});

export type TraceCombatResult = z.infer<typeof TraceCombatResultSchema>;

// --- Monster Reaction ---

export const MonsterReactionSchema = z.object({
  monsterId: z.string(),
  monsterName: z.string(),
  behaviorBefore: BehaviorStateSchema,
  behaviorAfter: BehaviorStateSchema,
  action: z.enum(['attack', 'move', 'wait']),
  damage: z.number().optional(),
});

export type MonsterReaction = z.infer<typeof MonsterReactionSchema>;

// --- Action Result ---

export const ActionResultSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  combat: TraceCombatResultSchema.optional(),
  hpBefore: z.number(),
  hpAfter: z.number(),
  positionBefore: z.object({ x: z.number(), y: z.number() }),
  positionAfter: z.object({ x: z.number(), y: z.number() }),
  monstersKilled: z.array(z.string()),
  monsterReactions: z.array(MonsterReactionSchema),
  /** Game messages describing what actually happened (e.g., "Crawler hits Goblin for 3 damage.") */
  outcomes: z.array(z.string()).optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// --- State Snapshot (optional debug data) ---

export const StateSnapshotSchema = z.object({
  visibleMonsters: z.array(z.object({
    id: z.string(),
    name: z.string(),
    hp: z.number(),
    x: z.number(),
    y: z.number(),
  })),
  visibleItems: z.array(z.object({
    templateId: z.string(),
    x: z.number(),
    y: z.number(),
  })),
  inventory: z.array(z.string()),
  equipped: z.object({
    weapon: z.string().optional(),
    armor: z.string().optional(),
  }),
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

// --- Turn Record ---

export const TurnRecordSchema = z.object({
  turn: z.number(),
  crawlerId: z.string(),
  floor: z.number(),
  prompt: z.string(),
  response: AgentResponseSchema,
  actionResult: ActionResultSchema,
  stateSnapshot: StateSnapshotSchema.optional(),
});

export type TurnRecord = z.infer<typeof TurnRecordSchema>;

// --- Crawler Summary ---

export const CrawlerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  characterClass: z.string(),
  bio: z.string().optional(),
  finalHp: z.number(),
  maxHp: z.number(),
  monstersKilled: z.number(),
  damageDealt: z.number(),
  damageTaken: z.number(),
});

export type CrawlerSummary = z.infer<typeof CrawlerSummarySchema>;

// --- Game Trace ---

export const GameTraceSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  seed: z.number(),
  zoneConfig: z.record(z.unknown()),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number(),
  outcome: z.enum(['win', 'loss', 'timeout']),
  finalFloor: z.number(),
  totalTurns: z.number(),
  crawlers: z.array(CrawlerSummarySchema),
  turns: z.array(TurnRecordSchema),
});

export type GameTrace = z.infer<typeof GameTraceSchema>;

// --- Trace Config (for starting a trace) ---

export const TraceConfigSchema = z.object({
  seed: z.number(),
  zoneConfig: z.record(z.unknown()),
  crawlers: z.array(CrawlerSummarySchema),
});

export type TraceConfig = z.infer<typeof TraceConfigSchema>;

// --- Game Summary (for ending a trace) ---

export const GameSummarySchema = z.object({
  outcome: z.enum(['win', 'loss', 'timeout']),
  finalFloor: z.number(),
  totalTurns: z.number(),
  durationMs: z.number(),
  crawlers: z.array(CrawlerSummarySchema),
});

export type GameSummary = z.infer<typeof GameSummarySchema>;

// --- Headless Game Options ---

export interface HeadlessGameOptions {
  /** RNG seed (random if not specified) */
  seed?: number;
  /** Agent to use for AI decisions */
  agent: AgentAdapter;
  /** Where to write traces */
  traceWriter: TraceWriter;
  /** Max turns before forced termination (default: 500) */
  maxTurns?: number;
  /** Callback for progress updates */
  onTurnComplete?: (turn: number, state: GameState) => void;
  /** Include state snapshots in traces (default: false, increases trace size) */
  includeSnapshots?: boolean;
  /** Zone/dungeon configuration */
  zoneConfig?: Partial<{ seed?: number; floorCount?: number }>;
}

export interface HeadlessGameResult {
  traceId: string;
  outcome: 'win' | 'loss' | 'timeout';
  finalFloor: number;
  totalTurns: number;
  durationMs: number;
}

// --- Agent Adapter Interface ---

export interface AgentAdapter {
  /** Get the next action for a crawler */
  getAction(
    crawlerId: CrawlerId,
    prompt: string,
    state: GameState
  ): Promise<AgentResponse>;

  /** Optional: called when game ends for cleanup */
  onGameEnd?(trace: GameTrace): Promise<void>;
}

// --- Trace Writer Interface ---

export interface TraceWriter {
  /** Start a new game trace, returns trace ID */
  startGame(config: TraceConfig): Promise<string>;

  /** Record a turn */
  writeTurn(traceId: string, turn: TurnRecord): Promise<void>;

  /** Finalize and close the trace */
  endGame(traceId: string, summary: GameSummary): Promise<void>;
}
