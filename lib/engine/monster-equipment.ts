/**
 * Monster Equipment Spawning
 *
 * Handles equipment assignment for monsters based on floor depth.
 * Higher floor = higher chance of equipment and better level.
 */

import type { ItemInstance, ItemTemplate, ConsumableTemplate, ItemTemplateId } from './items';
import { ITEM_TEMPLATES } from './items';
import type { MonsterTypeId } from './types';
import { MONSTER_TYPES, type MonsterLevel } from './monsters';
import { createLogger } from '../logging';

const equipmentLogger = createLogger({ module: 'monster-equipment' });

/** Drop rates by monster level */
export const LOOT_DROP_CHANCE: Record<MonsterLevel, number> = {
  1: 0.10,
  2: 0.25,
  3: 0.50,
};

/**
 * Get consumable templates up to a max tier.
 * Used for loot table drops.
 */
export function getConsumableTemplates(maxTier: number): ConsumableTemplate[] {
  return Object.values(ITEM_TEMPLATES).filter(
    (t): t is ConsumableTemplate => t.type === 'consumable' && t.tier <= maxTier
  );
}

/**
 * Configuration for monster equipment spawning.
 */
export interface MonsterEquipmentConfig {
  /** Current floor depth (1-indexed) */
  floor: number;
  /** RNG for deterministic rolls */
  rng: { getUniform: () => number };
  /** Area ID for the spawned equipment */
  areaId: string;
}

/**
 * Result of equipment roll for a monster.
 */
export interface MonsterEquipmentResult {
  weapon: ItemInstance | null;
  armor: ItemInstance | null;
}

/** Unique ID counter for monster equipment items */
let equipmentCounter = 0;

/**
 * Reset the equipment counter.
 * Useful for tests to ensure deterministic IDs.
 */
export function resetEquipmentCounter(): void {
  equipmentCounter = 0;
}

/** Unique ID counter for loot drops */
let lootCounter = 0;

/**
 * Reset the loot counter.
 * Useful for tests to ensure deterministic IDs.
 */
export function resetLootCounter(): void {
  lootCounter = 0;
}

/**
 * Roll for loot table drops when a monster dies.
 * Returns consumable items to spawn at monster's death position.
 */
export function rollLootTableDrop(
  monsterTypeId: MonsterTypeId,
  position: { x: number; y: number },
  areaId: string,
  rng: { getUniform: () => number }
): ItemInstance[] {
  const monsterType = MONSTER_TYPES[monsterTypeId];
  if (!monsterType) return [];

  const dropChance = LOOT_DROP_CHANCE[monsterType.level];

  // Roll for drop
  if (rng.getUniform() >= dropChance) {
    return [];
  }

  // Get eligible consumables (tier <= monster level)
  const candidates = getConsumableTemplates(monsterType.level);
  if (candidates.length === 0) return [];

  // Select random consumable
  const template = candidates[Math.floor(rng.getUniform() * candidates.length)];

  return [{
    id: `loot-${lootCounter++}`,
    templateId: template.id,
    x: position.x,
    y: position.y,
    areaId,
  }];
}

/**
 * Get the base chance of a monster having equipment based on its level.
 * Higher level monsters are more likely to have equipment.
 */
function getBaseEquipmentChance(level: MonsterLevel): number {
  if (level <= 1) return 0.1;  // 10% base for level 1
  if (level === 2) return 0.3;  // 30% base for level 2
  return 0.5;  // 50% base for level 3+
}

/**
 * Calculate equipment chance adjusted for floor depth.
 * Chance increases by 5% per floor, capped at base + 30%.
 */
function getEquipmentChance(level: MonsterLevel, floor: number): number {
  const base = getBaseEquipmentChance(level);
  const floorBonus = Math.min(0.3, (floor - 1) * 0.05);
  return Math.min(0.8, base + floorBonus);
}

/**
 * Get equipment templates by slot and tier.
 */
function getEquipmentBySlot(slot: 'weapon' | 'armor', maxTier: number): ItemTemplate[] {
  return Object.values(ITEM_TEMPLATES).filter(
    (t): t is ItemTemplate & { type: 'equipment' } =>
      t.type === 'equipment' && t.slot === slot && t.tier <= maxTier
  );
}

/**
 * Select a random equipment item of appropriate tier.
 */
function selectEquipment(
  slot: 'weapon' | 'armor',
  floor: number,
  rng: { getUniform: () => number }
): ItemTemplate | null {
  // Max tier increases with floor: floor 1-2 = tier 1, floor 3+ = tier 2
  const maxTier = floor >= 3 ? 2 : 1;
  const candidates = getEquipmentBySlot(slot, maxTier);

  if (candidates.length === 0) return null;

  const index = Math.floor(rng.getUniform() * candidates.length);
  return candidates[index];
}

/**
 * Create an item instance for monster equipment.
 * Note: areaId is set to empty string initially - it will be populated
 * when the equipment is dropped at a specific location.
 */
function createEquipmentInstance(
  template: ItemTemplate,
  monsterId: string,
  areaId: string
): ItemInstance {
  return {
    id: `meq-${monsterId}-${equipmentCounter++}`,
    templateId: template.id,
    x: 0,  // Position set when dropped
    y: 0,
    areaId,
  };
}

/**
 * Roll equipment for a monster based on type and floor.
 * Returns weapon and armor (either may be null).
 */
