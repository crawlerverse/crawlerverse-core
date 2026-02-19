/**
 * InventoryPanel Offhand Slot Tests
 *
 * Tests the offhand equipment slot display for various item types:
 * - Empty slot display
 * - Thrown weapons with quantity (×N)
 * - Quivers with ammo count (current/max)
 *
 * Part of CRA-143: Ranged Weapons Polish
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InventoryPanel } from '../InventoryPanel';
import type { Entity } from '../../../lib/engine/types';

// Mock the logger to avoid console noise in tests
vi.mock('../../../lib/logging', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const createTestCrawler = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'player',
  type: 'crawler',
  x: 5,
  y: 5,
  areaId: 'test-area',
  hp: 20,
  maxHp: 20,
  name: 'Test Crawler',
  char: '@',
  attack: 5,
  defense: 3,
  speed: 100,
  ...overrides,
});

describe('InventoryPanel offhand slot', () => {
  it('renders offhand slot', () => {
    const crawler = createTestCrawler();
    render(<InventoryPanel crawler={crawler} />);

    expect(screen.getByTestId('offhand-slot')).toBeInTheDocument();
    expect(screen.getByText(/Offhand/)).toBeInTheDocument();
  });

  it('displays thrown weapon with quantity', () => {
    const crawler = createTestCrawler({
      equippedOffhand: {
        id: 'dagger-1',
        templateId: 'throwing_dagger',
        x: 0,
        y: 0,
        areaId: 'test-area',
        quantity: 5,
      },
    });
    render(<InventoryPanel crawler={crawler} />);

    expect(screen.getByText('Throwing Dagger')).toBeInTheDocument();
    expect(screen.getByText('×5')).toBeInTheDocument();
  });

  it('displays quiver with ammo count', () => {
    const crawler = createTestCrawler({
      equippedOffhand: {
        id: 'quiver-1',
        templateId: 'leather_quiver',
        x: 0,
        y: 0,
        areaId: 'test-area',
        currentAmmo: 12,
      },
    });
    render(<InventoryPanel crawler={crawler} />);

    expect(screen.getByText('Leather Quiver')).toBeInTheDocument();
    expect(screen.getByText('12/20')).toBeInTheDocument();
  });

  it('displays empty when no offhand equipped', () => {
    const crawler = createTestCrawler({ equippedOffhand: null });
    render(<InventoryPanel crawler={crawler} />);

    const offhandSlot = screen.getByTestId('offhand-slot');
    expect(offhandSlot).toHaveTextContent('—');
  });
});
