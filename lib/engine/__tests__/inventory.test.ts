import { describe, it, expect } from 'vitest';
import { EntitySchema, ActionSchema } from '../types';
import { processPickup, processDrop, processUse, processEquip, MAX_INVENTORY_SIZE } from '../inventory';
import { createInitialState } from '../state';
import { simulate } from '../simulation';
import { queueCommand } from '../bubble';
import { entityId } from '../scheduler';
import type { GameState } from '../state';
import type { Entity } from '../types';
import type { ItemInstance } from '../items';
import {
  createTestItem,
  createTestCrawler,
  createMinimalGameState,
  createTestStateWithCrawler,
  expectSuccess,
  expectFailure,
} from './test-helpers';

// Aliases for backward compatibility within this file
const createItem = createTestItem;
const createCrawler = createTestCrawler;
const createTestState = createMinimalGameState;
const createStateWithCrawler = createTestStateWithCrawler;

// --- processPickup Tests ---

describe('processPickup', () => {
  it('picks up item at player position', () => {
    const item = createItem('health_potion', 'item-1');
    const state = createTestState({ items: [{ ...item, x: 5, y: 5 }] });

    const result = processPickup(state, 'crawler-1');

    expectSuccess(result, (state) => {
      expect(state.items).toHaveLength(0);
      expect(state.entities['crawler-1'].inventory).toHaveLength(1);
      expect(state.entities['crawler-1'].inventory![0].templateId).toBe('health_potion');
    });
    if (result.success) {
      expect(result.message).toContain('Health Potion');
    }
  });

  it('rejects when no item at position', () => {
    const state = createTestState();
    const result = processPickup(state, 'crawler-1');

    expectFailure(result, 'NO_ITEM', 'No item here');
  });

  it('rejects when inventory full', () => {
    const inventoryItems = Array.from({ length: MAX_INVENTORY_SIZE }, (_, i) =>
      createItem('health_potion', `inv-item-${i}`)
    );
    const groundItem = { ...createItem('short_sword', 'ground-item'), x: 5, y: 5 };

    const state = createStateWithCrawler(
      { inventory: inventoryItems },
      { items: [groundItem] }
    );

    const result = processPickup(state, 'crawler-1');

    expectFailure(result, 'INVENTORY_FULL', 'Inventory full');
  });

  it('picks up only one item when multiple on tile', () => {
    const items: ItemInstance[] = [
      { ...createItem('health_potion', 'item-1'), x: 5, y: 5 },
      { ...createItem('short_sword', 'item-2'), x: 5, y: 5 },
    ];
    const state = createTestState({ items });

    const result = processPickup(state, 'crawler-1');

    expectSuccess(result, (state) => {
      expect(state.items).toHaveLength(1);
      expect(state.entities['crawler-1'].inventory).toHaveLength(1);
      expect(state.entities['crawler-1'].inventory![0].templateId).toBe('health_potion');
      expect(state.items[0].templateId).toBe('short_sword');
    });
  });
});

// --- Entity Inventory Fields Tests ---

describe('Entity inventory fields', () => {
  it('accepts crawler with empty inventory', () => {
    const crawler = createCrawler();
    const parsed = EntitySchema.parse(crawler);
    expect(parsed.inventory).toEqual([]);
    expect(parsed.equippedWeapon).toBeNull();
    expect(parsed.equippedArmor).toBeNull();
  });

  it('accepts crawler with items in inventory', () => {
    const crawler = createCrawler({
      inventory: [createItem('health_potion', 'item-1')],
    });
    const parsed = EntitySchema.parse(crawler);
    expect(parsed.inventory).toHaveLength(1);
    expect(parsed.inventory![0].templateId).toBe('health_potion');
  });

  it('accepts crawler with equipped weapon', () => {
    const crawler = createCrawler({
      equippedWeapon: createItem('short_sword', 'item-2'),
    });
    const parsed = EntitySchema.parse(crawler);
    expect(parsed.equippedWeapon).not.toBeNull();
    expect(parsed.equippedWeapon!.templateId).toBe('short_sword');
  });

  it('monsters do not have inventory fields', () => {
    const monster = {
      id: 'rat-1',
      type: 'monster',
      x: 3,
      y: 3,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Rat',
      attack: 1,
      defense: 0,
      speed: 120,
      monsterTypeId: 'rat',
    };
    const parsed = EntitySchema.parse(monster);
    expect(parsed.inventory).toBeUndefined();
  });
});

// --- Inventory Action Schema Tests ---

