import { describe, it, expect } from 'vitest';
import { createMultiFloorTestDungeon } from '../../maps/multi-floor-test-dungeon';
import { getCrawlers, getMonsters, getCurrentArea } from '../../state';

describe('createMultiFloorTestDungeon', () => {
  it('creates a 5-floor zone', () => {
    const state = createMultiFloorTestDungeon();
    expect(Object.keys(state.zone.areas)).toHaveLength(5);
  });

  it('starts player on floor 1', () => {
    const state = createMultiFloorTestDungeon();
    expect(state.currentAreaId).toBe('area-1');

    const area = getCurrentArea(state);
    expect(area.metadata.name).toBe('Dungeon Level 1');
  });

  it('spawns crawler in entry area', () => {
    const state = createMultiFloorTestDungeon();
    const crawlers = getCrawlers(state);

    expect(crawlers.length).toBe(1);
    expect(crawlers[0].areaId).toBe('area-1');
  });

  it('spawns monsters across all floors', () => {
    const state = createMultiFloorTestDungeon();
    const monsters = getMonsters(state);

    // Should have monsters (exact count depends on generation)
    expect(monsters.length).toBeGreaterThan(0);
  });

  it('sets dangerLevel 1-5 for each floor', () => {
    const state = createMultiFloorTestDungeon();

    for (let i = 1; i <= 5; i++) {
      const area = state.zone.areas[`area-${i}`];
      expect(area.metadata.dangerLevel).toBe(i);
    }
  });

  it('has portals connecting floors', () => {
    const state = createMultiFloorTestDungeon();

    // Area 1 should have a down portal to area-2
    const area1 = state.zone.areas['area-1'];
    const tiles = area1.map.tiles.flat();
    const downPortal = tiles.find(
      (tile): tile is Extract<typeof tile, { type: 'portal' }> =>
        tile.type === 'portal' && tile.direction === 'down'
    );

    expect(downPortal).toBeDefined();
    expect(downPortal?.connection?.targetAreaId).toBe('area-2');
  });

  it('supports custom crawler count', () => {
    const state = createMultiFloorTestDungeon({ crawlerCount: 2 });
    const crawlers = getCrawlers(state);

    expect(crawlers.length).toBe(2);
  });

  it('supports character creation for first crawler', () => {
    const state = createMultiFloorTestDungeon({
      characterCreation: {
        name: 'TestHero',
        characterClass: 'warrior',
        bio: 'A test hero',
        statAllocations: { hp: 1, attack: 1, defense: 1, speed: 0 }, // 3 points total
      },
    });

    const crawlers = getCrawlers(state);
    expect(crawlers[0].name).toBe('TestHero');
    expect(crawlers[0].characterClass).toBe('warrior');
  });

  it('creates clear zone objective', () => {
    const state = createMultiFloorTestDungeon();

    const primaryObjective = state.objectives.find(o => o.priority === 'primary');
    expect(primaryObjective).toBeDefined();
    expect(primaryObjective?.type).toBe('clear_zone');
  });
});
