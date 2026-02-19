#!/usr/bin/env node
/**
 * Headless Game CLI Runner
 *
 * Runs games without UI for AI benchmarking and trace collection.
 *
 * Usage:
 *   pnpm --filter @crawler/core headless
 *   pnpm --filter @crawler/core headless --count 20
 *   pnpm --filter @crawler/core headless --seed 12345
 */

import { Command } from 'commander';
import {
  runHeadlessGame,
  AIAgent,
  ScriptAgent,
  ReplayAgent,
  FileTraceWriter,
  NoopTraceWriter,
} from '../lib/headless';

interface CLIOptions {
  count: number;
  seed?: number;
  output: string;
  maxTurns: number;
  quiet: boolean;
  noTrace: boolean;
  agent: 'ai' | 'script' | 'replay';
  replay?: string;
}

const program = new Command();

program
  .name('headless')
  .description('Run headless games for AI benchmarking and trace collection')
  .version('1.0.0')
  .option('-n, --count <number>', 'Number of games to run', '1')
  .option('-s, --seed <number>', 'RNG seed (single game only)')
  .option('-o, --output <dir>', 'Output directory for traces', './.traces')
  .option('--max-turns <number>', 'Turn limit per game', '500')
  .option('-q, --quiet', 'Suppress per-turn output', false)
  .option('--no-trace', 'Skip writing traces (perf testing)')
  .option('-a, --agent <type>', 'Agent type: ai, script, replay', 'ai')
  .option('--replay <file>', 'Path to trace file for replay mode')
  .action(async (opts) => {
    // When --replay is used, automatically set agent to 'replay'
    const agentType = opts.replay ? 'replay' : opts.agent;

    const options: CLIOptions = {
      count: parseInt(opts.count, 10),
      seed: opts.seed ? parseInt(opts.seed, 10) : undefined,
      output: opts.output,
      maxTurns: parseInt(opts.maxTurns, 10),
      quiet: opts.quiet,
      noTrace: opts.trace === false, // commander sets trace=false when --no-trace is passed
      agent: agentType as CLIOptions['agent'],
      replay: opts.replay,
    };

    await runCLI(options);
  });

program.parse();

/**
 * Main CLI runner
 */
async function runCLI(options: CLIOptions): Promise<void> {
  const { count, seed, output, maxTurns, quiet, noTrace, agent: agentType, replay } = options;

  // Validate options
  if (count > 1 && seed !== undefined) {
    console.error('Error: --seed can only be used with a single game (--count 1)');
    process.exit(1);
  }

  // Validate replay mode requires a replay file
  if (agentType === 'replay' && !replay) {
    console.error('Error: --agent replay requires --replay <file> to be specified');
    process.exit(1);
  }

  // Validate replay mode can only run single game
  if (agentType === 'replay' && count > 1) {
    console.error('Error: --replay can only be used with a single game (--count 1)');
    process.exit(1);
  }

  // Validate seed doesn't conflict with trace file seed in replay mode
  if (agentType === 'replay' && replay && seed !== undefined) {
    const replayAgent = new ReplayAgent(replay);
    const traceSeed = replayAgent.getSeed();
    if (seed !== traceSeed) {
      console.error(`Error: --seed ${seed} conflicts with trace seed ${traceSeed}`);
      process.exit(1);
    }
  }

  // Print header
  if (!quiet) {
    console.log('\n🎮 Headless Runner v1.0');
    console.log(`Agent: ${agentType}${replay ? ` (${replay})` : ''}`);
    console.log(`Output: ${noTrace ? '(disabled)' : output}`);
    console.log('');
  }

  // Track results for summary
  const results: GameResult[] = [];
  const startTime = performance.now();

  // Run games
  for (let i = 0; i < count; i++) {
    const gameNum = i + 1;

    // Create agent based on type
    let agent;
    let gameSeed: number;

    switch (agentType) {
      case 'script':
        agent = new ScriptAgent();
        gameSeed = seed ?? Math.floor(Math.random() * 1_000_000);
        break;
      case 'replay':
        // ReplayAgent takes file path directly in constructor
        agent = new ReplayAgent(replay!);
        // Use seed from trace file for determinism validation
        gameSeed = agent.getSeed();
        break;
      default:
        agent = new AIAgent();
        gameSeed = seed ?? Math.floor(Math.random() * 1_000_000);
    }

    if (!quiet) {
      console.log(`Game ${gameNum}/${count} [seed: ${gameSeed}]`);
    }

    const traceWriter = noTrace
      ? new NoopTraceWriter()
      : new FileTraceWriter({ outputDir: output });

    const floorTurns: number[] = [];
    let currentFloor = 1;
    let floorStartTurn = 0;

    try {
      const result = await runHeadlessGame({
        seed: gameSeed,
        agent,
        traceWriter,
        maxTurns,
        onTurnComplete: (turn, state) => {
          // Track floor progress (dangerLevel equals floor number for dungeon areas)
          const area = state.zone.areas[state.currentAreaId];
          const floor = area?.metadata?.dangerLevel ?? 1;

          if (floor > currentFloor) {
            floorTurns.push(turn - floorStartTurn);
            floorStartTurn = turn;
            currentFloor = floor;
          }
        },
      });

      // Record final floor turns
      floorTurns.push(result.totalTurns - floorStartTurn);

      results.push({
        seed: gameSeed,
        outcome: result.outcome,
        finalFloor: result.finalFloor,
        totalTurns: result.totalTurns,
        durationMs: result.durationMs,
        traceId: result.traceId,
        floorTurns,
      });

      if (!quiet) {
        printGameResult(result, floorTurns, noTrace ? undefined : output);
      }
    } catch (error) {
      console.error(`Game ${gameNum} failed:`, error);
      results.push({
        seed: gameSeed,
        outcome: 'error' as const,
        finalFloor: 0,
        totalTurns: 0,
        durationMs: 0,
        traceId: '',
        floorTurns: [],
      });
    }
  }

  const totalDuration = Math.round(performance.now() - startTime);

  // Print summary
  printSummary(results, totalDuration, output, noTrace);
}

