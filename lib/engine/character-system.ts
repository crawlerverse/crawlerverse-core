/**
 * Character System
 *
 * Defines the abstraction layer for character creation systems.
 * The default CrawlerCharacterSystem provides the 4-class system
 * with stat templates, name pools, and bio placeholders.
 */

import type { CharacterClass } from './types';
import type { ItemInstance, EquipmentTemplate, ItemTemplateId } from './items';
import { ITEM_TEMPLATES, isEquipmentTemplate } from './items';
import { createLogger } from '../logging';

const characterLogger = createLogger({ module: 'character-system' });

// --- Type Definitions ---

export interface BaseStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

/**
 * Points allocated to each stat during character creation.
 * Actual stat increments per point are defined in CharacterSystem.allocationCosts.
 */
export interface StatAllocation {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

export interface CharacterClassDefinition {
  readonly id: CharacterClass;
  readonly name: string;
  readonly color: string;
  readonly personality: string;
  readonly tagline: string;
}

export interface CharacterCreation {
  readonly name: string;
  readonly characterClass: CharacterClass;
  readonly bio: string;
  readonly statAllocations: StatAllocation;
}

// --- Play Stats Types ---

export interface PlayStats {
  readonly gamesPlayed: number;
  readonly deaths: number;
  readonly maxFloorReached: number;
  readonly monstersKilled: number;
}

export interface SavedCharacter {
  readonly id: string;
  readonly character: CharacterCreation;
  readonly playStats: PlayStats;
  readonly createdAt: number;
  readonly lastPlayedAt: number;
}

export interface AllocationCost {
  readonly cost: number;
  readonly increment: number;
}

export interface CharacterSystem {
  readonly classes: readonly CharacterClassDefinition[];
  readonly allocationPoints: number;
  readonly allocationCosts: Record<keyof BaseStats, AllocationCost>;
  getBaseStats(classId: CharacterClass): BaseStats;
  getNamePool(classId: CharacterClass): readonly string[];
  getBioPlaceholders(classId: CharacterClass): readonly string[];
  getClassColor(classId: CharacterClass): string;
  getLoadingMessages(): readonly string[];
}

// --- Name Validation ---

/**
 * Safe character pattern for names.
 * Allows alphanumeric, spaces, hyphens, and apostrophes.
 * Prevents prompt injection and XSS attacks.
 */
export const SAFE_NAME_PATTERN = /^[a-zA-Z0-9 '\-]+$/;

/**
 * Validate a character name for safe characters.
 * Returns true if name is valid, false otherwise.
 */
export function isValidCharacterName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 20 && SAFE_NAME_PATTERN.test(trimmed);
}

// --- Class Definitions ---

const CLASS_DEFINITIONS: readonly CharacterClassDefinition[] = [
  {
    id: 'warrior',
    name: 'Warrior',
    color: '#DC2626',
    personality: 'Aggressive and direct. Loves combat. Speaks with bravado and confidence.',
    tagline: '"I stand and fight" - Tanky brawler, slower but hits hard',
  },
  {
    id: 'rogue',
    name: 'Rogue',
    color: '#9333EA',
    personality: 'Calculating and opportunistic. Values self-preservation. Sarcastic and cunning.',
    tagline: '"Strike fast, don\'t get hit" - Glass cannon, fastest in the dungeon',
  },
  {
    id: 'mage',
    name: 'Mage',
    color: '#2563EB',
    personality: 'Intellectual and slightly arrogant. Analyzes situations coolly and methodically.',
    tagline: '"Kite and position" - Fragile but mobile, master of positioning',
  },
  {
    id: 'cleric',
    name: 'Cleric',
    color: '#EAB308',
    personality: 'Cautious and thoughtful. Speaks with quiet determination and compassion.',
    tagline: '"Outlast them" - Durable and steady, built to survive',
  },
];

// --- Base Stats per Class ---

const CLASS_BASE_STATS: Record<CharacterClass, BaseStats> = {
  warrior: { hp: 14, attack: 3, defense: 2, speed: 80 },
  rogue: { hp: 6, attack: 4, defense: 0, speed: 130 },
  mage: { hp: 8, attack: 2, defense: 0, speed: 110 },
  cleric: { hp: 12, attack: 2, defense: 1, speed: 90 },
};

// --- Name Pools (15-20 per class) ---

const CLASS_NAME_POOLS: Record<CharacterClass, readonly string[]> = {
  warrior: [
    'Grimjaw', 'Ironhide', 'Bloodaxe', 'Thornhelm', 'Stormbreaker',
    'Ragnar', 'Bjorn', 'Kira', 'Valka', 'Gorath', 'Carl',
    'Brunhilde', 'Wulfgar', 'Sigrid', 'Magnus', 'Theron',
    'Steelfist', 'Warhammer', 'Bonecrusher', 'Drakebane',
    'Bob', 'Bautista', 'Katia',
  ],
  rogue: [
    'Shadowstep', 'Whisper', 'Nyx', 'Silvertongue', 'Vex',
    'Crow', 'Dagger', 'Shade', 'Slick', 'Phantom',
    'Nimble', 'Sable', 'Quickfingers', 'Echo', 'Raven',
    'Nightshade', 'Viper', 'Hush', 'Glint', 'Steve Rowland',
  ],
  mage: [
    'Eldrath', 'Mystral', 'Zephyrus', 'Alaric', 'Seraphine',
    'Mordecai', 'Lyra', 'Ashwin', 'Thorne', 'Celeste', 'Donut',
    'Isolde', 'Grimoire', 'Astrid', 'Fenwick', 'Lucian',
    'Frostweave', 'Sparkwright', 'Runekeeper', 'Voidwalker',
    'Prepotente', 'Pony',
  ],
  cleric: [
    'Aldric', 'Serenity', 'Beacon', 'Tomas', 'Miriam',
    'Solace', 'Cedric', 'Helena', 'Dawnbringer', 'Patience',
    'Faithful', 'Mercy', 'Tobias', 'Lumina', 'Devout',
    'Lighttouch', 'Radiance', 'Hopebringer', 'Blessing',
    'Boris', 'Billy Bob', 'Karen',
  ],
};

// --- Bio Placeholders (10-15 per class) ---

const CLASS_BIO_PLACEHOLDERS: Record<CharacterClass, readonly string[]> = {
  warrior: [
    'A former blacksmith seeking redemption for a past mistake...',
    'Once led a mercenary band until betrayal scattered them...',
    'Raised in the fighting pits, freedom is still a new concept...',
    'The last survivor of a village raid, hunting for answers...',
    'A disgraced knight seeking to reclaim lost honor...',
    'Battle is the only language they ever learned to speak...',
    'The scars tell stories they refuse to share with words...',
    'Sworn to protect the weak after failing someone dear...',
    'A veteran of too many wars, searching for one worth fighting...',
    'The weapon feels more natural than an empty hand...',
  ],
  rogue: [
    'They say curiosity killed the cat. You\'re here to prove them right...',
    'A former noble who discovered the thrill of the shadows...',
    'Every lock is a puzzle, every treasure a challenge...',
    'Trust is a currency they can\'t afford to spend...',
    'The guild cast them out. Now they work alone...',
    'Information is power, and power is everything...',
    'A childhood on the streets taught lessons no school could...',
    'Some call it stealing. They call it redistribution...',
    'The best lies contain a grain of truth...',
    'Silence and patience are the deadliest weapons...',
  ],
  mage: [
    'Exiled from the mage academy for asking too many questions...',
    'The voices started after the ritual. They haven\'t stopped since...',
    'Knowledge is the only treasure worth seeking in these depths...',
    'A prodigy who grew bored with conventional magic...',
    'The ancient texts speak of power hidden in darkness...',
    'Arcane theory is elegant. Application is... messier...',
    'They called the experiment a failure. They were wrong...',
    'Magic flows through them like water through a cracked dam...',
    'The answers lie deeper than any scholar dared to look...',
    'Power without wisdom is dangerous. Fortunately, they have both...',
  ],
  cleric: [
    'Once a palace guard, now hunting the creature that took everything...',
    'Faith wavers but never breaks, even in the darkest depths...',
    'The divine speaks in whispers that grow harder to hear...',
    'Healing hands have seen too much suffering to stay idle...',
    'A pilgrimage that started in devotion became something else...',
    'The temple burned. The faith didn\'t...',
    'Compassion is a choice made harder by what lurks below...',
    'They pray not for themselves, but for those they will meet...',
    'Light persists even where shadows seem absolute...',
    'Doubt and faith are closer companions than most admit...',
  ],
};

// --- Loading Messages (Sims-style) ---

const LOADING_MESSAGES: readonly string[] = [
  'Reticulating threads of fate...',
  'Consulting the elder scrolls...',
  'Discombobulating destiny matrices...',
  'Polishing backstory crystals...',
  'Summoning narrative spirits...',
  'Untangling the yarn of existence...',
  'Fermenting dramatic tension...',
  'Calibrating tragic backstory levels...',
  'Shuffling the deck of sorrows...',
  'Consulting your mother\'s disappointment...',
  'Invoking the muse of mediocre origins...',
  'Defragmenting childhood trauma...',
  'Optimizing regret algorithms...',
  'Brewing existential dread...',
  'Aligning protagonist chakras...',
  'Generating plausible motivations...',
  'Rendering emotional baggage...',
  'Compiling character flaws...',
  'Initializing dramatic irony...',
  'Loading unresolved issues...',
];

// --- Allocation Costs ---

const ALLOCATION_COSTS: Record<keyof BaseStats, AllocationCost> = {
  hp: { cost: 1, increment: 2 },       // 1 point = +2 HP
  attack: { cost: 1, increment: 1 },   // 1 point = +1 ATK
  defense: { cost: 1, increment: 1 },  // 1 point = +1 DEF
  speed: { cost: 1, increment: 10 },   // 1 point = +10 SPD
};

// --- CrawlerCharacterSystem Implementation ---

export const CrawlerCharacterSystem: CharacterSystem = {
  classes: CLASS_DEFINITIONS,
  allocationPoints: 3,
  allocationCosts: ALLOCATION_COSTS,

  getBaseStats(classId: CharacterClass): BaseStats {
    return CLASS_BASE_STATS[classId];
  },

  getNamePool(classId: CharacterClass): readonly string[] {
    return CLASS_NAME_POOLS[classId];
  },

  getBioPlaceholders(classId: CharacterClass): readonly string[] {
    return CLASS_BIO_PLACEHOLDERS[classId];
  },

  getClassColor(classId: CharacterClass): string {
    const cls = CLASS_DEFINITIONS.find(c => c.id === classId);
    return cls?.color ?? '#FFFFFF';
  },

  getLoadingMessages(): readonly string[] {
    return LOADING_MESSAGES;
  },
};

// --- Helper Functions ---

/**
 * Calculate final stats from base stats and allocations.
 */
export function calculateFinalStats(
  baseStats: BaseStats,
  allocations: StatAllocation,
  costs: Record<keyof BaseStats, AllocationCost> = ALLOCATION_COSTS
): BaseStats {
  return {
    hp: baseStats.hp + allocations.hp * costs.hp.increment,
    attack: baseStats.attack + allocations.attack * costs.attack.increment,
    defense: baseStats.defense + allocations.defense * costs.defense.increment,
    speed: baseStats.speed + allocations.speed * costs.speed.increment,
  };
}

/**
 * Calculate total points spent from allocations.
 */
export function calculatePointsSpent(
  allocations: StatAllocation,
  costs: Record<keyof BaseStats, AllocationCost> = ALLOCATION_COSTS
): number {
  return (
    allocations.hp * costs.hp.cost +
    allocations.attack * costs.attack.cost +
    allocations.defense * costs.defense.cost +
    allocations.speed * costs.speed.cost
  );
}

/**
 * Create empty stat allocation.
 */
export function createEmptyAllocation(): StatAllocation {
  return { hp: 0, attack: 0, defense: 0, speed: 0 };
}

// --- PlayStats Factory Functions ---

/**
 * Create empty play stats for a new character.
 */
export function createEmptyPlayStats(): PlayStats {
  return {
    gamesPlayed: 0,
    deaths: 0,
    maxFloorReached: 0,
    monstersKilled: 0,
  };
}

/**
 * Create a saved character from a character creation.
 */
export function createSavedCharacter(character: CharacterCreation): SavedCharacter {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    character,
    playStats: createEmptyPlayStats(),
    createdAt: now,
    lastPlayedAt: now,
  };
}

