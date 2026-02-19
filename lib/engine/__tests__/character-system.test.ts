// packages/crawler-core/lib/engine/__tests__/character-system.test.ts
import { describe, it, expect } from 'vitest';
import {
  CrawlerCharacterSystem,
  calculateFinalStats,
  calculatePointsSpent,
  createEmptyAllocation,
  createEmptyPlayStats,
  createSavedCharacter,
  isValidCharacterName,
  SAFE_NAME_PATTERN,
  CLASS_STARTING_EQUIPMENT,
  createStartingEquipment,
  validateStartingEquipment,
  type BaseStats,
  type CharacterCreation,
  type PlayStats,
  type SavedCharacter,
  type StatAllocation,
} from '../character-system';
import { ITEM_TEMPLATES } from '../items';

describe('CrawlerCharacterSystem', () => {
  it('has exactly 4 classes', () => {
    expect(CrawlerCharacterSystem.classes).toHaveLength(4);
  });

  it('each class has required fields', () => {
    for (const cls of CrawlerCharacterSystem.classes) {
      expect(cls.id).toBeTruthy();
      expect(cls.name).toBeTruthy();
      expect(cls.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(cls.personality).toBeTruthy();
    }
  });

  it('getBaseStats returns valid stats for each class', () => {
    for (const cls of CrawlerCharacterSystem.classes) {
      const stats = CrawlerCharacterSystem.getBaseStats(cls.id);
      expect(stats.hp).toBeGreaterThan(0);
      expect(stats.attack).toBeGreaterThanOrEqual(0);
      expect(stats.defense).toBeGreaterThanOrEqual(0);
      expect(stats.speed).toBeGreaterThan(0);
    }
  });

  it('class stats match design spec', () => {
    expect(CrawlerCharacterSystem.getBaseStats('warrior')).toEqual({
      hp: 14, attack: 3, defense: 2, speed: 80,
    });
    expect(CrawlerCharacterSystem.getBaseStats('rogue')).toEqual({
      hp: 6, attack: 4, defense: 0, speed: 130,
    });
    expect(CrawlerCharacterSystem.getBaseStats('mage')).toEqual({
      hp: 8, attack: 2, defense: 0, speed: 110,
    });
    expect(CrawlerCharacterSystem.getBaseStats('cleric')).toEqual({
      hp: 12, attack: 2, defense: 1, speed: 90,
    });
  });

  it('has 3 allocation points', () => {
    expect(CrawlerCharacterSystem.allocationPoints).toBe(3);
  });

  it('getNamePool returns at least 15 names per class', () => {
    for (const cls of CrawlerCharacterSystem.classes) {
      const names = CrawlerCharacterSystem.getNamePool(cls.id);
      expect(names.length).toBeGreaterThanOrEqual(15);
    }
  });

  it('getBioPlaceholders returns at least 10 placeholders per class', () => {
    for (const cls of CrawlerCharacterSystem.classes) {
      const placeholders = CrawlerCharacterSystem.getBioPlaceholders(cls.id);
      expect(placeholders.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('getLoadingMessages returns at least 15 messages', () => {
    const messages = CrawlerCharacterSystem.getLoadingMessages();
    expect(messages.length).toBeGreaterThanOrEqual(15);
  });
});

describe('calculateFinalStats', () => {
  it('adds allocation increments to base stats', () => {
    const base: BaseStats = { hp: 10, attack: 2, defense: 0, speed: 100 };
    const allocations: StatAllocation = { hp: 2, attack: 1, defense: 0, speed: 1 };

    const final = calculateFinalStats(base, allocations);

    expect(final).toEqual({
      hp: 14,      // 10 + (2 * 2)
      attack: 3,   // 2 + (1 * 1)
      defense: 0,  // 0 + (0 * 1)
      speed: 110,  // 100 + (1 * 10)
    });
  });

  it('handles max allocation (3 points into one stat)', () => {
    const base = CrawlerCharacterSystem.getBaseStats('warrior');
    const allocations: StatAllocation = { hp: 3, attack: 0, defense: 0, speed: 0 };

    const final = calculateFinalStats(base, allocations);

    expect(final.hp).toBe(20); // 14 + (3 * 2)
  });
});

describe('calculatePointsSpent', () => {
  it('sums allocation costs', () => {
    const allocations: StatAllocation = { hp: 1, attack: 1, defense: 1, speed: 0 };
    expect(calculatePointsSpent(allocations)).toBe(3);
  });

  it('returns 0 for empty allocation', () => {
    const allocations = createEmptyAllocation();
    expect(calculatePointsSpent(allocations)).toBe(0);
  });
});

describe('stat allocation constraints', () => {
  const maxPoints = CrawlerCharacterSystem.allocationPoints;

  it('cannot allocate more points than available', () => {
    // With 3 points, maxing HP uses all 3 (HP costs 1 point each)
    const allocations: StatAllocation = { hp: 3, attack: 0, defense: 0, speed: 0 };
    expect(calculatePointsSpent(allocations)).toBe(maxPoints);

    // Adding any more would exceed limit
    const overAllocated: StatAllocation = { hp: 4, attack: 0, defense: 0, speed: 0 };
    expect(calculatePointsSpent(overAllocated)).toBeGreaterThan(maxPoints);
  });

  it('cannot reduce allocation below 0', () => {
    const emptyAllocation = createEmptyAllocation();
    // All allocations start at 0
    expect(emptyAllocation.hp).toBe(0);
    expect(emptyAllocation.attack).toBe(0);
    expect(emptyAllocation.defense).toBe(0);
    expect(emptyAllocation.speed).toBe(0);
  });

  it('remaining points calculation is correct', () => {
    const allocations: StatAllocation = { hp: 1, attack: 1, defense: 0, speed: 0 };
    const spent = calculatePointsSpent(allocations);
    const remaining = maxPoints - spent;

    expect(remaining).toBe(1); // 3 - 2 = 1 point remaining
  });

  it('can allocate all points across multiple stats', () => {
    // 1 HP + 1 ATK + 1 DEF = 3 points
    const allocations: StatAllocation = { hp: 1, attack: 1, defense: 1, speed: 0 };
    expect(calculatePointsSpent(allocations)).toBe(maxPoints);
  });

  it('speed allocation costs 1 point', () => {
    const allocations: StatAllocation = { hp: 0, attack: 0, defense: 0, speed: 1 };
    expect(calculatePointsSpent(allocations)).toBe(1);
  });
});

describe('name validation', () => {
  describe('SAFE_NAME_PATTERN', () => {
    it('allows basic alphanumeric names', () => {
      expect(SAFE_NAME_PATTERN.test('TestHero')).toBe(true);
      expect(SAFE_NAME_PATTERN.test('Hero123')).toBe(true);
    });

    it('allows spaces', () => {
      expect(SAFE_NAME_PATTERN.test('Test Hero')).toBe(true);
      expect(SAFE_NAME_PATTERN.test('The Great One')).toBe(true);
    });

    it('allows hyphens and apostrophes', () => {
      expect(SAFE_NAME_PATTERN.test("O'Brien")).toBe(true);
      expect(SAFE_NAME_PATTERN.test('Mary-Jane')).toBe(true);
    });

    it('rejects script tags (XSS prevention)', () => {
      expect(SAFE_NAME_PATTERN.test('<script>alert(1)</script>')).toBe(false);
      expect(SAFE_NAME_PATTERN.test('Hero<img src=x>')).toBe(false);
    });

    it('rejects special characters that could be used for injection', () => {
      expect(SAFE_NAME_PATTERN.test('Hero;DROP TABLE')).toBe(false);
      expect(SAFE_NAME_PATTERN.test('Hero$(command)')).toBe(false);
      expect(SAFE_NAME_PATTERN.test('Hero`whoami`')).toBe(false);
      expect(SAFE_NAME_PATTERN.test('Hero\\nInjected')).toBe(false);
    });

    it('rejects quotes that could break prompts', () => {
      expect(SAFE_NAME_PATTERN.test('Hero"Ignore previous')).toBe(false);
      expect(SAFE_NAME_PATTERN.test('Hero\\nNew instruction')).toBe(false);
    });
  });

  describe('isValidCharacterName', () => {
    it('accepts valid names', () => {
      expect(isValidCharacterName('TestHero')).toBe(true);
      expect(isValidCharacterName("O'Brien")).toBe(true);
      expect(isValidCharacterName('Mary-Jane')).toBe(true);
    });

    it('rejects empty names', () => {
      expect(isValidCharacterName('')).toBe(false);
    });

    it('rejects whitespace-only names', () => {
      expect(isValidCharacterName('   ')).toBe(false);
    });

    it('rejects names over 20 characters', () => {
      expect(isValidCharacterName('A'.repeat(21))).toBe(false);
    });

    it('accepts names at exactly 20 characters', () => {
      expect(isValidCharacterName('A'.repeat(20))).toBe(true);
    });

    it('trims whitespace before validating length', () => {
      expect(isValidCharacterName('  Hero  ')).toBe(true);
    });

    it('rejects names with invalid characters', () => {
      expect(isValidCharacterName('<script>')).toBe(false);
      expect(isValidCharacterName('Hero;DROP')).toBe(false);
    });
  });
});

describe('PlayStats', () => {
  describe('createEmptyPlayStats', () => {
    it('returns zero values for all stats', () => {
      const stats = createEmptyPlayStats();
      expect(stats).toEqual({
        gamesPlayed: 0,
        deaths: 0,
        maxFloorReached: 0,
        monstersKilled: 0,
      });
    });
  });
});

describe('SavedCharacter', () => {
  describe('createSavedCharacter', () => {
    it('creates a saved character with id, timestamps, and empty play stats', () => {
      const character: CharacterCreation = {
        name: 'Grimjaw',
        characterClass: 'warrior',
        bio: 'A test warrior',
        statAllocations: { hp: 1, attack: 1, defense: 1, speed: 0 },
      };

      const saved = createSavedCharacter(character);

      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(saved.character).toEqual(character);
      expect(saved.playStats).toEqual(createEmptyPlayStats());
      expect(saved.createdAt).toBeGreaterThan(0);
      expect(saved.lastPlayedAt).toBe(saved.createdAt);
    });
  });
});

describe('CLASS_STARTING_EQUIPMENT', () => {
  it('defines equipment for all 4 classes', () => {
    const classes = CrawlerCharacterSystem.classes.map(c => c.id);
    for (const classId of classes) {
      expect(CLASS_STARTING_EQUIPMENT[classId]).toBeDefined();
    }
  });

  it('references only valid item template IDs', () => {
    for (const equipment of Object.values(CLASS_STARTING_EQUIPMENT)) {
      if (equipment.weapon !== null) {
        expect(ITEM_TEMPLATES[equipment.weapon]).toBeDefined();
      }
      if (equipment.armor !== null) {
        expect(ITEM_TEMPLATES[equipment.armor]).toBeDefined();
      }
      if (equipment.offhand !== null) {
        expect(ITEM_TEMPLATES[equipment.offhand]).toBeDefined();
      }
    }
  });

  it('rogue starts with short_sword and throwing_dagger', () => {
    const rogueEquipment = CLASS_STARTING_EQUIPMENT['rogue'];
    expect(rogueEquipment.weapon).toBe('short_sword');
    expect(rogueEquipment.offhand).toBe('throwing_dagger');
  });

  it('warrior starts with short_sword and leather_armor', () => {
    const warriorEquipment = CLASS_STARTING_EQUIPMENT['warrior'];
    expect(warriorEquipment.weapon).toBe('short_sword');
    expect(warriorEquipment.armor).toBe('leather_armor');
  });

  it('mage starts with no equipment', () => {
    const mageEquipment = CLASS_STARTING_EQUIPMENT['mage'];
    expect(mageEquipment.weapon).toBeNull();
    expect(mageEquipment.armor).toBeNull();
    expect(mageEquipment.offhand).toBeNull();
  });

  it('cleric starts with leather_armor only', () => {
    const clericEquipment = CLASS_STARTING_EQUIPMENT['cleric'];
    expect(clericEquipment.weapon).toBeNull();
    expect(clericEquipment.armor).toBe('leather_armor');
    expect(clericEquipment.offhand).toBeNull();
  });
});

describe('createStartingEquipment', () => {
  const testCrawlerId = 'crawler-1';
  const testAreaId = 'test-area-1';

  it('creates weapon ItemInstance for warrior', () => {
    const equipment = createStartingEquipment('warrior', testCrawlerId, testAreaId);

    expect(equipment.weapon).not.toBeNull();
    expect(equipment.weapon!.templateId).toBe('short_sword');
    expect(equipment.weapon!.id).toBe(`start-${testCrawlerId}-weapon`);
    expect(equipment.weapon!.areaId).toBe(testAreaId);
    expect(equipment.weapon!.x).toBe(0);
    expect(equipment.weapon!.y).toBe(0);
  });

  it('creates armor ItemInstance for warrior', () => {
    const equipment = createStartingEquipment('warrior', testCrawlerId, testAreaId);

    expect(equipment.armor).not.toBeNull();
    expect(equipment.armor!.templateId).toBe('leather_armor');
    expect(equipment.armor!.id).toBe(`start-${testCrawlerId}-armor`);
  });

  it('warrior has no offhand', () => {
    const equipment = createStartingEquipment('warrior', testCrawlerId, testAreaId);
    expect(equipment.offhand).toBeNull();
  });

  it('creates weapon and offhand for rogue', () => {
    const equipment = createStartingEquipment('rogue', testCrawlerId, testAreaId);

    expect(equipment.weapon).not.toBeNull();
    expect(equipment.weapon!.templateId).toBe('short_sword');
    expect(equipment.offhand).not.toBeNull();
    expect(equipment.offhand!.templateId).toBe('throwing_dagger');
  });

  it('rogue throwing_dagger has quantity from template', () => {
    const equipment = createStartingEquipment('rogue', testCrawlerId, testAreaId);

    expect(equipment.offhand).not.toBeNull();
    // throwing_dagger template has quantity: 5
    expect(equipment.offhand!.quantity).toBe(5);
  });

  it('mage has no equipment', () => {
    const equipment = createStartingEquipment('mage', testCrawlerId, testAreaId);

    expect(equipment.weapon).toBeNull();
    expect(equipment.armor).toBeNull();
    expect(equipment.offhand).toBeNull();
  });

  it('cleric has only armor', () => {
    const equipment = createStartingEquipment('cleric', testCrawlerId, testAreaId);

    expect(equipment.weapon).toBeNull();
    expect(equipment.armor).not.toBeNull();
    expect(equipment.armor!.templateId).toBe('leather_armor');
    expect(equipment.offhand).toBeNull();
  });
});

describe('validateStartingEquipment', () => {
  it('returns empty array when all configurations are valid', () => {
    const errors = validateStartingEquipment();
    expect(errors).toEqual([]);
  });

  it('validates weapon template references exist', () => {
    const errors = validateStartingEquipment();
    const weaponErrors = errors.filter(e => e.includes('.weapon'));
    expect(weaponErrors).toHaveLength(0);
  });

  it('validates armor template references exist', () => {
    const errors = validateStartingEquipment();
    const armorErrors = errors.filter(e => e.includes('.armor'));
    expect(armorErrors).toHaveLength(0);
  });

  it('validates offhand template references exist', () => {
    const errors = validateStartingEquipment();
    const offhandErrors = errors.filter(e => e.includes('.offhand'));
    expect(offhandErrors).toHaveLength(0);
  });
});
