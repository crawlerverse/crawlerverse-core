/**
 * HeadlessGame Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { runHeadlessGame } from '../headless-game';
import { FileTraceWriter } from '../traces/file-writer';
import { ScriptAgent } from '../agents/script-agent';
import type { AgentAdapter, AgentResponse } from '../types';
import type { GameState } from '../../engine/state';
import type { CrawlerId } from '../../engine/crawler-id';

/**
 * Simple scripted agent for testing - always waits
 */
class WaitAgent implements AgentAdapter {
  callCount = 0;

  async getAction(
    _crawlerId: CrawlerId,
    _prompt: string,
    _state: GameState
  ): Promise<AgentResponse> {
    this.callCount++;
    return {
      action: { action: 'wait', reasoning: 'Testing - always wait' },
      reasoning: 'Testing - always wait',
      shortThought: 'Wait',
    };
  }
}

describe('runHeadlessGame', () => {
  const testDir = './test-headless-traces';

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should run a game and produce a trace file', async () => {
    const agent = new WaitAgent();
    const traceWriter = new FileTraceWriter({ outputDir: testDir });

    const result = await runHeadlessGame({
      seed: 12345,
      agent,
      traceWriter,
      maxTurns: 10, // Limit turns for test speed
    });

    // Check result
    expect(result.traceId).toMatch(/^game-\d+-[a-z0-9]+$/);
    expect(result.totalTurns).toBeLessThanOrEqual(10);
    expect(['win', 'loss', 'timeout']).toContain(result.outcome);
    expect(result.finalFloor).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThan(0);

    // Check trace file exists
    const files = fs.readdirSync(testDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.jsonl$/);

    // Verify trace content
    const traceContent = fs.readFileSync(`${testDir}/${files[0]}`, 'utf-8');
    const lines = traceContent.trim().split('\n');

    // Should have header, turns, and summary
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const header = JSON.parse(lines[0]);
    expect(header.type).toBe('header');
    expect(header.seed).toBe(12345);

    const summary = JSON.parse(lines[lines.length - 1]);
    expect(summary.type).toBe('summary');
    expect(summary.outcome).toBe(result.outcome);
  });

  it('should call agent for each turn requiring input', async () => {
    const agent = new WaitAgent();
    const traceWriter = new FileTraceWriter({ outputDir: testDir });

    await runHeadlessGame({
      seed: 54321,
      agent,
      traceWriter,
      maxTurns: 5,
    });

    // Agent should have been called at least once
    expect(agent.callCount).toBeGreaterThan(0);
    expect(agent.callCount).toBeLessThanOrEqual(5);
  });

  it('should respect maxTurns limit', async () => {
    const agent = new WaitAgent();
    const traceWriter = new FileTraceWriter({ outputDir: testDir });

    const result = await runHeadlessGame({
      seed: 99999,
      agent,
      traceWriter,
      maxTurns: 3,
    });

    expect(result.totalTurns).toBeLessThanOrEqual(3);
  });

  it('should call onTurnComplete callback', async () => {
    const agent = new WaitAgent();
    const traceWriter = new FileTraceWriter({ outputDir: testDir });
    const turns: number[] = [];

    await runHeadlessGame({
      seed: 11111,
      agent,
      traceWriter,
      maxTurns: 5,
      onTurnComplete: (turn) => turns.push(turn),
    });

    expect(turns.length).toBeGreaterThan(0);
    // Turns should be sequential
    for (let i = 1; i < turns.length; i++) {
      expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    }
  });

  it('should accept zoneConfig option', async () => {
    const agent = new WaitAgent();
    const traceWriter = new FileTraceWriter({ outputDir: testDir });

    const result = await runHeadlessGame({
      seed: 77777,
      agent,
      traceWriter,
      maxTurns: 3,
      zoneConfig: { floorCount: 2 }, // Custom config
    });

    expect(result.traceId).toBeDefined();
  });

  it('should complete a game with ScriptAgent', async () => {
    const agent = new ScriptAgent();
    const traceWriter = new FileTraceWriter({ outputDir: testDir });

    const result = await runHeadlessGame({
      seed: 99999,
      agent,
      traceWriter,
      maxTurns: 50,
    });

    expect(result.traceId).toBeDefined();
    expect(['win', 'loss', 'timeout']).toContain(result.outcome);
    expect(result.totalTurns).toBeLessThanOrEqual(50);

    // ScriptAgent should take actions (not just wait)
    const files = fs.readdirSync(testDir);
    expect(files.length).toBe(1);

    const traceContent = fs.readFileSync(`${testDir}/${files[0]}`, 'utf-8');
    const lines = traceContent.trim().split('\n');
    const turns = lines.filter((l) => JSON.parse(l).type === 'turn');

    // Verify ScriptAgent made decisions
    expect(turns.length).toBeGreaterThan(0);
  });
});