describe('Inventory action schemas', () => {
  it('validates pickup action', () => {
    const action = { action: 'pickup', reasoning: 'Item on ground' };
    expect(() => ActionSchema.parse(action)).not.toThrow();
  });

  it('validates drop action with itemType', () => {
    const action = { action: 'drop', itemType: 'health_potion', reasoning: 'Making room' };
    expect(() => ActionSchema.parse(action)).not.toThrow();
  });

  it('validates use action with itemType', () => {
    const action = { action: 'use', itemType: 'health_potion', reasoning: 'Low health' };
    expect(() => ActionSchema.parse(action)).not.toThrow();
  });

  it('validates equip action with itemType', () => {
    const action = { action: 'equip', itemType: 'short_sword', reasoning: 'Better weapon' };
    expect(() => ActionSchema.parse(action)).not.toThrow();
  });

  it('rejects drop action without itemType', () => {
    const action = { action: 'drop', reasoning: 'Making room' };
    expect(() => ActionSchema.parse(action)).toThrow();
  });
});

// --- processDrop Tests ---

describe('processDrop', () => {
  it('drops item from inventory to ground', () => {
    const state = createStateWithCrawler({ inventory: [createItem('health_potion', 'item-1')] });

    const result = processDrop(state, 'crawler-1', 'health_potion');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].inventory).toHaveLength(0);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].x).toBe(5);
      expect(state.items[0].y).toBe(5);
      expect(state.items[0].templateId).toBe('health_potion');
    });
    if (result.success) {
      expect(result.message).toContain('Health Potion');
    }
  });

  it('drops equipped weapon directly', () => {
    const state = createStateWithCrawler({ equippedWeapon: createItem('short_sword', 'weapon-1') });

    const result = processDrop(state, 'crawler-1', 'short_sword');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].equippedWeapon).toBeNull();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].x).toBe(5);
      expect(state.items[0].y).toBe(5);
      expect(state.items[0].templateId).toBe('short_sword');
    });
  });

  it('drops equipped armor directly', () => {
    const state = createStateWithCrawler({ equippedArmor: createItem('leather_armor', 'armor-1') });

    const result = processDrop(state, 'crawler-1', 'leather_armor');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].equippedArmor).toBeNull();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].x).toBe(5);
      expect(state.items[0].y).toBe(5);
      expect(state.items[0].templateId).toBe('leather_armor');
    });
  });

  it('rejects when item not found', () => {
    const state = createTestState();
    const result = processDrop(state, 'crawler-1', 'nonexistent_item');

    expectFailure(result, 'NO_ITEM', "You don't have nonexistent_item");
  });
});

// --- processUse Tests ---

describe('processUse', () => {
  it('applies health potion effect', () => {
    const state = createStateWithCrawler({
      hp: 5,
      inventory: [createItem('health_potion', 'item-1')],
    });

    const result = processUse(state, 'crawler-1', 'health_potion');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].hp).toBe(10);
      expect(state.entities['crawler-1'].inventory).toHaveLength(0);
    });
    if (result.success) {
      expect(result.message).toContain('Health Potion');
    }
  });

  it('caps HP at maxHp', () => {
    const state = createStateWithCrawler({
      hp: 8,
      inventory: [createItem('health_potion', 'item-1')],
    });

    const result = processUse(state, 'crawler-1', 'health_potion');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].hp).toBe(10);
      expect(state.entities['crawler-1'].inventory).toHaveLength(0);
    });
  });

  it('rejects when item not in inventory', () => {
    const state = createTestState();
    const result = processUse(state, 'crawler-1', 'health_potion');

    expectFailure(result, 'NO_ITEM', "You don't have health_potion");
  });

  it('rejects when item is not consumable', () => {
    const state = createStateWithCrawler({ inventory: [createItem('short_sword', 'item-1')] });

    const result = processUse(state, 'crawler-1', 'short_sword');

    expectFailure(result, 'NOT_CONSUMABLE', 'Short Sword cannot be used');
  });

  describe('elixir of vitality (CRA-105)', () => {
    it('increases maxHp and heals', () => {
      const state = createStateWithCrawler({
        hp: 5,
        maxHp: 10,
        inventory: [createItem('elixir_of_vitality', 'elixir-1')],
      });

      const result = processUse(state, 'crawler-1', 'elixir_of_vitality');

      expect(result.success).toBe(true);
      if (result.success) {
        const updated = result.state.entities['crawler-1'];
        expect(updated.maxHp).toBe(20); // 10 + 10
        expect(updated.hp).toBe(15);    // 5 + 10, capped at new maxHp
        expect(updated.inventory).toHaveLength(0);
        expect(result.message).toBe('Used Elixir of Vitality');
      }
    });

    it('caps hp at new maxHp', () => {
      const state = createStateWithCrawler({
        hp: 10,
        maxHp: 10,
        inventory: [createItem('elixir_of_vitality', 'elixir-1')],
      });

      const result = processUse(state, 'crawler-1', 'elixir_of_vitality');

      expect(result.success).toBe(true);
      if (result.success) {
        const updated = result.state.entities['crawler-1'];
        expect(updated.maxHp).toBe(20); // 10 + 10
        expect(updated.hp).toBe(20);    // 10 + 10, capped at 20
        expect(updated.inventory).toHaveLength(0);
        expect(result.message).toBe('Used Elixir of Vitality');
      }
    });
  });
});