interface GameResult {
  seed: number;
  outcome: 'win' | 'loss' | 'timeout' | 'error';
  finalFloor: number;
  totalTurns: number;
  durationMs: number;
  traceId: string;
  floorTurns: number[];
}

/**
 * Print progress bar for floor turns
 */
function progressBar(turns: number, maxTurns: number = 50): string {
  const width = Math.min(20, Math.ceil((turns / maxTurns) * 20));
  return '█'.repeat(width);
}

/**
 * Print single game result
 */
function printGameResult(
  result: { outcome: string; finalFloor: number; totalTurns: number; traceId: string },
  floorTurns: number[],
  outputDir?: string
): void {
  for (let i = 0; i < floorTurns.length; i++) {
    const floor = i + 1;
    const turns = floorTurns[i];
    const isLast = i === floorTurns.length - 1;
    const suffix = isLast
      ? result.outcome === 'win'
        ? ' (victory!)'
        : result.outcome === 'loss'
        ? ' (died)'
        : ' (timeout)'
      : '';

    console.log(`  Floor ${floor}: ${progressBar(turns)} ${turns} turns${suffix}`);
  }

  const outcomeLabel = result.outcome.toUpperCase();
  console.log(`  Result: ${outcomeLabel} at floor ${result.finalFloor}, ${result.totalTurns} turns`);

  if (outputDir) {
    console.log(`  Trace: ${outputDir}/${result.traceId}.jsonl`);
  }
  console.log('');
}

/**
 * Print batch summary
 */
function printSummary(
  results: GameResult[],
  totalDurationMs: number,
  outputDir: string,
  noTrace: boolean
): void {
  const games = results.length;
  const wins = results.filter(r => r.outcome === 'win').length;
  const errors = results.filter(r => r.outcome === 'error').length;
  const floor1Clears = results.filter(r => r.finalFloor >= 2).length;
  const floor3Reaches = results.filter(r => r.finalFloor >= 3).length;
  const avgTurns = results.reduce((sum, r) => sum + r.totalTurns, 0) / games;

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
  };

  console.log('━'.repeat(45));
  console.log(`Summary (${games} game${games > 1 ? 's' : ''})`);
  console.log('━'.repeat(45));
  console.log(`Win rate:        ${((wins / games) * 100).toFixed(0)}% (${wins}/${games})`);
  console.log(`Floor 1 clear:   ${((floor1Clears / games) * 100).toFixed(0)}% (${floor1Clears}/${games})`);
  console.log(`Floor 3+ reach:  ${((floor3Reaches / games) * 100).toFixed(0)}% (${floor3Reaches}/${games})`);
  console.log(`Avg turns:       ${avgTurns.toFixed(1)}`);

  if (errors > 0) {
    console.log(`Errors:          ${errors}`);
  }

  console.log(`Total time:      ${formatDuration(totalDurationMs)}`);

  if (!noTrace) {
    console.log(`Traces saved:    ${outputDir}/`);
  }

  console.log('');
}
