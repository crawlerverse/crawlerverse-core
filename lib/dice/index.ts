export { diceService } from './diceService';
export { fireCriticalConfetti, shakeScreen, injectShakeStyles } from './diceEffects';
export { tronDiceTheme, diceBoxConfig } from './diceTheme';
export {
  initSounds,
  playDiceRoll,
  playCritical,
  playFumble,
  isMuted,
  setMuted,
} from './soundService';
export type { DiceResult, DiceStateCallback } from './types';
