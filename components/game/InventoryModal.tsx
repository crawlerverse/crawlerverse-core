'use client';

/**
 * InventoryModal Component
 *
 * Full inventory management modal with:
 * - Equipped items display (weapon + armor)
 * - Backpack list with number hotkeys
 * - Keyboard navigation (arrows/vim keys)
 * - Item detail pane with stats and lore
 */

import { useCallback, useEffect, useState } from 'react';
import type { Entity } from '../../lib/engine/types';
import type { ItemInstance, ItemTemplate } from '../../lib/engine/items';
import { getItemTemplate } from '../../lib/engine/items';

export interface InventoryModalProps {
  isOpen: boolean;
  crawler: Entity;
  onClose: () => void;
  onEquip: (itemTemplateId: string) => void;
  onUse: (itemTemplateId: string) => void;
  onDrop: (itemTemplateId: string) => void;
}

type SelectableItem =
  | { type: 'equipped-weapon'; item: ItemInstance }
  | { type: 'equipped-armor'; item: ItemInstance }
  | { type: 'backpack'; item: ItemInstance; index: number };

/** Get item type badge */
function getItemBadge(templateId: string): string {
  const template = getItemTemplate(templateId);
  if (!template) return '?';
  if (template.type === 'consumable') return 'C';
  if (template.type === 'equipment') {
    return template.slot === 'weapon' ? 'W' : 'A';
  }
  return '?';
}

/** Get item name from template */
function getItemName(templateId: string): string {
  const template = getItemTemplate(templateId);
  return template?.name ?? templateId;
}

/** Get item stats display */
function getItemStats(templateId: string): string {
  const template = getItemTemplate(templateId);
  if (!template) return '';

  const modifier = template.effect.modifiers[0];
  if (!modifier) return '';

  const sign = modifier.delta > 0 ? '+' : '';
  return `${sign}${modifier.delta} ${modifier.stat.toUpperCase()}`;
}

/** Get item lore text */
function getItemLore(templateId: string): string {
  const template = getItemTemplate(templateId);
  return (template as ItemTemplate & { lore?: string })?.lore ?? '';
}

/** Get item tier */
function getItemTier(templateId: string): number {
  const template = getItemTemplate(templateId);
  return template?.tier ?? 0;
}

/** Get item type label */
function getItemTypeLabel(templateId: string): string {
  const template = getItemTemplate(templateId);
  if (!template) return 'Unknown';
  if (template.type === 'consumable') return 'Consumable';
  if (template.type === 'equipment') {
    return template.slot === 'weapon' ? 'Weapon' : 'Armor';
  }
  return 'Unknown';
}

