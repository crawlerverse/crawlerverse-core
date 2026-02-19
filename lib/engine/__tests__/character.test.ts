import { describe, it, expect } from 'vitest';
import {
  CHARACTER_CLASSES,
  CLASS_PERSONALITIES,
  CLASS_TRAIT_DEFAULTS,
  getRandomCharacterClass,
  getRandomName,
  generateCharacterIdentity,
  getPersonalityDescription,
  formatCharacterTitle,
  generateTraits,
  type CharacterClass,
} from '../character';
import { createRNG } from '../rng';
import { EntitySchema } from '../types';

describe('CHARACTER_CLASSES', () => {
  it('contains all four character classes', () => {
    expect(CHARACTER_CLASSES).toEqual(['warrior', 'rogue', 'mage', 'cleric']);
  });

  it('has expected length', () => {
    expect(CHARACTER_CLASSES.length).toBe(4);
  });
});

describe('CLASS_PERSONALITIES', () => {
  it('has a personality description for each class', () => {
    for (const characterClass of CHARACTER_CLASSES) {
      expect(CLASS_PERSONALITIES[characterClass]).toBeDefined();
      expect(typeof CLASS_PERSONALITIES[characterClass]).toBe('string');
      expect(CLASS_PERSONALITIES[characterClass].length).toBeGreaterThan(0);
    }
  });

  it('warrior personality mentions combat', () => {
    expect(CLASS_PERSONALITIES.warrior.toLowerCase()).toContain('combat');
  });

  it('rogue personality mentions self-preservation', () => {
    expect(CLASS_PERSONALITIES.rogue.toLowerCase()).toContain('self-preservation');
  });

  it('mage personality mentions intellectual', () => {
    expect(CLASS_PERSONALITIES.mage.toLowerCase()).toContain('intellectual');
  });

  it('cleric personality mentions cautious', () => {
    expect(CLASS_PERSONALITIES.cleric.toLowerCase()).toContain('cautious');
  });
});