// --- processEquip Tests ---

describe('processEquip', () => {
  it('equips weapon from inventory', () => {
    const state = createStateWithCrawler({ inventory: [createItem('short_sword', 'item-1')] });

    const result = processEquip(state, 'crawler-1', 'short_sword');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedWeapon).not.toBeNull();
      expect(crawler.equippedWeapon!.templateId).toBe('short_sword');
      expect(crawler.inventory).toHaveLength(0);
    });
    if (result.success) {
      expect(result.message).toContain('Short Sword');
    }
  });

  it('equips armor from inventory', () => {
    const state = createStateWithCrawler({ inventory: [createItem('leather_armor', 'item-1')] });

    const result = processEquip(state, 'crawler-1', 'leather_armor');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedArmor).not.toBeNull();
      expect(crawler.equippedArmor!.templateId).toBe('leather_armor');
      expect(crawler.inventory).toHaveLength(0);
    });
    if (result.success) {
      expect(result.message).toContain('Leather Armor');
    }
  });

  it('swaps equipped weapon with inventory item (direct swap)', () => {
    const state = createStateWithCrawler({
      inventory: [createItem('long_sword', 'item-1')],
      equippedWeapon: createItem('short_sword', 'item-2'),
    });

    const result = processEquip(state, 'crawler-1', 'long_sword');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedWeapon!.templateId).toBe('long_sword');
      expect(crawler.inventory).toHaveLength(1);
      expect(crawler.inventory![0].templateId).toBe('short_sword');
    });
  });

  it('swap works when inventory is full', () => {
    const inventoryItems = Array.from({ length: 9 }, (_, i) =>
      createItem('health_potion', `inv-item-${i}`)
    );
    inventoryItems.push(createItem('long_sword', 'inv-item-9'));

    const state = createStateWithCrawler({
      inventory: inventoryItems,
      equippedWeapon: createItem('short_sword', 'equipped-item'),
    });

    const result = processEquip(state, 'crawler-1', 'long_sword');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedWeapon!.templateId).toBe('long_sword');
      expect(crawler.inventory).toHaveLength(10);
      expect(crawler.inventory!.some(i => i.templateId === 'short_sword')).toBe(true);
      expect(crawler.inventory!.some(i => i.templateId === 'long_sword')).toBe(false);
    });
  });

  it('rejects when item not in inventory', () => {
    const state = createTestState();
    const result = processEquip(state, 'crawler-1', 'short_sword');

    expectFailure(result, 'NO_ITEM', "You don't have short_sword");
  });

  it('rejects when item is not equipment', () => {
    const state = createStateWithCrawler({ inventory: [createItem('health_potion', 'item-1')] });

    const result = processEquip(state, 'crawler-1', 'health_potion');

    expectFailure(result, 'NOT_EQUIPMENT', 'Health Potion cannot be equipped');
  });
});

// --- Integration Tests via Simulation ---

