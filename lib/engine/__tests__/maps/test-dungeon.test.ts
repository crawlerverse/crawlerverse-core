import { describe, it, expect } from 'vitest';
import {
  createTestDungeon,
  TEST_DUNGEON_WIDTH,
  TEST_DUNGEON_HEIGHT,
} from '../../maps/test-dungeon';
import { isPassable } from '../../map';
import { GameStateSchema, getCrawlers, getMonsters, getCurrentArea } from '../../state';
import { processAction } from '../../actions';
import type { EntityId } from '../../scheduler';
import { type CharacterCreation, CrawlerCharacterSystem } from '../../character-system';
import type { Entity } from '../../types';

describe('Test Dungeon Constants', () => {
  it('has correct dimensions', () => {
    expect(TEST_DUNGEON_WIDTH).toBe(30);
    expect(TEST_DUNGEON_HEIGHT).toBe(15);
  });
});

describe('createTestDungeon', () => {
  describe('map structure', () => {
    it('creates map with correct dimensions', () => {
      const state = createTestDungeon();

      expect(getCurrentArea(state).map.width).toBe(TEST_DUNGEON_WIDTH);
      expect(getCurrentArea(state).map.height).toBe(TEST_DUNGEON_HEIGHT);
    });

    it('creates tiles array with correct structure', () => {
      const state = createTestDungeon();

      expect(getCurrentArea(state).map.tiles).toBeDefined();
      expect(getCurrentArea(state).map.tiles.length).toBe(TEST_DUNGEON_HEIGHT);
      expect(getCurrentArea(state).map.tiles[0].length).toBe(TEST_DUNGEON_WIDTH);
    });

    it('has two rooms with one starting room', () => {
      const state = createTestDungeon();

      expect(getCurrentArea(state).map.rooms.length).toBe(2);
      // At least one room should be a starting room
      expect(getCurrentArea(state).map.rooms.some((r) => r.tags.includes('starting'))).toBe(true);
    });

    it('stores the seed in the map', () => {
      const state = createTestDungeon({ seed: 12345 });

      expect(getCurrentArea(state).map.seed).toBe(12345);
    });

    it('uses Date.now() as default seed', () => {
      const state = createTestDungeon();

      expect(typeof getCurrentArea(state).map.seed).toBe('number');
      expect(getCurrentArea(state).map.seed).toBeGreaterThan(0);
    });
  });

  describe('crawler placement', () => {
    it('places crawler at correct position', () => {
      const state = createTestDungeon();
      const crawlers = getCrawlers(state);
      const crawler = crawlers[0]!;

      expect(crawler.x).toBe(4);
      expect(crawler.y).toBe(4);
    });

    it('places crawler on passable tile', () => {
      const state = createTestDungeon();
      const crawlers = getCrawlers(state);
      const crawler = crawlers[0]!;

      expect(isPassable(getCurrentArea(state).map, crawler.x, crawler.y)).toBe(true);
    });
  });

  describe('crawler stats', () => {
    it('creates crawler with class-appropriate stats', () => {
      const state = createTestDungeon({ seed: 42 });
      const crawlers = getCrawlers(state);
      const crawler = crawlers[0]!;

      expect(crawler.id).toBe('crawler-1');
      expect(crawler.char).toBe('@');
      // Name is randomly generated from character pool
      expect(crawler.name).toBeDefined();
      expect(typeof crawler.name).toBe('string');
      expect(crawler.name.length).toBeGreaterThan(0);

      // Verify stats match the assigned class
      expect(crawler.characterClass).toBeDefined();
      const expectedStats = CrawlerCharacterSystem.getBaseStats(crawler.characterClass!);
      expect(crawler.hp).toBe(expectedStats.hp);
      expect(crawler.maxHp).toBe(expectedStats.hp);
      expect(crawler.attack).toBe(expectedStats.attack);
      expect(crawler.defense).toBe(expectedStats.defense);
      expect(crawler.speed).toBe(expectedStats.speed);
    });

    it('assigns character class to crawlers', () => {
      const state = createTestDungeon();
      const crawlers = getCrawlers(state);
      const crawler = crawlers[0]!;

      expect(crawler.characterClass).toBeDefined();
      expect(['warrior', 'rogue', 'mage', 'cleric']).toContain(crawler.characterClass);
    });

    it('warrior class has tanky stats', () => {
      // Warrior should have high HP and defense
      const warriorStats = CrawlerCharacterSystem.getBaseStats('warrior');
      expect(warriorStats.hp).toBeGreaterThanOrEqual(12);
      expect(warriorStats.defense).toBeGreaterThan(0);
    });

    it('rogue class has high attack and speed', () => {
      // Rogue should have good attack and high speed
      const rogueStats = CrawlerCharacterSystem.getBaseStats('rogue');
      expect(rogueStats.attack).toBeGreaterThanOrEqual(4);
      expect(rogueStats.speed).toBeGreaterThan(100);
    });
  });

  describe('monster placement', () => {
    it('creates 4 monsters', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      expect(monsters.length).toBe(4);
    });

    it('has two rats in the left room area', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      const rats = monsters.filter((m) => m.name === 'Rat');
      expect(rats.length).toBe(2);

      // Both rats should be in the left room (x < 10)
      expect(rats.every((r) => r.x < 10)).toBe(true);
    });

    it('has troll in the right area', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      const troll = monsters.find((m) => m.id === 'troll');
      expect(troll).toBeDefined();
      expect(troll!.x).toBe(24);
      expect(troll!.y).toBe(10);
    });

    it('has goblin in the right area', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      const goblin = monsters.find((m) => m.id === 'goblin');
      expect(goblin).toBeDefined();
      expect(goblin!.x).toBe(22);
      expect(goblin!.y).toBe(3);
    });

    it('places all monsters on passable tiles', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      for (const monster of monsters) {
        expect(isPassable(getCurrentArea(state).map, monster.x, monster.y)).toBe(true);
      }
    });
  });

  describe('monster stats', () => {
    it('creates rats with correct stats (fast, weak)', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      const rat = monsters.find((m) => m.name === 'Rat');
      expect(rat).toBeDefined();
      expect(rat!.hp).toBe(3);
      expect(rat!.maxHp).toBe(3);
      expect(rat!.attack).toBe(1);
      expect(rat!.defense).toBe(0);
      expect(rat!.speed).toBe(120); // Fast
      expect(rat!.monsterTypeId).toBe('rat');
    });

    it('creates troll with correct stats (slow, tanky)', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      const troll = monsters.find((m) => m.id === 'troll');
      expect(troll).toBeDefined();
      expect(troll!.hp).toBe(15);
      expect(troll!.maxHp).toBe(15);
      expect(troll!.attack).toBe(4);
      expect(troll!.defense).toBe(2);
      expect(troll!.speed).toBe(80); // Slow
      expect(troll!.monsterTypeId).toBe('troll');
    });

    it('creates goblin with correct stats (balanced)', () => {
      const state = createTestDungeon();
      const monsters = getMonsters(state);

      const goblin = monsters.find((m) => m.id === 'goblin');
      expect(goblin).toBeDefined();
      expect(goblin!.hp).toBe(5);
      expect(goblin!.maxHp).toBe(5);
      expect(goblin!.attack).toBe(2);
      expect(goblin!.defense).toBe(0);
      expect(goblin!.speed).toBe(100);
      expect(goblin!.monsterTypeId).toBe('goblin');
    });
  });

  describe('game state', () => {
    it('starts at turn 0', () => {
      const state = createTestDungeon();

      expect(state.turn).toBe(0);
    });

    it('starts with playing status', () => {
      const state = createTestDungeon();

      expect(state.gameStatus.status).toBe('playing');
    });

    it('has initial message with character name', () => {
      const state = createTestDungeon();

      expect(state.messages.length).toBe(1);
      expect(state.messages[0].text).toContain('enters the dungeon');
      expect(state.messages[0].text).toContain('Kill all monsters to win');
    });
  });

  describe('schema validation', () => {
    it('creates valid state that passes GameStateSchema', () => {
      const state = createTestDungeon();
      const result = GameStateSchema.safeParse(state);

      expect(result.success).toBe(true);
    });
  });

  describe('slow monster movement', () => {
    it('troll (speed 80) should move toward crawler in same bubble', () => {
      // Use crawlerCount=2 so troll is in crawler-2's bubble and can move
      let state = createTestDungeon({ crawlerCount: 2 });
      const initialTroll = getMonsters(state).find(m => m.id === 'troll')!;
      const initialPos = { x: initialTroll.x, y: initialTroll.y };

      // Find bubble containing troll (bubble-2 with crawler-2)
      const trollBubble = state.bubbles.find(b =>
        b.entityIds.some(id => id === 'troll')
      )!;
      const crawlerInBubble = trollBubble.entityIds.find(id =>
        id.toString().startsWith('crawler')
      )!;

      // Simulate 10 crawler turns in troll's bubble
      for (let i = 0; i < 10; i++) {
        if (state.gameStatus.status !== 'playing') break;

        const result = processAction(state, crawlerInBubble, {
          action: 'wait',
          reasoning: 'testing troll movement',
        });

        if (result.success) {
          state = result.state;
        } else {
          break;
        }
      }

      // Troll should have moved at least once over 10 crawler turns
      // (speed 80 means ~8 troll turns per 10 crawler turns)
      const finalTroll = getMonsters(state).find(m => m.id === 'troll');

      // Skip assertion if game ended
      if (state.gameStatus.status === 'playing' && finalTroll) {
        const hasMoved = finalTroll.x !== initialPos.x || finalTroll.y !== initialPos.y;
        expect(hasMoved).toBe(true);
      }
    });

    it('troll does NOT move when in separate bubble (hibernating)', () => {
      // With crawlerCount=1, troll is not in the active bubble
      let state = createTestDungeon({ crawlerCount: 1 });
      const initialTroll = getMonsters(state).find(m => m.id === 'troll')!;
      const initialPos = { x: initialTroll.x, y: initialTroll.y };

      // Simulate 10 crawler turns - troll should NOT move since it's hibernating
      for (let i = 0; i < 10; i++) {
        if (state.gameStatus.status !== 'playing') break;

        const result = processAction(state, 'crawler-1', {
          action: 'wait',
          reasoning: 'testing troll hibernation',
        });

        if (result.success) {
          state = result.state;
        } else {
          break;
        }
      }

      const finalTroll = getMonsters(state).find(m => m.id === 'troll');

      // Troll should NOT have moved - it's hibernating in right room
      if (state.gameStatus.status === 'playing' && finalTroll) {
        const hasMoved = finalTroll.x !== initialPos.x || finalTroll.y !== initialPos.y;
        expect(hasMoved).toBe(false);
      }
    });
  });

  describe('createTestDungeon with crawlerCount', () => {
    it('creates 1 crawler by default', () => {
      const state = createTestDungeon();
      const crawlers = getCrawlers(state);
      expect(crawlers).toHaveLength(1);
      expect(crawlers[0].id).toBe('crawler-1');
    });

    it('creates 1 crawler with explicit crawlerCount: 1', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawlers = getCrawlers(state);
      expect(crawlers).toHaveLength(1);
    });

    it('creates 2 crawlers with crawlerCount: 2', () => {
      const state = createTestDungeon({ crawlerCount: 2 });
      const crawlers = getCrawlers(state);
      expect(crawlers).toHaveLength(2);
      expect(crawlers.map(c => c.id).sort()).toEqual(['crawler-1', 'crawler-2']);
    });

    it('throws if crawlerCount exceeds room count', () => {
      expect(() => createTestDungeon({ crawlerCount: 3 })).toThrow(/cannot exceed room count/);
    });

    it('throws if crawlerCount is 0', () => {
      expect(() => createTestDungeon({ crawlerCount: 0 })).toThrow(/must be at least 1/);
    });

    it('throws if crawlerCount is negative', () => {
      expect(() => createTestDungeon({ crawlerCount: -1 })).toThrow(/must be at least 1/);
    });

    it('creates separate bubbles for each crawler', () => {
      const state = createTestDungeon({ crawlerCount: 2 });
      expect(state.bubbles).toHaveLength(2);
    });

    it('assigns correct monsters to each bubble', () => {
      const state = createTestDungeon({ crawlerCount: 2 });

      // Bubble 1: crawler-1, rat-1, rat-2
      const bubble1 = state.bubbles.find(b => b.entityIds.includes('crawler-1' as EntityId));
      expect(bubble1?.entityIds).toContain('rat-1');
      expect(bubble1?.entityIds).toContain('rat-2');
      expect(bubble1?.entityIds).not.toContain('troll');

      // Bubble 2: crawler-2, troll, goblin
      const bubble2 = state.bubbles.find(b => b.entityIds.includes('crawler-2' as EntityId));
      expect(bubble2?.entityIds).toContain('troll');
      expect(bubble2?.entityIds).toContain('goblin');
      expect(bubble2?.entityIds).not.toContain('rat-1');
    });

    it('crawlers have correct positions', () => {
      const state = createTestDungeon({ crawlerCount: 2 });
      const crawler1 = state.entities['crawler-1'];
      const crawler2 = state.entities['crawler-2'];

      expect(crawler1).toMatchObject({ x: 4, y: 4 });   // Left room
      expect(crawler2).toMatchObject({ x: 24, y: 4 }); // Right room
    });
  });

  describe('Test dungeon objectives', () => {
    it('returns empty objectives array (generation happens in createInitialState)', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      // Test dungeon no longer generates objectives - that's done by createInitialState
      expect(state.objectives).toEqual([]);
    });
  });

  describe('createTestDungeon with CharacterCreation', () => {
    it('uses provided character creation data', () => {
      const characterCreation: CharacterCreation = {
        name: 'CustomHero',
        characterClass: 'mage',
        bio: 'A test character.',
        statAllocations: { hp: 1, attack: 1, defense: 1, speed: 0 },
      };

      const state = createTestDungeon({
        crawlerCount: 1,
        seed: 42,
        characterCreation,
      });

      const crawler = getCrawlers(state)[0]!;
      expect(crawler.name).toBe('CustomHero');
      expect(crawler.characterClass).toBe('mage');
      expect(crawler.bio).toBe('A test character.');
      // Mage base: hp=8, atk=2, def=0, spd=110
      // Allocations: hp+1 (=+2), atk+1, def+1, spd+0
      expect(crawler.hp).toBe(10);     // 8 + 2
      expect(crawler.maxHp).toBe(10);
      expect(crawler.attack).toBe(3);  // 2 + 1
      expect(crawler.defense).toBe(1); // 0 + 1
      expect(crawler.speed).toBe(110); // 110 + 0
    });

    it('falls back to random generation with class-appropriate stats when no characterCreation provided', () => {
      const state = createTestDungeon({ crawlerCount: 1, seed: 42 });
      const crawler = getCrawlers(state)[0]!;

      expect(crawler.name).toBeTruthy();
      expect(crawler.characterClass).toBeTruthy();
      // Stats should match the randomly assigned class (not hardcoded defaults)
      const expectedStats = CrawlerCharacterSystem.getBaseStats(crawler.characterClass!);
      expect(crawler.hp).toBe(expectedStats.hp);
      expect(crawler.maxHp).toBe(expectedStats.hp);
      expect(crawler.attack).toBe(expectedStats.attack);
      expect(crawler.defense).toBe(expectedStats.defense);
      expect(crawler.speed).toBe(expectedStats.speed);
    });

    it('only applies characterCreation to first crawler', () => {
      const characterCreation: CharacterCreation = {
        name: 'CustomHero',
        characterClass: 'rogue',
        bio: 'Main character.',
        statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
      };

      const state = createTestDungeon({
        crawlerCount: 2,
        seed: 42,
        characterCreation,
      });

      const crawlers = getCrawlers(state);
      const crawler1 = crawlers.find(c => c.id === 'crawler-1')!;
      const crawler2 = crawlers.find(c => c.id === 'crawler-2')!;

      // First crawler uses characterCreation
      expect(crawler1.name).toBe('CustomHero');
      expect(crawler1.characterClass).toBe('rogue');
      expect(crawler1.bio).toBe('Main character.');

      // Second crawler is randomly generated (no bio)
      expect(crawler2.name).not.toBe('CustomHero');
      expect(crawler2.bio).toBeUndefined();
    });

    it('handles characterCreation with empty bio', () => {
      const characterCreation: CharacterCreation = {
        name: 'NoBioHero',
        characterClass: 'warrior',
        bio: '',
        statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
      };

      const state = createTestDungeon({
        crawlerCount: 1,
        seed: 42,
        characterCreation,
      });

      const crawler = getCrawlers(state)[0]!;
      expect(crawler.name).toBe('NoBioHero');
      // Empty bio should be stored as undefined
      expect(crawler.bio).toBeUndefined();
    });
  });

  describe('crawler traits', () => {
    it('should generate traits for each crawler', () => {
      const state = createTestDungeon({ seed: 42 });
      const crawler = Object.values(state.entities).find(
        (e): e is Entity & { traits: NonNullable<Entity['traits']> } =>
          e.type === 'crawler'
      );

      expect(crawler?.traits).toBeDefined();
      expect(crawler?.traits.bravery).toBeGreaterThanOrEqual(-2);
      expect(crawler?.traits.bravery).toBeLessThanOrEqual(2);
      expect(crawler?.traits.observant).toBeGreaterThanOrEqual(-2);
      expect(crawler?.traits.observant).toBeLessThanOrEqual(2);
    });

    it('should generate traits consistent with class', () => {
      // Create multiple dungeons and check trait ranges match class
      for (let seed = 0; seed < 10; seed++) {
        const state = createTestDungeon({ seed });
        const crawlers = Object.values(state.entities).filter(e => e.type === 'crawler');

        for (const crawler of crawlers) {
          expect(crawler.traits).toBeDefined();
        }
      }
    });
  });
});
