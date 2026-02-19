/**
 * Inventory Module
 *
 * Pure functions for processing inventory-related actions.
 * No side effects - takes state, returns new state.
 */

import type { GameState } from './state';
import type { Entity } from './types';
import type { ItemInstance } from './items';
import { getItemAtPosition, getItemTemplate, ITEM_TEMPLATES } from './items';
import { createLogger } from '../logging';
import { EventType } from './events';

// --- Structured Logging ---
const inventoryLogger = createLogger({ module: 'inventory' });

// --- Constants ---

/** Maximum number of items a crawler can carry */
export const MAX_INVENTORY_SIZE = 10;

// --- Error Codes ---

export type InventoryErrorCode =
  | 'NO_ITEM'
  | 'INVENTORY_FULL'
  | 'ACTOR_NOT_FOUND'
  | 'NOT_CONSUMABLE'
  | 'NOT_EQUIPMENT'
  | 'INVALID_TEMPLATE';

// --- Result Types ---

export type InventoryActionResult =
  | { readonly success: true; readonly state: GameState; readonly message: string }
  | { readonly success: false; readonly error: string; readonly code: InventoryErrorCode };

// --- Helper Functions ---

/**
 * Get item display name from template, with logging for missing templates.
 */
function getItemDisplayName(item: ItemInstance): string {
  const template = getItemTemplate(item.templateId);
  if (!template) {
    inventoryLogger.warn(
      { templateId: item.templateId, itemId: item.id, availableTemplates: Object.keys(ITEM_TEMPLATES) },
      'Item template not found - using fallback name "Unknown Item"'
    );
    return 'Unknown Item';
  }
  return template.name;
}

/**
 * Remove item at index from array, returning new array.
 */
function removeAt<T>(array: readonly T[], index: number): T[] {
  return [...array.slice(0, index), ...array.slice(index + 1)];
}

/**
 * Replace item at index in array, returning new array.
 */
function replaceAt<T>(array: readonly T[], index: number, newItem: T): T[] {
  return [...array.slice(0, index), newItem, ...array.slice(index + 1)];
}

// --- Pickup Action ---

/**
 * Process a pickup action for an actor.
 *
 * Finds the first item at the actor's position and moves it from the ground
 * to the actor's inventory.
 *
 * @param state - Current game state
 * @param actorId - ID of the actor picking up an item
 * @returns InventoryActionResult with success/failure and updated state
 */
export function processPickup(state: GameState, actorId: string): InventoryActionResult {
  const actor = state.entities[actorId];
  if (!actor) {
    return { success: false, error: `Actor ${actorId} not found`, code: 'ACTOR_NOT_FOUND' };
  }

  const inventory = actor.inventory ?? [];

  if (inventory.length >= MAX_INVENTORY_SIZE) {
    return { success: false, error: 'Inventory full', code: 'INVENTORY_FULL' };
  }

  const item = getItemAtPosition(state.items, actor.x, actor.y, actor.areaId);
  if (!item) {
    return { success: false, error: 'No item here', code: 'NO_ITEM' };
  }

  const itemName = getItemDisplayName(item);
  const newState: GameState = {
    ...state,
    entities: {
      ...state.entities,
      [actorId]: { ...actor, inventory: [...inventory, item] },
    },
    items: state.items.filter(i => i.id !== item.id),
  };

  // Emit ITEM_FOUND event
  const { eventEmitter, ...stateWithoutEmitter } = newState;
  eventEmitter?.emit({
    type: EventType.ITEM_FOUND,
    timestamp: Date.now(),
    context: structuredClone(stateWithoutEmitter) as GameState,
    entities: [actor],
    metadata: {
      itemType: item.templateId,
      quantity: item.quantity ?? 1,
    }
  });

  return { success: true, state: newState, message: `Picked up ${itemName}` };
}

// --- Drop Action ---