describe('inventory action integration', () => {
  it('pickup action works through simulate', () => {
    let state = createInitialState({ seed: 12345 });
    const player = Object.values(state.entities).find(e => e.type === 'crawler')!;

    state = {
      ...state,
      items: [{ id: 'test-item', templateId: 'health_potion', x: player.x, y: player.y, areaId: 'area-1' }],
      entities: {
        ...state.entities,
        [player.id]: { ...player, inventory: [], equippedWeapon: null, equippedArmor: null },
      },
    };

    const bubble = state.bubbles[0];
    const queueResult = queueCommand(bubble, entityId(player.id), { action: 'pickup', reasoning: 'Test' });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    const result = simulate(state);

    const updatedPlayer = result.state.entities[player.id];
    expect(updatedPlayer.inventory).toHaveLength(1);
    expect(updatedPlayer.inventory![0].templateId).toBe('health_potion');
    expect(result.state.items).toHaveLength(0);
    expect(result.state.messages.some(m => m.text.includes('Picked up'))).toBe(true);
  });

  it('drop action works through simulate', () => {
    let state = createInitialState({ seed: 12345 });
    const player = Object.values(state.entities).find(e => e.type === 'crawler')!;

    state = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: {
          ...player,
          inventory: [createItem('health_potion', 'inv-item')],
          equippedWeapon: null,
          equippedArmor: null,
        },
      },
    };

    const bubble = state.bubbles[0];
    const queueResult = queueCommand(bubble, entityId(player.id), {
      action: 'drop',
      itemType: 'health_potion',
      reasoning: 'Test',
    });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    const result = simulate(state);

    const updatedPlayer = result.state.entities[player.id];
    expect(updatedPlayer.inventory).toHaveLength(0);
    expect(result.state.items).toHaveLength(1);
    expect(result.state.items[0].templateId).toBe('health_potion');
    expect(result.state.messages.some(m => m.text.includes('Dropped'))).toBe(true);
  });

  it('use action works through simulate', () => {
    let state = createInitialState({ seed: 12345 });
    const player = Object.values(state.entities).find(e => e.type === 'crawler')!;

    state = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: {
          ...player,
          hp: 5,
          inventory: [createItem('health_potion', 'inv-item')],
          equippedWeapon: null,
          equippedArmor: null,
        },
      },
    };

    const bubble = state.bubbles[0];
    const queueResult = queueCommand(bubble, entityId(player.id), {
      action: 'use',
      itemType: 'health_potion',
      reasoning: 'Test',
    });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    const result = simulate(state);

    const updatedPlayer = result.state.entities[player.id];
    expect(updatedPlayer.inventory).toHaveLength(0);
    expect(updatedPlayer.hp).toBe(10);
    expect(result.state.messages.some(m => m.text.includes('Used'))).toBe(true);
  });

  it('equip action works through simulate', () => {
    let state = createInitialState({ seed: 12345 });
    const player = Object.values(state.entities).find(e => e.type === 'crawler')!;

    state = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: {
          ...player,
          inventory: [createItem('short_sword', 'inv-item')],
          equippedWeapon: null,
          equippedArmor: null,
        },
      },
    };

    const bubble = state.bubbles[0];
    const queueResult = queueCommand(bubble, entityId(player.id), {
      action: 'equip',
      itemType: 'short_sword',
      reasoning: 'Test',
    });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    const result = simulate(state);

    const updatedPlayer = result.state.entities[player.id];
    expect(updatedPlayer.inventory).toHaveLength(0);
    expect(updatedPlayer.equippedWeapon).not.toBeNull();
    expect(updatedPlayer.equippedWeapon!.templateId).toBe('short_sword');
    expect(result.state.messages.some(m => m.text.includes('Equipped'))).toBe(true);
  });

  it('failed pickup generates error message', () => {
    let state = createInitialState({ seed: 12345 });
    const player = Object.values(state.entities).find(e => e.type === 'crawler')!;

    state = {
      ...state,
      items: [],
      entities: {
        ...state.entities,
        [player.id]: { ...player, inventory: [], equippedWeapon: null, equippedArmor: null },
      },
    };

    const bubble = state.bubbles[0];
    const queueResult = queueCommand(bubble, entityId(player.id), { action: 'pickup', reasoning: 'Test' });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    const result = simulate(state);

    expect(result.state.messages.some(m => m.text.includes('No item'))).toBe(true);
  });
});

// --- Full Flow Integration Test ---

describe('full inventory flow', () => {
  it('pickup -> equip sequence', () => {
    let state = createInitialState({ seed: 99999 });
    const player = Object.values(state.entities).find(e => e.type === 'crawler')!;

    state = {
      ...state,
      items: [{ id: 'sword', templateId: 'short_sword', x: player.x, y: player.y, areaId: 'area-1' }],
      entities: {
        ...state.entities,
        [player.id]: { ...player, inventory: [], equippedWeapon: null, equippedArmor: null },
      },
    };

    // Step 1: Pickup
    let bubble = state.bubbles[0];
    let queueResult = queueCommand(bubble, entityId(player.id), { action: 'pickup', reasoning: 'Get weapon' });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    let simResult = simulate(state);
    state = simResult.state;

    expect(state.entities[player.id].inventory).toHaveLength(1);
    expect(state.items).toHaveLength(0);

    // Step 2: Equip
    bubble = state.bubbles[0];
    queueResult = queueCommand(bubble, entityId(player.id), {
      action: 'equip',
      itemType: 'short_sword',
      reasoning: 'Arm myself',
    });
    expect(queueResult.success).toBe(true);
    state = { ...state, bubbles: [queueResult.bubble] };

    simResult = simulate(state);
    state = simResult.state;

    expect(state.entities[player.id].inventory).toHaveLength(0);
    expect(state.entities[player.id].equippedWeapon!.templateId).toBe('short_sword');
  });
});

