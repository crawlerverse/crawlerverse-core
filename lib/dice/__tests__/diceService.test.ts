/**
 * @fileoverview Tests for the dice service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock instance for assertions
let mockDiceBoxInstance: {
  init: ReturnType<typeof vi.fn>;
  roll: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  updateConfig: ReturnType<typeof vi.fn>;
};

// Create a fresh mock instance factory
function createMockInstance(rollReturn: Array<{ value: number }> = [{ value: 15 }]) {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    roll: vi.fn().mockResolvedValue(rollReturn),
    clear: vi.fn(),
    updateConfig: vi.fn(),
  };
}

// Mock dice-box before importing diceService
vi.mock('@3d-dice/dice-box', () => {
  // Use a class to properly support `new DiceBox()`
  const MockDiceBox = vi.fn().mockImplementation(function (this: unknown) {
    return mockDiceBoxInstance;
  });
  return { default: MockDiceBox };
});

// Get reference to mocked constructor
import DiceBox from '@3d-dice/dice-box';

describe('diceService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Reset the mock instance before each test
    mockDiceBoxInstance = createMockInstance();
    // Reset constructor call tracking
    vi.mocked(DiceBox).mockClear();
    // Clean up any existing container
    document.getElementById('dice-overlay-container')?.remove();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('roll', () => {
    it('returns correct result structure', async () => {
      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result).toMatchObject({
        notation: '1d20',
        rolls: expect.any(Array),
        total: expect.any(Number),
        isCritical: expect.any(Boolean),
        isFumble: expect.any(Boolean),
      });
    });

    it('returns the value from the dice physics simulation', async () => {
      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      // Default mock returns [{ value: 15 }]
      expect(result.rolls).toEqual([15]);
      expect(result.total).toBe(15);
    });

    it('sets isCritical to true when d20 rolls a 20', async () => {
      // Configure mock to return 20
      mockDiceBoxInstance = createMockInstance([{ value: 20 }]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.isCritical).toBe(true);
      expect(result.isFumble).toBe(false);
    });

    it('sets isFumble to true when d20 rolls a 1', async () => {
      mockDiceBoxInstance = createMockInstance([{ value: 1 }]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.isFumble).toBe(true);
      expect(result.isCritical).toBe(false);
    });

    it('does not set isCritical/isFumble for non-d20 dice', async () => {
      // d6 rolling 1 should NOT be a fumble (only d20s have crits/fumbles)
      mockDiceBoxInstance = createMockInstance([{ value: 1 }]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d6');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.isFumble).toBe(false);
      expect(result.isCritical).toBe(false);
    });

    it('does not set isCritical for d6 rolling 6 (max value)', async () => {
      mockDiceBoxInstance = createMockInstance([{ value: 6 }]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d6');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.isCritical).toBe(false);
    });

    it('sums multiple dice correctly', async () => {
      mockDiceBoxInstance = createMockInstance([
        { value: 4 },
        { value: 3 },
        { value: 6 },
        { value: 2 },
      ]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('4d6');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.notation).toBe('4d6');
      expect(result.rolls).toEqual([4, 3, 6, 2]);
      expect(result.total).toBe(15); // 4 + 3 + 6 + 2
    });

    it('throws error for invalid notation', async () => {
      const { diceService } = await import('../diceService');

      await expect(diceService.roll('invalid')).rejects.toThrow(
        'Invalid dice notation: invalid'
      );
    });

    it('throws error for malformed notation', async () => {
      const { diceService } = await import('../diceService');

      await expect(diceService.roll('d20')).rejects.toThrow(
        'Invalid dice notation: d20'
      );
      await expect(diceService.roll('1d')).rejects.toThrow(
        'Invalid dice notation: 1d'
      );
      await expect(diceService.roll('20')).rejects.toThrow(
        'Invalid dice notation: 20'
      );
    });

    it('clears previous dice before rolling', async () => {
      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      expect(mockDiceBoxInstance.clear).toHaveBeenCalled();
    });

    it('initializes dice-box lazily on first roll', async () => {
      const { diceService } = await import('../diceService');

      // DiceBox should not be instantiated until roll is called
      expect(DiceBox).not.toHaveBeenCalled();

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      expect(DiceBox).toHaveBeenCalledTimes(1);
      expect(mockDiceBoxInstance.init).toHaveBeenCalled();
    });

    it('reuses dice-box instance for subsequent rolls', async () => {
      const { diceService } = await import('../diceService');

      // First roll
      const roll1Promise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await roll1Promise;

      // Second roll
      const roll2Promise = diceService.roll('1d6');
      await vi.advanceTimersByTimeAsync(600);
      await roll2Promise;

      // Should only create one instance
      expect(DiceBox).toHaveBeenCalledTimes(1);
    });
  });

  describe('isRolling', () => {
    it('returns false initially', async () => {
      const { diceService } = await import('../diceService');

      expect(diceService.isRolling()).toBe(false);
    });

    it('returns true while dice are rolling', async () => {
      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('1d20');

      // Give time for the roll to start (init + roll call)
      await vi.advanceTimersByTimeAsync(10);

      expect(diceService.isRolling()).toBe(true);

      // Complete the roll
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      expect(diceService.isRolling()).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('notifies subscribers when rolling starts', async () => {
      const { diceService } = await import('../diceService');

      const callback = vi.fn();
      diceService.subscribe(callback);

      const rollPromise = diceService.roll('1d20');

      // Wait for roll to start
      await vi.advanceTimersByTimeAsync(10);

      expect(callback).toHaveBeenCalledWith(true);

      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;
    });

    it('notifies subscribers when rolling completes', async () => {
      const { diceService } = await import('../diceService');

      const callback = vi.fn();
      diceService.subscribe(callback);

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      expect(callback).toHaveBeenCalledWith(false);
    });

    it('returns working unsubscribe function', async () => {
      const { diceService } = await import('../diceService');

      const callback = vi.fn();
      const unsubscribe = diceService.subscribe(callback);

      // Unsubscribe before rolling
      unsubscribe();

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      // Callback should not have been called
      expect(callback).not.toHaveBeenCalled();
    });

    it('supports multiple subscribers', async () => {
      const { diceService } = await import('../diceService');

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      diceService.subscribe(callback1);
      diceService.subscribe(callback2);

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      expect(callback1).toHaveBeenCalledWith(true);
      expect(callback1).toHaveBeenCalledWith(false);
      expect(callback2).toHaveBeenCalledWith(true);
      expect(callback2).toHaveBeenCalledWith(false);
    });

    it('unsubscribing one callback does not affect others', async () => {
      const { diceService } = await import('../diceService');

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsubscribe1 = diceService.subscribe(callback1);
      diceService.subscribe(callback2);

      // Unsubscribe only callback1
      unsubscribe1();

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith(true);
      expect(callback2).toHaveBeenCalledWith(false);
    });
  });

  describe('browser environment', () => {
    it('creates dice overlay container when it does not exist', async () => {
      const { diceService } = await import('../diceService');

      expect(document.getElementById('dice-overlay-container')).toBeNull();

      const rollPromise = diceService.roll('1d20');
      await vi.advanceTimersByTimeAsync(600);
      await rollPromise;

      const container = document.getElementById('dice-overlay-container');
      expect(container).not.toBeNull();
      expect(container?.style.position).toBe('fixed');
      expect(container?.style.zIndex).toBe('9999');
    });
  });

  describe('d20 critical and fumble edge cases', () => {
    it('can have both critical and fumble in same roll (multiple d20s)', async () => {
      mockDiceBoxInstance = createMockInstance([{ value: 20 }, { value: 1 }]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('2d20');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.isCritical).toBe(true);
      expect(result.isFumble).toBe(true);
      expect(result.total).toBe(21);
    });

    it('sets isCritical when any d20 in pool rolls 20', async () => {
      mockDiceBoxInstance = createMockInstance([
        { value: 5 },
        { value: 20 },
        { value: 12 },
      ]);

      const { diceService } = await import('../diceService');

      const rollPromise = diceService.roll('3d20');
      await vi.advanceTimersByTimeAsync(600);
      const result = await rollPromise;

      expect(result.isCritical).toBe(true);
      expect(result.rolls).toContain(20);
    });
  });
});
