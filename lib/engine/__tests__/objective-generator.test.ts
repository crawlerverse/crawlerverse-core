import { describe, it, expect } from 'vitest';
import {
  hasObjectiveTag,
  hasReachTag,
  hasClearTag,
  findNearestCrawler,
  generateObjectives,
} from '../objective-generator';
import { createTestDungeon } from '../maps/test-dungeon';
import type { Room } from '../map';

describe('objective-generator helpers', () => {
  describe('hasObjectiveTag', () => {
    it('returns true for monster with objective_target tag', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const troll = state.entities['troll'];
      expect(hasObjectiveTag(troll, state)).toBe(true);
    });

    it('returns false for monster without objective tags', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const rat = state.entities['rat-1'];
      expect(hasObjectiveTag(rat, state)).toBe(false);
    });

    it('returns false for crawler entities', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawler = state.entities['crawler-1'];
      expect(hasObjectiveTag(crawler, state)).toBe(false);
    });
  });

  describe('hasReachTag', () => {
    it('returns true for room with treasure tag', () => {
      const room: Room = {
        x: 0, y: 0, width: 10, height: 10,
        center: { x: 5, y: 5 },
        tags: ['treasure'],
      };
      expect(hasReachTag(room)).toBe(true);
    });

    it('returns false for room with only starting tag', () => {
      const room: Room = {
        x: 0, y: 0, width: 10, height: 10,
        center: { x: 5, y: 5 },
        tags: ['starting'],
      };
      expect(hasReachTag(room)).toBe(false);
    });
  });

  describe('hasClearTag', () => {
    it('returns true for room with arena tag', () => {
      const room: Room = {
        x: 0, y: 0, width: 10, height: 10,
        center: { x: 5, y: 5 },
        tags: ['arena'],
      };
      expect(hasClearTag(room)).toBe(true);
    });

    it('returns false for room without clear tags', () => {
      const room: Room = {
        x: 0, y: 0, width: 10, height: 10,
        center: { x: 5, y: 5 },
        tags: ['treasure'],
      };
      expect(hasClearTag(room)).toBe(false);
    });
  });

  describe('findNearestCrawler', () => {
    it('returns the only crawler in single-crawler game', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const result = findNearestCrawler(state, { x: 20, y: 10 });
      expect(result).toBe('crawler-1');
    });

    it('returns nearest crawler by Manhattan distance', () => {
      const state = createTestDungeon({ crawlerCount: 2 });
      // crawler-1 at (4, 4), crawler-2 at (24, 4)
      // Target at (20, 5) is closer to crawler-2
      const result = findNearestCrawler(state, { x: 20, y: 5 });
      expect(result).toBe('crawler-2');
    });
  });
});

describe('generateObjectives', () => {
  describe('primary objective', () => {
    it('creates clear_zone for victoryType: clear_all', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const objectives = generateObjectives(state, { victoryType: 'clear_all' });
      const primary = objectives.find(o => o.priority === 'primary');
      expect(primary).toBeDefined();
      expect(primary?.type).toBe('clear_zone');
      expect(primary?.assignee).toBeNull();
    });

    it('creates find_exit for victoryType: find_exit', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const objectives = generateObjectives(state, { victoryType: 'find_exit' });
      const primary = objectives.find(o => o.priority === 'primary');
      expect(primary).toBeDefined();
      expect(primary?.type).toBe('find_exit');
    });
  });

  describe('kill objectives', () => {
    it('creates kill objective for troll (tagged objective_target)', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const objectives = generateObjectives(state, { victoryType: 'clear_all' });
      const killObjs = objectives.filter(o => o.type === 'kill');
      expect(killObjs.length).toBeGreaterThan(0);
      const trollObj = killObjs.find(o =>
        o.type === 'kill' && o.target.entityId === 'troll'
      );
      expect(trollObj).toBeDefined();
    });

    it('does not create kill objective for untagged monsters', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const objectives = generateObjectives(state, { victoryType: 'clear_all' });
      const killObjs = objectives.filter(o => o.type === 'kill');
      // Only troll should have a kill objective
      const ratObj = killObjs.find(o =>
        o.type === 'kill' && o.target.entityId.startsWith('rat')
      );
      expect(ratObj).toBeUndefined();
    });
  });

  describe('assignment', () => {
    it('assigns kill objectives to nearest crawler', () => {
      const state = createTestDungeon({ crawlerCount: 2 });
      const objectives = generateObjectives(state, { victoryType: 'clear_all' });
      const trollObj = objectives.find(o =>
        o.type === 'kill' && o.target.entityId === 'troll'
      );
      // Troll is at (24, 10), crawler-2 is at (24, 4) - closer than crawler-1 at (4, 4)
      expect(trollObj?.assignee).toBe('crawler-2');
    });
  });
});