// --- ACTOR_NOT_FOUND Error Tests ---

describe('ACTOR_NOT_FOUND error handling', () => {
  it('processPickup returns ACTOR_NOT_FOUND when actor does not exist', () => {
    const result = processPickup(createTestState(), 'nonexistent-actor');
    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });

  it('processDrop returns ACTOR_NOT_FOUND when actor does not exist', () => {
    const result = processDrop(createTestState(), 'nonexistent-actor', 'health_potion');
    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });

  it('processUse returns ACTOR_NOT_FOUND when actor does not exist', () => {
    const result = processUse(createTestState(), 'nonexistent-actor', 'health_potion');
    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });

  it('processEquip returns ACTOR_NOT_FOUND when actor does not exist', () => {
    const result = processEquip(createTestState(), 'nonexistent-actor', 'short_sword');
    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });
});

// --- INVALID_TEMPLATE Error Tests ---

describe('INVALID_TEMPLATE error handling', () => {
  it('processUse returns INVALID_TEMPLATE when item has unknown template', () => {
    const state = createStateWithCrawler({
      inventory: [createItem('nonexistent_template', 'item-1')],
    });

    const result = processUse(state, 'crawler-1', 'nonexistent_template');

    expectFailure(result, 'INVALID_TEMPLATE', 'not found in registry');
  });

  it('processEquip returns INVALID_TEMPLATE when item has unknown template', () => {
    const state = createStateWithCrawler({
      inventory: [createItem('nonexistent_template', 'item-1')],
    });

    const result = processEquip(state, 'crawler-1', 'nonexistent_template');

    expectFailure(result, 'INVALID_TEMPLATE', 'not found in registry');
  });
});

// --- Armor Swap Test ---

describe('processEquip armor swap', () => {
  it('swaps equipped armor with inventory item (direct swap)', () => {
    const state = createStateWithCrawler({
      inventory: [createItem('chain_mail', 'item-1')],
      equippedArmor: createItem('leather_armor', 'item-2'),
    });

    const result = processEquip(state, 'crawler-1', 'chain_mail');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedArmor!.templateId).toBe('chain_mail');
      expect(crawler.inventory).toHaveLength(1);
      expect(crawler.inventory![0].templateId).toBe('leather_armor');
    });
  });
});

// --- State Immutability Tests ---

describe('state immutability', () => {
  it('processPickup does not mutate original state', () => {
    const item: ItemInstance = { ...createItem('health_potion', 'item-1'), x: 5, y: 5 };
    const state = createTestState({ items: [item] });
    const originalItems = state.items;
    const originalInventory = state.entities['crawler-1'].inventory;

    const result = processPickup(state, 'crawler-1');

    expect(state.items).toBe(originalItems);
    expect(state.items.length).toBe(1);
    expect(state.entities['crawler-1'].inventory).toBe(originalInventory);
    expectSuccess(result, (newState) => {
      expect(newState.items).not.toBe(originalItems);
    });
  });

  it('processDrop does not mutate original state', () => {
    const state = createStateWithCrawler({ inventory: [createItem('health_potion', 'item-1')] });
    const originalInventory = state.entities['crawler-1'].inventory;
    const originalItems = state.items;

    const result = processDrop(state, 'crawler-1', 'health_potion');

    expect(state.entities['crawler-1'].inventory).toBe(originalInventory);
    expect(state.entities['crawler-1'].inventory!.length).toBe(1);
    expect(state.items).toBe(originalItems);
    expectSuccess(result, (newState) => {
      expect(newState.entities['crawler-1'].inventory).not.toBe(originalInventory);
    });
  });

  it('processUse does not mutate original state', () => {
    const state = createStateWithCrawler({
      hp: 5,
      inventory: [createItem('health_potion', 'item-1')],
    });
    const originalHp = state.entities['crawler-1'].hp;
    const originalInventory = state.entities['crawler-1'].inventory;

    const result = processUse(state, 'crawler-1', 'health_potion');

    expect(state.entities['crawler-1'].hp).toBe(originalHp);
    expect(state.entities['crawler-1'].inventory).toBe(originalInventory);
    expectSuccess(result, (newState) => {
      expect(newState.entities['crawler-1'].hp).not.toBe(originalHp);
    });
  });

  it('processEquip does not mutate original state', () => {
    const state = createStateWithCrawler({ inventory: [createItem('short_sword', 'item-1')] });
    const originalInventory = state.entities['crawler-1'].inventory;
    const originalEquippedWeapon = state.entities['crawler-1'].equippedWeapon;

    const result = processEquip(state, 'crawler-1', 'short_sword');

    expect(state.entities['crawler-1'].inventory).toBe(originalInventory);
    expect(state.entities['crawler-1'].inventory!.length).toBe(1);
    expect(state.entities['crawler-1'].equippedWeapon).toBe(originalEquippedWeapon);
    expectSuccess(result, (newState) => {
      expect(newState.entities['crawler-1'].inventory).not.toBe(originalInventory);
    });
  });
});

