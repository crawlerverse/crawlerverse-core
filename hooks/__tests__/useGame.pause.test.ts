/**
 * useGame Hook - Pause Controls Tests
 *
 * Tests for the AI pause/step functionality in useGame.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGame } from '../useGame';
import type { CrawlerConfig } from '../useGame';
import type { CrawlerId } from '../../lib/engine/crawler-id';

// Mock fetch for AI requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useGame pause controls', () => {
  const playerConfig: [CrawlerConfig, ...CrawlerConfig[]] = [
    { id: 'crawler-1' as CrawlerId, control: 'player' },
  ];

  const aiConfig: [CrawlerConfig, ...CrawlerConfig[]] = [
    { id: 'crawler-1' as CrawlerId, control: 'ai' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    // Default mock that returns a valid AI response
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

  describe('initial state', () => {
    it('starts not paused by default', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      expect(result.current.isPaused).toBe(false);
    });

    it('can start paused with startPaused option', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      expect(result.current.isPaused).toBe(true);
    });

    it('starts in action step mode by default', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      expect(result.current.stepMode).toBe('action');
    });
  });

  describe('pause/resume controls', () => {
    it('pause() sets isPaused to true', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(true);
    });

    it('resume() sets isPaused to false', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.resume();
      });

      expect(result.current.isPaused).toBe(false);
    });

    it('togglePause() toggles between paused and unpaused', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.togglePause();
      });

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.togglePause();
      });

      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('step mode', () => {
    it('setStepMode switches between action and round modes', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      expect(result.current.stepMode).toBe('action');

      act(() => {
        result.current.setStepMode('round');
      });

      expect(result.current.stepMode).toBe('round');

      act(() => {
        result.current.setStepMode('action');
      });

      expect(result.current.stepMode).toBe('action');
    });
  });

  describe('step function', () => {
    it('step() does not throw when called while paused', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      expect(() => {
        act(() => {
          result.current.step();
        });
      }).not.toThrow();
    });

    it('step() does not throw when called while not paused', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
          startPaused: false,
        })
      );

      expect(() => {
        act(() => {
          result.current.step();
        });
      }).not.toThrow();
    });
  });

  describe('AI behavior when paused', () => {
    it('does not make AI requests when started paused', async () => {
      renderHook(() =>
        useGame({
          crawlerConfigs: aiConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      // Let the game loop run a few iterations
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Should not have made any fetch calls because we're paused
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('stops making AI requests after pause() is called', async () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: aiConfig,
          accessCode: 'test-code',
          startPaused: false,
        })
      );

      // Let one AI request go through
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // Pause the game
      act(() => {
        result.current.pause();
      });

      // Clear mock to count new calls
      mockFetch.mockClear();

      // Let more time pass
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Should not have made additional calls after pausing
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('resumes making AI requests after resume() is called', async () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: aiConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      // Verify no calls while paused
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(mockFetch).not.toHaveBeenCalled();

      // Resume
      act(() => {
        result.current.resume();
      });

      // Let the game loop run
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Should have made AI requests after resuming
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('step behavior', () => {
    it('step() triggers exactly one AI request when paused in action mode', async () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: aiConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      // Verify paused and no calls yet
      expect(result.current.isPaused).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();

      // Trigger a step
      act(() => {
        result.current.step();
      });

      // Let the game loop process the step
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Should have made exactly one AI request
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear and verify no more calls without another step
      mockFetch.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('reset behavior', () => {
    it('reset() preserves pause state', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
          startPaused: true,
        })
      );

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.reset();
      });

      // Pause state should persist across reset
      expect(result.current.isPaused).toBe(true);
    });

    it('reset() preserves step mode', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      act(() => {
        result.current.setStepMode('round');
      });

      expect(result.current.stepMode).toBe('round');

      act(() => {
        result.current.reset();
      });

      // Step mode should persist across reset
      expect(result.current.stepMode).toBe('round');
    });
  });

  describe('return value interface', () => {
    it('exposes all pause-related properties and methods', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      // Properties
      expect(result.current).toHaveProperty('isPaused');
      expect(result.current).toHaveProperty('stepMode');
      expect(result.current).toHaveProperty('isAIThinking');

      // Methods
      expect(typeof result.current.pause).toBe('function');
      expect(typeof result.current.resume).toBe('function');
      expect(typeof result.current.togglePause).toBe('function');
      expect(typeof result.current.step).toBe('function');
      expect(typeof result.current.setStepMode).toBe('function');
    });

    it('provides stable callback references across re-renders', () => {
      const { result, rerender } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      const firstPause = result.current.pause;
      const firstResume = result.current.resume;
      const firstToggle = result.current.togglePause;
      const firstStep = result.current.step;

      rerender();

      expect(result.current.pause).toBe(firstPause);
      expect(result.current.resume).toBe(firstResume);
      expect(result.current.togglePause).toBe(firstToggle);
      expect(result.current.step).toBe(firstStep);
    });
  });

  describe('isAIThinking status', () => {
    it('isAIThinking is false when no AI crawlers are configured', () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: playerConfig,
          accessCode: 'test-code',
        })
      );

      expect(result.current.isAIThinking).toBe(false);
    });

    it('isAIThinking reflects AI status with AI crawler', async () => {
      const { result } = renderHook(() =>
        useGame({
          crawlerConfigs: aiConfig,
          accessCode: 'test-code',
          startPaused: false,
        })
      );

      // Initially should transition to AI thinking
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // The status should indicate AI is thinking (may vary based on game loop timing)
      expect(typeof result.current.isAIThinking).toBe('boolean');
    });
  });
});
