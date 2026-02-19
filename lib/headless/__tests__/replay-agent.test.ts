/**
 * ReplayAgent Tests
 *
 * Tests for the ReplayAgent that reads actions from recorded trace files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ReplayAgent } from '../agents/replay-agent';
import { FileTraceWriter } from '../traces/file-writer';
import type { GameState } from '../../engine/state';
import type { Entity } from '../../engine/types';
import type { CrawlerId } from '../../engine/crawler-id';
import type { TraceConfig, TurnRecord, GameSummary, CrawlerSummary } from '../types';
import type { Action, Direction } from '../../engine/types';

// Helper to create a minimal game state for testing
function createTestState(): GameState {
  const crawler: Entity = {
    id: 'crawler-1',
    type: 'crawler',
    x: 5,
    y: 5,
    areaId: 'area-1',
    hp: 10,
    maxHp: 10,
    name: 'Test Crawler',
    char: '@',
    attack: 5,
    defense: 2,
    speed: 100,
  };

  return {
    zone: {
      id: 'zone-1',
      name: 'Test Zone',
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-1'],
      areas: {
        'area-1': {
          metadata: {
            id: 'area-1',
            name: 'Test Area',
            dangerLevel: 1,
          },
          map: {
            width: 20,
            height: 20,
            tiles: Array(20).fill(null).map(() =>
              Array(20).fill(null).map(() => ({ type: 'floor' as const }))
            ),
            rooms: [],
            seed: 12345,
          },
        },
      },
    },
    currentAreaId: 'area-1',
    entities: { 'crawler-1': crawler },
    items: [],
    bubbles: [],
    hibernating: [],
    exploredTiles: {},
    objectives: [],
    turn: 1,
    messages: [],
    gameStatus: { status: 'playing' },
  };
}

describe('ReplayAgent', () => {
  const testDir = './test-traces-replay';

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

  const createTestTurn = (
    turn: number,
    actionType: Action['action'],
    direction?: Direction
  ): TurnRecord => {
    const action: Action = direction
      ? { action: actionType, direction, reasoning: `Turn ${turn} reasoning` } as Action
      : { action: actionType, reasoning: `Turn ${turn} reasoning` } as Action;

    return {
      turn,
      crawlerId: 'crawler-1',
      floor: 1,
      prompt: `Test prompt for turn ${turn}`,
      response: {
        action,
        reasoning: `Turn ${turn} reasoning`,
        shortThought: `Turn ${turn}`,
        modelId: 'test-model',
        durationMs: 100,
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
    };
  };

  const createTestSummary = (): GameSummary => ({
    outcome: 'win',
    finalFloor: 3,
    totalTurns: 3,
    durationMs: 5000,
    crawlers: [createTestCrawler('crawler-1')],
  });

  /**
   * Helper to create a trace file with given turns
   */
  async function createTraceFile(
    seed: number,
    turns: TurnRecord[]
  ): Promise<string> {
    const writer = new FileTraceWriter({ outputDir: testDir });
    const config = createTestConfig(seed);
    const traceId = await writer.startGame(config);

    for (const turn of turns) {
      await writer.writeTurn(traceId, turn);
    }

    const filePath = writer.getFilePath(traceId)!;
    await writer.endGame(traceId, createTestSummary());

    return filePath;
  }

  describe('replaying actions in order', () => {
    it('should replay actions from trace file in order', async () => {
      const filePath = await createTraceFile(12345, [
        createTestTurn(1, 'move', 'north'),
        createTestTurn(2, 'attack', 'east'),
        createTestTurn(3, 'wait'),
      ]);

      const agent = new ReplayAgent(filePath);
      const state = createTestState();

      // First action: move north
      const response1 = await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);
      expect(response1.action.action).toBe('move');
      expect(response1.action).toHaveProperty('direction', 'north');
      expect(response1.reasoning).toBe('Turn 1 reasoning');

      // Second action: attack east
      const response2 = await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);
      expect(response2.action.action).toBe('attack');
      expect(response2.action).toHaveProperty('direction', 'east');

      // Third action: wait
      const response3 = await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);
      expect(response3.action.action).toBe('wait');
    });

    it('should preserve all response metadata from trace', async () => {
      const filePath = await createTraceFile(12345, [
        createTestTurn(1, 'move', 'north'),
      ]);

      const agent = new ReplayAgent(filePath);
      const state = createTestState();

      const response = await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);

      expect(response.modelId).toBe('test-model');
      expect(response.durationMs).toBe(100);
      expect(response.shortThought).toBe('Turn 1');
    });
  });

  describe('throwing when trace is exhausted', () => {
    it('should throw when all actions have been replayed', async () => {
      const filePath = await createTraceFile(12345, [
        createTestTurn(1, 'wait'),
      ]);

      const agent = new ReplayAgent(filePath);
      const state = createTestState();

      // First call succeeds
      await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);

      // Second call should throw
      await expect(agent.getAction('crawler-1' as CrawlerId, 'prompt', state))
        .rejects.toThrow('Trace exhausted');
    });

    it('should include turn count in exhaustion error', async () => {
      const filePath = await createTraceFile(12345, [
        createTestTurn(1, 'wait'),
        createTestTurn(2, 'wait'),
        createTestTurn(3, 'wait'),
      ]);

      const agent = new ReplayAgent(filePath);
      const state = createTestState();

      // Exhaust all turns
      await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);
      await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);
      await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);

      // Fourth call should throw with turn info
      await expect(agent.getAction('crawler-1' as CrawlerId, 'prompt', state))
        .rejects.toThrow('3 turns');
    });
  });

  describe('error handling for invalid/missing trace files', () => {
    it('should throw for non-existent file', () => {
      expect(() => new ReplayAgent('/non/existent/file.jsonl'))
        .toThrow();
    });

    it('should throw for invalid trace file (missing header)', () => {
      const filePath = path.join(testDir, 'invalid.jsonl');
      fs.writeFileSync(filePath, JSON.stringify({ type: 'invalid' }) + '\n');

      expect(() => new ReplayAgent(filePath))
        .toThrow('missing header or summary');
    });

    it('should throw for trace file with no turns', async () => {
      const writer = new FileTraceWriter({ outputDir: testDir });
      const config = createTestConfig(12345);
      const traceId = await writer.startGame(config);
      const filePath = writer.getFilePath(traceId)!;
      await writer.endGame(traceId, createTestSummary());

      const agent = new ReplayAgent(filePath);
      const state = createTestState();

      await expect(agent.getAction('crawler-1' as CrawlerId, 'prompt', state))
        .rejects.toThrow('Trace exhausted');
    });
  });

  describe('providing seed from trace', () => {
    it('should provide seed from trace via getSeed()', async () => {
      const filePath = await createTraceFile(99999, [
        createTestTurn(1, 'wait'),
      ]);

      const agent = new ReplayAgent(filePath);

      expect(agent.getSeed()).toBe(99999);
    });

    it('should return the original seed used in the trace', async () => {
      const filePath = await createTraceFile(42, [
        createTestTurn(1, 'move', 'south'),
      ]);

      const agent = new ReplayAgent(filePath);

      expect(agent.getSeed()).toBe(42);
    });
  });

  describe('response format', () => {
    it('should set modelId to "replay-agent" if not present in trace', async () => {
      // Create a trace with a turn that has no modelId
      const writer = new FileTraceWriter({ outputDir: testDir });
      const config = createTestConfig(12345);
      const traceId = await writer.startGame(config);

      const turnWithoutModelId: TurnRecord = {
        turn: 1,
        crawlerId: 'crawler-1',
        floor: 1,
        prompt: 'Test prompt',
        response: {
          action: { action: 'wait', reasoning: 'Test' },
          reasoning: 'Test',
          shortThought: 'Test',
          // No modelId
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
      };

      await writer.writeTurn(traceId, turnWithoutModelId);
      const filePath = writer.getFilePath(traceId)!;
      await writer.endGame(traceId, createTestSummary());

      const agent = new ReplayAgent(filePath);
      const state = createTestState();
      const response = await agent.getAction('crawler-1' as CrawlerId, 'prompt', state);

      expect(response.modelId).toBe('replay-agent');
    });
  });
});
