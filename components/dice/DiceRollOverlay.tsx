'use client';

import { DiceRollButton } from './DiceRollButton';
import type { DiceResult } from '../../lib/dice';

/** Modal backdrop shared classes */
const MODAL_BACKDROP_CLASSES = 'fixed inset-0 bg-black/75 flex items-center justify-center z-50';
const MODAL_FADE_STYLE = { animation: 'fadeIn 200ms ease-out' };

interface DiceRollOverlayProps {
  /** Title displayed above the dice roll button */
  title: string;
  /** Optional subtitle (e.g., target info for ranged attacks) */
  subtitle?: string;
  /** Dice notation, defaults to "1d20" */
  notation?: string;
  /** Button label, defaults to "Roll d20" */
  buttonLabel?: string;
  /** Called when roll completes with result */
  onRollComplete: (result: DiceResult) => void;
  /** Accessible title ID for the dialog */
  titleId: string;
}

/**
 * Reusable dice roll overlay modal for combat actions.
 * Used for both melee and ranged attack dice rolls.
 */
export function DiceRollOverlay({
  title,
  subtitle,
  notation = '1d20',
  buttonLabel = 'Roll d20',
  onRollComplete,
  titleId,
}: DiceRollOverlayProps) {
  return (
    <div
      className={MODAL_BACKDROP_CLASSES}
      style={MODAL_FADE_STYLE}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-8 shadow-2xl text-center"
        style={{ animation: 'scaleIn 200ms ease-out' }}
      >
        <h2
          id={titleId}
          className="text-xl font-semibold text-[var(--text)] mb-2"
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-[var(--text-muted)] mb-6">
            {subtitle}
          </p>
        )}
        {!subtitle && <div className="mb-4" />}
        <DiceRollButton
          notation={notation}
          label={buttonLabel}
          onRollComplete={onRollComplete}
        />
      </div>
    </div>
  );
}
