/**
 * InventoryPanel Component Tests
 *
 * Tests equipment slot display, inventory list rendering, and capacity indicators.
 * Relies on actual item templates (short_sword, leather_armor, health_potion)
 * from lib/engine/items.ts for realistic test data.
 *
 * Also tests edge cases: unknown templates, undefined inventory, and full capacity styling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InventoryPanel } from '../InventoryPanel';
import type { Entity } from '../../../lib/engine/types';
import type { ItemInstance } from '../../../lib/engine/items';

// Mock the logger to avoid console noise in tests
vi.mock('../../../lib/logging', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/** Creates a test crawler entity with sensible defaults. Override any property via the overrides param. */
function createTestCrawler(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'crawler-1',
    type: 'crawler',
    x: 5,
    y: 5,
    hp: 10,
    maxHp: 10,
    name: 'Test Crawler',
    attack: 5,
    defense: 2,
    speed: 100,
    char: '@',
    areaId: 'area-1',
    ...overrides,
  };
}

/** Creates an item instance for testing */
function createItem(templateId: string, id?: string): ItemInstance {
  return {
    id: id ?? `item-${templateId}`,
    templateId,
    x: 0,
    y: 0,
    areaId: 'area-1',
  };
}

describe('InventoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('equipment slots', () => {
    it('shows empty weapon slot when no weapon equipped', () => {
      const crawler = createTestCrawler({ equippedWeapon: null });
      render(<InventoryPanel crawler={crawler} />);

      const weaponSlot = screen.getByTestId('weapon-slot');
      expect(within(weaponSlot).getByText(/Weapon/)).toBeInTheDocument();
      expect(within(weaponSlot).getByText('—')).toBeInTheDocument();
    });

    it('shows empty armor slot when no armor equipped', () => {
      const crawler = createTestCrawler({ equippedArmor: null });
      render(<InventoryPanel crawler={crawler} />);

      const armorSlot = screen.getByTestId('armor-slot');
      expect(within(armorSlot).getByText(/Armor/)).toBeInTheDocument();
      expect(within(armorSlot).getByText('—')).toBeInTheDocument();
    });

    it('shows weapon name and stats when equipped', () => {
      const crawler = createTestCrawler({
        equippedWeapon: createItem('short_sword'),
      });
      render(<InventoryPanel crawler={crawler} />);

      const weaponSlot = screen.getByTestId('weapon-slot');
      expect(within(weaponSlot).getByText('Short Sword')).toBeInTheDocument();
      expect(within(weaponSlot).getByText('+2 ATTACK')).toBeInTheDocument();
    });

    it('shows armor name and stats when equipped', () => {
      const crawler = createTestCrawler({
        equippedArmor: createItem('leather_armor'),
      });
      render(<InventoryPanel crawler={crawler} />);

      const armorSlot = screen.getByTestId('armor-slot');
      expect(within(armorSlot).getByText('Leather Armor')).toBeInTheDocument();
      expect(within(armorSlot).getByText('+1 DEFENSE')).toBeInTheDocument();
    });
  });

  describe('inventory list', () => {
    it('shows empty message when inventory is empty', () => {
      const crawler = createTestCrawler({ inventory: [] });
      render(<InventoryPanel crawler={crawler} />);

      const inventoryList = screen.getByTestId('inventory-list');
      expect(within(inventoryList).getByText('0/10')).toBeInTheDocument();
      expect(within(inventoryList).getByText('Empty')).toBeInTheDocument();
    });

    it('shows item names in inventory', () => {
      const crawler = createTestCrawler({
        inventory: [
          createItem('health_potion', 'item-1'),
          createItem('short_sword', 'item-2'),
        ],
      });
      render(<InventoryPanel crawler={crawler} />);

      const inventoryList = screen.getByTestId('inventory-list');
      expect(within(inventoryList).getByText('Health Potion')).toBeInTheDocument();
      expect(within(inventoryList).getByText('Short Sword')).toBeInTheDocument();
      expect(within(inventoryList).getByText('2/10')).toBeInTheDocument();
    });

    it('shows full inventory indicator when at capacity', () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        createItem('health_potion', `item-${i}`)
      );
      const crawler = createTestCrawler({ inventory: items });
      render(<InventoryPanel crawler={crawler} />);

      const counter = screen.getByTestId('inventory-counter');
      expect(counter).toHaveTextContent('10/10');
    });

    it('applies danger styling when inventory is full', () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        createItem('health_potion', `item-${i}`)
      );
      const crawler = createTestCrawler({ inventory: items });
      render(<InventoryPanel crawler={crawler} />);

      const counter = screen.getByTestId('inventory-counter');
      expect(counter.className).toContain('text-[var(--danger)]');
    });

    it('applies muted styling when inventory is not full', () => {
      const crawler = createTestCrawler({
        inventory: [createItem('health_potion', 'item-1')],
      });
      render(<InventoryPanel crawler={crawler} />);

      const counter = screen.getByTestId('inventory-counter');
      expect(counter.className).toContain('text-[var(--text-muted)]');
    });
  });

  describe('edge cases', () => {
    it('handles undefined inventory gracefully', () => {
      // Create crawler without inventory field
      const crawler = createTestCrawler();
      // Force undefined by removing the field
      const crawlerWithoutInventory = { ...crawler };
      delete (crawlerWithoutInventory as Record<string, unknown>).inventory;

      render(<InventoryPanel crawler={crawlerWithoutInventory as Entity} />);

      const counter = screen.getByTestId('inventory-counter');
      expect(counter).toHaveTextContent('0/10');
    });

    it('displays unknown templateId when template not found', () => {
      const crawler = createTestCrawler({
        inventory: [createItem('nonexistent_template', 'item-unknown')],
      });
      render(<InventoryPanel crawler={crawler} />);

      expect(screen.getByText('[Unknown: nonexistent_template]')).toBeInTheDocument();
    });

    it('displays unknown templateId for unknown equipped weapon', () => {
      const crawler = createTestCrawler({
        equippedWeapon: createItem('unknown_weapon'),
      });
      render(<InventoryPanel crawler={crawler} />);

      const weaponSlot = screen.getByTestId('weapon-slot');
      expect(within(weaponSlot).getByText('[Unknown: unknown_weapon]')).toBeInTheDocument();
    });

    it('handles consumable item in equipment slot gracefully', () => {
      // This shouldn't happen in normal gameplay, but the component should handle it
      const crawler = createTestCrawler({
        equippedWeapon: createItem('health_potion'), // consumable in weapon slot
      });
      render(<InventoryPanel crawler={crawler} />);

      const weaponSlot = screen.getByTestId('weapon-slot');
      // Should show the name but no stat bonus (since it's not equipment)
      expect(within(weaponSlot).getByText('Health Potion')).toBeInTheDocument();
      // Stat bonus should not be shown for non-equipment
      expect(within(weaponSlot).queryByText(/\+/)).not.toBeInTheDocument();
    });

    it('handles multiple items with same name', () => {
      const crawler = createTestCrawler({
        inventory: [
          createItem('health_potion', 'potion-1'),
          createItem('health_potion', 'potion-2'),
          createItem('health_potion', 'potion-3'),
        ],
      });
      render(<InventoryPanel crawler={crawler} />);

      // All three potions should render (using unique IDs as keys)
      const potions = screen.getAllByText('Health Potion');
      expect(potions).toHaveLength(3);
      expect(screen.getByText('3/10')).toBeInTheDocument();
    });
  });
});
