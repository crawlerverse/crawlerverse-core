// packages/crawler-core/lib/engine/__tests__/starting-equipment.test.ts
import { describe, it, expect } from 'vitest';
import { createMultiFloorTestDungeon } from '../maps/multi-floor-test-dungeon';
import type { CharacterCreation } from '../character-system';
import { isCrawler } from '../state';

describe('starting equipment integration', () => {
  const createCharacterCreation = (characterClass: 'warrior' | 'rogue' | 'mage' | 'cleric'): CharacterCreation => ({
    name: 'TestCrawler',
    characterClass,
    bio: 'A test character',
    statAllocations: { hp: 1, attack: 1, defense: 1, speed: 0 },
  });

  it('rogue starts with short_sword weapon and throwing_dagger offhand (quantity 5)', () => {
    const game = createMultiFloorTestDungeon({
      seed: 12345,
      crawlerCount: 1,
      characterCreation: createCharacterCreation('rogue'),
    });

    const crawler = Object.values(game.entities).find(isCrawler);
    expect(crawler).toBeDefined();

    // Check weapon
    expect(crawler!.equippedWeapon).toBeDefined();
    expect(crawler!.equippedWeapon!.templateId).toBe('short_sword');

    // Check offhand (throwing_dagger with quantity)
    expect(crawler!.equippedOffhand).toBeDefined();
    expect(crawler!.equippedOffhand!.templateId).toBe('throwing_dagger');
    expect(crawler!.equippedOffhand!.quantity).toBe(5);
  });

  it('warrior starts with short_sword weapon and leather_armor', () => {
    const game = createMultiFloorTestDungeon({
      seed: 12345,
      crawlerCount: 1,
      characterCreation: createCharacterCreation('warrior'),
    });

    const crawler = Object.values(game.entities).find(isCrawler);
    expect(crawler).toBeDefined();

    // Check weapon
    expect(crawler!.equippedWeapon).toBeDefined();
    expect(crawler!.equippedWeapon!.templateId).toBe('short_sword');

    // Check armor
    expect(crawler!.equippedArmor).toBeDefined();
    expect(crawler!.equippedArmor!.templateId).toBe('leather_armor');

    // No offhand
    expect(crawler!.equippedOffhand).toBeUndefined();
  });

  it('mage starts with no equipment', () => {
    const game = createMultiFloorTestDungeon({
      seed: 12345,
      crawlerCount: 1,
      characterCreation: createCharacterCreation('mage'),
    });

    const crawler = Object.values(game.entities).find(isCrawler);
    expect(crawler).toBeDefined();

    expect(crawler!.equippedWeapon).toBeUndefined();
    expect(crawler!.equippedArmor).toBeUndefined();
    expect(crawler!.equippedOffhand).toBeUndefined();
  });

  it('cleric starts with leather_armor only', () => {
    const game = createMultiFloorTestDungeon({
      seed: 12345,
      crawlerCount: 1,
      characterCreation: createCharacterCreation('cleric'),
    });

    const crawler = Object.values(game.entities).find(isCrawler);
    expect(crawler).toBeDefined();

    // No weapon
    expect(crawler!.equippedWeapon).toBeUndefined();

    // Check armor
    expect(crawler!.equippedArmor).toBeDefined();
    expect(crawler!.equippedArmor!.templateId).toBe('leather_armor');

    // No offhand
    expect(crawler!.equippedOffhand).toBeUndefined();
  });
});