export function rollMonsterEquipment(
  monsterTypeId: MonsterTypeId,
  monsterId: string,
  config: MonsterEquipmentConfig
): MonsterEquipmentResult {
  const monsterType = MONSTER_TYPES[monsterTypeId];
  if (!monsterType) {
    return { weapon: null, armor: null };
  }

  // Only humanoid monsters can have equipment
  if (!monsterType.canHaveEquipment) {
    return { weapon: null, armor: null };
  }

  const chance = getEquipmentChance(monsterType.level, config.floor);
  const result: MonsterEquipmentResult = { weapon: null, armor: null };

  // Roll for weapon
  if (config.rng.getUniform() < chance) {
    const weaponTemplate = selectEquipment('weapon', config.floor, config.rng);
    if (weaponTemplate) {
      result.weapon = createEquipmentInstance(weaponTemplate, monsterId, config.areaId);
    }
  }

  // Roll for armor (separate roll, armor is rarer)
  if (config.rng.getUniform() < chance * 0.5) {
    const armorTemplate = selectEquipment('armor', config.floor, config.rng);
    if (armorTemplate) {
      result.armor = createEquipmentInstance(armorTemplate, monsterId, config.areaId);
    }
  }

  return result;
}

/**
 * Drop monster's equipped items as loot at its position.
 * Returns new items array with dropped items added.
 */
export function dropLoot(
  monster: { x: number; y: number; equippedWeapon?: ItemInstance | null; equippedArmor?: ItemInstance | null },
  items: readonly ItemInstance[]
): ItemInstance[] {
  const droppedItems: ItemInstance[] = [];

  if (monster.equippedWeapon) {
    droppedItems.push({
      ...monster.equippedWeapon,
      x: monster.x,
      y: monster.y,
    });
  }

  if (monster.equippedArmor) {
    droppedItems.push({
      ...monster.equippedArmor,
      x: monster.x,
      y: monster.y,
    });
  }

  return droppedItems.length > 0 ? [...items, ...droppedItems] : [...items];
}

// --- Guaranteed Equipment for Specific Monster Types ---

/**
 * Equipment that certain monster types always spawn with.
 * Used for monsters like goblin_archer that need specific loadouts.
 */
const GUARANTEED_EQUIPMENT: Partial<Record<MonsterTypeId, {
  weapon: ItemTemplateId;
  offhand?: ItemTemplateId;
}>> = {
  goblin_archer: {
    weapon: 'shortbow',
    offhand: 'leather_quiver',
  },
};

/**
 * Result of guaranteed equipment creation.
 */
export interface GuaranteedEquipmentResult {
  readonly weapon: ItemInstance | null;
  readonly offhand: ItemInstance | null;
}

/**
 * Create guaranteed equipment for a monster type.
 * Returns weapon and offhand based on GUARANTEED_EQUIPMENT mapping.
 * Quivers are initialized with full ammo from their template capacity.
 *
 * @param monsterTypeId - The type of monster
 * @param monsterId - The monster's ID (used for equipment ID generation)
 * @param areaId - The area where the equipment will be placed
 * @returns Weapon and offhand, both may be null if no guaranteed equipment
 */
export function createGuaranteedEquipment(
  monsterTypeId: MonsterTypeId,
  monsterId: string,
  areaId: string
): GuaranteedEquipmentResult {
  const config = GUARANTEED_EQUIPMENT[monsterTypeId];
  if (!config) {
    return { weapon: null, offhand: null };
  }

  let weapon: ItemInstance | null = null;
  let offhand: ItemInstance | null = null;

  // Create weapon if specified
  if (config.weapon) {
    const weaponTemplate = ITEM_TEMPLATES[config.weapon];
    if (weaponTemplate) {
      weapon = {
        id: `meq-${monsterId}-${equipmentCounter++}`,
        templateId: config.weapon,
        x: 0,
        y: 0,
        areaId,
      };
    } else {
      equipmentLogger.error(
        { monsterTypeId, configuredWeapon: config.weapon },
        'Guaranteed equipment weapon template not found - monster will spawn without weapon. Check GUARANTEED_EQUIPMENT configuration.'
      );
    }
  }

  // Create offhand if specified
  if (config.offhand) {
    const offhandTemplate = ITEM_TEMPLATES[config.offhand];
    if (offhandTemplate) {
      const offhandItem: ItemInstance = {
        id: `meq-${monsterId}-${equipmentCounter++}`,
        templateId: config.offhand,
        x: 0,
        y: 0,
        areaId,
      };

      // Initialize quivers with full ammo from template capacity
      if (offhandTemplate.type === 'equipment' && offhandTemplate.capacity) {
        offhandItem.currentAmmo = offhandTemplate.capacity;
      }

      offhand = offhandItem;
    } else {
      equipmentLogger.error(
        { monsterTypeId, configuredOffhand: config.offhand },
        'Guaranteed equipment offhand template not found - monster will spawn without offhand. Check GUARANTEED_EQUIPMENT configuration.'
      );
    }
  }

  return { weapon, offhand };
}

/**
 * Validate GUARANTEED_EQUIPMENT references valid template IDs.
 * Call this in tests or at startup to catch configuration errors early.
 * Returns an array of error messages (empty if all valid).
 */
export function validateGuaranteedEquipment(): string[] {
  const errors: string[] = [];

  for (const [monsterType, config] of Object.entries(GUARANTEED_EQUIPMENT)) {
    if (config.weapon && !ITEM_TEMPLATES[config.weapon]) {
      errors.push(
        `GUARANTEED_EQUIPMENT.${monsterType}.weapon references unknown template '${config.weapon}'`
      );
    }
    if (config.offhand && !ITEM_TEMPLATES[config.offhand]) {
      errors.push(
        `GUARANTEED_EQUIPMENT.${monsterType}.offhand references unknown template '${config.offhand}'`
      );
    }
  }

  return errors;
}
