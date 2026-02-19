import { describe, it, expect } from 'vitest';
import {
  getHealthBand,
  getSelfHealthBand,
  getEnemyHealthBand,
  getItemQualityBand,
  getItemComparisonBand,
  getPerceptionText,
  generatePerceptions,
  type PerceptionContext,
} from '../perception';
import type { PerceptionTraits, Perception } from '../perception-types';
import type { EntityId } from '../scheduler';
import type { Entity } from '../types';
import { createCooldowns } from '../perception-cooldowns';

describe('perception engine', () => {
  const neutralTraits: PerceptionTraits = { bravery: 0, observant: 0 };
  const braveTraits: PerceptionTraits = { bravery: 2, observant: 0 };
  const cowardTraits: PerceptionTraits = { bravery: -2, observant: 0 };

  describe('getHealthBand', () => {
    it('should return healthy for HP > 75%', () => {
      expect(getHealthBand(80, 100, 0)).toBe('healthy');
      expect(getHealthBand(76, 100, 0)).toBe('healthy');
    });

    it('should return wounded for HP 51-75%', () => {
      expect(getHealthBand(75, 100, 0)).toBe('wounded');
      expect(getHealthBand(51, 100, 0)).toBe('wounded');
    });

    it('should return badly_hurt for HP 26-50%', () => {
      expect(getHealthBand(50, 100, 0)).toBe('badly_hurt');
      expect(getHealthBand(26, 100, 0)).toBe('badly_hurt');
    });

    it('should return nearly_dead for HP 11-25%', () => {
      expect(getHealthBand(25, 100, 0)).toBe('nearly_dead');
      expect(getHealthBand(11, 100, 0)).toBe('nearly_dead');
    });

    it('should return deaths_door for HP 1-10%', () => {
      expect(getHealthBand(10, 100, 0)).toBe('deaths_door');
      expect(getHealthBand(1, 100, 0)).toBe('deaths_door');
    });

    it('should shift thresholds based on bravery', () => {
      // Brave (+2): 5% per point = 10% shift down
      // So "wounded" starts at 65% instead of 75%
      expect(getHealthBand(70, 100, 2)).toBe('healthy'); // Would be wounded with 0 bravery

      // Coward (-2): 10% shift up
      // So "wounded" starts at 85%
      expect(getHealthBand(80, 100, -2)).toBe('wounded'); // Would be healthy with 0 bravery
    });
  });

  describe('getSelfHealthBand', () => {
    it('should use bravery from traits for self assessment', () => {
      expect(getSelfHealthBand(70, 100, braveTraits)).toBe('healthy');
      expect(getSelfHealthBand(70, 100, cowardTraits)).toBe('wounded');
    });
  });

  describe('getEnemyHealthBand', () => {
    it('should not use bravery for enemy assessment', () => {
      // Enemy health perception doesn't shift with bravery
      expect(getEnemyHealthBand(70, 100, braveTraits)).toBe('wounded');
      expect(getEnemyHealthBand(70, 100, cowardTraits)).toBe('wounded');
    });
  });

  describe('equipment perception', () => {
    const highObservant: PerceptionTraits = { bravery: 0, observant: 2 };
    const lowObservant: PerceptionTraits = { bravery: 0, observant: -2 };

    describe('getItemQualityBand', () => {
      // Baseline attack for weapons is ~3-5, so +3 is significant
      it('should return masterwork for stat +3 or more above baseline', () => {
        expect(getItemQualityBand(6, 3, neutralTraits)).toBe('masterwork');
      });

      it('should return good for stat +1 to +2 above baseline', () => {
        expect(getItemQualityBand(5, 3, neutralTraits)).toBe('good');
        expect(getItemQualityBand(4, 3, neutralTraits)).toBe('good');
      });

      it('should return average for stat at baseline', () => {
        expect(getItemQualityBand(3, 3, neutralTraits)).toBe('average');
      });

      it('should return crude for stat -1 to -2 below baseline', () => {
        expect(getItemQualityBand(2, 3, neutralTraits)).toBe('crude');
        expect(getItemQualityBand(1, 3, neutralTraits)).toBe('crude');
      });

      it('should return junk for stat -3 or more below baseline', () => {
        expect(getItemQualityBand(0, 3, neutralTraits)).toBe('junk');
      });
    });

    describe('getItemComparisonBand', () => {
      it('should return far_superior for +3 or more', () => {
        expect(getItemComparisonBand(8, 5, neutralTraits)).toBe('far_superior');
      });

      it('should return better for +1 to +2', () => {
        expect(getItemComparisonBand(7, 5, neutralTraits)).toBe('better');
        expect(getItemComparisonBand(6, 5, neutralTraits)).toBe('better');
      });

      it('should return similar for same stat', () => {
        expect(getItemComparisonBand(5, 5, neutralTraits)).toBe('similar');
      });

      it('should return worse for -1 to -2', () => {
        expect(getItemComparisonBand(4, 5, neutralTraits)).toBe('worse');
        expect(getItemComparisonBand(3, 5, neutralTraits)).toBe('worse');
      });

      it('should return much_worse for -3 or more', () => {
        expect(getItemComparisonBand(2, 5, neutralTraits)).toBe('much_worse');
      });
    });

    describe('observant trait effect', () => {
      it('high observant should detect finer differences', () => {
        // With high observant (+2), threshold for "better" drops from 1 to effectively smaller
        // So a +1 difference that would be "similar" for low observant is "better" for high
        // This is handled by the granularity - high observant can distinguish ±1
        expect(getItemComparisonBand(6, 5, highObservant)).toBe('better');
      });

      it('low observant should miss small differences', () => {
        // With low observant (-2), need bigger difference to notice
        // A +1 difference might appear as "similar"
        expect(getItemComparisonBand(6, 5, lowObservant)).toBe('similar');
      });
    });
  });

  describe('perception text', () => {
    describe('getPerceptionText', () => {
      it('should generate warrior-style enemy health text', () => {
        const perception: Perception = {
          type: 'enemy_health',
          entityId: 'rat-1' as EntityId,
          band: 'nearly_dead',
        };
        const text = getPerceptionText(perception, 'warrior');
        expect(text).toBe("One more blow will finish it!");
      });

      it('should generate rogue-style enemy health text', () => {
        const perception: Perception = {
          type: 'enemy_health',
          entityId: 'rat-1' as EntityId,
          band: 'nearly_dead',
        };
        const text = getPerceptionText(perception, 'rogue');
        expect(text).toBe("Easy pickings now...");
      });

      it('should generate self health text', () => {
        const perception: Perception = {
          type: 'self_health',
          band: 'deaths_door',
        };
        const text = getPerceptionText(perception, 'warrior');
        expect(text).toContain("fall"); // Warrior says "I won't fall here!"
      });

      it('should return null for healthy band (not interesting)', () => {
        const perception: Perception = {
          type: 'self_health',
          band: 'healthy',
        };
        const text = getPerceptionText(perception, 'warrior');
        expect(text).toBeNull();
      });

      it('should generate item comparison text', () => {
        const perception: Perception = {
          type: 'item_comparison',
          itemId: 'sword-1',
          comparison: 'far_superior',
        };
        const text = getPerceptionText(perception, 'warrior');
        expect(text).toBeTruthy();
        expect(text!.length).toBeLessThanOrEqual(30); // Keep it short for bubble
      });

      it('should return null for average item quality (not interesting)', () => {
        const perception: Perception = {
          type: 'item_quality',
          itemId: 'sword-1',
          quality: 'average',
        };
        const text = getPerceptionText(perception, 'warrior');
        expect(text).toBeNull();
      });

      it('should return null for similar item comparison (not interesting)', () => {
        const perception: Perception = {
          type: 'item_comparison',
          itemId: 'sword-1',
          comparison: 'similar',
        };
        const text = getPerceptionText(perception, 'warrior');
        expect(text).toBeNull();
      });
    });
  });
});

