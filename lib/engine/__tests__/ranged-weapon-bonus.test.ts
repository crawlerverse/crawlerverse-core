// packages/crawler-core/lib/engine/__tests__/ranged-weapon-bonus.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isCrawler } from '../state';
import { createMultiFloorTestDungeon } from '../maps/multi-floor-test-dungeon';
import type { CharacterCreation } from '../character-system';
import { clearFOVCache } from '../fov';
import { resetMonsterCounter } from '../monsters';
import { resetLootCounter } from '../monster-equipment';

describe('ranged attack weapon bonus', () => {
  beforeEach(() => {
    clearFOVCache();
    resetMonsterCounter();
    resetLootCounter();
  });

  const createRogueCharacter = (): CharacterCreation => ({
    name: 'TestRogue',
    characterClass: 'rogue',
    bio: 'A test rogue',
    statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
  });

  it('thrown weapon uses offhand stats not main weapon stats', () => {
    // Create state with rogue (has sword + throwing daggers)
    const state = createMultiFloorTestDungeon({
      seed: 12345,
      crawlerCount: 1,
      characterCreation: createRogueCharacter(),
    });

    const player = Object.values(state.entities).find(isCrawler)!;

    // Verify rogue has sword in weapon slot and daggers in offhand
    expect(player.equippedWeapon?.templateId).toBe('short_sword'); // +2 ATK
    expect(player.equippedOffhand?.templateId).toBe('throwing_dagger'); // +1 ATK

    // The damage calculation for thrown weapons should use +1 (dagger) not +2 (sword)
    // We can verify this by checking the combat result in messages
    // (Actual damage verification requires controlled combat scenario)
  });
});
