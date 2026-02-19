/**
 * Result of a dice roll animation.
 */
export interface DiceResult {
  /** Original notation, e.g., '1d20' or '4d6' */
  notation: string;
  /** Individual die results */
  rolls: number[];
  /** Sum of all rolls */
  total: number;
  /** True if any d20 rolled a natural 20 */
  isCritical: boolean;
  /** True if any d20 rolled a natural 1 */
  isFumble: boolean;
}

/**
 * Callback for dice service state changes.
 */
export type DiceStateCallback = (isRolling: boolean) => void;
