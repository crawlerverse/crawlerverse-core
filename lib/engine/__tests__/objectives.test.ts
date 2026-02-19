import { describe, it, expect } from 'vitest';
import {
  ObjectiveSchema,
  createReachObjective,
  createKillObjective,
  createFindExitObjective,
  createClearZoneObjective,
  checkObjectiveCompletion,
  isObjectiveRelevantToCrawler,
  updateObjectives,
  updateObjectivesForCrawlers,
} from '../objective';
import { crawlerIdFromIndex } from '../crawler-id';
import { createTestDungeon } from '../maps/test-dungeon';
import { getEntity, getCurrentArea, type GameState } from '../state';

// Helper to create a state with a portal at a specific position
function addPortalToState(state: GameState, portalX: number, portalY: number): GameState {
  const currentArea = getCurrentArea(state);
  const newTiles = currentArea.map.tiles.map((row, y) =>
    row.map((tile, x) =>
      x === portalX && y === portalY ? { type: 'portal' as const, direction: 'down' as const } : tile
    )
  );
  return {
    ...state,
    zone: {
      ...state.zone,
      areas: {
        ...state.zone.areas,
        [state.currentAreaId]: {
          ...currentArea,
          map: {
            ...currentArea.map,
            tiles: newTiles,
          },
        },
      },
    },
  };
}

