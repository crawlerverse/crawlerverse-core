/**
 * File-based Trace Writer
 *
 * Writes game traces to JSONL files for local storage and ML pipelines.
 * Each game produces one file with the trace ID as filename.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TraceWriter, TraceConfig, TurnRecord, GameSummary, GameTrace } from '../types';

export interface FileTraceWriterOptions {
  /** Output directory for trace files (default: './traces') */
  outputDir?: string;
}

/**
 * Writes traces to JSONL files.
 *
 * File format: One JSON object per line
 * - Line 1: Trace header (id, version, seed, config, startedAt)
 * - Lines 2-N: Turn records
 * - Final line: Game summary (appended on endGame)
 *
 * This streaming format allows reading large traces without loading all into memory.
 */
export class FileTraceWriter implements TraceWriter {
  private readonly outputDir: string;
  private readonly traces: Map<string, {
    config: TraceConfig;
    startedAt: string;
    filePath: string;
  }> = new Map();

  constructor(options: FileTraceWriterOptions = {}) {
    this.outputDir = options.outputDir ?? './traces';
  }

  async startGame(config: TraceConfig): Promise<string> {
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Generate trace ID
    const id = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const filePath = path.join(this.outputDir, `${id}.jsonl`);

    // Store trace metadata
    this.traces.set(id, { config, startedAt, filePath });

    // Write header line
    const header = {
      type: 'header',
      id,
      version: 1,
      seed: config.seed,
      zoneConfig: config.zoneConfig,
      crawlers: config.crawlers,
      startedAt,
    };
    fs.writeFileSync(filePath, JSON.stringify(header) + '\n');

    return id;
  }

  async writeTurn(traceId: string, turn: TurnRecord): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Unknown trace ID: ${traceId}`);
    }

    const record = { type: 'turn', ...turn };
    fs.appendFileSync(trace.filePath, JSON.stringify(record) + '\n');
  }

  async endGame(traceId: string, summary: GameSummary): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Unknown trace ID: ${traceId}`);
    }

    const endedAt = new Date().toISOString();
    const footer = {
      type: 'summary',
      ...summary,
      endedAt,
    };
    fs.appendFileSync(trace.filePath, JSON.stringify(footer) + '\n');

    // Clean up
    this.traces.delete(traceId);
  }

  /** Get the file path for a trace (useful for reporting) */
  getFilePath(traceId: string): string | undefined {
    return this.traces.get(traceId)?.filePath;
  }
}

/**
 * Read a complete trace from a JSONL file.
 *
 * @param filePath - Path to the trace file
 * @returns Parsed GameTrace object
 */
export function readTraceFile(filePath: string): GameTrace {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').map(line => JSON.parse(line));

  const header = lines.find(l => l.type === 'header');
  const summary = lines.find(l => l.type === 'summary');
  const turns = lines
    .filter(l => l.type === 'turn')
    .map(({ type: _type, ...turn }) => turn);

  if (!header || !summary) {
    throw new Error(`Invalid trace file: missing header or summary`);
  }

  return {
    id: header.id,
    version: header.version,
    seed: header.seed,
    zoneConfig: header.zoneConfig,
    startedAt: header.startedAt,
    endedAt: summary.endedAt,
    durationMs: summary.durationMs,
    outcome: summary.outcome,
    finalFloor: summary.finalFloor,
    totalTurns: summary.totalTurns,
    crawlers: summary.crawlers,
    turns,
  };
}

/**
 * NoopTraceWriter - discards all trace data.
 * Useful for performance testing when trace output is not needed.
 */
export class NoopTraceWriter implements TraceWriter {
  private counter = 0;

  async startGame(_config: TraceConfig): Promise<string> {
    return `noop-${++this.counter}`;
  }

  async writeTurn(_traceId: string, _turn: TurnRecord): Promise<void> {
    // Discard
  }

  async endGame(_traceId: string, _summary: GameSummary): Promise<void> {
    // Discard
  }
}
