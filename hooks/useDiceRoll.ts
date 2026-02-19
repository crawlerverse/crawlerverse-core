'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  diceService,
  fireCriticalConfetti,
  shakeScreen,
  injectShakeStyles,
  initSounds,
  playDiceRoll,
  playCritical,
  playFumble,
} from '../lib/dice';
import type { DiceResult } from '../lib/dice';

/**
 * React hook for dice rolling with automatic effect handling.
 *
 * @example
 * const { roll, isRolling } = useDiceRoll();
 * const result = await roll('1d20');
 * // result.rolls[0] is the actual random d20 value
 */
export function useDiceRoll() {
  const [isRolling, setIsRolling] = useState(false);

  useEffect(() => {
    // Inject shake styles on mount
    injectShakeStyles();

    // Subscribe to rolling state
    const unsubscribe = diceService.subscribe(setIsRolling);
    return unsubscribe;
  }, []);

  const roll = useCallback(async (notation: string): Promise<DiceResult> => {
    // Initialize sounds (no-op if already loaded)
    await initSounds();

    // Play dice roll sound at start
    playDiceRoll();

    const result = await diceService.roll(notation);

    // Play effects based on result
    if (result.isCritical) {
      fireCriticalConfetti();
      playCritical();
    } else if (result.isFumble) {
      shakeScreen();
      playFumble();
    }

    return result;
  }, []);

  return { roll, isRolling };
}