// --- Drop Priority Tests ---

describe('processDrop priority', () => {
  it('drops from inventory before equipped when both have same itemType', () => {
    const state = createStateWithCrawler({
      inventory: [createItem('short_sword', 'inv-sword')],
      equippedWeapon: createItem('short_sword', 'equip-sword'),
    });

    const result = processDrop(state, 'crawler-1', 'short_sword');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.inventory).toHaveLength(0);
      expect(crawler.equippedWeapon!.id).toBe('equip-sword');
      expect(state.items[0].id).toBe('inv-sword');
    });
  });

  it('drops equipped weapon when not in inventory', () => {
    const state = createStateWithCrawler({
      equippedWeapon: createItem('short_sword', 'equip-sword'),
    });

    const result = processDrop(state, 'crawler-1', 'short_sword');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].equippedWeapon).toBeNull();
      expect(state.items[0].id).toBe('equip-sword');
    });
  });

  it('drops equipped armor when not in inventory or weapon', () => {
    const state = createStateWithCrawler({
      equippedArmor: createItem('leather_armor', 'equip-armor'),
    });

    const result = processDrop(state, 'crawler-1', 'leather_armor');

    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].equippedArmor).toBeNull();
      expect(state.items[0].id).toBe('equip-armor');
    });
  });
});

// --- Offhand Slot Tests (CRA-77 Task 8) ---

describe('equip offhand items', () => {
  it('equips quiver to offhand slot', () => {
    const state = createStateWithCrawler({
      inventory: [createTestItem('leather_quiver')],
    });

    const result = processEquip(state, 'crawler-1', 'leather_quiver');
    expectSuccess(result, (newState) => {
      const crawler = newState.entities['crawler-1'];
      expect(crawler.equippedOffhand?.templateId).toBe('leather_quiver');
      expect(crawler.inventory).toHaveLength(0);
    });
  });

  it('swaps offhand items correctly', () => {
    const state = createStateWithCrawler({
      inventory: [createTestItem('leather_quiver', 'quiver-2')],
      equippedOffhand: createTestItem('leather_quiver', 'quiver-1'),
    });

    const result = processEquip(state, 'crawler-1', 'leather_quiver');
    expectSuccess(result, (newState) => {
      const crawler = newState.entities['crawler-1'];
      expect(crawler.equippedOffhand?.id).toBe('quiver-2');
      expect(crawler.inventory?.[0]?.id).toBe('quiver-1');
    });
  });

  it('drops offhand items correctly', () => {
    const state = createStateWithCrawler({
      equippedOffhand: createTestItem('leather_quiver'),
    });

    const result = processDrop(state, 'crawler-1', 'leather_quiver');
    expectSuccess(result, (newState) => {
      const crawler = newState.entities['crawler-1'];
      expect(crawler.equippedOffhand).toBeNull();
      expect(newState.items).toHaveLength(1);
    });
  });
});

// --- Monster Inventory Restriction Tests ---

describe('Entity inventory field restrictions', () => {
  it('rejects monster with inventory fields', () => {
    const monster = {
      id: 'rat-1',
      type: 'monster',
      x: 3,
      y: 3,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Rat',
      attack: 1,
      defense: 0,
      speed: 120,
      monsterTypeId: 'rat',
      inventory: [],
    };
    expect(() => EntitySchema.parse(monster)).toThrow('Inventory field is only valid for crawlers');
  });

  it('accepts monster with equipped weapon', () => {
    const monster = {
      id: 'rat-1',
      type: 'monster',
      x: 3,
      y: 3,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Rat',
      attack: 1,
      defense: 0,
      speed: 120,
      monsterTypeId: 'rat',
      equippedWeapon: createItem('short_sword', 'sword-1'),
    };
    expect(() => EntitySchema.parse(monster)).not.toThrow();
  });

  it('accepts monster with equipped armor', () => {
    const monster = {
      id: 'rat-1',
      type: 'monster',
      x: 3,
      y: 3,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: 'Rat',
      attack: 1,
      defense: 0,
      speed: 120,
      monsterTypeId: 'rat',
      equippedArmor: createItem('leather_armor', 'armor-1'),
    };
    expect(() => EntitySchema.parse(monster)).not.toThrow();
  });

  it('rejects entity with hp > maxHp', () => {
    const invalidCrawler = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 15,
      maxHp: 10,
      name: 'Crawler',
      attack: 2,
      defense: 0,
      speed: 100,
      char: '@',
    };
    expect(() => EntitySchema.parse(invalidCrawler)).toThrow('HP cannot exceed maxHp');
  });

  it('accepts entity with hp equal to maxHp', () => {
    const validCrawler = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Crawler',
      attack: 2,
      defense: 0,
      speed: 100,
      char: '@',
    };
    expect(() => EntitySchema.parse(validCrawler)).not.toThrow();
  });
});

