/**
 * Seeded Random Number Generator
 *
 * Provides deterministic randomness for reproducible game state.
 * Uses mulberry32 algorithm - simple, fast, good distribution.
 */

export type RNG = () => number;

/**
 * Create a seeded random number generator.
 * Returns values in [0, 1) like Math.random().
 *
 * @param seed - Integer seed value (32-bit recommended for optimal distribution)
 * @returns Function that returns next random number
 * @throws Error if seed is NaN or Infinity
 *
 * @example
 * const rng = createRNG(12345);
 * rng(); // 0.9797282677609473
 * rng(); // 0.3067522644996643
 */
export function createRNG(seed: number): RNG {
  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid RNG seed: expected finite number, got ${seed}`);
  }

  let state = seed >>> 0; // Convert to unsigned 32-bit integer

  return function random(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a random element from an array.
 *
 * @param array - Array to pick from (must be non-empty)
 * @param rng - Random number generator
 * @returns Random element from array
 * @throws Error if array is empty
 */
export function pickRandom<T>(array: readonly T[], rng: RNG): T {
  if (array.length === 0) {
    throw new Error('pickRandom called with empty array');
  }
  const index = Math.floor(rng() * array.length);
  return array[index];
}
