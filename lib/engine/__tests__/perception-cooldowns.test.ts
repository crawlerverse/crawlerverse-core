import { describe, it, expect } from 'vitest';
import {
  createCooldowns,
  shouldEmitPerception,
  updateCooldowns,
  tickCooldowns,
  resetCombatCooldowns,
} from '../perception-cooldowns';
import type { Perception } from '../perception-types';
import type { EntityId } from '../scheduler';

describe('perception cooldowns', () => {
  describe('createCooldowns', () => {
    it('should create empty cooldowns', () => {
      const cooldowns = createCooldowns();
      expect(cooldowns.enemyHealth.size).toBe(0);
      expect(cooldowns.selfHealth).toBeNull();
      expect(cooldowns.itemQuality.size).toBe(0);
    });
  });

  describe('shouldEmitPerception', () => {
    it('should emit first perception for entity', () => {
      const cooldowns = createCooldowns();
      const perception: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'wounded',
      };
      expect(shouldEmitPerception(perception, cooldowns)).toBe(true);
    });

    it('should not emit same perception within cooldown', () => {
      let cooldowns = createCooldowns();
      const perception: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'wounded',
      };

      cooldowns = updateCooldowns(perception, cooldowns);
      expect(shouldEmitPerception(perception, cooldowns)).toBe(false);
    });

    it('should emit when band changes', () => {
      let cooldowns = createCooldowns();
      const perception1: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'wounded',
      };
      const perception2: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'badly_hurt',
      };

      cooldowns = updateCooldowns(perception1, cooldowns);
      expect(shouldEmitPerception(perception2, cooldowns)).toBe(true);
    });

    it('should emit after cooldown expires', () => {
      let cooldowns = createCooldowns();
      const perception: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'wounded',
      };

      cooldowns = updateCooldowns(perception, cooldowns);

      // Tick 3 times (enemy health cooldown is 3)
      cooldowns = tickCooldowns(cooldowns);
      cooldowns = tickCooldowns(cooldowns);
      cooldowns = tickCooldowns(cooldowns);

      expect(shouldEmitPerception(perception, cooldowns)).toBe(true);
    });

    it('should not emit item perception twice (permanent cooldown)', () => {
      let cooldowns = createCooldowns();
      const perception: Perception = {
        type: 'item_quality',
        itemId: 'sword-1',
        quality: 'masterwork',
      };

      cooldowns = updateCooldowns(perception, cooldowns);
      expect(shouldEmitPerception(perception, cooldowns)).toBe(false);

      // Even after many ticks, still false
      for (let i = 0; i < 100; i++) {
        cooldowns = tickCooldowns(cooldowns);
      }
      expect(shouldEmitPerception(perception, cooldowns)).toBe(false);
    });

    it('should handle self health cooldown', () => {
      let cooldowns = createCooldowns();
      const perception: Perception = {
        type: 'self_health',
        band: 'wounded',
      };

      expect(shouldEmitPerception(perception, cooldowns)).toBe(true);
      cooldowns = updateCooldowns(perception, cooldowns);
      expect(shouldEmitPerception(perception, cooldowns)).toBe(false);

      // After 2 ticks, should emit again
      cooldowns = tickCooldowns(cooldowns);
      cooldowns = tickCooldowns(cooldowns);
      expect(shouldEmitPerception(perception, cooldowns)).toBe(true);
    });
  });

  describe('resetCombatCooldowns', () => {
    it('should clear enemy health cooldowns', () => {
      let cooldowns = createCooldowns();
      const perception: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'wounded',
      };

      cooldowns = updateCooldowns(perception, cooldowns);
      expect(cooldowns.enemyHealth.size).toBe(1);

      cooldowns = resetCombatCooldowns(cooldowns);
      expect(cooldowns.enemyHealth.size).toBe(0);
    });

    it('should preserve item cooldowns when resetting combat', () => {
      let cooldowns = createCooldowns();
      const itemPerception: Perception = {
        type: 'item_quality',
        itemId: 'sword-1',
        quality: 'masterwork',
      };
      const enemyPerception: Perception = {
        type: 'enemy_health',
        entityId: 'rat-1' as EntityId,
        band: 'wounded',
      };

      cooldowns = updateCooldowns(itemPerception, cooldowns);
      cooldowns = updateCooldowns(enemyPerception, cooldowns);

      cooldowns = resetCombatCooldowns(cooldowns);

      // Item cooldown preserved, enemy cooldown cleared
      expect(cooldowns.itemQuality.has('sword-1')).toBe(true);
      expect(cooldowns.enemyHealth.size).toBe(0);
    });
  });
});