// --- Actor Not Found Tests ---

describe('ACTOR_NOT_FOUND handling', () => {
  it('processPickup rejects with ACTOR_NOT_FOUND for invalid actor', () => {
    const state = createTestState();
    const result = processPickup(state, 'nonexistent-actor');

    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });

  it('processDrop rejects with ACTOR_NOT_FOUND for invalid actor', () => {
    const state = createTestState();
    const result = processDrop(state, 'nonexistent-actor', 'health_potion');

    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });

  it('processUse rejects with ACTOR_NOT_FOUND for invalid actor', () => {
    const state = createTestState();
    const result = processUse(state, 'nonexistent-actor', 'health_potion');

    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });

  it('processEquip rejects with ACTOR_NOT_FOUND for invalid actor', () => {
    const state = createTestState();
    const result = processEquip(state, 'nonexistent-actor', 'short_sword');

    expectFailure(result, 'ACTOR_NOT_FOUND', 'nonexistent-actor');
  });
});

// --- Unknown Template Tests ---

describe('Unknown template handling', () => {
  it('processUse rejects with INVALID_TEMPLATE for unknown templateId', () => {
    const invalidItem: ItemInstance = { id: 'item-1', templateId: 'nonexistent_potion', x: 0, y: 0, areaId: 'area-1' };
    const state = createStateWithCrawler({ inventory: [invalidItem] });

    const result = processUse(state, 'crawler-1', 'nonexistent_potion');

    expectFailure(result, 'INVALID_TEMPLATE', 'nonexistent_potion');
  });

  it('processEquip rejects with INVALID_TEMPLATE for unknown templateId', () => {
    const invalidItem: ItemInstance = { id: 'item-1', templateId: 'nonexistent_sword', x: 0, y: 0, areaId: 'area-1' };
    const state = createStateWithCrawler({ inventory: [invalidItem] });

    const result = processEquip(state, 'crawler-1', 'nonexistent_sword');

    expectFailure(result, 'INVALID_TEMPLATE', 'nonexistent_sword');
  });

  it('processPickup handles unknown template gracefully (uses fallback name)', () => {
    const invalidItem: ItemInstance = { id: 'item-1', templateId: 'nonexistent_item', x: 5, y: 5, areaId: 'area-1' };
    const state = createTestState({ items: [invalidItem] });

    const result = processPickup(state, 'crawler-1');

    // Pickup should still succeed, just with fallback name
    expectSuccess(result, (state) => {
      expect(state.entities['crawler-1'].inventory).toHaveLength(1);
    });
    if (result.success) {
      expect(result.message).toContain('Unknown Item');
    }
  });

  it('processDrop handles unknown template gracefully (uses fallback name)', () => {
    const invalidItem: ItemInstance = { id: 'item-1', templateId: 'nonexistent_item', x: 0, y: 0, areaId: 'area-1' };
    const state = createStateWithCrawler({ inventory: [invalidItem] });

    const result = processDrop(state, 'crawler-1', 'nonexistent_item');

    // Drop should still succeed, just with fallback name
    expectSuccess(result, (state) => {
      expect(state.items).toHaveLength(1);
    });
    if (result.success) {
      expect(result.message).toContain('Unknown Item');
    }
  });
});

// --- Armor Swap Tests ---

