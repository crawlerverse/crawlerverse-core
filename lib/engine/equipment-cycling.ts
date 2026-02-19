/**
 * Equipment Cycling Utilities
 *
 * Pure functions for cycling through equipment items by slot.
 */

import type { ItemInstance } from './items';
import { getItemTemplate, isEquipmentTemplate } from './items';

export type EquipmentSlot = 'weapon' | 'armor';

/**
 * Get the next equipment item to equip for a given slot.
 *
 * Cycles through inventory items matching the slot type.
 * If nothing is currently equipped, returns the first matching item.
 * If the currently equipped item's template matches one in inventory,
 * returns the next one (wrapping to first after last).
 *
 * @param inventory - Player's inventory items
 * @param slot - The equipment slot to cycle ('weapon' or 'armor')
 * @param currentlyEquipped - Currently equipped item in that slot (or null)
 * @returns Next item to equip, or undefined if no matching items
 */
export function getNextEquipment(
  inventory: readonly ItemInstance[],
  slot: EquipmentSlot,
  currentlyEquipped: ItemInstance | null | undefined
): ItemInstance | undefined {
  // Filter inventory to only items of the target slot
  const slotItems = inventory.filter((item) => {
    const template = getItemTemplate(item.templateId);
    return template && isEquipmentTemplate(template) && template.slot === slot;
  });

  if (slotItems.length === 0) {
    return undefined;
  }

  // If nothing equipped, return first item
  if (!currentlyEquipped) {
    return slotItems[0];
  }

  // Find index of currently equipped item's template in the filtered list
  const currentIndex = slotItems.findIndex(
    (item) => item.templateId === currentlyEquipped.templateId
  );

  // If current item not found in inventory (or different instance), return first
  if (currentIndex === -1) {
    return slotItems[0];
  }

  // Return next item, wrapping around
  const nextIndex = (currentIndex + 1) % slotItems.length;
  return slotItems[nextIndex];
}