export function InventoryModal({
  isOpen,
  crawler,
  onClose,
  onEquip,
  onUse,
  onDrop,
}: InventoryModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inventory = crawler.inventory ?? [];
  const { equippedWeapon, equippedArmor } = crawler;

  // Build selectable items list
  const selectableItems: SelectableItem[] = [];
  if (equippedWeapon) {
    selectableItems.push({ type: 'equipped-weapon', item: equippedWeapon });
  }
  if (equippedArmor) {
    selectableItems.push({ type: 'equipped-armor', item: equippedArmor });
  }
  inventory.forEach((item, index) => {
    selectableItems.push({ type: 'backpack', item, index });
  });

  // Clamp selection when items change
  useEffect(() => {
    if (selectedIndex >= selectableItems.length) {
      setSelectedIndex(Math.max(0, selectableItems.length - 1));
    }
  }, [selectableItems.length, selectedIndex]);

  // Get currently selected item
  const selectedItem = selectableItems[selectedIndex];
  const selectedTemplateId = selectedItem?.item.templateId;

  // Handle keyboard input
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Close on Escape or 'i'
      if (e.key === 'Escape' || e.key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Navigation: up/down or j/k
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(selectableItems.length - 1, i + 1));
        return;
      }

      // Number hotkeys for backpack items (1-9)
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const backpackIndex = num - 1;
        if (backpackIndex < inventory.length) {
          e.preventDefault();
          e.stopPropagation();
          // Find the index in selectableItems
          const equipped = (equippedWeapon ? 1 : 0) + (equippedArmor ? 1 : 0);
          setSelectedIndex(equipped + backpackIndex);
        }
        return;
      }

      // Action: Enter to equip/use
      if (e.key === 'Enter' && selectedItem) {
        e.preventDefault();
        e.stopPropagation();
        const template = getItemTemplate(selectedItem.item.templateId);
        if (!template) return;

        if (selectedItem.type === 'equipped-weapon' || selectedItem.type === 'equipped-armor') {
          // Unequip by "equipping" it again (engine handles swap to inventory)
          onEquip(selectedItem.item.templateId);
        } else if (template.type === 'consumable') {
          onUse(selectedItem.item.templateId);
        } else {
          onEquip(selectedItem.item.templateId);
        }
        return;
      }

      // Drop: 'd' key
      if (e.key === 'd' && selectedItem) {
        e.preventDefault();
        e.stopPropagation();
        onDrop(selectedItem.item.templateId);
        return;
      }
    },
    [isOpen, selectedItem, selectableItems.length, inventory.length, equippedWeapon, equippedArmor, onClose, onEquip, onUse, onDrop]
  );

  // Attach keyboard listener when open
  useEffect(() => {
    if (isOpen) {
      // Use capture phase to intercept before game handler
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [isOpen, handleKeyDown]);

  // Reset selection when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const equippedCount = (equippedWeapon ? 1 : 0) + (equippedArmor ? 1 : 0);

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-50"
      onClick={onClose}
      data-testid="inventory-modal-backdrop"
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="inventory-modal"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text)]">Inventory</h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Equipped Section */}
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
              EQUIPPED
            </div>
            <div className="space-y-1">
              <div
                className={`flex items-center gap-2 px-2 py-1 rounded ${
                  selectedIndex === 0 && equippedWeapon
                    ? 'bg-[var(--bg-deep)] border border-[var(--accent)]'
                    : ''
                }`}
              >
                <span className="text-[var(--text-muted)] w-6">W:</span>
                <span className="text-[var(--text)]">
                  {equippedWeapon ? getItemName(equippedWeapon.templateId) : 'Empty'}
                </span>
              </div>
              <div
                className={`flex items-center gap-2 px-2 py-1 rounded ${
                  selectedIndex === (equippedWeapon ? 1 : 0) && equippedArmor
                    ? 'bg-[var(--bg-deep)] border border-[var(--accent)]'
                    : ''
                }`}
              >
                <span className="text-[var(--text-muted)] w-6">A:</span>
                <span className="text-[var(--text)]">
                  {equippedArmor ? getItemName(equippedArmor.templateId) : 'Empty'}
                </span>
              </div>
            </div>
          </div>

          {/* Backpack Section */}
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
              BACKPACK
            </div>
            {inventory.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)] italic px-2">Empty</div>
            ) : (
              <div className="space-y-1">
                {inventory.map((item, index) => {
                  const itemIndex = equippedCount + index;
                  const isSelected = selectedIndex === itemIndex;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--bg-deep)] border border-[var(--accent)]'
                          : 'hover:bg-[var(--bg-deep)]'
                      }`}
                      onClick={() => setSelectedIndex(itemIndex)}
                    >
                      <span className="text-[var(--text-muted)] w-6">{index + 1}.</span>
                      <span className="text-[var(--text)] flex-1">{getItemName(item.templateId)}</span>
                      <span className="text-xs text-[var(--text-muted)]">[{getItemBadge(item.templateId)}]</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Detail Pane */}
          {selectedItem && (
            <div className="border-t border-[var(--border)] pt-4">
              <div className="text-sm font-medium text-[var(--text)]">
                {getItemName(selectedTemplateId!)}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Tier {getItemTier(selectedTemplateId!)} {getItemTypeLabel(selectedTemplateId!)}
              </div>
              {getItemStats(selectedTemplateId!) && (
                <div className="text-xs text-[var(--success)] mt-1">
                  {getItemStats(selectedTemplateId!)}
                </div>
              )}
              {getItemLore(selectedTemplateId!) && (
                <div className="text-xs text-[var(--text-muted)] mt-2 italic">
                  &quot;{getItemLore(selectedTemplateId!)}&quot;
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
          <span className="mr-4">[up/down/jk] Navigate</span>
          <span className="mr-4">[Enter] Equip/Use</span>
          <span className="mr-4">[d] Drop</span>
          <span>[Esc] Close</span>
        </div>
      </div>
    </div>
  );
}
