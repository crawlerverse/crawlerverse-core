import confetti from 'canvas-confetti';

/**
 * Fire celebratory confetti for critical hits.
 * Gold and cyan colors matching Tron theme.
 */
export function fireCriticalConfetti(): void {
  // Left burst
  confetti({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0, y: 0.6 },
    colors: ['#ffd700', '#00ffff', '#ffffff'],
  });
  // Right burst
  confetti({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 1, y: 0.6 },
    colors: ['#ffd700', '#00ffff', '#ffffff'],
  });
}

/**
 * Shake the screen briefly for fumbles.
 */
export function shakeScreen(): void {
  const root = document.documentElement;
  root.style.animation = 'none';
  // Trigger reflow
  void root.offsetHeight;
  root.style.animation = 'fumbleShake 0.5s ease-out';
}

/**
 * CSS keyframes for fumble shake.
 * Inject into document head if not present.
 */
export function injectShakeStyles(): void {
  if (document.getElementById('dice-shake-styles')) return;

  const style = document.createElement('style');
  style.id = 'dice-shake-styles';
  style.textContent = `
    @keyframes fumbleShake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
      20%, 40%, 60%, 80% { transform: translateX(4px); }
    }
  `;
  document.head.appendChild(style);
}
