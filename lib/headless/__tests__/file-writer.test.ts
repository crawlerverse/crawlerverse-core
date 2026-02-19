/**
 * FileTraceWriter Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FileTraceWriter, NoopTraceWriter, readTraceFile } from '../traces/file-writer';
import type { TraceConfig, TurnRecord, GameSummary, CrawlerSummary } from '../types';

describe('FileTraceWriter', () => {
  const testDir = './test-traces';
  let writer: FileTraceWriter;

  beforeEach(() => {
    writer = new FileTraceWriter({ outputDir: testDir });
    // Clean up test directory if it exists
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  const createTestCrawler = (id: string): CrawlerSummary => ({
    id,
    name: 'Test Crawler',
    characterClass: 'warrior',
    finalHp: 20,
    maxHp: 20,
    monstersKilled: 0,
    damageDealt: 0,
    damageTaken: 0,
  });

  const createTestConfig = (seed = 12345): TraceConfig => ({
    seed,
    zoneConfig: { seed },
    crawlers: [createTestCrawler('crawler-1')],
  });

  const createTestTurn = (turn: number): TurnRecord => ({
    turn,
    crawlerId: 'crawler-1',
    floor: 1,
    prompt: 'Test prompt',
    response: {
      action: { action: 'wait', reasoning: 'Testing' },
      reasoning: 'Testing',
      shortThought: 'Test',
    },
    actionResult: {
      success: true,
      hpBefore: 20,
      hpAfter: 20,
      positionBefore: { x: 5, y: 5 },
      positionAfter: { x: 5, y: 5 },
      monstersKilled: [],
      monsterReactions: [],
    },
  });

  const createTestSummary = (): GameSummary => ({
    outcome: 'win',
    finalFloor: 3,
    totalTurns: 10,
    durationMs: 5000,
    crawlers: [createTestCrawler('crawler-1')],
  });

  describe('startGame', () => {
    it('should create output directory if not exists', async () => {
      expect(fs.existsSync(testDir)).toBe(false);

      await writer.startGame(createTestConfig());

      expect(fs.existsSync(testDir)).toBe(true);
    });

    it('should return a unique trace ID', async () => {
      const id1 = await writer.startGame(createTestConfig(1));
      const id2 = await writer.startGame(createTestConfig(2));

      expect(id1).toMatch(/^game-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^game-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should create a trace file with header', async () => {
      const traceId = await writer.startGame(createTestConfig());
      const filePath = writer.getFilePath(traceId);

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath!)).toBe(true);

      const content = fs.readFileSync(filePath!, 'utf-8');
      const lines = content.trim().split('\n');
      const header = JSON.parse(lines[0]);

      expect(header.type).toBe('header');
      expect(header.id).toBe(traceId);
      expect(header.version).toBe(1);
      expect(header.seed).toBe(12345);
    });
  });

  describe('writeTurn', () => {
    it('should append turn record to trace file', async () => {
      const traceId = await writer.startGame(createTestConfig());
      await writer.writeTurn(traceId, createTestTurn(1));

      const filePath = writer.getFilePath(traceId);
      const content = fs.readFileSync(filePath!, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);
      const turn = JSON.parse(lines[1]);
      expect(turn.type).toBe('turn');
      expect(turn.turn).toBe(1);
    });

    it('should throw for unknown trace ID', async () => {
      await expect(writer.writeTurn('unknown-id', createTestTurn(1)))
        .rejects.toThrow('Unknown trace ID');
    });
  });

  describe('endGame', () => {
    it('should append summary and clean up', async () => {
      const traceId = await writer.startGame(createTestConfig());
      await writer.writeTurn(traceId, createTestTurn(1));
      const filePath = writer.getFilePath(traceId);

      await writer.endGame(traceId, createTestSummary());

      // File should still exist
      expect(fs.existsSync(filePath!)).toBe(true);

      // But trace should be cleaned up (getFilePath returns undefined)
      expect(writer.getFilePath(traceId)).toBeUndefined();

      // Summary should be in file
      const content = fs.readFileSync(filePath!, 'utf-8');
      const lines = content.trim().split('\n');
      const summary = JSON.parse(lines[lines.length - 1]);

      expect(summary.type).toBe('summary');
      expect(summary.outcome).toBe('win');
      expect(summary.endedAt).toBeDefined();
    });

    it('should throw for unknown trace ID', async () => {
      await expect(writer.endGame('unknown-id', createTestSummary()))
        .rejects.toThrow('Unknown trace ID');
    });
  });
});

describe('readTraceFile', () => {
  const testDir = './test-traces-read';

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should parse a complete trace file', async () => {
    const writer = new FileTraceWriter({ outputDir: testDir });

    const config: TraceConfig = {
      seed: 99999,
      zoneConfig: { seed: 99999 },
      crawlers: [{
        id: 'c1',
        name: 'Hero',
        characterClass: 'mage',
        finalHp: 15,
        maxHp: 20,
        monstersKilled: 2,
        damageDealt: 30,
        damageTaken: 5,
      }],
    };

    const traceId = await writer.startGame(config);
    await writer.writeTurn(traceId, {
      turn: 1,
      crawlerId: 'c1',
      floor: 1,
      prompt: 'prompt1',
      response: {
        action: { action: 'move', direction: 'north', reasoning: 'exploring' },
        reasoning: 'exploring',
        shortThought: 'move',
      },
      actionResult: {
        success: true,
        hpBefore: 20,
        hpAfter: 20,
        positionBefore: { x: 0, y: 0 },
        positionAfter: { x: 0, y: -1 },
        monstersKilled: [],
        monsterReactions: [],
      },
    });

    const filePath = writer.getFilePath(traceId)!;

    await writer.endGame(traceId, {
      outcome: 'loss',
      finalFloor: 2,
      totalTurns: 50,
      durationMs: 10000,
      crawlers: config.crawlers,
    });

    const trace = readTraceFile(filePath);

    expect(trace.id).toBe(traceId);
    expect(trace.version).toBe(1);
    expect(trace.seed).toBe(99999);
    expect(trace.outcome).toBe('loss');
    expect(trace.finalFloor).toBe(2);
    expect(trace.totalTurns).toBe(50);
    expect(trace.turns.length).toBe(1);
    expect(trace.turns[0].turn).toBe(1);
  });

  it('should throw for invalid trace file', () => {
    const filePath = path.join(testDir, 'invalid.jsonl');
    fs.writeFileSync(filePath, JSON.stringify({ type: 'invalid' }));

    expect(() => readTraceFile(filePath)).toThrow('missing header or summary');
  });
});

describe('NoopTraceWriter', () => {
  it('should return incrementing IDs', async () => {
    const writer = new NoopTraceWriter();

    const id1 = await writer.startGame({ seed: 1, zoneConfig: {}, crawlers: [] });
    const id2 = await writer.startGame({ seed: 2, zoneConfig: {}, crawlers: [] });

    expect(id1).toBe('noop-1');
    expect(id2).toBe('noop-2');
  });

  it('should not throw on any operation', async () => {
    const writer = new NoopTraceWriter();
    const traceId = await writer.startGame({ seed: 1, zoneConfig: {}, crawlers: [] });

    await expect(writer.writeTurn(traceId, {} as TurnRecord)).resolves.not.toThrow();
    await expect(writer.endGame(traceId, {} as GameSummary)).resolves.not.toThrow();
  });
});