// --- Starting Equipment ---

export interface StartingEquipment {
  readonly weapon: ItemTemplateId | null;
  readonly armor: ItemTemplateId | null;
  readonly offhand: ItemTemplateId | null;
}

/**
 * Starting equipment for each character class.
 * Equipment template IDs must exist in ITEM_TEMPLATES.
 */
export const CLASS_STARTING_EQUIPMENT: Record<CharacterClass, StartingEquipment> = {
  warrior: { weapon: 'short_sword', armor: 'leather_armor', offhand: null },
  rogue: { weapon: 'short_sword', armor: null, offhand: 'throwing_dagger' },
  mage: { weapon: null, armor: null, offhand: null },
  cleric: { weapon: null, armor: 'leather_armor', offhand: null },
};

/**
 * Create equipped item instances for a character class.
 * Returns ItemInstance objects ready to assign to entity slots.
 */
export function createStartingEquipment(
  characterClass: CharacterClass,
  crawlerId: string,
  areaId: string
): {
  weapon: ItemInstance | null;
  armor: ItemInstance | null;
  offhand: ItemInstance | null;
} {
  const config = CLASS_STARTING_EQUIPMENT[characterClass];

  const createItemForSlot = (
    templateId: string | null,
    slot: 'weapon' | 'armor' | 'offhand'
  ): ItemInstance | null => {
    if (templateId === null) {
      return null;
    }

    const template = ITEM_TEMPLATES[templateId];
    if (!template) {
      characterLogger.error(
        { characterClass, slot, templateId },
        'Starting equipment template not found - character will spawn without this equipment. Check CLASS_STARTING_EQUIPMENT configuration.'
      );
      return null;
    }
    if (!isEquipmentTemplate(template)) {
      characterLogger.error(
        { characterClass, slot, templateId, actualType: template.type },
        'Starting equipment template is not equipment type - character will spawn without this equipment. Check CLASS_STARTING_EQUIPMENT configuration.'
      );
      return null;
    }

    const item: ItemInstance = {
      id: `start-${crawlerId}-${slot}`,
      templateId,
      x: 0,
      y: 0,
      areaId,
    };

    // Copy quantity for thrown weapons (stackable items)
    if (template.stackable && template.quantity !== undefined) {
      return { ...item, quantity: template.quantity };
    }

    // Copy currentAmmo for quivers
    if (template.currentAmmo !== undefined) {
      return { ...item, currentAmmo: template.currentAmmo };
    }

    return item;
  };

  return {
    weapon: createItemForSlot(config.weapon, 'weapon'),
    armor: createItemForSlot(config.armor, 'armor'),
    offhand: createItemForSlot(config.offhand, 'offhand'),
  };
}

/**
 * Validate CLASS_STARTING_EQUIPMENT references valid template IDs.
 * Call this in tests or at startup to catch configuration errors early.
 * Returns an array of error messages (empty if all valid).
 */
export function validateStartingEquipment(): string[] {
  const errors: string[] = [];

  for (const [charClass, config] of Object.entries(CLASS_STARTING_EQUIPMENT)) {
    for (const [slot, templateId] of Object.entries(config)) {
      if (templateId === null) continue;

      const template = ITEM_TEMPLATES[templateId];
      if (!template) {
        errors.push(
          `CLASS_STARTING_EQUIPMENT.${charClass}.${slot} references unknown template '${templateId}'`
        );
      } else if (!isEquipmentTemplate(template)) {
        errors.push(
          `CLASS_STARTING_EQUIPMENT.${charClass}.${slot} references non-equipment template '${templateId}' (type: ${template.type})`
        );
      }
    }
  }

  return errors;
}
