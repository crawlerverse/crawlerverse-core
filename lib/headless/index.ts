/**
 * Headless Game Execution Module
 *
 * Provides headless game execution for automated testing, AI benchmarking,
 * and trace collection for ML training pipelines.
 *
 * @example
 * ```typescript
 * import { runHeadlessGame, AIAgent, FileTraceWriter } from '@crawler/core/headless';
 *
 * const result = await runHeadlessGame({
 *   seed: 12345,
 *   agent: new AIAgent(),
 *   traceWriter: new FileTraceWriter({ outputDir: './traces' }),
 * });
 *
 * console.log(`Game ended: ${result.outcome} on floor ${result.finalFloor}`);
 * ```
 */

// Main entry point
export { runHeadlessGame } from './headless-game';

// Agents
export { AIAgent, type AIAgentOptions } from './agents/ai-agent';
export { ReplayAgent } from './agents/replay-agent';
export { ScriptAgent } from './agents/script-agent';

// Trace writers
export {
  FileTraceWriter,
  NoopTraceWriter,
  readTraceFile,
  type FileTraceWriterOptions,
} from './traces/file-writer';

// Types and schemas
export {
  // Schemas
  AgentResponseSchema,
  TraceCombatResultSchema,
  MonsterReactionSchema,
  ActionResultSchema,
  StateSnapshotSchema,
  TurnRecordSchema,
  CrawlerSummarySchema,
  GameTraceSchema,
  TraceConfigSchema,
  GameSummarySchema,
  // Types
  type AgentResponse,
  type TraceCombatResult,
  type MonsterReaction,
  type ActionResult,
  type StateSnapshot,
  type TurnRecord,
  type CrawlerSummary,
  type GameTrace,
  type TraceConfig,
  type GameSummary,
  // Options and results
  type HeadlessGameOptions,
  type HeadlessGameResult,
  // Interfaces
  type AgentAdapter,
  type TraceWriter,
} from './types';
