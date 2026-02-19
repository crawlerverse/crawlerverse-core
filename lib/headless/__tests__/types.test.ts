/**
 * Type Schema Tests
 *
 * Tests Zod schema validation for trace types.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentResponseSchema,
  ActionResultSchema,
  TurnRecordSchema,
  CrawlerSummarySchema,
  GameTraceSchema,
  StateSnapshotSchema,
} from '../types';

describe('AgentResponseSchema', () => {
  it('should accept valid response with all fields', () => {
    const response = {
      action: { action: 'move', direction: 'north', reasoning: 'Moving towards the exit' },
      reasoning: 'Moving towards the exit',
      shortThought: 'Go north',
      modelId: 'test-model',
      durationMs: 100,
      outputTokens: 50,
    };

    const result = AgentResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('should accept response without optional fields', () => {
    const response = {
      action: { action: 'wait', reasoning: 'Waiting for opportunity' },
      reasoning: 'Waiting for opportunity',
      shortThought: 'Wait',
    };

    const result = AgentResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('should reject response missing required fields', () => {
    const response = {
      action: { action: 'wait', reasoning: 'test' },
      // missing reasoning and shortThought at top level
    };

    const result = AgentResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
});

describe('ActionResultSchema', () => {
  it('should accept valid result', () => {
    const result = {
      success: true,
      hpBefore: 20,
      hpAfter: 18,
      positionBefore: { x: 5, y: 5 },
      positionAfter: { x: 6, y: 5 },
      monstersKilled: ['goblin-1'],
      monsterReactions: [],
    };

    const parsed = ActionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('should accept result with error message', () => {
    const result = {
      success: false,
      errorMessage: 'Cannot move there',
      hpBefore: 20,
      hpAfter: 20,
      positionBefore: { x: 5, y: 5 },
      positionAfter: { x: 5, y: 5 },
      monstersKilled: [],
      monsterReactions: [],
    };

    const parsed = ActionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('should accept result with combat data', () => {
    const result = {
      success: true,
      hpBefore: 20,
      hpAfter: 20,
      positionBefore: { x: 5, y: 5 },
      positionAfter: { x: 5, y: 5 },
      monstersKilled: ['goblin-1'],
      monsterReactions: [],
      combat: {
        targetId: 'goblin-1',
        targetName: 'Goblin',
        roll: 15,
        hit: true,
        damage: 8,
        targetHpBefore: 8,
        targetHpAfter: 0,
        killed: true,
      },
    };

    const parsed = ActionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});

describe('StateSnapshotSchema', () => {
  it('should accept valid snapshot', () => {
    const snapshot = {
      visibleMonsters: [
        { id: 'm1', name: 'Goblin', hp: 5, x: 3, y: 4 },
      ],
      visibleItems: [
        { templateId: 'sword', x: 2, y: 2 },
      ],
      inventory: ['potion', 'key'],
      equipped: {
        weapon: 'dagger',
        armor: 'leather',
      },
    };

    const result = StateSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it('should accept snapshot with empty collections', () => {
    const snapshot = {
      visibleMonsters: [],
      visibleItems: [],
      inventory: [],
      equipped: {},
    };

    const result = StateSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });
});

describe('TurnRecordSchema', () => {
  it('should accept valid turn record', () => {
    const turn = {
      turn: 1,
      crawlerId: 'crawler-1',
      floor: 2,
      prompt: 'You are in a dark room...',
      response: {
        action: { action: 'attack', direction: 'east', reasoning: 'Goblin is blocking the way' },
        reasoning: 'Goblin is blocking the way',
        shortThought: 'Attack!',
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

    const result = TurnRecordSchema.safeParse(turn);
    expect(result.success).toBe(true);
  });

  it('should accept turn with state snapshot', () => {
    const turn = {
      turn: 1,
      crawlerId: 'crawler-1',
      floor: 1,
      prompt: 'Test prompt',
      response: {
        action: { action: 'wait', reasoning: 'Test' },
        reasoning: 'Test',
        shortThought: 'Test',
      },
      actionResult: {
        success: true,
        hpBefore: 20,
        hpAfter: 20,
        positionBefore: { x: 0, y: 0 },
        positionAfter: { x: 0, y: 0 },
        monstersKilled: [],
        monsterReactions: [],
      },
      stateSnapshot: {
        visibleMonsters: [],
        visibleItems: [],
        inventory: [],
        equipped: {},
      },
    };

    const result = TurnRecordSchema.safeParse(turn);
    expect(result.success).toBe(true);
  });
});

describe('CrawlerSummarySchema', () => {
  it('should accept valid summary', () => {
    const summary = {
      id: 'c1',
      name: 'Heroic Adventurer',
      characterClass: 'warrior',
      bio: 'A brave soul seeking fortune',
      finalHp: 15,
      maxHp: 20,
      monstersKilled: 5,
      damageDealt: 42,
      damageTaken: 12,
    };

    const result = CrawlerSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
  });

  it('should accept summary without optional bio', () => {
    const summary = {
      id: 'c1',
      name: 'Heroic Adventurer',
      characterClass: 'warrior',
      finalHp: 15,
      maxHp: 20,
      monstersKilled: 5,
      damageDealt: 42,
      damageTaken: 12,
    };

    const result = CrawlerSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
  });
});

describe('GameTraceSchema', () => {
  it('should accept valid complete trace', () => {
    const trace = {
      id: 'game-123-abc',
      version: 1 as const,
      seed: 12345,
      zoneConfig: { seed: 12345 },
      startedAt: '2025-01-19T00:00:00Z',
      endedAt: '2025-01-19T00:05:00Z',
      durationMs: 300000,
      outcome: 'win' as const,
      finalFloor: 5,
      totalTurns: 100,
      crawlers: [{
        id: 'c1',
        name: 'Hero',
        characterClass: 'mage',
        finalHp: 10,
        maxHp: 15,
        monstersKilled: 20,
        damageDealt: 150,
        damageTaken: 50,
      }],
      turns: [{
        turn: 1,
        crawlerId: 'c1',
        floor: 1,
        prompt: 'Test',
        response: {
          action: { action: 'wait', reasoning: 'Test' },
          reasoning: 'Test',
          shortThought: 'Test',
        },
        actionResult: {
          success: true,
          hpBefore: 15,
          hpAfter: 15,
          positionBefore: { x: 0, y: 0 },
          positionAfter: { x: 0, y: 0 },
          monstersKilled: [],
          monsterReactions: [],
        },
      }],
    };

    const result = GameTraceSchema.safeParse(trace);
    expect(result.success).toBe(true);
  });

  it('should reject invalid outcome', () => {
    const trace = {
      id: 'game-123-abc',
      version: 1 as const,
      seed: 12345,
      zoneConfig: {},
      startedAt: '2025-01-19T00:00:00Z',
      endedAt: '2025-01-19T00:05:00Z',
      durationMs: 300000,
      outcome: 'invalid', // invalid!
      finalFloor: 5,
      totalTurns: 100,
      crawlers: [],
      turns: [],
    };

    const result = GameTraceSchema.safeParse(trace);
    expect(result.success).toBe(false);
  });
});
