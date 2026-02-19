// packages/crawler-core/lib/engine/__tests__/perception-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  HealthBand,
  QualityBand,
  ComparisonBand,
  PerceptionTraits,
  CombatPerception,
  EquipmentPerception,
  Perception,
  PerceptionTraitsSchema,
  HEALTH_BANDS,
  QUALITY_BANDS,
  COMPARISON_BANDS,
} from '../perception-types';

describe('perception-types', () => {
  describe('HealthBand', () => {
    it('should have correct bands in order', () => {
      expect(HEALTH_BANDS).toEqual([
        'healthy',
        'wounded',
        'badly_hurt',
        'nearly_dead',
        'deaths_door',
      ]);
    });
  });

  describe('QualityBand', () => {
    it('should have correct bands in order', () => {
      expect(QUALITY_BANDS).toEqual([
        'masterwork',
        'good',
        'average',
        'crude',
        'junk',
      ]);
    });
  });

  describe('ComparisonBand', () => {
    it('should have correct bands in order', () => {
      expect(COMPARISON_BANDS).toEqual([
        'far_superior',
        'better',
        'similar',
        'worse',
        'much_worse',
      ]);
    });
  });

  describe('PerceptionTraitsSchema', () => {
    it('should validate valid traits', () => {
      const traits: PerceptionTraits = { bravery: 1, observant: -1 };
      expect(PerceptionTraitsSchema.safeParse(traits).success).toBe(true);
    });

    it('should reject out-of-range bravery', () => {
      const traits = { bravery: 5, observant: 0 };
      expect(PerceptionTraitsSchema.safeParse(traits).success).toBe(false);
    });

    it('should reject out-of-range observant', () => {
      const traits = { bravery: 0, observant: -5 };
      expect(PerceptionTraitsSchema.safeParse(traits).success).toBe(false);
    });
  });
});
