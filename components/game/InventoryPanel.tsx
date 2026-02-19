'use client';

/**
 * InventoryPanel Component
 *
 * Displays a crawler's inventory and equipped items with stat bonuses.
 * - Equipment slots: Shows weapon, armor, and offhand with stat modifiers (e.g., "+2 ATTACK")
 *   - Offhand slot has context-aware display: quantity for thrown weapons, ammo for quivers
 * - Inventory list: Displays carried items with capacity indicator (max 10 items)
 * - Visual feedback: Highlights when inventory reaches capacity
 *
 * Gracefully handles:
 * - Missing/undefined inventory (defaults to empty array)
 * - Unknown item templates (displays templateId with warning)
 * - Invalid items in inventory array (filters and logs)
 *
 * Note: Only the primary (first) modifier is displayed for equipment items.
 */

import type { Entity } from '../../lib/engine/types';
import type { ItemInstance } from '../../lib/engine/items';
import { getItemTemplate } from '../../lib/engine/items';
import { MAX_INVENTORY_SIZE } from '../../lib/engine/inventory';
import { createLogger } from '../../lib/logging';

const logger = createLogger({ module: 'InventoryPanel' });

interface InventoryPanelProps {
  /** The crawler entity whose inventory to display */
  crawler: Entity;
}

/**
 * Get display name for an item instance.
 * Returns 'Empty' for null/undefined items.
 * Falls back to templateId (marked as unknown) if template not found.
 */
function getItemName(item: ItemInstance | null | undefined): string {
  if (!item) return 'Empty';
  const template = getItemTemplate(item.templateId);
  if (!template) {
    logger.warn(
      { templateId: item.templateId, itemId: item.id },
      'Item template not found - possible data corruption'
    );
    return `[Unknown: ${item.templateId}]`;
  }
  return template.name;
}

/**
 * Get stat bonus text for equipment.
 * Displays only the primary (first) modifier - items with multiple modifiers
 * will only show the first bonus in the UI.
 *
 * Returns null for:
 * - Null/undefined items (expected)
 * - Missing templates (logged as warning)
 * - Non-equipment items in equipment slots (logged as error)
 * - Equipment with no modifiers (logged as debug)
 */
function getStatBonus(item: ItemInstance | null | undefined): string | null {
  if (!item) return null;

  const template = getItemTemplate(item.templateId);
  if (!template) {
    logger.warn(
      { templateId: item.templateId, itemId: item.id },
      'Template not found for equipped item'
    );
    return null;
  }

  if (template.type !== 'equipment') {
    // This indicates a bug - equippedWeapon/equippedArmor should only hold equipment
    logger.error(
      { templateId: item.templateId, type: template.type, itemId: item.id },
      'Non-equipment item in equipment slot - logic error'
    );
    return null;
  }

  const modifier = template.effect.modifiers[0];
  if (!modifier) {
    // Equipment without modifiers is technically valid but unusual
    logger.debug(
      { templateId: item.templateId },
      'Equipment has no modifiers configured'
    );
    return null;
  }

  const sign = modifier.delta > 0 ? '+' : '';
  return `${sign}${modifier.delta} ${modifier.stat.toUpperCase()}`;
}

/**
 * Get display text for offhand slot items.
 * - Thrown weapons: Show quantity (xN)
 * - Quivers: Show ammo (current/max)
 * - Other: Show stat bonus
 */
function getOffhandDisplay(item: ItemInstance | null | undefined): string | null {
  if (!item) return null;

  // Thrown weapons show quantity
  if (item.quantity !== undefined && item.quantity > 0) {
    return `×${item.quantity}`;
  }

  // Quivers show ammo count - get max from template
  if (item.currentAmmo !== undefined) {
    const template = getItemTemplate(item.templateId);
    if (template && template.type === 'equipment' && template.capacity !== undefined) {
      return `${item.currentAmmo}/${template.capacity}`;
    }
  }

  // Fall back to stat bonus display
  return getStatBonus(item);
}

/**
 * Filter and validate inventory items, logging any invalid entries.
 */
function filterValidItems(items: readonly ItemInstance[]): ItemInstance[] {
  return items.filter((item, index) => {
    if (!item || typeof item.id !== 'string') {
      logger.error(
        { index, item },
        'Invalid item in inventory array - skipping render'
      );
      return false;
    }
    return true;
  });
}

/** Renders a single equipment row in compact format */
function EquipmentRow({
  label,
  item,
  testId,
  customDisplay,
}: {
  label: string;
  item: ItemInstance | null | undefined;
  testId: string;
  customDisplay?: string | null;
}) {
  const name = getItemName(item);
  const bonus = customDisplay ?? getStatBonus(item);
  const isEmpty = !item;

  return (
    <div className="flex items-baseline gap-1 text-xs" data-testid={testId}>
      <span className="text-[var(--text-muted)] w-16 shrink-0">{label}:</span>
      {isEmpty ? (
        <span className="text-[var(--text-muted)]">—</span>
      ) : (
        <>
          <span className="text-[var(--text)]">{name}</span>
          {bonus && <span className="text-[var(--success)]">{bonus}</span>}
        </>
      )}
    </div>
  );
}

export function InventoryPanel({ crawler }: InventoryPanelProps) {
  // Development-only type assertion
  if (process.env.NODE_ENV === 'development' && crawler.type !== 'crawler') {
    logger.error(
      { entityId: crawler.id, entityType: crawler.type },
      'InventoryPanel received non-crawler entity'
    );
  }

  const rawInventory = crawler.inventory ?? [];
  const inventory = filterValidItems(rawInventory);
  const isFull = inventory.length >= MAX_INVENTORY_SIZE;

  return (
    <div className="space-y-2" data-testid="inventory-panel">
      {/* Equipment List */}
      <div className="p-2 rounded bg-[var(--bg-deep)] border border-[var(--border)] space-y-1">
        <div className="text-[0.6rem] text-[var(--text-muted)] uppercase tracking-wider mb-1">
          Equipment
        </div>
        <EquipmentRow label="Weapon" item={crawler.equippedWeapon} testId="weapon-slot" />
        <EquipmentRow label="Armor" item={crawler.equippedArmor} testId="armor-slot" />
        <EquipmentRow
          label="Offhand"
          item={crawler.equippedOffhand}
          testId="offhand-slot"
          customDisplay={getOffhandDisplay(crawler.equippedOffhand)}
        />
      </div>

      {/* Inventory List */}
      <div
        className="p-2 rounded bg-[var(--bg-deep)] border border-[var(--border)]"
        data-testid="inventory-list"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[0.6rem] text-[var(--text-muted)] uppercase tracking-wider">
            Inventory
          </span>
          <span
            className={`text-[0.6rem] ${isFull ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}
            data-testid="inventory-counter"
          >
            {inventory.length}/{MAX_INVENTORY_SIZE}
          </span>
        </div>
        {inventory.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)] italic">Empty</div>
        ) : (
          <div className="space-y-0.5">
            {inventory.map((item) => (
              <div key={item.id} className="text-xs text-[var(--text)]">
                {getItemName(item)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