describe('Armor swap', () => {
  it('swaps equipped armor with inventory item (direct swap)', () => {
    const inventoryArmor = createItem('chain_mail', 'armor-new');
    const equippedArmor = createItem('leather_armor', 'armor-old');
    const state = createStateWithCrawler({
      inventory: [inventoryArmor],
      equippedArmor: equippedArmor,
    });

    const result = processEquip(state, 'crawler-1', 'chain_mail');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      // New armor is equipped
      expect(crawler.equippedArmor?.templateId).toBe('chain_mail');
      expect(crawler.equippedArmor?.id).toBe('armor-new');
      // Old armor is now in inventory
      expect(crawler.inventory).toHaveLength(1);
      expect(crawler.inventory![0].templateId).toBe('leather_armor');
      expect(crawler.inventory![0].id).toBe('armor-old');
    });
  });

  it('swaps armor even when inventory is full', () => {
    // Fill inventory with potions, plus one chain mail to equip
    const potions = Array(9).fill(null).map((_, i) => createItem('health_potion', `potion-${i}`));
    const chainMail = createItem('chain_mail', 'armor-new');
    const equippedArmor = createItem('leather_armor', 'armor-old');
    const state = createStateWithCrawler({
      inventory: [...potions, chainMail],
      equippedArmor: equippedArmor,
    });

    const result = processEquip(state, 'crawler-1', 'chain_mail');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      // New armor is equipped
      expect(crawler.equippedArmor?.templateId).toBe('chain_mail');
      // Old armor replaced chain mail's slot in inventory
      expect(crawler.inventory).toHaveLength(10);
      expect(crawler.inventory!.some(i => i.templateId === 'leather_armor')).toBe(true);
      expect(crawler.inventory!.every(i => i.templateId !== 'chain_mail')).toBe(true);
    });
  });
});

// --- Drop Priority Tests ---

describe('Drop priority', () => {
  it('drops from inventory first when item exists in both inventory and equipped', () => {
    const inventorySword = createItem('short_sword', 'sword-inv');
    const equippedSword = createItem('short_sword', 'sword-equipped');
    const state = createStateWithCrawler({
      inventory: [inventorySword],
      equippedWeapon: equippedSword,
    });

    const result = processDrop(state, 'crawler-1', 'short_sword');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      // Inventory item was dropped
      expect(crawler.inventory).toHaveLength(0);
      // Equipped weapon remains equipped
      expect(crawler.equippedWeapon).not.toBeNull();
      expect(crawler.equippedWeapon?.id).toBe('sword-equipped');
      // Dropped item is the one from inventory
      expect(state.items[0].id).toBe('sword-inv');
    });
  });

  it('drops equipped weapon when not in inventory', () => {
    const equippedSword = createItem('short_sword', 'sword-equipped');
    const state = createStateWithCrawler({
      inventory: [],
      equippedWeapon: equippedSword,
    });

    const result = processDrop(state, 'crawler-1', 'short_sword');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedWeapon).toBeNull();
      expect(state.items[0].id).toBe('sword-equipped');
    });
  });

  it('drops equipped armor when not in inventory and no equipped weapon matches', () => {
    const equippedArmor = createItem('leather_armor', 'armor-equipped');
    const state = createStateWithCrawler({
      inventory: [],
      equippedWeapon: null,
      equippedArmor: equippedArmor,
    });

    const result = processDrop(state, 'crawler-1', 'leather_armor');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      expect(crawler.equippedArmor).toBeNull();
      expect(state.items[0].id).toBe('armor-equipped');
    });
  });
});

// --- Use at Full HP Tests ---

describe('Use consumable edge cases', () => {
  it('still consumes potion when already at full HP', () => {
    const potion = createItem('health_potion', 'potion-1');
    const state = createStateWithCrawler({
      hp: 10,
      maxHp: 10,
      inventory: [potion],
    });

    const result = processUse(state, 'crawler-1', 'health_potion');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      // HP stays at max (no overheal)
      expect(crawler.hp).toBe(10);
      // Potion is consumed
      expect(crawler.inventory).toHaveLength(0);
    });
  });

  it('caps healing at maxHp (no overheal)', () => {
    const potion = createItem('health_potion', 'potion-1');
    const state = createStateWithCrawler({
      hp: 8,
      maxHp: 10,
      inventory: [potion],
    });

    const result = processUse(state, 'crawler-1', 'health_potion');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      // HP healed but capped at maxHp (8 + 5 = 13, capped to 10)
      expect(crawler.hp).toBe(10);
    });
  });

  it('uses only one item when multiple of same type in inventory', () => {
    const potions = [
      createItem('health_potion', 'potion-1'),
      createItem('health_potion', 'potion-2'),
    ];
    const state = createStateWithCrawler({
      hp: 5,
      maxHp: 10,
      inventory: potions,
    });

    const result = processUse(state, 'crawler-1', 'health_potion');

    expectSuccess(result, (state) => {
      const crawler = state.entities['crawler-1'];
      // Only one potion consumed
      expect(crawler.inventory).toHaveLength(1);
      // Second potion remains (first one was used)
      expect(crawler.inventory![0].id).toBe('potion-2');
    });
  });
});