describe('Objective Types', () => {
  describe('createReachObjective', () => {
    it('creates a valid reach objective', () => {
      const obj = createReachObjective({
        id: 'obj-1',
        description: 'Reach the east corridor',
        target: { x: 10, y: 5 },
        assignee: crawlerIdFromIndex(1),
      });

      expect(obj.type).toBe('reach');
      expect(obj.target).toEqual({ x: 10, y: 5 });
      expect(obj.status).toBe('active');
      expect(obj.priority).toBe('secondary');
      expect(obj.assignee).toBe('crawler-1');
    });
  });

  describe('createKillObjective', () => {
    it('creates a valid kill objective', () => {
      const obj = createKillObjective({
        id: 'obj-2',
        description: 'Defeat the Troll',
        target: { entityId: 'troll-1' },
        assignee: null,
        priority: 'primary',
      });

      expect(obj.type).toBe('kill');
      expect(obj.target).toEqual({ entityId: 'troll-1' });
      expect(obj.priority).toBe('primary');
      expect(obj.assignee).toBeNull();
    });
  });

  describe('createFindExitObjective', () => {
    it('creates a valid find_exit objective with null target', () => {
      const obj = createFindExitObjective({
        id: 'obj-4',
        description: 'Find the exit',
        assignee: null,
      });

      expect(obj.type).toBe('find_exit');
      expect(obj.target).toBeNull();
      expect(obj.status).toBe('active');
      expect(obj.priority).toBe('primary'); // Default for find_exit
    });
  });

  describe('createClearZoneObjective', () => {
    it('creates a valid clear_zone objective', () => {
      const obj = createClearZoneObjective({
        id: 'obj-3',
        description: 'Clear the dungeon',
        target: { x1: 0, y1: 0, x2: 29, y2: 14 },
        assignee: null,
        priority: 'primary',
      });

      expect(obj.type).toBe('clear_zone');
      expect(obj.target).toEqual({ x1: 0, y1: 0, x2: 29, y2: 14 });
    });

    it('throws error for invalid bounds (x1 > x2)', () => {
      expect(() =>
        createClearZoneObjective({
          id: 'bad',
          description: 'Invalid',
          target: { x1: 10, y1: 0, x2: 5, y2: 14 },
          assignee: null,
        })
      ).toThrow('Invalid ClearZone bounds');
    });

    it('throws error for invalid bounds (y1 > y2)', () => {
      expect(() =>
        createClearZoneObjective({
          id: 'bad',
          description: 'Invalid',
          target: { x1: 0, y1: 10, x2: 5, y2: 5 },
          assignee: null,
        })
      ).toThrow('Invalid ClearZone bounds');
    });

    it('accepts equal bounds (single tile zone)', () => {
      const obj = createClearZoneObjective({
        id: 'single',
        description: 'Single tile',
        target: { x1: 5, y1: 5, x2: 5, y2: 5 },
        assignee: null,
      });
      expect(obj.target).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
    });
  });

  describe('ObjectiveSchema', () => {
    it('validates a well-formed reach objective', () => {
      const obj = createReachObjective({
        id: 'test',
        description: 'Test',
        target: { x: 5, y: 5 },
        assignee: null,
      });

      const result = ObjectiveSchema.safeParse(obj);
      expect(result.success).toBe(true);
    });

    it('validates a well-formed kill objective', () => {
      const obj = createKillObjective({
        id: 'test',
        description: 'Test',
        target: { entityId: 'monster-1' },
        assignee: null,
      });

      const result = ObjectiveSchema.safeParse(obj);
      expect(result.success).toBe(true);
    });

    it('validates a well-formed find_exit objective', () => {
      const obj = createFindExitObjective({
        id: 'test',
        description: 'Test',
        assignee: null,
      });

      const result = ObjectiveSchema.safeParse(obj);
      expect(result.success).toBe(true);
    });

    it('validates a well-formed clear_zone objective', () => {
      const obj = createClearZoneObjective({
        id: 'test',
        description: 'Test',
        target: { x1: 0, y1: 0, x2: 10, y2: 10 },
        assignee: null,
      });

      const result = ObjectiveSchema.safeParse(obj);
      expect(result.success).toBe(true);
    });

    it('rejects objective with invalid type', () => {
      const invalid = {
        id: 'test',
        type: 'unknown',
        description: 'Test',
        target: null,
        status: 'active',
        priority: 'primary',
        assignee: null,
      };
      const result = ObjectiveSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects objective with invalid status', () => {
      const invalid = {
        id: 'test',
        type: 'reach',
        description: 'Test',
        target: { x: 5, y: 5 },
        status: 'pending', // Invalid
        priority: 'primary',
        assignee: null,
      };
      const result = ObjectiveSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects reach objective with wrong target type (kill target)', () => {
      const invalid = {
        id: 'test',
        type: 'reach',
        description: 'Test',
        target: { entityId: 'monster-1' }, // Wrong target for reach
        status: 'active',
        priority: 'primary',
        assignee: null,
      };
      const result = ObjectiveSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects clear_zone objective with inverted bounds', () => {
      const invalid = {
        id: 'test',
        type: 'clear_zone',
        description: 'Test',
        target: { x1: 10, y1: 0, x2: 5, y2: 10 }, // x1 > x2
        status: 'active',
        priority: 'primary',
        assignee: null,
      };
      const result = ObjectiveSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

describe('Completion Checking', () => {
  describe('isObjectiveRelevantToCrawler', () => {
    it('returns true for global objectives (assignee: null)', () => {
      const obj = createClearZoneObjective({
        id: 'test',
        description: 'Clear all',
        target: { x1: 0, y1: 0, x2: 10, y2: 10 },
        assignee: null,
      });

      expect(isObjectiveRelevantToCrawler(obj, crawlerIdFromIndex(1))).toBe(true);
      expect(isObjectiveRelevantToCrawler(obj, crawlerIdFromIndex(2))).toBe(true);
    });

    it('returns true only for assigned crawler', () => {
      const obj = createReachObjective({
        id: 'test',
        description: 'Scout',
        target: { x: 5, y: 5 },
        assignee: crawlerIdFromIndex(1),
      });

      expect(isObjectiveRelevantToCrawler(obj, crawlerIdFromIndex(1))).toBe(true);
      expect(isObjectiveRelevantToCrawler(obj, crawlerIdFromIndex(2))).toBe(false);
    });
  });

  describe('checkObjectiveCompletion - reach', () => {
    it('completes when crawler at target', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawler = getEntity(state, 'crawler-1')!;

      const obj = createReachObjective({
        id: 'test',
        description: 'Reach here',
        target: { x: crawler.x, y: crawler.y },
        assignee: crawlerIdFromIndex(1),
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(true);
    });

    it('does not complete when crawler elsewhere', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createReachObjective({
        id: 'test',
        description: 'Reach far',
        target: { x: 25, y: 10 },
        assignee: crawlerIdFromIndex(1),
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(false);
    });

    it('returns false for non-existent crawler', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createReachObjective({
        id: 'test',
        description: 'Reach',
        target: { x: 5, y: 5 },
        assignee: crawlerIdFromIndex(99), // Non-existent
      });

      // This crawler doesn't exist in state, so it can't complete
      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(99))).toBe(false);
    });
  });

  describe('checkObjectiveCompletion - kill', () => {
    it('completes when target entity does not exist', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createKillObjective({
        id: 'test',
        description: 'Kill ghost',
        target: { entityId: 'nonexistent-entity' },
        assignee: null,
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(true);
    });

    it('does not complete when target alive', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createKillObjective({
        id: 'test',
        description: 'Kill troll',
        target: { entityId: 'troll' },
        assignee: null,
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(false);
    });

    it('completes when target has exactly 0 HP', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      // Modify troll to have 0 HP but still exist in state
      const stateWithDeadTroll = {
        ...state,
        entities: {
          ...state.entities,
          troll: { ...state.entities['troll'], hp: 0 },
        },
      };

      const obj = createKillObjective({
        id: 'test',
        description: 'Kill troll',
        target: { entityId: 'troll' },
        assignee: null,
      });

      expect(checkObjectiveCompletion(obj, stateWithDeadTroll, crawlerIdFromIndex(1))).toBe(true);
    });

    it('completes when target has negative HP', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const stateWithDeadTroll = {
        ...state,
        entities: {
          ...state.entities,
          troll: { ...state.entities['troll'], hp: -5 },
        },
      };

      const obj = createKillObjective({
        id: 'test',
        description: 'Kill troll',
        target: { entityId: 'troll' },
        assignee: null,
      });

      expect(checkObjectiveCompletion(obj, stateWithDeadTroll, crawlerIdFromIndex(1))).toBe(true);
    });
  });

  describe('checkObjectiveCompletion - find_exit', () => {
    it('completes when crawler is adjacent to portal (cardinal)', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawler = getEntity(state, 'crawler-1')!;

      // Place portal one tile east of crawler
      const stateWithPortal = addPortalToState(state, crawler.x + 1, crawler.y);

      const obj = createFindExitObjective({
        id: 'test',
        description: 'Find the exit',
        assignee: crawlerIdFromIndex(1),
      });

      expect(checkObjectiveCompletion(obj, stateWithPortal, crawlerIdFromIndex(1))).toBe(true);
    });

    it('completes when crawler is adjacent to portal (diagonal)', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawler = getEntity(state, 'crawler-1')!;

      // Place portal diagonally (northeast) from crawler
      const stateWithPortal = addPortalToState(state, crawler.x + 1, crawler.y - 1);

      const obj = createFindExitObjective({
        id: 'test',
        description: 'Find the exit',
        assignee: crawlerIdFromIndex(1),
      });

      expect(checkObjectiveCompletion(obj, stateWithPortal, crawlerIdFromIndex(1))).toBe(true);
    });

    it('does not complete when crawler is not adjacent to portal', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawler = getEntity(state, 'crawler-1')!;

      // Place portal far from crawler (2 tiles away)
      const stateWithPortal = addPortalToState(state, crawler.x + 3, crawler.y);

      const obj = createFindExitObjective({
        id: 'test',
        description: 'Find the exit',
        assignee: crawlerIdFromIndex(1),
      });

      expect(checkObjectiveCompletion(obj, stateWithPortal, crawlerIdFromIndex(1))).toBe(false);
    });

    it('does not complete when map has no portal', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createFindExitObjective({
        id: 'test',
        description: 'Find the exit',
        assignee: crawlerIdFromIndex(1),
      });

      // Test dungeon has no portal by default
      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(false);
    });

    it('returns false for non-existent crawler', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createFindExitObjective({
        id: 'test',
        description: 'Find the exit',
        assignee: crawlerIdFromIndex(99),
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(99))).toBe(false);
    });

    it('checks all 8 directions for adjacency', () => {
      const state = createTestDungeon({ crawlerCount: 1 });
      const crawler = getEntity(state, 'crawler-1')!;

      // Test all 8 directions
      const directions = [
        { dx: -1, dy: -1 }, // northwest
        { dx: 0, dy: -1 },  // north
        { dx: 1, dy: -1 },  // northeast
        { dx: -1, dy: 0 },  // west
        { dx: 1, dy: 0 },   // east
        { dx: -1, dy: 1 },  // southwest
        { dx: 0, dy: 1 },   // south
        { dx: 1, dy: 1 },   // southeast
      ];

      const obj = createFindExitObjective({
        id: 'test',
        description: 'Find the exit',
        assignee: crawlerIdFromIndex(1),
      });

      for (const { dx, dy } of directions) {
        const stateWithStairs = addPortalToState(state, crawler.x + dx, crawler.y + dy);
        expect(checkObjectiveCompletion(obj, stateWithStairs, crawlerIdFromIndex(1))).toBe(true);
      }
    });
  });

  describe('checkObjectiveCompletion - clear_zone', () => {
    it('completes when no monsters in bounds', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createClearZoneObjective({
        id: 'test',
        description: 'Clear empty zone',
        target: { x1: 1, y1: 1, x2: 2, y2: 2 },
        assignee: null,
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(true);
    });

    it('does not complete when monsters remain', () => {
      const state = createTestDungeon({ crawlerCount: 1 });

      const obj = createClearZoneObjective({
        id: 'test',
        description: 'Clear all',
        target: { x1: 0, y1: 0, x2: 29, y2: 14 },
        assignee: null,
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(1))).toBe(false);
    });

    it('ignores objectives assigned to other crawlers', () => {
      const state = createTestDungeon({ crawlerCount: 2 });
      const crawler1 = getEntity(state, 'crawler-1')!;

      const obj = createReachObjective({
        id: 'test',
        description: 'Reach',
        target: { x: crawler1.x, y: crawler1.y },
        assignee: crawlerIdFromIndex(1),
      });

      expect(checkObjectiveCompletion(obj, state, crawlerIdFromIndex(2))).toBe(false);
    });
  });
});

describe('updateObjectives', () => {
  it('marks completed objectives as completed', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    const crawler = getEntity(state, 'crawler-1')!;

    const stateWithObjectives = {
      ...state,
      objectives: [
        createReachObjective({
          id: 'obj-1',
          description: 'Already here',
          target: { x: crawler.x, y: crawler.y },
          assignee: crawlerIdFromIndex(1),
        }),
      ],
    };

    const updated = updateObjectives(stateWithObjectives, crawlerIdFromIndex(1));
    expect(updated.objectives[0].status).toBe('completed');
  });

  it('leaves incomplete objectives as active', () => {
    const state = createTestDungeon({ crawlerCount: 1 });

    const stateWithObjectives = {
      ...state,
      objectives: [
        createReachObjective({
          id: 'obj-1',
          description: 'Far away',
          target: { x: 25, y: 10 },
          assignee: crawlerIdFromIndex(1),
        }),
      ],
    };

    const updated = updateObjectives(stateWithObjectives, crawlerIdFromIndex(1));
    expect(updated.objectives[0].status).toBe('active');
  });

  it('does not modify already completed objectives', () => {
    const state = createTestDungeon({ crawlerCount: 1 });

    const stateWithObjectives = {
      ...state,
      objectives: [
        {
          ...createReachObjective({
            id: 'obj-1',
            description: 'Done',
            target: { x: 0, y: 0 },
            assignee: crawlerIdFromIndex(1),
          }),
          status: 'completed' as const,
        },
      ],
    };

    const updated = updateObjectives(stateWithObjectives, crawlerIdFromIndex(1));
    expect(updated.objectives[0].status).toBe('completed');
  });

  it('returns same state reference when no changes', () => {
    const state = createTestDungeon({ crawlerCount: 1 });

    const stateWithObjectives = {
      ...state,
      objectives: [
        createReachObjective({
          id: 'obj-1',
          description: 'Far away',
          target: { x: 25, y: 10 },
          assignee: crawlerIdFromIndex(1),
        }),
      ],
    };

    const updated = updateObjectives(stateWithObjectives, crawlerIdFromIndex(1));
    expect(updated).toBe(stateWithObjectives); // Same reference
  });

  it('updates multiple objectives correctly', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    const crawler = getEntity(state, 'crawler-1')!;

    const stateWithObjectives = {
      ...state,
      objectives: [
        // Should complete (crawler at position)
        createReachObjective({
          id: 'obj-1',
          description: 'Here',
          target: { x: crawler.x, y: crawler.y },
          assignee: crawlerIdFromIndex(1),
        }),
        // Should stay active (far away)
        createReachObjective({
          id: 'obj-2',
          description: 'Far',
          target: { x: 25, y: 10 },
          assignee: crawlerIdFromIndex(1),
        }),
        // Already completed
        {
          ...createReachObjective({
            id: 'obj-3',
            description: 'Done',
            target: { x: 0, y: 0 },
            assignee: crawlerIdFromIndex(1),
          }),
          status: 'completed' as const,
        },
      ],
    };

    const updated = updateObjectives(stateWithObjectives, crawlerIdFromIndex(1));
    expect(updated.objectives[0].status).toBe('completed');
    expect(updated.objectives[1].status).toBe('active');
    expect(updated.objectives[2].status).toBe('completed');
  });
});