describe('getRandomCharacterClass', () => {
  it('returns a valid character class', () => {
    const rng = createRNG(12345);
    const result = getRandomCharacterClass(rng);
    expect(CHARACTER_CLASSES).toContain(result);
  });

  it('returns different classes over multiple calls', () => {
    const rng = createRNG(12345);
    const results = new Set<CharacterClass>();
    // Run 100 times - should get at least 2 different classes
    for (let i = 0; i < 100; i++) {
      results.add(getRandomCharacterClass(rng));
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic with same seed', () => {
    const rng1 = createRNG(42);
    const rng2 = createRNG(42);
    const results1 = Array.from({ length: 10 }, () => getRandomCharacterClass(rng1));
    const results2 = Array.from({ length: 10 }, () => getRandomCharacterClass(rng2));
    expect(results1).toEqual(results2);
  });
});

describe('getRandomName', () => {
  it('returns a string for each character class', () => {
    const rng = createRNG(12345);
    for (const characterClass of CHARACTER_CLASSES) {
      const name = getRandomName(characterClass, rng);
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('returns different names over multiple calls', () => {
    const rng = createRNG(12345);
    const results = new Set<string>();
    // Run 50 times for warrior - should get at least 2 different names
    for (let i = 0; i < 50; i++) {
      results.add(getRandomName('warrior', rng));
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic with same seed', () => {
    const rng1 = createRNG(42);
    const rng2 = createRNG(42);
    const results1 = Array.from({ length: 10 }, () => getRandomName('warrior', rng1));
    const results2 = Array.from({ length: 10 }, () => getRandomName('warrior', rng2));
    expect(results1).toEqual(results2);
  });
});

describe('generateCharacterIdentity', () => {
  it('returns an object with characterClass and name', () => {
    const rng = createRNG(12345);
    const identity = generateCharacterIdentity(rng);
    expect(identity).toHaveProperty('characterClass');
    expect(identity).toHaveProperty('name');
    expect(CHARACTER_CLASSES).toContain(identity.characterClass);
    expect(typeof identity.name).toBe('string');
  });

  it('generates different identities over multiple calls', () => {
    const rng = createRNG(12345);
    const identities = [];
    for (let i = 0; i < 20; i++) {
      identities.push(generateCharacterIdentity(rng));
    }
    // Check we got some variety in classes or names
    const uniqueClasses = new Set(identities.map(id => id.characterClass));
    const uniqueNames = new Set(identities.map(id => id.name));
    expect(uniqueClasses.size + uniqueNames.size).toBeGreaterThan(2);
  });

  it('is deterministic with same seed', () => {
    const rng1 = createRNG(42);
    const rng2 = createRNG(42);
    const identity1 = generateCharacterIdentity(rng1);
    const identity2 = generateCharacterIdentity(rng2);
    expect(identity1).toEqual(identity2);
  });
});

describe('getPersonalityDescription', () => {
  it('returns the correct personality for each class', () => {
    for (const characterClass of CHARACTER_CLASSES) {
      const description = getPersonalityDescription(characterClass);
      expect(description).toBe(CLASS_PERSONALITIES[characterClass]);
    }
  });
});

describe('formatCharacterTitle', () => {
  it('formats warrior title correctly', () => {
    expect(formatCharacterTitle('Grimjaw', 'warrior')).toBe('Grimjaw the Warrior');
  });

  it('formats rogue title correctly', () => {
    expect(formatCharacterTitle('Shadowstep', 'rogue')).toBe('Shadowstep the Rogue');
  });

  it('formats mage title correctly', () => {
    expect(formatCharacterTitle('Ashwind', 'mage')).toBe('Ashwind the Mage');
  });

  it('formats cleric title correctly', () => {
    expect(formatCharacterTitle('Dawnbringer', 'cleric')).toBe('Dawnbringer the Cleric');
  });

  it('capitalizes the class name', () => {
    const title = formatCharacterTitle('Test', 'warrior');
    expect(title).toContain('Warrior');
    expect(title).not.toContain('warrior');
  });
});

describe('Entity bio field', () => {
  it('accepts crawler entity with bio', () => {
    const crawler = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      characterClass: 'warrior',
      bio: 'A former blacksmith seeking redemption.',
    };

    const result = EntitySchema.safeParse(crawler);
    expect(result.success).toBe(true);
  });

  it('accepts crawler entity without bio', () => {
    const crawler = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      characterClass: 'warrior',
    };

    const result = EntitySchema.safeParse(crawler);
    expect(result.success).toBe(true);
  });

  it('rejects bio longer than 250 characters', () => {
    const longBio = 'x'.repeat(251);
    const crawler = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5,
      y: 5,
      areaId: 'area-1',
      hp: 10,
      maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      characterClass: 'warrior',
      bio: longBio,
    };

    const result = EntitySchema.safeParse(crawler);
    expect(result.success).toBe(false);
  });
});

describe('perception traits', () => {
  describe('CLASS_TRAIT_DEFAULTS', () => {
    it('should have traits for all classes', () => {
      expect(CLASS_TRAIT_DEFAULTS.warrior).toEqual({ bravery: 2, observant: -1 });
      expect(CLASS_TRAIT_DEFAULTS.rogue).toEqual({ bravery: 0, observant: 2 });
      expect(CLASS_TRAIT_DEFAULTS.mage).toEqual({ bravery: -1, observant: 1 });
      expect(CLASS_TRAIT_DEFAULTS.cleric).toEqual({ bravery: 1, observant: 0 });
    });
  });

  describe('generateTraits', () => {
    it('should generate traits with variance from class defaults', () => {
      const rng = createRNG(42);
      const traits = generateTraits('warrior', rng);

      // Warrior default: bravery 2, observant -1
      // Variance is ±1, so bravery should be 1-3 (clamped to 2), observant -2 to 0
      expect(traits.bravery).toBeGreaterThanOrEqual(1);
      expect(traits.bravery).toBeLessThanOrEqual(2); // clamped at 2
      expect(traits.observant).toBeGreaterThanOrEqual(-2);
      expect(traits.observant).toBeLessThanOrEqual(0);
    });

    it('should clamp traits to valid range', () => {
      // Test with many seeds to ensure clamping works
      for (let seed = 0; seed < 100; seed++) {
        const rng = createRNG(seed);
        const traits = generateTraits('warrior', rng);
        expect(traits.bravery).toBeGreaterThanOrEqual(-2);
        expect(traits.bravery).toBeLessThanOrEqual(2);
        expect(traits.observant).toBeGreaterThanOrEqual(-2);
        expect(traits.observant).toBeLessThanOrEqual(2);
      }
    });

    it('should produce deterministic results with same seed', () => {
      const traits1 = generateTraits('rogue', createRNG(123));
      const traits2 = generateTraits('rogue', createRNG(123));
      expect(traits1).toEqual(traits2);
    });
  });
});
