'use client';

import { useState, useEffect } from 'react';
import { useDiceRoll } from '../../hooks/useDiceRoll';
import {
  injectDiceButtonStyles,
  DICE_BUTTON_STYLES,
  DICE_BUTTON_ANIMATION,
  DICE_BUTTON_ANIMATION_DURATION,
} from './diceStyles';
import type { DiceResult } from '../../lib/dice';

interface DiceRollButtonProps {
  /** Dice notation, e.g., "1d20" */
  notation: string;
  /** Called when roll completes with result */
  onRollComplete: (result: DiceResult) => void;
  /** Button label, defaults to "Roll" */
  label?: string;
  /** Additional CSS class */
  className?: string;
}

/**
 * Button that triggers a dice roll animation.
 * Pulses to draw attention, disabled while rolling.
 */
export function DiceRollButton({
  notation,
  onRollComplete,
  label = 'Roll',
  className = '',
}: DiceRollButtonProps) {
  const { roll, isRolling } = useDiceRoll();
  const [hasRolled, setHasRolled] = useState(false);

  useEffect(() => {
    injectDiceButtonStyles();
  }, []);

  const handleClick = async () => {
    if (isRolling || hasRolled) return;

    try {
      const result = await roll(notation);
      setHasRolled(true);
      onRollComplete(result);
    } catch (error) {
      console.error('Dice roll failed:', error);
      // Don't set hasRolled so user can retry
    }
  };

  if (hasRolled) return null;

  return (
    <button
      onClick={handleClick}
      disabled={isRolling}
      className={`dice-roll-button ${isRolling ? 'rolling' : ''} ${className}`}
      style={{
        ...DICE_BUTTON_STYLES,
        cursor: isRolling ? 'wait' : 'pointer',
        animation: isRolling
          ? 'none'
          : `${DICE_BUTTON_ANIMATION} ${DICE_BUTTON_ANIMATION_DURATION} ease-in-out infinite`,
      }}
    >
      {isRolling ? 'Rolling...' : label}
    </button>
  );
}