describe('updateObjectivesForCrawlers', () => {
  it('updates objectives for multiple crawlers in one pass', () => {
    const state = createTestDungeon({ crawlerCount: 2 });
    const crawler1 = getEntity(state, 'crawler-1')!;
    const crawler2 = getEntity(state, 'crawler-2')!;

    const stateWithObjectives = {
      ...state,
      objectives: [
        createReachObjective({
          id: 'obj-1',
          description: 'Crawler 1 here',
          target: { x: crawler1.x, y: crawler1.y },
          assignee: crawlerIdFromIndex(1),
        }),
        createReachObjective({
          id: 'obj-2',
          description: 'Crawler 2 here',
          target: { x: crawler2.x, y: crawler2.y },
          assignee: crawlerIdFromIndex(2),
        }),
      ],
    };

    const updated = updateObjectivesForCrawlers(stateWithObjectives, [
      crawlerIdFromIndex(1),
      crawlerIdFromIndex(2),
    ]);

    expect(updated.objectives[0].status).toBe('completed');
    expect(updated.objectives[1].status).toBe('completed');
  });

  it('returns same state reference when no crawlers provided', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    const updated = updateObjectivesForCrawlers(state, []);
    expect(updated).toBe(state);
  });

  it('returns same state reference when no objectives exist', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    const stateNoObjectives = { ...state, objectives: [] };
    const updated = updateObjectivesForCrawlers(stateNoObjectives, [crawlerIdFromIndex(1)]);
    expect(updated).toBe(stateNoObjectives);
  });

  it('completes global objective when any crawler satisfies it', () => {
    const state = createTestDungeon({ crawlerCount: 2 });
    const crawler1 = getEntity(state, 'crawler-1')!;

    const stateWithObjectives = {
      ...state,
      objectives: [
        createReachObjective({
          id: 'obj-global',
          description: 'Anyone reach here',
          target: { x: crawler1.x, y: crawler1.y },
          assignee: null, // Global objective
        }),
      ],
    };

    const updated = updateObjectivesForCrawlers(stateWithObjectives, [
      crawlerIdFromIndex(1),
      crawlerIdFromIndex(2),
    ]);

    expect(updated.objectives[0].status).toBe('completed');
  });
});
