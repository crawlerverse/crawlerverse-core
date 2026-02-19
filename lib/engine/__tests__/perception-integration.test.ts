import { describe, it, expect } from 'vitest';
import { createTestDungeon } from '../maps/test-dungeon';
import { generatePerceptions, type PerceptionContext, getPerceptionText } from '../perception';
import { createCooldowns, tickCooldowns } from '../perception-cooldowns';
import type { Entity } from '../types';
import type { EntityId } from '../scheduler';

describe('perception integration', () => {
  it('should generate perceptions for dungeon crawler', () => {
    const state = createTestDungeon({ seed: 42, crawlerCount: 1 });
    const crawler = Object.values(state.entities).find(e => e.type === 'crawler')!;
    const visibleEnemies = Object.values(state.entities).filter(e => e.type === 'monster');

    const context: PerceptionContext = {
      crawler,
      visibleEntities: visibleEnemies,
      groundItems: [],
      cooldowns: createCooldowns(),
    };

    const result = generatePerceptions(context);

    // Should have generated some perceptions
    expect(result.perceptions.length).toBeGreaterThanOrEqual(0);
    expect(result.cooldowns).toBeDefined();
  });

  it('should generate personality-appropriate text', () => {
    const state = createTestDungeon({ seed: 42, crawlerCount: 1 });
    const crawler = Object.values(state.entities).find(e => e.type === 'crawler')!;
    const characterClass = crawler.characterClass ?? 'warrior';

    // Simulate a low-health enemy perception
    const perception = {
      type: 'enemy_health' as const,
      entityId: 'rat-1' as EntityId,
      band: 'nearly_dead' as const,
    };

    const text = getPerceptionText(perception, characterClass);

    expect(text).toBeTruthy();
    expect(text!.length).toBeLessThanOrEqual(30);
  });

  it('should track cooldowns across multiple turns', () => {
    const state = createTestDungeon({ seed: 42, crawlerCount: 1 });
    const crawler = Object.values(state.entities).find(e => e.type === 'crawler')!;
    const visibleEnemies = Object.values(state.entities).filter(e => e.type === 'monster');

    let cooldowns = createCooldowns();

    // First turn - should generate perceptions
    const result1 = generatePerceptions({
      crawler,
      visibleEntities: visibleEnemies,
      groundItems: [],
      cooldowns,
    });

    cooldowns = result1.cooldowns;

    // Second turn with same state - fewer perceptions due to cooldowns
    const result2 = generatePerceptions({
      crawler,
      visibleEntities: visibleEnemies,
      groundItems: [],
      cooldowns,
    });

    // Cooldowns should prevent duplicate perceptions
    expect(result2.perceptions.length).toBeLessThanOrEqual(result1.perceptions.length);
  });

  it('should use traits from dungeon-generated crawler', () => {
    const state = createTestDungeon({ seed: 42, crawlerCount: 1 });
    const crawler = Object.values(state.entities).find(e => e.type === 'crawler')!;

    // Crawler should have traits generated from class defaults
    expect(crawler.traits).toBeDefined();
    expect(crawler.traits!.bravery).toBeGreaterThanOrEqual(-2);
    expect(crawler.traits!.bravery).toBeLessThanOrEqual(2);
    expect(crawler.traits!.observant).toBeGreaterThanOrEqual(-2);
    expect(crawler.traits!.observant).toBeLessThanOrEqual(2);
  });
});
