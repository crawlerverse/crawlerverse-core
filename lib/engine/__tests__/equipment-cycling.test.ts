// packages/crawler-core/lib/engine/__tests__/equipment-cycling.test.ts
import { describe, it, expect } from 'vitest';
import { getNextEquipment } from '../equipment-cycling';
import type { ItemInstance } from '../items';

function createItem(templateId: string, id: string): ItemInstance {
  return { id, templateId, x: 0, y: 0, areaId: 'test' };
}

describe('getNextEquipment', () => {
  describe('weapon cycling', () => {
    it('returns first weapon when nothing equipped', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('leather_armor', 'a1'),
        createItem('long_sword', 'w2'),
      ];

      const result = getNextEquipment(inventory, 'weapon', null);

      expect(result?.id).toBe('w1');
    });

    it('returns next weapon in inventory order', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('leather_armor', 'a1'),
        createItem('long_sword', 'w2'),
      ];
      const equipped = createItem('short_sword', 'w0');

      const result = getNextEquipment(inventory, 'weapon', equipped);

      expect(result?.id).toBe('w2');
    });

    it('wraps to first weapon after last', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
      ];
      const equipped = createItem('short_sword', 'eq-w');

      const result = getNextEquipment(inventory, 'weapon', equipped);

      expect(result?.id).toBe('w1');
    });

    it('returns undefined when no weapons in inventory', () => {
      const inventory = [
        createItem('leather_armor', 'a1'),
        createItem('health_potion', 'p1'),
      ];

      const result = getNextEquipment(inventory, 'weapon', null);

      expect(result).toBeUndefined();
    });

    it('returns first weapon when equipped item not in inventory', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('long_sword', 'w2'),
      ];
      const equipped = createItem('bastard_sword', 'eq-w'); // Not in inventory

      const result = getNextEquipment(inventory, 'weapon', equipped);

      expect(result?.id).toBe('w1');
    });
  });

  describe('armor cycling', () => {
    it('returns first armor when nothing equipped', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('leather_armor', 'a1'),
        createItem('chain_mail', 'a2'),
      ];

      const result = getNextEquipment(inventory, 'armor', null);

      expect(result?.id).toBe('a1');
    });

    it('cycles through armor only', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('leather_armor', 'a1'),
        createItem('chain_mail', 'a2'),
      ];
      const equipped = createItem('leather_armor', 'eq-a');

      const result = getNextEquipment(inventory, 'armor', equipped);

      expect(result?.id).toBe('a2');
    });

    it('returns undefined when no armor in inventory', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('health_potion', 'p1'),
      ];

      const result = getNextEquipment(inventory, 'armor', null);

      expect(result).toBeUndefined();
    });

    it('wraps to first armor after last', () => {
      const inventory = [
        createItem('leather_armor', 'a1'),
        createItem('chain_mail', 'a2'),
      ];
      const equipped = createItem('chain_mail', 'eq-a');

      const result = getNextEquipment(inventory, 'armor', equipped);

      expect(result?.id).toBe('a1');
    });
  });

  describe('edge cases', () => {
    it('handles empty inventory', () => {
      const result = getNextEquipment([], 'weapon', null);

      expect(result).toBeUndefined();
    });

    it('handles undefined currently equipped', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
      ];

      const result = getNextEquipment(inventory, 'weapon', undefined);

      expect(result?.id).toBe('w1');
    });

    it('cycles through multiple weapons in order', () => {
      const inventory = [
        createItem('short_sword', 'w1'),
        createItem('long_sword', 'w2'),
        createItem('bastard_sword', 'w3'),
      ];

      // Start with nothing
      const first = getNextEquipment(inventory, 'weapon', null);
      expect(first?.id).toBe('w1');

      // Cycle to second
      const second = getNextEquipment(inventory, 'weapon', createItem('short_sword', 'eq'));
      expect(second?.id).toBe('w2');

      // Cycle to third
      const third = getNextEquipment(inventory, 'weapon', createItem('long_sword', 'eq'));
      expect(third?.id).toBe('w3');

      // Wrap back to first
      const fourth = getNextEquipment(inventory, 'weapon', createItem('bastard_sword', 'eq'));
      expect(fourth?.id).toBe('w1');
    });
  });
});
