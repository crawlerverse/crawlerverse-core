/**
 * @fileoverview Tests for the seeded random number generator
 */

import { describe, it, expect } from 'vitest';
import { createRNG, pickRandom } from '../rng';

describe('createRNG', () => {
  describe('determinism', () => {
    it('produces identical sequences for the same seed', () => {
      const rng1 = createRNG(12345);
      const rng2 = createRNG(12345);

      for (let i = 0; i < 100; i++) {
        expect(rng1()).toBe(rng2());
      }
    });

    it('produces different sequences for different seeds', () => {
      const rng1 = createRNG(1);
      const rng2 = createRNG(2);

      const values1 = [rng1(), rng1(), rng1()];
      const values2 = [rng2(), rng2(), rng2()];

      expect(values1).not.toEqual(values2);
    });

    it('produces documented example values', () => {
      const rng = createRNG(12345);
      expect(rng()).toBeCloseTo(0.9797282677609473, 10);
      expect(rng()).toBeCloseTo(0.3067522644996643, 10);
    });
  });

  describe('output range', () => {
    it('produces values in [0, 1) range', () => {
      const rng = createRNG(12345);

      for (let i = 0; i < 1000; i++) {
        const value = rng();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });
  });

  describe('edge case seeds', () => {
    it('handles seed = 0', () => {
      const rng = createRNG(0);
      const value = rng();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('handles negative seeds via unsigned conversion', () => {
      const rng = createRNG(-12345);
      const value = rng();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('handles very large seeds via unsigned 32-bit conversion', () => {
      const rng1 = createRNG(4294967295); // Max 32-bit unsigned
      const rng2 = createRNG(4294967296); // Should wrap to 0

      expect(rng1()).toBeGreaterThanOrEqual(0);
      expect(rng2()).toBeGreaterThanOrEqual(0);
    });

    it('truncates float seeds to integers', () => {
      const rng1 = createRNG(123.999);
      const rng2 = createRNG(123);

      const values1 = [rng1(), rng1(), rng1()];
      const values2 = [rng2(), rng2(), rng2()];

      expect(values1).toEqual(values2);
    });
  });

  describe('validation', () => {
    it('throws for NaN seed', () => {
      expect(() => createRNG(NaN)).toThrow('Invalid RNG seed: expected finite number, got NaN');
    });

    it('throws for Infinity seed', () => {
      expect(() => createRNG(Infinity)).toThrow('Invalid RNG seed: expected finite number, got Infinity');
    });

    it('throws for -Infinity seed', () => {
      expect(() => createRNG(-Infinity)).toThrow('Invalid RNG seed: expected finite number, got -Infinity');
    });
  });
});

describe('pickRandom', () => {
  describe('basic functionality', () => {
    it('picks an element from the array', () => {
      const rng = createRNG(12345);
      const array = [1, 2, 3, 4, 5];
      const result = pickRandom(array, rng);

      expect(array).toContain(result);
    });

    it('handles single-element array', () => {
      const rng = createRNG(12345);
      expect(pickRandom(['only'], rng)).toBe('only');
    });

    it('works with different types', () => {
      const rng = createRNG(42);

      const strings = pickRandom(['a', 'b', 'c'], rng);
      expect(['a', 'b', 'c']).toContain(strings);

      const objects = pickRandom([{ id: 1 }, { id: 2 }], rng);
      expect([1, 2]).toContain(objects.id);
    });
  });

  describe('determinism', () => {
    it('is deterministic with the same seed', () => {
      const arr = ['a', 'b', 'c', 'd', 'e'];

      const rng1 = createRNG(42);
      const rng2 = createRNG(42);

      const results1 = Array.from({ length: 10 }, () => pickRandom(arr, rng1));
      const results2 = Array.from({ length: 10 }, () => pickRandom(arr, rng2));

      expect(results1).toEqual(results2);
    });

    it('produces variety over multiple picks', () => {
      const rng = createRNG(12345);
      const arr = ['a', 'b', 'c', 'd'];
      const results = new Set<string>();

      for (let i = 0; i < 100; i++) {
        results.add(pickRandom(arr, rng));
      }

      expect(results.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validation', () => {
    it('throws for empty array', () => {
      const rng = createRNG(12345);
      expect(() => pickRandom([], rng)).toThrow('pickRandom called with empty array');
    });
  });
});
