/**
 * AIAgent Tests
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIAgent } from '../agents/ai-agent';
import type { GameState } from '../../engine/state';

// Mock the AI provider
vi.mock('../../ai/providers', () => ({
  getAIModel: vi.fn(() => ({ id: 'mock-model' })),
  getProviderConfig: vi.fn(() => ({ model: 'mock-model' })),
}));

// Mock generateObject from ai package
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

// Minimal mock state for testing
const mockState: Partial<GameState> = {
  currentAreaId: 'test-area',
  entities: {
    'crawler-1': {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      x: 5,
      y: 5,
      hp: 20,
      maxHp: 20,
      attack: 3,
      defense: 2,
      speed: 10,
      areaId: 'test-area',
    } as any,
  },
};

describe('AIAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert AI response to valid AgentResponse', async () => {
    const { generateObject } = await import('ai');
    const mockGenerateObject = vi.mocked(generateObject);

    // AI returns flat structure
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        action: 'move',
        direction: 'north',
        reasoning: 'Moving toward the exit',
        shortThought: 'Go north',
      },
      usage: { outputTokens: 50 },
    } as any);

    const agent = new AIAgent();
    const response = await agent.getAction(
      'crawler-1' as any,
      'Test prompt',
      mockState as GameState
    );

    expect(response.action).toEqual({
      action: 'move',
      direction: 'north',
      reasoning: 'Moving toward the exit',
    });
    expect(response.reasoning).toBe('Moving toward the exit');
    expect(response.shortThought).toBe('Go north');
  });

  it('should handle wait action without direction', async () => {
    const { generateObject } = await import('ai');
    const mockGenerateObject = vi.mocked(generateObject);

    mockGenerateObject.mockResolvedValueOnce({
      object: {
        action: 'wait',
        reasoning: 'No enemies nearby',
        shortThought: 'Wait',
      },
      usage: { outputTokens: 30 },
    } as any);

    const agent = new AIAgent();
    const response = await agent.getAction(
      'crawler-1' as any,
      'Test prompt',
      mockState as GameState
    );

    expect(response.action).toEqual({
      action: 'wait',
      reasoning: 'No enemies nearby',
    });
  });
});
