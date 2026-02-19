/**
 * useGame Hook - Control Switch Tests
 *
 * Tests for preserving game state when switching between player and AI control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGame } from '../useGame';
import type { CrawlerConfig, CrawlerControl } from '../useGame';
import type { CrawlerId } from '../../lib/engine/crawler-id';
import { crawlerIdFromIndex } from '../../lib/engine/crawler-id';

// Mock fetch for AI requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useGame control switching', () => {
  const playerConfig: [CrawlerConfig, ...CrawlerConfig[]] = [
    { id: 'crawler-1' as CrawlerId, control: 'player' },
  ];

  const aiConfig: [CrawlerConfig, ...CrawlerConfig[]] = [
    { id: 'crawler-1' as CrawlerId, control: 'ai' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        action: { action: 'wait', reasoning: 'Test' },
        reasoning: 'Test reasoning',
        shortThought: 'Thinking...',
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('game state preservation', () => {
    it('preserves state object identity when control config changes', () => {
      const { result, rerender } = renderHook(
        ({ configs }: { configs: [CrawlerConfig, ...CrawlerConfig[]] }) =>
          useGame({ crawlerConfigs: configs, accessCode: 'test' }),
        { initialProps: { configs: playerConfig } }
      );

      const stateBefore = result.current.state;
      expect(stateBefore.turn).toBeGreaterThanOrEqual(0);
      expect(Object.keys(stateBefore.entities).length).toBeGreaterThan(0);

      // Switch to AI control
      rerender({ configs: aiConfig });

      // State should be preserved (same reference since no simulation ran)
      const stateAfter = result.current.state;
      expect(stateAfter.turn).toBe(stateBefore.turn);
      expect(stateAfter.entities).toEqual(stateBefore.entities);
      expect(stateAfter.zone).toBe(stateBefore.zone);
    });

    it('preserves entity HP, position, and inventory across control switch', () => {
      const { result, rerender } = renderHook(
        ({ configs }: { configs: [CrawlerConfig, ...CrawlerConfig[]] }) =>
          useGame({ crawlerConfigs: configs, accessCode: 'test' }),
        { initialProps: { configs: playerConfig } }
      );

      const crawler = result.current.state.entities['crawler-1'];
      expect(crawler).toBeDefined();
      const { hp, x, y, inventory } = crawler;

      // Switch to AI
      rerender({ configs: aiConfig });

      const crawlerAfter = result.current.state.entities['crawler-1'];
      expect(crawlerAfter.hp).toBe(hp);
      expect(crawlerAfter.x).toBe(x);
      expect(crawlerAfter.y).toBe(y);
      expect(crawlerAfter.inventory).toEqual(inventory);
    });

    it('preserves explored tiles across control switch', () => {
      const { result, rerender } = renderHook(
        ({ configs }: { configs: [CrawlerConfig, ...CrawlerConfig[]] }) =>
          useGame({ crawlerConfigs: configs, accessCode: 'test' }),
        { initialProps: { configs: playerConfig } }
      );

      const exploredBefore = result.current.state.exploredTiles;

      rerender({ configs: aiConfig });

      expect(result.current.state.exploredTiles).toBe(exploredBefore);
    });

    it('preserves turn count across control switch', () => {
      const { result, rerender } = renderHook(
        ({ configs }: { configs: [CrawlerConfig, ...CrawlerConfig[]] }) =>
          useGame({ crawlerConfigs: configs, accessCode: 'test' }),
        { initialProps: { configs: playerConfig } }
      );

      const turnBefore = result.current.state.turn;

      rerender({ configs: aiConfig });

      expect(result.current.state.turn).toBe(turnBefore);
    });
  });

  describe('aiTransitioningIds', () => {
    it('starts empty', () => {
      const { result } = renderHook(() =>
        useGame({ crawlerConfigs: playerConfig, accessCode: 'test' })
      );

      expect(result.current.aiTransitioningIds.size).toBe(0);
    });

    it('is cleared on reset', async () => {
      const { result } = renderHook(() =>
        useGame({ crawlerConfigs: playerConfig, accessCode: 'test' })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.aiTransitioningIds.size).toBe(0);
    });
  });
});

describe('control map behavior', () => {
  it('correctly maps crawler IDs to control types', () => {
    const configs: CrawlerConfig[] = [
      { id: crawlerIdFromIndex(1), control: 'player' },
      { id: crawlerIdFromIndex(2), control: 'ai' },
    ];

    const controlMap = new Map<string, CrawlerControl>();
    for (const config of configs) {
      controlMap.set(config.id, config.control);
    }

    expect(controlMap.get(crawlerIdFromIndex(1))).toBe('player');
    expect(controlMap.get(crawlerIdFromIndex(2))).toBe('ai');

    // Simulate a control switch
    controlMap.set(crawlerIdFromIndex(1), 'ai');
    expect(controlMap.get(crawlerIdFromIndex(1))).toBe('ai');
  });
});

describe('GameInner key generation', () => {
  it('key does not include control type', () => {
    const configs: CrawlerConfig[] = [
      { id: crawlerIdFromIndex(1), control: 'player' },
    ];

    const key = configs.map((c) => c.id).join(',');

    const configsAfterSwitch: CrawlerConfig[] = [
      { id: crawlerIdFromIndex(1), control: 'ai' },
    ];
    const keyAfterSwitch = configsAfterSwitch.map((c) => c.id).join(',');

    expect(key).toBe(keyAfterSwitch);
  });

  it('key changes when crawler count changes (should remount)', () => {
    const oneConfig: CrawlerConfig[] = [
      { id: crawlerIdFromIndex(1), control: 'player' },
    ];
    const twoConfigs: CrawlerConfig[] = [
      { id: crawlerIdFromIndex(1), control: 'player' },
      { id: crawlerIdFromIndex(2), control: 'ai' },
    ];

    const keyOne = oneConfig.map((c) => c.id).join(',');
    const keyTwo = twoConfigs.map((c) => c.id).join(',');

    expect(keyOne).not.toBe(keyTwo);
  });
});
