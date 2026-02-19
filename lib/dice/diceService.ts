// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./dice-box.d.ts" />
import type DiceBox from '@3d-dice/dice-box';
import type { DiceResult, DiceStateCallback } from './types';
import { diceBoxConfig, tronDiceTheme } from './diceTheme';

type DiceBoxInstance = InstanceType<typeof DiceBox>;

/** Delay after roll completes to let the result visually sink in */
const RESULT_DISPLAY_DELAY_MS = 500;

let diceBox: DiceBoxInstance | null = null;
let diceBoxPromise: Promise<DiceBoxInstance> | null = null;
let isRolling = false;
const subscribers: Set<DiceStateCallback> = new Set();

/**
 * Notify all subscribers of rolling state change.
 */
function notifySubscribers(rolling: boolean): void {
  isRolling = rolling;
  subscribers.forEach((cb) => cb(rolling));
}

/**
 * Lazily initialize dice-box.
 * Only loads the library when first roll is requested.
 */
async function ensureDiceBox(): Promise<DiceBoxInstance> {
  if (typeof document === 'undefined') {
    throw new Error('diceService requires a browser environment');
  }

  if (diceBox) return diceBox;
  if (diceBoxPromise) return diceBoxPromise;

  diceBoxPromise = (async () => {
    // Dynamic import for lazy loading
    const DiceBox = (await import('@3d-dice/dice-box')).default;

    // Inject styles for dice canvas - creates effective "padding" by scaling down
    if (!document.getElementById('dice-canvas-styles')) {
      const style = document.createElement('style');
      style.id = 'dice-canvas-styles';
      style.textContent = `
        .dice-box-canvas {
          transform: scale(0.8);
          transform-origin: center center;
        }
      `;
      document.head.appendChild(style);
    }

    // Create container for dice canvas - centered overlay with extra room for physics
    let container = document.getElementById('dice-overlay-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'dice-overlay-container';
      container.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-100%, -25%);
        width: 700px;
        height: 700px;
        z-index: 9999;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }

    const box = new DiceBox('#dice-overlay-container', {
      ...diceBoxConfig,
      assetPath: '/dice-box-assets/',
    });

    await box.init();
    box.updateConfig(tronDiceTheme);

    diceBox = box;
    return box;
  })();

  return diceBoxPromise;
}

/**
 * Parse dice notation to extract die count and sides.
 * e.g., "2d20" -> { count: 2, sides: 20 }
 */
function parseNotation(notation: string): { count: number; sides: number } {
  const match = notation.match(/^(\d+)d(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid dice notation: ${notation}`);
  }
  return { count: parseInt(match[1], 10), sides: parseInt(match[2], 10) };
}

/**
 * Roll dice and return the actual random results.
 */
async function roll(notation: string): Promise<DiceResult> {
  const box = await ensureDiceBox();
  const { sides } = parseNotation(notation);

  notifySubscribers(true);

  try {
    box.clear();

    // Roll and get results from physics simulation
    const results = await box.roll(notation);
    const rolls = results.map((r) => r.value);
    const total = rolls.reduce((sum, val) => sum + val, 0);

    // Check for crits/fumbles (only meaningful for d20)
    const isCritical = sides === 20 && rolls.some((r) => r === 20);
    const isFumble = sides === 20 && rolls.some((r) => r === 1);

    // Pause to let result sink in
    await new Promise((resolve) => setTimeout(resolve, RESULT_DISPLAY_DELAY_MS));

    return {
      notation,
      rolls,
      total,
      isCritical,
      isFumble,
    };
  } finally {
    notifySubscribers(false);
  }
}

/**
 * Check if dice are currently rolling.
 */
function getIsRolling(): boolean {
  return isRolling;
}

/**
 * Subscribe to rolling state changes.
 * Returns unsubscribe function.
 */
function subscribe(callback: DiceStateCallback): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export const diceService = {
  roll,
  isRolling: getIsRolling,
  subscribe,
};
