import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventoryModal } from '../InventoryModal';
import type { Entity } from '../../../lib/engine/types';
import type { ItemInstance } from '../../../lib/engine/items';

// Mock logger
vi.mock('../../../lib/logging', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createItem(templateId: string, id: string): ItemInstance {
  return { id, templateId, x: 0, y: 0, areaId: 'test' };
}

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

describe('InventoryModal', () => {
  it('renders when open', () => {
    const crawler = createTestCrawler();
    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    expect(screen.getByText('Inventory')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const crawler = createTestCrawler();
    render(
      <InventoryModal
        isOpen={false}
        crawler={crawler}
        onClose={() => {}}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
  });

  it('shows equipped items section', () => {
    const crawler = createTestCrawler({
      equippedWeapon: createItem('short_sword', 'w1'),
      equippedArmor: createItem('leather_armor', 'a1'),
    });

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    expect(screen.getByText('EQUIPPED')).toBeInTheDocument();
    // Items appear in both the list and detail pane, so use getAllByText
    expect(screen.getAllByText(/Short Sword/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Leather Armor/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows backpack items with numbers', () => {
    const crawler = createTestCrawler({
      inventory: [
        createItem('long_sword', 'w2'),
        createItem('health_potion', 'p1'),
      ],
    });

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    expect(screen.getByText('BACKPACK')).toBeInTheDocument();
    expect(screen.getByText(/1\./)).toBeInTheDocument();
    // Items appear in both the list and detail pane, so use getAllByText
    expect(screen.getAllByText(/Long Sword/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2\./)).toBeInTheDocument();
    expect(screen.getAllByText(/Health Potion/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('InventoryModal keyboard interactions', () => {
  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    const crawler = createTestCrawler();

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={onClose}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on i key', async () => {
    const onClose = vi.fn();
    const crawler = createTestCrawler();

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={onClose}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    await userEvent.keyboard('i');

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onEquip when Enter pressed on backpack equipment', async () => {
    const onEquip = vi.fn();
    const crawler = createTestCrawler({
      inventory: [createItem('long_sword', 'w1')],
    });

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={onEquip}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    // First backpack item is at index 0 (no equipped items)
    // Selection starts at 0, so just press Enter
    await userEvent.keyboard('{Enter}');

    expect(onEquip).toHaveBeenCalledWith('long_sword');
  });

  it('calls onUse when Enter pressed on consumable', async () => {
    const onUse = vi.fn();
    const crawler = createTestCrawler({
      inventory: [createItem('health_potion', 'p1')],
    });

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={() => {}}
        onUse={onUse}
        onDrop={() => {}}
      />
    );

    // First backpack item is at index 0 (no equipped items)
    // Selection starts at 0, so just press Enter
    await userEvent.keyboard('{Enter}');

    expect(onUse).toHaveBeenCalledWith('health_potion');
  });

  it('calls onDrop when d pressed on selected item', async () => {
    const onDrop = vi.fn();
    const crawler = createTestCrawler({
      inventory: [createItem('health_potion', 'p1')],
    });

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={() => {}}
        onUse={() => {}}
        onDrop={onDrop}
      />
    );

    // First backpack item is at index 0, selection starts there
    await userEvent.keyboard('d');

    expect(onDrop).toHaveBeenCalledWith('health_potion');
  });

  it('selects backpack item with number hotkey', async () => {
    const onEquip = vi.fn();
    const crawler = createTestCrawler({
      inventory: [
        createItem('short_sword', 'w1'),
        createItem('long_sword', 'w2'),
      ],
    });

    render(
      <InventoryModal
        isOpen={true}
        crawler={crawler}
        onClose={() => {}}
        onEquip={onEquip}
        onUse={() => {}}
        onDrop={() => {}}
      />
    );

    // Press 2 to select second item, then Enter
    await userEvent.keyboard('2{Enter}');

    expect(onEquip).toHaveBeenCalledWith('long_sword');
  });
});