describe('generatePerceptions', () => {
  const mockCrawler: Entity = {
    id: 'crawler-1',
    type: 'crawler',
    x: 5,
    y: 5,
    areaId: 'test-area',
    hp: 8,
    maxHp: 10,
    name: 'Grimjaw',
    attack: 5,
    defense: 2,
    speed: 100,
    char: '@',
    characterClass: 'warrior',
    bio: 'Aggressive warrior',
    traits: { bravery: 2, observant: -1 },
  } as Entity;

  const mockEnemy: Entity = {
    id: 'rat-1',
    type: 'monster',
    x: 5,
    y: 4,
    areaId: 'test-area',
    hp: 2,
    maxHp: 8,
    name: 'Giant Rat',
    attack: 2,
    defense: 0,
    speed: 100,
    monsterTypeId: 'rat',
  } as Entity;

  it('should generate self health perception when hurt', () => {
    // With bravery +2, thresholds shift down by 10% (5% per point)
    // healthy: > 65%, wounded: > 40%, badly_hurt: > 15%, nearly_dead: > 0%
    // At 60% HP (6/10), the brave crawler perceives themselves as "wounded"
    const hurtCrawler = { ...mockCrawler, hp: 6, maxHp: 10 };
    const context: PerceptionContext = {
      crawler: hurtCrawler,
      visibleEntities: [],
      groundItems: [],
      cooldowns: createCooldowns(),
    };

    const result = generatePerceptions(context);

    expect(result.perceptions.some(p => p.type === 'self_health')).toBe(true);
    const selfHealth = result.perceptions.find(p => p.type === 'self_health');
    expect(selfHealth?.type === 'self_health' && selfHealth.band).toBe('wounded');
  });

  it('should generate enemy health perception for visible enemies', () => {
    const context: PerceptionContext = {
      crawler: mockCrawler,
      visibleEntities: [mockEnemy],
      groundItems: [],
      cooldowns: createCooldowns(),
    };

    const result = generatePerceptions(context);

    expect(result.perceptions.some(p => p.type === 'enemy_health')).toBe(true);
    const enemyHealth = result.perceptions.find(p => p.type === 'enemy_health');
    expect(enemyHealth?.type === 'enemy_health' && enemyHealth.band).toBe('nearly_dead');
  });

  it('should return priority perception for UI', () => {
    const context: PerceptionContext = {
      crawler: { ...mockCrawler, hp: 1 }, // Critical health
      visibleEntities: [mockEnemy],
      groundItems: [],
      cooldowns: createCooldowns(),
    };

    const result = generatePerceptions(context);

    // Self health is highest priority
    expect(result.priority?.type).toBe('self_health');
  });

  it('should respect cooldowns', () => {
    const cooldowns = createCooldowns();
    const context: PerceptionContext = {
      crawler: mockCrawler,
      visibleEntities: [mockEnemy],
      groundItems: [],
      cooldowns,
    };

    const result1 = generatePerceptions(context);
    expect(result1.perceptions.length).toBeGreaterThan(0);

    // Use the returned cooldowns for next call
    const result2 = generatePerceptions({
      ...context,
      cooldowns: result1.cooldowns,
    });

    // Same perceptions should be filtered out by cooldowns
    expect(result2.perceptions.length).toBeLessThan(result1.perceptions.length);
  });

  it('should not generate self_health perception when healthy', () => {
    const healthyCrawler = { ...mockCrawler, hp: 10, maxHp: 10 };
    const context: PerceptionContext = {
      crawler: healthyCrawler,
      visibleEntities: [],
      groundItems: [],
      cooldowns: createCooldowns(),
    };

    const result = generatePerceptions(context);

    expect(result.perceptions.some(p => p.type === 'self_health')).toBe(false);
  });

  it('should not generate enemy_health perception for healthy enemies', () => {
    const healthyEnemy = { ...mockEnemy, hp: 8, maxHp: 8 };
    const context: PerceptionContext = {
      crawler: mockCrawler,
      visibleEntities: [healthyEnemy],
      groundItems: [],
      cooldowns: createCooldowns(),
    };

    const result = generatePerceptions(context);

    expect(result.perceptions.some(p => p.type === 'enemy_health')).toBe(false);
  });
});
