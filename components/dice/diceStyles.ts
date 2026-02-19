/** Tron cyan color for dice UI */
export const DICE_CYAN = '#00ffff';

/** Button style constants */
export const DICE_BUTTON_STYLES = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 'bold' as const,
  color: DICE_CYAN,
  background: `rgba(0, 255, 255, 0.1)`,
  border: `2px solid ${DICE_CYAN}`,
  borderRadius: '8px',
  transition: 'all 0.2s ease',
} as const;

/** Animation name (must match keyframe name) */
export const DICE_BUTTON_ANIMATION = 'diceButtonPulse';
export const DICE_BUTTON_ANIMATION_DURATION = '2s';

/**
 * Inject dice button styles into document.
 */
export function injectDiceButtonStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dice-button-styles')) return;

  const style = document.createElement('style');
  style.id = 'dice-button-styles';
  style.textContent = `
    @keyframes diceButtonPulse {
      0%, 100% {
        box-shadow: 0 0 5px #00ffff, 0 0 10px #00ffff;
      }
      50% {
        box-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 30px #00ffff;
      }
    }

    .dice-roll-button:hover:not(:disabled) {
      background: rgba(0, 255, 255, 0.2);
      transform: scale(1.05);
    }

    .dice-roll-button:active:not(:disabled) {
      transform: scale(0.98);
    }

    .dice-roll-button.rolling {
      opacity: 0.7;
    }
  `;
  document.head.appendChild(style);
}
