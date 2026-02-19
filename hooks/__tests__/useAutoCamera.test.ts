// packages/crawler-core/hooks/__tests__/useAutoCamera.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoCamera } from '../useAutoCamera';

describe('useAutoCamera', () => {
  const mockCrawlers = [
    { id: 'crawler-1', x: 10, y: 10, hp: 20, maxHp: 20 },
    { id: 'crawler-2', x: 15, y: 12, hp: 15, maxHp: 20 },
  ];

  it('focuses on lead crawler during exploration', () => {
    const { result } = renderHook(() =>
      useAutoCamera({
        crawlers: mockCrawlers,
        monsters: [],
        isInCombat: false,
        speedMultiplier: 1,
      })
    );

    expect(result.current.focus).toEqual({ x: 10, y: 10 });
  });

  it('focuses on combat center when in combat', () => {
    const mockMonsters = [
      { id: 'monster-1', x: 12, y: 10 },
      { id: 'monster-2', x: 14, y: 10 },
    ];

    const { result } = renderHook(() =>
      useAutoCamera({
        crawlers: mockCrawlers,
        monsters: mockMonsters,
        isInCombat: true,
        speedMultiplier: 1,
      })
    );

    // Center of all entities: crawlers at (10,10), (15,12) + monsters at (12,10), (14,10)
    // Average x: (10+15+12+14)/4 = 12.75, y: (10+12+10+10)/4 = 10.5
    expect(result.current.focus.x).toBeCloseTo(12.75, 1);
    expect(result.current.focus.y).toBeCloseTo(10.5, 1);
  });

  describe('lerping behavior', () => {
    let rafCallbacks: Array<(time: number) => void> = [];
    let rafId = 0;

    beforeEach(() => {
      vi.useFakeTimers();
      rafCallbacks = [];
      rafId = 0;

      vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
        rafCallbacks.push(callback);
        return ++rafId;
      });

      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        // Cancel by removing from queue (simplified)
        rafCallbacks = rafCallbacks.filter((_, i) => i !== id - 1);
      });

      vi.stubGlobal('performance', {
        now: () => vi.getMockedSystemTime()?.getTime() ?? 0,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    const advanceAnimationFrames = (ms: number) => {
      vi.advanceTimersByTime(ms);
      // Execute all pending animation frame callbacks wrapped in act
      act(() => {
        const callbacks = [...rafCallbacks];
        rafCallbacks = [];
        const currentTime = vi.getMockedSystemTime()?.getTime() ?? 0;
        callbacks.forEach((cb) => cb(currentTime));
      });
    };

    it('lerps smoothly to new focus position', () => {
      const { result, rerender } = renderHook(
        ({ crawlers }) =>
          useAutoCamera({
            crawlers,
            monsters: [],
            isInCombat: false,
            speedMultiplier: 1,
          }),
        { initialProps: { crawlers: mockCrawlers } }
      );

      // Initial focus should be at crawler-1
      expect(result.current.focus).toEqual({ x: 10, y: 10 });

      // Move crawler 1 to new position
      const movedCrawlers = [
        { id: 'crawler-1', x: 20, y: 20, hp: 20, maxHp: 20 },
        { id: 'crawler-2', x: 15, y: 12, hp: 15, maxHp: 20 },
      ];

      rerender({ crawlers: movedCrawlers });

      // Target should update immediately
      expect(result.current.targetFocus).toEqual({ x: 20, y: 20 });

      // Advance partially through animation (100ms of 300ms = 1/3)
      advanceAnimationFrames(100);

      // Focus should NOT be at target yet (proving lerp is happening)
      expect(result.current.focus.x).not.toEqual(20);
      expect(result.current.focus.y).not.toEqual(20);

      // Focus should be somewhere between start and target
      expect(result.current.focus.x).toBeGreaterThan(10);
      expect(result.current.focus.x).toBeLessThan(20);
      expect(result.current.focus.y).toBeGreaterThan(10);
      expect(result.current.focus.y).toBeLessThan(20);

      // Complete the animation (advance past 300ms total)
      advanceAnimationFrames(250);

      // Focus should now be at target
      expect(result.current.focus.x).toBeCloseTo(20, 1);
      expect(result.current.focus.y).toBeCloseTo(20, 1);
    });

    it('speedMultiplier of 2 completes animation faster', () => {
      const { result, rerender } = renderHook(
        ({ crawlers, speedMultiplier }) =>
          useAutoCamera({
            crawlers,
            monsters: [],
            isInCombat: false,
            speedMultiplier,
          }),
        { initialProps: { crawlers: mockCrawlers, speedMultiplier: 2 } }
      );

      // Initial focus at crawler-1
      expect(result.current.focus).toEqual({ x: 10, y: 10 });

      // Move crawler
      const movedCrawlers = [
        { id: 'crawler-1', x: 20, y: 20, hp: 20, maxHp: 20 },
        { id: 'crawler-2', x: 15, y: 12, hp: 15, maxHp: 20 },
      ];

      rerender({ crawlers: movedCrawlers, speedMultiplier: 2 });

      // With speedMultiplier=2, animation should complete in 150ms (300/2)
      // Advance 150ms - should be complete
      advanceAnimationFrames(150);

      // Focus should be at target after 150ms (half the normal 300ms)
      expect(result.current.focus.x).toBeCloseTo(20, 1);
      expect(result.current.focus.y).toBeCloseTo(20, 1);
    });

    it('speedMultiplier of 0.5 makes animation slower', () => {
      const { result, rerender } = renderHook(
        ({ crawlers, speedMultiplier }) =>
          useAutoCamera({
            crawlers,
            monsters: [],
            isInCombat: false,
            speedMultiplier,
          }),
        { initialProps: { crawlers: mockCrawlers, speedMultiplier: 0.5 } }
      );

      // Move crawler
      const movedCrawlers = [
        { id: 'crawler-1', x: 20, y: 20, hp: 20, maxHp: 20 },
        { id: 'crawler-2', x: 15, y: 12, hp: 15, maxHp: 20 },
      ];

      rerender({ crawlers: movedCrawlers, speedMultiplier: 0.5 });

      // With speedMultiplier=0.5, animation should take 600ms (300/0.5)
      // After 300ms, animation should NOT be complete
      advanceAnimationFrames(300);

      // Focus should still be lerping (not at target yet)
      expect(result.current.focus.x).toBeLessThan(20);
      expect(result.current.focus.y).toBeLessThan(20);

      // After 600ms total, should be complete
      advanceAnimationFrames(350);

      expect(result.current.focus.x).toBeCloseTo(20, 1);
      expect(result.current.focus.y).toBeCloseTo(20, 1);
    });
  });

  it('follows first living crawler when lead dies', () => {
    const deadLeadCrawlers = [
      { id: 'crawler-1', x: 10, y: 10, hp: 0, maxHp: 20 },
      { id: 'crawler-2', x: 15, y: 12, hp: 15, maxHp: 20 },
    ];

    const { result } = renderHook(() =>
      useAutoCamera({
        crawlers: deadLeadCrawlers,
        monsters: [],
        isInCombat: false,
        speedMultiplier: 1,
      })
    );

    expect(result.current.focus).toEqual({ x: 15, y: 12 });
  });
});