/**
 * Process a drop action for an actor.
 *
 * Drops an item matching the given templateId. Checks in this order:
 * 1. Inventory (removes first matching item)
 * 2. Equipped weapon
 * 3. Equipped armor
 * 4. Equipped offhand
 *
 * The dropped item is placed at the actor's current position.
 *
 * @param state - Current game state
 * @param actorId - ID of the actor dropping an item
 * @param itemType - The templateId of the item to drop
 * @returns InventoryActionResult with success/failure and updated state
 */
export function processDrop(
  state: GameState,
  actorId: string,
  itemType: string
): InventoryActionResult {
  const actor = state.entities[actorId];
  if (!actor) {
    return { success: false, error: `Actor ${actorId} not found`, code: 'ACTOR_NOT_FOUND' };
  }

  const inventory = actor.inventory ?? [];

  // Find item to drop: inventory first, then equipped weapon, armor, offhand
  const inventoryIndex = inventory.findIndex(item => item.templateId === itemType);

  let itemToDrop: ItemInstance | null = null;
  let actorUpdate: Partial<Entity> = {};

  if (inventoryIndex !== -1) {
    itemToDrop = inventory[inventoryIndex];
    actorUpdate = { inventory: removeAt(inventory, inventoryIndex) };
  } else if (actor.equippedWeapon?.templateId === itemType) {
    itemToDrop = actor.equippedWeapon;
    actorUpdate = { equippedWeapon: null };
  } else if (actor.equippedArmor?.templateId === itemType) {
    itemToDrop = actor.equippedArmor;
    actorUpdate = { equippedArmor: null };
  } else if (actor.equippedOffhand?.templateId === itemType) {
    itemToDrop = actor.equippedOffhand;
    actorUpdate = { equippedOffhand: null };
  }

  if (!itemToDrop) {
    return { success: false, error: `You don't have ${itemType}`, code: 'NO_ITEM' };
  }

  const itemName = getItemDisplayName(itemToDrop);
  const droppedItem = { ...itemToDrop, x: actor.x, y: actor.y };

  const newState: GameState = {
    ...state,
    entities: {
      ...state.entities,
      [actorId]: { ...actor, ...actorUpdate },
    },
    items: [...state.items, droppedItem],
  };

  return { success: true, state: newState, message: `Dropped ${itemName}` };
}

// --- Use Action ---

/**
 * Process a use action for an actor.
 *
 * Uses a consumable item from the actor's inventory, applying its effects.
 * Only consumable items (type === 'consumable') can be used.
 *
 * @param state - Current game state
 * @param actorId - ID of the actor using an item
 * @param itemType - The templateId of the item to use
 * @returns InventoryActionResult with success/failure and updated state
 */
export function processUse(
  state: GameState,
  actorId: string,
  itemType: string
): InventoryActionResult {
  const actor = state.entities[actorId];
  if (!actor) {
    return { success: false, error: `Actor ${actorId} not found`, code: 'ACTOR_NOT_FOUND' };
  }

  const inventory = actor.inventory ?? [];
  const inventoryIndex = inventory.findIndex(item => item.templateId === itemType);

  if (inventoryIndex === -1) {
    return { success: false, error: `You don't have ${itemType}`, code: 'NO_ITEM' };
  }

  const item = inventory[inventoryIndex];
  const template = getItemTemplate(item.templateId);

  if (!template) {
    inventoryLogger.error(
      { actorId, itemType, templateId: item.templateId, availableTemplates: Object.keys(ITEM_TEMPLATES) },
      'Item template not found - possible data corruption'
    );
    return {
      success: false,
      error: `Item template '${item.templateId}' not found in registry`,
      code: 'INVALID_TEMPLATE',
    };
  }

  if (template.type !== 'consumable') {
    return { success: false, error: `${template.name} cannot be used`, code: 'NOT_CONSUMABLE' };
  }

  // Apply effect modifiers
  let newHp = actor.hp;
  let newMaxHp = actor.maxHp;
  let newAttack = actor.attack;
  let newDefense = actor.defense;
  let newSpeed = actor.speed;

  for (const modifier of template.effect.modifiers) {
    switch (modifier.stat) {
      case 'hp': newHp += modifier.delta; break;
      case 'maxHp': newMaxHp += modifier.delta; break;
      case 'attack': newAttack += modifier.delta; break;
      case 'defense': newDefense += modifier.delta; break;
      case 'speed': newSpeed += modifier.delta; break;
    }
  }

  // Ensure maxHp doesn't go below 1
  newMaxHp = Math.max(1, newMaxHp);
  // Cap hp at maxHp, ensure stats don't go below minimums
  newHp = Math.min(newHp, newMaxHp);
  newAttack = Math.max(0, newAttack);
  newDefense = Math.max(0, newDefense);
  newSpeed = Math.max(1, newSpeed);

  const newState: GameState = {
    ...state,
    entities: {
      ...state.entities,
      [actorId]: {
        ...actor,
        hp: newHp,
        maxHp: newMaxHp,
        attack: newAttack,
        defense: newDefense,
        speed: newSpeed,
        inventory: removeAt(inventory, inventoryIndex),
      },
    },
  };

  return { success: true, state: newState, message: `Used ${template.name}` };
}

