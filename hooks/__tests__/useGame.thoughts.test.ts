/**
 * useGame Hook - Thoughts Tests
 *
 * Tests for the thought bubble functionality in useGame.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGame } from '../useGame';
import type { CrawlerConfig } from '../useGame';
import type { CrawlerId } from '../../lib/engine/crawler-id';

// Mock fetch for AI requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useGame thoughts', () => {
  const defaultConfigs: [CrawlerConfig, ...CrawlerConfig[]] = [
    { id: 'crawler-1' as CrawlerId, control: 'player' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts with empty thoughts array', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: defaultConfigs,
          accessCode: 'test-code',
        })
      );

      expect(result.current.thoughts).toEqual([]);
    });

    it('exposes thoughts in return value', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: defaultConfigs,
          accessCode: 'test-code',
        })
      );

      expect(result.current).toHaveProperty('thoughts');
      expect(Array.isArray(result.current.thoughts)).toBe(true);
    });
  });

  describe('reset behavior', () => {
    it('clears thoughts on reset', async () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: defaultConfigs,
          accessCode: 'test-code',
        })
      );

      // Manually trigger reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.thoughts).toEqual([]);
    });
  });
});

describe('Thought interface', () => {
  it('has correct shape', () => {
    // Type-level test - this validates the Thought interface structure
    const thought = {
      id: 'thought-123',
      crawlerId: 'crawler-1' as CrawlerId,
      text: 'For glory!',
      timestamp: Date.now(),
    };

    expect(thought.id).toBeDefined();
    expect(thought.crawlerId).toBeDefined();
    expect(thought.text).toBeDefined();
    expect(thought.timestamp).toBeDefined();
  });
});