// --- Equip Action ---

/**
 * Process an equip action for an actor.
 *
 * Equips an item from the actor's inventory to the appropriate equipment slot.
 * Only equipment items (type === 'equipment') can be equipped.
 *
 * Direct swap: When the target slot already has an item equipped, the old item
 * is moved to the inventory slot where the new item was. This allows equipping
 * even when inventory is full.
 *
 * @param state - Current game state
 * @param actorId - ID of the actor equipping an item
 * @param itemType - The templateId of the item to equip
 * @returns InventoryActionResult with success/failure and updated state
 */
export function processEquip(
  state: GameState,
  actorId: string,
  itemType: string
): InventoryActionResult {
  const actor = state.entities[actorId];
  if (!actor) {
    return { success: false, error: `Actor ${actorId} not found`, code: 'ACTOR_NOT_FOUND' };
  }

  const inventory = actor.inventory ?? [];
  const inventoryIndex = inventory.findIndex(item => item.templateId === itemType);

  if (inventoryIndex === -1) {
    return { success: false, error: `You don't have ${itemType}`, code: 'NO_ITEM' };
  }

  const item = inventory[inventoryIndex];
  const template = getItemTemplate(item.templateId);

  if (!template) {
    inventoryLogger.error(
      { actorId, itemType, templateId: item.templateId, availableTemplates: Object.keys(ITEM_TEMPLATES) },
      'Item template not found - possible data corruption'
    );
    return {
      success: false,
      error: `Item template '${item.templateId}' not found in registry`,
      code: 'INVALID_TEMPLATE',
    };
  }

  if (template.type !== 'equipment') {
    return { success: false, error: `${template.name} cannot be equipped`, code: 'NOT_EQUIPMENT' };
  }

  const slot = template.slot;
  const currentlyEquipped =
    slot === 'weapon' ? actor.equippedWeapon :
    slot === 'armor' ? actor.equippedArmor :
    actor.equippedOffhand;

  // Direct swap: replace item in inventory with currently equipped (if any), or just remove
  const newInventory = currentlyEquipped
    ? replaceAt(inventory, inventoryIndex, currentlyEquipped)
    : removeAt(inventory, inventoryIndex);

  // Build the slot update based on which slot we're equipping to
  const slotUpdate =
    slot === 'weapon' ? { equippedWeapon: item } :
    slot === 'armor' ? { equippedArmor: item } :
    { equippedOffhand: item };

  const newState: GameState = {
    ...state,
    entities: {
      ...state.entities,
      [actorId]: {
        ...actor,
        inventory: newInventory,
        ...slotUpdate,
      },
    },
  };

  return { success: true, state: newState, message: `Equipped ${template.name}` };
}
