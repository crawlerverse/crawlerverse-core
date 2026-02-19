import { describe, it, expect, afterEach } from 'vitest';
import {
  createBubble,
  shouldMerge,
  distance,
  entitiesWithinRadius,
  mergeBubbles,
  wakeNearbyEntities,
  hibernateBubble,
  splitBubble,
  reconcileBubbles,
  checkTimeout,
  queueCommand,
  dequeueCommand,
  enableBubbleDebugLogging,
  resetBubbleWarnLog,
  bubbleId,
  TimeoutConfigSchema,
  BubbleSchema,
  DEFAULT_COMMAND_QUEUE_SIZE,
  type Bubble,
  type TypedEntity,
} from '../bubble';
import { advanceScheduler, entityId, type EntityId } from '../scheduler';
import { type Entity, type GameState, type Action } from '../state';
import { parseAsciiMap, type DungeonMap } from '../map';
import { DEFAULT_AREA_ID } from '../state';
import { createTestDungeon } from '../maps/test-dungeon';
import { createTestZone } from './test-helpers';

// Helper to create a test map for GameState
function createTestMap(width = 10, height = 10): DungeonMap {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    if (y === 0 || y === height - 1) {
      rows.push('#'.repeat(width));
    } else {
      rows.push('#' + '.'.repeat(width - 2) + '#');
    }
  }
  const { tiles } = parseAsciiMap(rows.join('\n'));
  return {
    width,
    height,
    tiles,
    rooms: [{ x: 1, y: 1, width: width - 2, height: height - 2, center: { x: Math.floor(width / 2), y: Math.floor(height / 2) }, tags: ['starting'] }],
    seed: 0,
  };
}

// Helper to create entity speed with branded EntityId
const entity = (id: string, speed: number) => ({ id: entityId(id), speed });

// Helper to create typed entity for shouldMerge tests
const typedEntity = (id: string, x: number, y: number, type: 'crawler' | 'monster'): TypedEntity => ({
  id: entityId(id),
  x,
  y,
  type,
});

// Reset logging after each test to avoid cross-test pollution
afterEach(() => {
  resetBubbleWarnLog();
});

describe('bubbleId', () => {
  it('creates branded BubbleId from valid string', () => {
    const id = bubbleId('test-bubble');
    expect(id).toBe('test-bubble');
  });

  it('throws error for empty string', () => {
    expect(() => bubbleId('')).toThrow('BubbleId cannot be empty');
  });

  it('throws error for whitespace-only string', () => {
    expect(() => bubbleId('   ')).toThrow('BubbleId cannot be empty');
  });

  it('accepts strings with embedded whitespace', () => {
    const id = bubbleId('bubble 1');
    expect(id).toBe('bubble 1');
  });
});

describe('Zod schemas', () => {
  describe('TimeoutConfigSchema', () => {
    it('validates correct timeout config', () => {
      const result = TimeoutConfigSchema.safeParse({ warningMs: 3000, autoWaitMs: 5000 });
      expect(result.success).toBe(true);
    });

    it('rejects when warningMs equals autoWaitMs', () => {
      const result = TimeoutConfigSchema.safeParse({ warningMs: 5000, autoWaitMs: 5000 });
      expect(result.success).toBe(false);
    });

    it('rejects when warningMs exceeds autoWaitMs', () => {
      const result = TimeoutConfigSchema.safeParse({ warningMs: 10000, autoWaitMs: 5000 });
      expect(result.success).toBe(false);
    });

    it('rejects non-positive warningMs', () => {
      const result = TimeoutConfigSchema.safeParse({ warningMs: 0, autoWaitMs: 5000 });
      expect(result.success).toBe(false);
    });

    it('rejects non-positive autoWaitMs', () => {
      const result = TimeoutConfigSchema.safeParse({ warningMs: 3000, autoWaitMs: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('BubbleSchema', () => {
    it('validates a complete bubble object', () => {
      const bubble = {
        id: 'test-bubble',
        scheduler: {
          entries: [{ entityId: 'player', speed: 100, actionPoints: 0 }],
          currentActorId: null,
        },
        entityIds: ['player'],
        executionState: { status: 'idle' },
        timeoutConfig: { warningMs: 5000, autoWaitMs: 10000 },
        center: { x: 5, y: 5 },
        radius: 8,
      };
      expect(BubbleSchema.parse(bubble)).toBeDefined();
    });

    it('validates awaiting_input execution state', () => {
      const bubble = {
        id: 'test-bubble',
        scheduler: { entries: [], currentActorId: null },
        entityIds: [],
        executionState: {
          status: 'awaiting_input',
          actorId: 'player',
          waitingSince: 1234567890,
          warningEmitted: false,
        },
        timeoutConfig: { warningMs: 5000, autoWaitMs: 10000 },
        center: { x: 0, y: 0 },
        radius: 8,
      };
      expect(BubbleSchema.parse(bubble)).toBeDefined();
    });
  });
});

describe('createBubble', () => {
  it('creates bubble with scheduler and entity list', () => {
    const entities = [entity('player', 100), entity('rat', 120)];
    const bubble = createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player'), entityId('rat')],
      entities,
      center: { x: 5, y: 5 },
    });

    expect(bubble.id).toBe(bubbleId('test-bubble'));
    expect(bubble.entityIds).toEqual([entityId('player'), entityId('rat')]);
    expect(bubble.scheduler.entries).toHaveLength(2);
    expect(bubble.center).toEqual({ x: 5, y: 5 });
    expect(bubble.radius).toBe(8); // Default perception radius
  });

  it('creates bubble with idle execution state', () => {
    const bubble = createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player')],
      entities: [entity('player', 100)],
      center: { x: 0, y: 0 },
    });

    expect(bubble.executionState.status).toBe('idle');
  });

  it('uses default timeout config', () => {
    const bubble = createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player')],
      entities: [entity('player', 100)],
      center: { x: 0, y: 0 },
    });

    expect(bubble.timeoutConfig.warningMs).toBe(5000);
    expect(bubble.timeoutConfig.autoWaitMs).toBe(10000);
  });

  it('accepts custom timeout config', () => {
    const bubble = createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player')],
      entities: [entity('player', 100)],
      center: { x: 0, y: 0 },
      timeoutConfig: { warningMs: 3000, autoWaitMs: 5000 },
    });

    expect(bubble.timeoutConfig.warningMs).toBe(3000);
    expect(bubble.timeoutConfig.autoWaitMs).toBe(5000);
  });

  it('filters entities to only those in entityIds', () => {
    const entities = [
      entity('player', 100),
      entity('rat', 120),
      entity('orc', 80), // Not in entityIds
    ];
    const bubble = createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player'), entityId('rat')], // Only 2 of 3 entities
      entities,
      center: { x: 0, y: 0 },
    });

    expect(bubble.scheduler.entries).toHaveLength(2);
    expect(bubble.scheduler.entries.map(e => e.entityId)).toEqual([
      entityId('player'),
      entityId('rat'),
    ]);
  });

  it('logs warning when entityIds reference missing entities', () => {
    const warnings: string[] = [];
    enableBubbleDebugLogging((msg) => warnings.push(msg));

    createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player'), entityId('ghost')], // ghost doesn't exist in entities
      entities: [entity('player', 100)],
      center: { x: 0, y: 0 },
    });

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('ghost');
    expect(warnings[0]).toContain('missing entities');
  });

  it('throws error for invalid radius', () => {
    expect(() =>
      createBubble({
        id: bubbleId('test-bubble'),
        entityIds: [entityId('player')],
        entities: [entity('player', 100)],
        center: { x: 0, y: 0 },
        radius: 0,
      })
    ).toThrow('radius must be positive');

    expect(() =>
      createBubble({
        id: bubbleId('test-bubble'),
        entityIds: [entityId('player')],
        entities: [entity('player', 100)],
        center: { x: 0, y: 0 },
        radius: -5,
      })
    ).toThrow('radius must be positive');
  });

  it('throws error when warningMs >= autoWaitMs', () => {
    expect(() =>
      createBubble({
        id: bubbleId('test-bubble'),
        entityIds: [entityId('player')],
        entities: [entity('player', 100)],
        center: { x: 0, y: 0 },
        timeoutConfig: { warningMs: 10000, autoWaitMs: 5000 },
      })
    ).toThrow('warningMs (10000) must be less than autoWaitMs (5000)');

    expect(() =>
      createBubble({
        id: bubbleId('test-bubble'),
        entityIds: [entityId('player')],
        entities: [entity('player', 100)],
        center: { x: 0, y: 0 },
        timeoutConfig: { warningMs: 5000, autoWaitMs: 5000 },
      })
    ).toThrow('warningMs (5000) must be less than autoWaitMs (5000)');
  });
});

describe('distance', () => {
  it('calculates Chebyshev distance between positions', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(4);
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    expect(distance({ x: 0, y: 0 }, { x: 5, y: 3 })).toBe(5);
  });
});

describe('entitiesWithinRadius', () => {
  it('returns entities within radius of position', () => {
    const entities = [
      { id: entityId('a'), x: 5, y: 5 },
      { id: entityId('b'), x: 6, y: 5 }, // distance 1
      { id: entityId('c'), x: 15, y: 5 }, // distance 10
    ];

    const nearby = entitiesWithinRadius(entities, { x: 5, y: 5 }, 8);

    expect(nearby.map(e => e.id)).toEqual([entityId('a'), entityId('b')]);
  });

  it('includes entities exactly at radius boundary', () => {
    const entities = [{ id: entityId('a'), x: 8, y: 0 }];

    const nearby = entitiesWithinRadius(entities, { x: 0, y: 0 }, 8);

    expect(nearby).toHaveLength(1);
  });

  it('returns empty array when no entities in radius', () => {
    const entities = [{ id: entityId('a'), x: 100, y: 100 }];

    const nearby = entitiesWithinRadius(entities, { x: 0, y: 0 }, 8);

    expect(nearby).toHaveLength(0);
  });
});

describe('shouldMerge', () => {
  it('returns true when crawlers within perception range', () => {
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 5, 5, 'crawler'),
      [entityId('crawlerB')]: typedEntity('crawlerB', 7, 5, 'crawler'),
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 5, y: 5 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('crawlerB')],
      entities: [entity('crawlerB', 100)],
      center: { x: 7, y: 5 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(true);
  });

  it('returns false when crawlers beyond perception range', () => {
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 0, 0, 'crawler'),
      [entityId('crawlerB')]: typedEntity('crawlerB', 20, 20, 'crawler'),
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 0, y: 0 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('crawlerB')],
      entities: [entity('crawlerB', 100)],
      center: { x: 20, y: 20 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(false);
  });

  it('returns true when any crawler pair is within range', () => {
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 0, 0, 'crawler'),
      [entityId('crawlerB')]: typedEntity('crawlerB', 50, 50, 'crawler'),
      [entityId('crawlerC')]: typedEntity('crawlerC', 5, 0, 'crawler'), // Near A
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 0, y: 0 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('crawlerB'), entityId('crawlerC')],
      entities: [entity('crawlerB', 100), entity('crawlerC', 100)],
      center: { x: 25, y: 25 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(true); // A and C are close
  });

  it('returns false when bubbles contain only monsters (no crawlers)', () => {
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('rat1')]: typedEntity('rat1', 5, 5, 'monster'),
      [entityId('rat2')]: typedEntity('rat2', 6, 5, 'monster'),
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('rat1')],
      entities: [entity('rat1', 100)],
      center: { x: 5, y: 5 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('rat2')],
      entities: [entity('rat2', 100)],
      center: { x: 6, y: 5 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(false); // Monsters don't trigger merges
  });

  it('handles missing entities in lookup gracefully', () => {
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 5, 5, 'crawler'),
      // crawlerB is missing from entities
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 5, y: 5 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('crawlerB')], // This entity doesn't exist in lookup
      entities: [entity('crawlerB', 100)],
      center: { x: 6, y: 5 },
    });

    // Should not throw
    expect(() => shouldMerge(bubbleA, bubbleB, entities)).not.toThrow();
    // Should return false since no valid crawler pair
    expect(shouldMerge(bubbleA, bubbleB, entities)).toBe(false);
  });

  it('logs warning when entity is missing from lookup', () => {
    const warnings: string[] = [];
    enableBubbleDebugLogging((msg) => warnings.push(msg));

    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 5, 5, 'crawler'),
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 5, y: 5 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('ghost')],
      entities: [entity('ghost', 100)],
      center: { x: 6, y: 5 },
    });

    shouldMerge(bubbleA, bubbleB, entities);

    expect(warnings.some(w => w.includes('ghost') && w.includes('not found'))).toBe(true);
  });

  it('returns true when crawlers exactly at perception radius boundary', () => {
    // Default perception radius is 8 (Chebyshev distance)
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 0, 0, 'crawler'),
      [entityId('crawlerB')]: typedEntity('crawlerB', 8, 0, 'crawler'), // Exactly at radius
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 0, y: 0 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('crawlerB')],
      entities: [entity('crawlerB', 100)],
      center: { x: 8, y: 0 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(true); // At boundary, should merge
  });

  it('returns false when crawlers just beyond perception radius boundary', () => {
    // Default perception radius is 8
    const entities: Record<EntityId, TypedEntity> = {
      [entityId('crawlerA')]: typedEntity('crawlerA', 0, 0, 'crawler'),
      [entityId('crawlerB')]: typedEntity('crawlerB', 9, 0, 'crawler'), // Just beyond radius
    };
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('crawlerA')],
      entities: [entity('crawlerA', 100)],
      center: { x: 0, y: 0 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('crawlerB')],
      entities: [entity('crawlerB', 100)],
      center: { x: 9, y: 0 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(false); // Beyond boundary, should not merge
  });

  it('returns false when bubbles have no entities', () => {
    const entities: Record<EntityId, TypedEntity> = {};
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [],
      entities: [],
      center: { x: 0, y: 0 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [],
      entities: [],
      center: { x: 1, y: 0 },
    });

    const result = shouldMerge(bubbleA, bubbleB, entities);

    expect(result).toBe(false); // No entities to compare
  });
});

describe('mergeBubbles', () => {
  it('combines entity IDs from both bubbles', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1'), entityId('rat1')],
      entities: [entity('player1', 100), entity('rat1', 120)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2'), entityId('goblin1')],
      entities: [entity('player2', 100), entity('goblin1', 80)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.entityIds).toHaveLength(4);
    expect(merged.entityIds).toContain(entityId('goblin1'));
    expect(merged.entityIds).toContain(entityId('player1'));
    expect(merged.entityIds).toContain(entityId('player2'));
    expect(merged.entityIds).toContain(entityId('rat1'));
  });

  it('deduplicates entities present in both bubbles', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1'), entityId('rat1')],
      entities: [entity('player1', 100), entity('rat1', 120)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player1'), entityId('goblin1')], // player1 in both
      entities: [entity('player1', 100), entity('goblin1', 80)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.entityIds).toHaveLength(3);
    expect(merged.entityIds.filter(id => id === entityId('player1'))).toHaveLength(1);
  });

  it('preserves action points from both schedulers', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 120)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    // Advance bubbleB's scheduler to give player2 some action points
    const advancedBubbleB = {
      ...bubbleB,
      scheduler: advanceScheduler(bubbleB.scheduler),
    };

    const merged = mergeBubbles(bubbleA, advancedBubbleB);

    const player1Entry = merged.scheduler.entries.find(e => e.entityId === entityId('player1'));
    const player2Entry = merged.scheduler.entries.find(e => e.entityId === entityId('player2'));

    expect(player1Entry?.actionPoints).toBe(0);
    expect(player2Entry?.actionPoints).toBe(120); // Advanced once
  });

  it('takes higher action points when entity is in both', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    // Advance bubbleA to give player1 action points
    const advancedA = {
      ...bubbleA,
      scheduler: advanceScheduler(bubbleA.scheduler),
    };

    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player1')], // Same entity, but fresh (0 AP)
      entities: [entity('player1', 100)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    const merged = mergeBubbles(advancedA, bubbleB);

    const player1Entry = merged.scheduler.entries.find(e => e.entityId === entityId('player1'));
    expect(player1Entry?.actionPoints).toBe(100); // Takes higher value
  });

  it('generates new bubble ID from source bubble IDs', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.id).toBe(bubbleId('bubble-merged-bubble-a-bubble-b'));
  });

  it('uses stricter timeout config', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
      radius: 8,
      timeoutConfig: { warningMs: 5000, autoWaitMs: 10000 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 10, y: 5 },
      radius: 8,
      timeoutConfig: { warningMs: 3000, autoWaitMs: 5000 },
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.timeoutConfig.warningMs).toBe(3000); // Stricter (shorter)
    expect(merged.timeoutConfig.autoWaitMs).toBe(5000);
  });

  it('calculates center as midpoint and radius to cover both bubbles', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 0, y: 0 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 10, y: 0 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    // Center should be midpoint
    expect(merged.center).toEqual({ x: 5, y: 0 });

    // Radius should cover both original bubbles
    // distToA = distance from (5,0) to (0,0) + 8 = 5 + 8 = 13
    // distToB = distance from (5,0) to (10,0) + 8 = 5 + 8 = 13
    expect(merged.radius).toBe(13);
  });

  it('calculates radius correctly for asymmetric bubble positions', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 0, y: 0 },
      radius: 5,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 20, y: 0 },
      radius: 10,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    // Center should be midpoint: (10, 0)
    expect(merged.center).toEqual({ x: 10, y: 0 });

    // distToA = distance from (10,0) to (0,0) + 5 = 10 + 5 = 15
    // distToB = distance from (10,0) to (20,0) + 10 = 10 + 10 = 20
    // Max is 20
    expect(merged.radius).toBe(20);
  });

  it('merged bubble starts in idle execution state', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.executionState).toEqual({ status: 'idle' });
  });

  it('merged scheduler has null currentActorId', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
      radius: 8,
    });
    // Advance to set currentActorId
    const advancedA = {
      ...bubbleA,
      scheduler: advanceScheduler(bubbleA.scheduler),
    };
    expect(advancedA.scheduler.currentActorId).toBe(entityId('player1'));

    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 10, y: 5 },
      radius: 8,
    });

    const merged = mergeBubbles(advancedA, bubbleB);

    // Merged bubble should reset currentActorId
    expect(merged.scheduler.currentActorId).toBeNull();
  });

  it('merges two empty bubbles correctly', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [],
      entities: [],
      center: { x: 0, y: 0 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [],
      entities: [],
      center: { x: 10, y: 0 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.entityIds).toHaveLength(0);
    expect(merged.scheduler.entries).toHaveLength(0);
    expect(merged.center).toEqual({ x: 5, y: 0 }); // Midpoint
    expect(merged.id).toBe(bubbleId('bubble-merged-bubble-a-bubble-b'));
  });

  it('merges empty bubble with non-empty bubble', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [],
      entities: [],
      center: { x: 0, y: 0 },
      radius: 8,
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player')],
      entities: [entity('player', 100)],
      center: { x: 10, y: 0 },
      radius: 8,
    });

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.entityIds).toHaveLength(1);
    expect(merged.entityIds).toContain(entityId('player'));
    expect(merged.scheduler.entries).toHaveLength(1);
  });
});

describe('wakeNearbyEntities', () => {
  // Helper to create state with hibernating entities
  function createStateWithHibernating(): GameState {
    const state = createTestDungeon();
    // Add a hibernating entity that's within range
    const hibernatingMonster: Entity = {
      id: 'sleeping-goblin',
      type: 'monster',
      x: 10, // Within 8 tiles of player at (4,4)
      y: 4,
      hp: 5,
      maxHp: 5,
      name: 'Sleeping Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    return {
      ...state,
      entities: { ...state.entities, 'sleeping-goblin': hibernatingMonster },
      hibernating: [entityId('sleeping-goblin')],
    };
  }

  function createStateWithDistantHibernating(): GameState {
    const state = createTestDungeon();
    // Add a hibernating entity that's far away (beyond DEFAULT_PERCEPTION_RADIUS)
    const distantMonster: Entity = {
      id: 'distant-goblin',
      type: 'monster',
      x: 50, // Far beyond perception radius
      y: 50,
      hp: 5,
      maxHp: 5,
      name: 'Distant Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    return {
      ...state,
      entities: { ...state.entities, 'distant-goblin': distantMonster },
      hibernating: [entityId('distant-goblin')],
    };
  }

  it('wakes hibernating entities within perception radius', () => {
    const state = createStateWithHibernating();
    const bubble = state.bubbles[0];
    const crawlerPos = { x: 4, y: 4 }; // Player position in test dungeon

    const result = wakeNearbyEntities(state, bubble, crawlerPos);

    expect(result.state.hibernating.length).toBeLessThan(state.hibernating.length);
    expect(result.bubble.entityIds.length).toBeGreaterThan(bubble.entityIds.length);
    expect(result.wokenIds).toContain('sleeping-goblin');
  });

  it('does not wake entities beyond perception radius', () => {
    const state = createStateWithDistantHibernating();
    const bubble = state.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };

    const result = wakeNearbyEntities(state, bubble, crawlerPos);

    expect(result.state.hibernating).toEqual(state.hibernating);
    expect(result.wokenIds).toHaveLength(0);
  });

  it('woken entities start with 0 action points', () => {
    const state = createStateWithHibernating();
    const bubble = state.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };

    const result = wakeNearbyEntities(state, bubble, crawlerPos);

    const newEntry = result.bubble.scheduler.entries.find(
      e => e.entityId === 'sleeping-goblin'
    );
    expect(newEntry).toBeDefined();
    expect(newEntry?.actionPoints).toBe(0);
  });

  it('returns unchanged state when no entities to wake', () => {
    const state = createTestDungeon();
    const stateWithNoHibernating = { ...state, hibernating: [] }; // No hibernating entities
    const bubble = stateWithNoHibernating.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };

    const result = wakeNearbyEntities(stateWithNoHibernating, bubble, crawlerPos);

    expect(result.state).toEqual(stateWithNoHibernating);
    expect(result.bubble).toEqual(bubble);
    expect(result.wokenIds).toHaveLength(0);
  });

  it('handles multiple hibernating entities at different distances', () => {
    const state = createTestDungeon();
    const nearMonster: Entity = {
      id: 'near-goblin',
      type: 'monster',
      x: 7,
      y: 4,
      hp: 3,
      maxHp: 3,
      name: 'Near Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    const farMonster: Entity = {
      id: 'far-goblin',
      type: 'monster',
      x: 50,
      y: 50,
      hp: 3,
      maxHp: 3,
      name: 'Far Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    const stateWithBoth: GameState = {
      ...state,
      entities: {
        ...state.entities,
        'near-goblin': nearMonster,
        'far-goblin': farMonster,
      },
      hibernating: [entityId('near-goblin'), entityId('far-goblin')],
    };
    const bubble = stateWithBoth.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };

    const result = wakeNearbyEntities(stateWithBoth, bubble, crawlerPos);

    // Only near-goblin should wake
    expect(result.wokenIds).toContain('near-goblin');
    expect(result.wokenIds).not.toContain('far-goblin');
    expect(result.state.hibernating).toContain(entityId('far-goblin'));
    expect(result.state.hibernating).not.toContain(entityId('near-goblin'));
  });

  it('wakes entity exactly at perception radius boundary', () => {
    const state = createTestDungeon();
    // Entity exactly at perception radius (8 tiles away using Chebyshev distance)
    const boundaryMonster: Entity = {
      id: 'boundary-goblin',
      type: 'monster',
      x: 12, // 8 tiles from player at (4,4) using Chebyshev
      y: 4,
      hp: 3,
      maxHp: 3,
      name: 'Boundary Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    const stateWithBoundary: GameState = {
      ...state,
      entities: { ...state.entities, 'boundary-goblin': boundaryMonster },
      hibernating: [entityId('boundary-goblin')],
    };
    const bubble = stateWithBoundary.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };

    const result = wakeNearbyEntities(stateWithBoundary, bubble, crawlerPos);

    expect(result.wokenIds).toContain('boundary-goblin');
  });

  it('does not wake entity just beyond perception radius', () => {
    const state = createTestDungeon();
    // Entity just beyond perception radius (9 tiles away)
    const beyondMonster: Entity = {
      id: 'beyond-goblin',
      type: 'monster',
      x: 13, // 9 tiles from player at (4,4)
      y: 4,
      hp: 3,
      maxHp: 3,
      name: 'Beyond Goblin',
      char: 'g',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    };
    const stateWithBeyond: GameState = {
      ...state,
      entities: { ...state.entities, 'beyond-goblin': beyondMonster },
      hibernating: [entityId('beyond-goblin')],
    };
    const bubble = stateWithBeyond.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };

    const result = wakeNearbyEntities(stateWithBeyond, bubble, crawlerPos);

    expect(result.wokenIds).toHaveLength(0);
    expect(result.state.hibernating).toContain(entityId('beyond-goblin'));
  });

  it('preserves existing scheduler entries when adding woken entities', () => {
    const state = createStateWithHibernating();
    const bubble = state.bubbles[0];
    const crawlerPos = { x: 4, y: 4 };
    const originalEntryCount = bubble.scheduler.entries.length;

    const result = wakeNearbyEntities(state, bubble, crawlerPos);

    // Should have original entries plus the woken entity
    expect(result.bubble.scheduler.entries.length).toBe(originalEntryCount + 1);
    // Original entries should still be present
    for (const originalEntry of bubble.scheduler.entries) {
      const found = result.bubble.scheduler.entries.find(
        e => e.entityId === originalEntry.entityId
      );
      expect(found).toBeDefined();
      expect(found?.actionPoints).toBe(originalEntry.actionPoints);
    }
  });
});

describe('hibernateBubble', () => {
  // Helper to create a state with a bubble containing only monsters
  function createStateWithMonstersOnlyBubble(): GameState {
    const goblin: Entity = {
      id: 'goblin',
      type: 'monster',
      x: 5, y: 5,
      hp: 5, maxHp: 5,
      name: 'Goblin',
      char: 'g',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const rat: Entity = {
      id: 'rat',
      type: 'monster',
      x: 6, y: 5,
      hp: 3, maxHp: 3,
      name: 'Rat',
      char: 'r',
      attack: 1, defense: 0, speed: 120,
      areaId: 'area-1',
    };

    const bubble = createBubble({
      id: bubbleId('monster-bubble'),
      entityIds: [entityId('goblin'), entityId('rat')],
      entities: [
        { id: entityId('goblin'), speed: 100 },
        { id: entityId('rat'), speed: 120 },
      ],
      center: { x: 5, y: 5 },
    });

    return {
      zone: createTestZone(createTestMap(10, 10)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { goblin, rat },
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0,
      messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  it('moves remaining entities to hibernating list', () => {
    const state = createStateWithMonstersOnlyBubble();
    const bubble = state.bubbles[0];

    const result = hibernateBubble(bubble, state);

    expect(result.hibernating).toContain('goblin');
    expect(result.hibernating).toContain('rat');
    expect(result.hibernating.length).toBe(2);
  });

  it('removes bubble from state', () => {
    const state = createStateWithMonstersOnlyBubble();
    const bubble = state.bubbles[0];

    const result = hibernateBubble(bubble, state);

    expect(result.bubbles.find(b => b.id === bubble.id)).toBeUndefined();
    expect(result.bubbles.length).toBe(0);
  });

  it('preserves existing hibernating entities', () => {
    const state = createStateWithMonstersOnlyBubble();
    const stateWithExisting = {
      ...state,
      hibernating: [entityId('existing-monster')],
    };
    const bubble = state.bubbles[0];

    const result = hibernateBubble(bubble, stateWithExisting);

    expect(result.hibernating).toContain('existing-monster');
    expect(result.hibernating).toContain('goblin');
    expect(result.hibernating).toContain('rat');
    expect(result.hibernating.length).toBe(3);
  });

  it('preserves other bubbles', () => {
    const state = createStateWithMonstersOnlyBubble();
    const otherBubble = createBubble({
      id: bubbleId('other-bubble'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 2, y: 2 },
    });
    const stateWithTwoBubbles = {
      ...state,
      bubbles: [...state.bubbles, otherBubble],
    };
    const bubbleToHibernate = stateWithTwoBubbles.bubbles[0];

    const result = hibernateBubble(bubbleToHibernate, stateWithTwoBubbles);

    expect(result.bubbles.length).toBe(1);
    expect(result.bubbles[0].id).toBe('other-bubble');
  });
});

describe('splitBubble', () => {
  // Helper to create state with two crawlers in same bubble
  function createStateWithTwoCrawlers(): GameState {
    const player1: Entity = {
      id: 'player1', type: 'crawler',
      x: 2, y: 2, hp: 10, maxHp: 10,
      name: 'Player 1', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player2: Entity = {
      id: 'player2', type: 'crawler',
      x: 8, y: 8, hp: 10, maxHp: 10,  // Far from player1
      name: 'Player 2', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const bubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    return {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player1, player2 },
      items: [],
      bubbles: [bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  function createStateWithTwoCrawlersAndMonster(): GameState {
    const state = createStateWithTwoCrawlers();
    const goblin: Entity = {
      id: 'goblin', type: 'monster',
      x: 3, y: 2, hp: 5, maxHp: 5,  // Close to player1 at (2,2)
      name: 'Goblin', char: 'g',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    // Update bubble to include goblin
    const updatedBubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2'), entityId('goblin')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
        { id: entityId('goblin'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });

    return {
      ...state,
      entities: { ...state.entities, goblin },
      bubbles: [updatedBubble],
    };
  }

  it('creates separate bubble per crawler', () => {
    const state = createStateWithTwoCrawlers();
    const bubble = state.bubbles[0];

    const result = splitBubble(bubble, state);

    expect(result.length).toBe(2);
    expect(result[0].entityIds).toContain('player1');
    expect(result[1].entityIds).toContain('player2');
  });

  it('assigns monsters to nearest crawler', () => {
    const state = createStateWithTwoCrawlersAndMonster();
    const bubble = state.bubbles[0];

    const result = splitBubble(bubble, state);

    // Goblin at (3,2) is closer to player1 at (2,2) than player2 at (8,8)
    const player1Bubble = result.find(b => b.entityIds.includes(entityId('player1')));
    expect(player1Bubble?.entityIds).toContain('goblin');
  });

  it('uses deterministic tie-breaking for equidistant monsters', () => {
    const state = createStateWithTwoCrawlers();
    // Add monster exactly equidistant from both crawlers
    const equidistant: Entity = {
      id: 'equidistant', type: 'monster',
      x: 5, y: 5, hp: 5, maxHp: 5,  // Equidistant from (2,2) and (8,8)
      name: 'Equidistant', char: 'e',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const stateWithEquidistant = {
      ...state,
      entities: { ...state.entities, equidistant },
    };

    // Update bubble to include the monster
    const updatedBubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2'), entityId('equidistant')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
        { id: entityId('equidistant'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });
    stateWithEquidistant.bubbles = [updatedBubble];

    const result1 = splitBubble(updatedBubble, stateWithEquidistant);
    const result2 = splitBubble(updatedBubble, stateWithEquidistant);

    // Results should be identical (deterministic)
    // Use slice() to create mutable copies before sorting (entityIds are frozen)
    expect([...result1[0].entityIds].sort()).toEqual([...result2[0].entityIds].sort());
    expect([...result1[1].entityIds].sort()).toEqual([...result2[1].entityIds].sort());
  });

  it('preserves action points in split bubbles', () => {
    const state = createStateWithTwoCrawlers();
    // Manually set some action points in the bubble's scheduler
    let advancedBubble = state.bubbles[0];
    // Advance scheduler a few times to accumulate AP
    advancedBubble = { ...advancedBubble, scheduler: advanceScheduler(advancedBubble.scheduler) };
    advancedBubble = { ...advancedBubble, scheduler: advanceScheduler(advancedBubble.scheduler) };

    const stateWithAP = { ...state, bubbles: [advancedBubble] };

    const result = splitBubble(advancedBubble, stateWithAP);

    // Each entity's AP should be preserved in their new bubble
    for (const newBubble of result) {
      for (const entry of newBubble.scheduler.entries) {
        const originalEntry = advancedBubble.scheduler.entries.find(e => e.entityId === entry.entityId);
        expect(entry.actionPoints).toBe(originalEntry?.actionPoints);
      }
    }
  });

  it('returns single bubble if only one crawler', () => {
    const state = createTestDungeon(); // Has single player
    const bubble = state.bubbles[0];

    const result = splitBubble(bubble, state);

    // Should return original bubble (or equivalent) since no split needed
    expect(result.length).toBe(1);
  });

  it('assigns monster to crawler with lower ID when equidistant', () => {
    const state = createStateWithTwoCrawlers();
    // Add monster exactly equidistant from both crawlers
    const equidistant: Entity = {
      id: 'equidistant', type: 'monster',
      x: 5, y: 5, hp: 5, maxHp: 5,  // Equidistant from (2,2) and (8,8)
      name: 'Equidistant', char: 'e',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const stateWithEquidistant = {
      ...state,
      entities: { ...state.entities, equidistant },
    };

    // Update bubble to include the monster
    const updatedBubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2'), entityId('equidistant')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
        { id: entityId('equidistant'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });
    stateWithEquidistant.bubbles = [updatedBubble];

    const result = splitBubble(updatedBubble, stateWithEquidistant);

    // Equidistant monster should go to player1 (lower ID)
    const player1Bubble = result.find(b => b.entityIds.includes(entityId('player1')));
    expect(player1Bubble?.entityIds).toContain('equidistant');
  });

  it('centers each new bubble on its crawler', () => {
    const state = createStateWithTwoCrawlers();
    const bubble = state.bubbles[0];

    const result = splitBubble(bubble, state);

    const player1Bubble = result.find(b => b.entityIds.includes(entityId('player1')));
    const player2Bubble = result.find(b => b.entityIds.includes(entityId('player2')));

    // player1 is at (2,2), player2 is at (8,8)
    expect(player1Bubble?.center).toEqual({ x: 2, y: 2 });
    expect(player2Bubble?.center).toEqual({ x: 8, y: 8 });
  });

  it('handles multiple monsters with different distances', () => {
    const state = createStateWithTwoCrawlers();
    // Add monsters at different distances
    const nearPlayer1: Entity = {
      id: 'nearPlayer1', type: 'monster',
      x: 1, y: 2, hp: 5, maxHp: 5,
      name: 'Near Player 1', char: 'm',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const nearPlayer2: Entity = {
      id: 'nearPlayer2', type: 'monster',
      x: 9, y: 8, hp: 5, maxHp: 5,
      name: 'Near Player 2', char: 'm',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const stateWithMonsters = {
      ...state,
      entities: { ...state.entities, nearPlayer1, nearPlayer2 },
    };

    const updatedBubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2'), entityId('nearPlayer1'), entityId('nearPlayer2')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
        { id: entityId('nearPlayer1'), speed: 100 },
        { id: entityId('nearPlayer2'), speed: 100 },
      ],
      center: { x: 5, y: 5 },
    });
    stateWithMonsters.bubbles = [updatedBubble];

    const result = splitBubble(updatedBubble, stateWithMonsters);

    const player1Bubble = result.find(b => b.entityIds.includes(entityId('player1')));
    const player2Bubble = result.find(b => b.entityIds.includes(entityId('player2')));

    expect(player1Bubble?.entityIds).toContain('nearPlayer1');
    expect(player2Bubble?.entityIds).toContain('nearPlayer2');
  });

  it('generates unique bubble IDs for split bubbles', () => {
    const state = createStateWithTwoCrawlers();
    const bubble = state.bubbles[0];

    const result = splitBubble(bubble, state);

    expect(result[0].id).not.toBe(result[1].id);
    expect(result[0].id).toContain('shared-bubble');
    expect(result[1].id).toContain('shared-bubble');
  });
});

describe('reconcileBubbles', () => {
  function createStateWithOverlappingBubbles(): GameState {
    // Two bubbles with crawlers close together (within perception radius)
    const player1: Entity = {
      id: 'player1', type: 'crawler',
      x: 5, y: 5, hp: 10, maxHp: 10,
      name: 'Player 1', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player2: Entity = {
      id: 'player2', type: 'crawler',
      x: 7, y: 5, hp: 10, maxHp: 10,  // Only 2 tiles away
      name: 'Player 2', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const bubble1 = createBubble({
      id: bubbleId('bubble-1'),
      entityIds: [entityId('player1')],
      entities: [{ id: entityId('player1'), speed: 100 }],
      center: { x: 5, y: 5 },
    });
    const bubble2 = createBubble({
      id: bubbleId('bubble-2'),
      entityIds: [entityId('player2')],
      entities: [{ id: entityId('player2'), speed: 100 }],
      center: { x: 7, y: 5 },
    });

    return {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player1, player2 },
      items: [],
      bubbles: [bubble1, bubble2],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  function createStateWithDistantCrawlersInSameBubble(): GameState {
    // One bubble with two crawlers far apart (beyond perception radius)
    const player1: Entity = {
      id: 'player1', type: 'crawler',
      x: 2, y: 2, hp: 10, maxHp: 10,
      name: 'Player 1', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player2: Entity = {
      id: 'player2', type: 'crawler',
      x: 18, y: 18, hp: 10, maxHp: 10,  // 16 tiles away (beyond 8 tile radius)
      name: 'Player 2', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const sharedBubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
      ],
      center: { x: 10, y: 10 },
    });

    return {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player1, player2 },
      items: [],
      bubbles: [sharedBubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  function createStateWithCrawlerlessBubble(): GameState {
    // A bubble with only monsters (no crawlers)
    const goblin: Entity = {
      id: 'goblin', type: 'monster',
      x: 5, y: 5, hp: 5, maxHp: 5,
      name: 'Goblin', char: 'g',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const monsterBubble = createBubble({
      id: bubbleId('monster-bubble'),
      entityIds: [entityId('goblin')],
      entities: [{ id: entityId('goblin'), speed: 100 }],
      center: { x: 5, y: 5 },
    });

    return {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { goblin },
      items: [],
      bubbles: [monsterBubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };
  }

  it('merges overlapping bubbles', () => {
    const state = createStateWithOverlappingBubbles();

    const result = reconcileBubbles(state);

    expect(result.bubbles.length).toBe(1);
    expect(result.bubbles[0].entityIds).toContain('player1');
    expect(result.bubbles[0].entityIds).toContain('player2');
  });

  it('splits bubbles with distant crawlers', () => {
    const state = createStateWithDistantCrawlersInSameBubble();

    const result = reconcileBubbles(state);

    expect(result.bubbles.length).toBe(2);
  });

  it('hibernates bubbles without crawlers', () => {
    const state = createStateWithCrawlerlessBubble();

    const result = reconcileBubbles(state);

    expect(result.bubbles.length).toBe(0);
    expect(result.hibernating).toContain('goblin');
  });

  it('leaves unchanged state when no reconciliation needed', () => {
    const state = createTestDungeon();  // Normal state with player and monsters
    const result = reconcileBubbles(state);

    expect(result.bubbles.length).toBe(state.bubbles.length);
  });

  it('handles multiple merges in a single call', () => {
    // Three bubbles, each within perception radius of the next
    const player1: Entity = {
      id: 'player1', type: 'crawler',
      x: 2, y: 5, hp: 10, maxHp: 10,
      name: 'Player 1', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player2: Entity = {
      id: 'player2', type: 'crawler',
      x: 6, y: 5, hp: 10, maxHp: 10,  // 4 tiles from player1
      name: 'Player 2', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player3: Entity = {
      id: 'player3', type: 'crawler',
      x: 10, y: 5, hp: 10, maxHp: 10,  // 4 tiles from player2
      name: 'Player 3', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const bubble1 = createBubble({
      id: bubbleId('bubble-1'),
      entityIds: [entityId('player1')],
      entities: [{ id: entityId('player1'), speed: 100 }],
      center: { x: 2, y: 5 },
    });
    const bubble2 = createBubble({
      id: bubbleId('bubble-2'),
      entityIds: [entityId('player2')],
      entities: [{ id: entityId('player2'), speed: 100 }],
      center: { x: 6, y: 5 },
    });
    const bubble3 = createBubble({
      id: bubbleId('bubble-3'),
      entityIds: [entityId('player3')],
      entities: [{ id: entityId('player3'), speed: 100 }],
      center: { x: 10, y: 5 },
    });

    const state: GameState = {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player1, player2, player3 },
      items: [],
      bubbles: [bubble1, bubble2, bubble3],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };

    const result = reconcileBubbles(state);

    // All three should merge into one bubble
    expect(result.bubbles.length).toBe(1);
    expect(result.bubbles[0].entityIds).toContain('player1');
    expect(result.bubbles[0].entityIds).toContain('player2');
    expect(result.bubbles[0].entityIds).toContain('player3');
  });

  it('handles both merge and hibernate in same reconciliation', () => {
    // Two overlapping bubbles with crawlers, one bubble with only monster
    const player1: Entity = {
      id: 'player1', type: 'crawler',
      x: 5, y: 5, hp: 10, maxHp: 10,
      name: 'Player 1', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player2: Entity = {
      id: 'player2', type: 'crawler',
      x: 7, y: 5, hp: 10, maxHp: 10,
      name: 'Player 2', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const goblin: Entity = {
      id: 'goblin', type: 'monster',
      x: 15, y: 15, hp: 5, maxHp: 5,
      name: 'Goblin', char: 'g',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const bubble1 = createBubble({
      id: bubbleId('bubble-1'),
      entityIds: [entityId('player1')],
      entities: [{ id: entityId('player1'), speed: 100 }],
      center: { x: 5, y: 5 },
    });
    const bubble2 = createBubble({
      id: bubbleId('bubble-2'),
      entityIds: [entityId('player2')],
      entities: [{ id: entityId('player2'), speed: 100 }],
      center: { x: 7, y: 5 },
    });
    const monsterBubble = createBubble({
      id: bubbleId('monster-bubble'),
      entityIds: [entityId('goblin')],
      entities: [{ id: entityId('goblin'), speed: 100 }],
      center: { x: 15, y: 15 },
    });

    const state: GameState = {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player1, player2, goblin },
      items: [],
      bubbles: [bubble1, bubble2, monsterBubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };

    const result = reconcileBubbles(state);

    // Should have one merged bubble for crawlers, goblin should be hibernating
    expect(result.bubbles.length).toBe(1);
    expect(result.bubbles[0].entityIds).toContain('player1');
    expect(result.bubbles[0].entityIds).toContain('player2');
    expect(result.hibernating).toContain('goblin');
  });

  it('does not split single-crawler bubbles', () => {
    const state = createTestDungeon();
    const result = reconcileBubbles(state);

    // Should still be one bubble (no split with single crawler)
    expect(result.bubbles.length).toBe(1);
  });
});

describe('bubble tick', () => {
  it('createBubble initializes tick to 0', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 0, y: 0 },
    });

    expect(bubble.tick).toBe(0);
  });

  it('mergeBubbles takes the higher tick', () => {
    const bubbleA = createBubble({
      id: bubbleId('bubble-a'),
      entityIds: [entityId('player1')],
      entities: [entity('player1', 100)],
      center: { x: 5, y: 5 },
    });
    const bubbleB = createBubble({
      id: bubbleId('bubble-b'),
      entityIds: [entityId('player2')],
      entities: [entity('player2', 100)],
      center: { x: 10, y: 5 },
    });

    // Manually set different ticks by creating new bubble objects
    const bubbleAWithTick = { ...bubbleA, tick: 10 };
    const bubbleBWithTick = { ...bubbleB, tick: 25 };

    const merged = mergeBubbles(bubbleAWithTick as Bubble, bubbleBWithTick as Bubble);

    expect(merged.tick).toBe(25); // Takes the higher tick
  });

  it('splitBubble preserves the original tick', () => {
    const player1: Entity = {
      id: 'player1', type: 'crawler',
      x: 2, y: 2, hp: 10, maxHp: 10,
      name: 'Player 1', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };
    const player2: Entity = {
      id: 'player2', type: 'crawler',
      x: 18, y: 18, hp: 10, maxHp: 10,
      name: 'Player 2', char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
    };

    const bubble = createBubble({
      id: bubbleId('shared-bubble'),
      entityIds: [entityId('player1'), entityId('player2')],
      entities: [
        { id: entityId('player1'), speed: 100 },
        { id: entityId('player2'), speed: 100 },
      ],
      center: { x: 10, y: 10 },
    });

    // Set a non-zero tick
    const bubbleWithTick = { ...bubble, tick: 42 };

    const state: GameState = {
      zone: createTestZone(createTestMap(20, 20)),
      currentAreaId: DEFAULT_AREA_ID,
      entities: { player1, player2 },
      items: [],
      bubbles: [bubbleWithTick as Bubble],
      hibernating: [],
      exploredTiles: {},
      objectives: [],
      turn: 0, messages: [],
      gameStatus: { status: 'playing' },
    };

    const splits = splitBubble(bubbleWithTick as Bubble, state);

    // All split bubbles should preserve the original tick
    expect(splits.length).toBe(2);
    expect(splits[0].tick).toBe(42);
    expect(splits[1].tick).toBe(42);
  });
});

describe('mergeBubbles with tick synchronization', () => {
  it('fast-forwards slower bubble scheduler to match faster bubble tick', () => {
    // Create two bubbles at different ticks with entities that have AP
    const bubbleA = {
      ...createBubble({
        id: bubbleId('a'),
        entityIds: [entityId('player1')],
        entities: [{ id: entityId('player1'), speed: 100 }],
        center: { x: 0, y: 0 },
      }),
      tick: 10,
    };

    const bubbleB = {
      ...createBubble({
        id: bubbleId('b'),
        entityIds: [entityId('player2')],
        entities: [{ id: entityId('player2'), speed: 100 }],
        center: { x: 5, y: 5 },
      }),
      tick: 15,
    };

    const merged = mergeBubbles(bubbleA as Bubble, bubbleB as Bubble);

    // player1 should have 5 extra ticks of AP (5 * 100 = 500 extra AP)
    const player1Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player1')
    );
    // player2 should have 0 AP (it was ahead, no fast-forward needed)
    const player2Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player2')
    );

    // Verify fast-forward happened (player1 gained AP from 5 ticks)
    expect(player1Entry?.actionPoints).toBe(500); // 5 ticks * 100 speed
    expect(player2Entry?.actionPoints).toBe(0);
    expect(player1Entry?.actionPoints).toBeGreaterThan(player2Entry?.actionPoints ?? 0);
  });

  it('fast-forwards slower bubble when ahead bubble is first argument', () => {
    // bubbleA is ahead (tick 20), bubbleB is behind (tick 10)
    const bubbleA = {
      ...createBubble({
        id: bubbleId('a'),
        entityIds: [entityId('player1')],
        entities: [{ id: entityId('player1'), speed: 100 }],
        center: { x: 0, y: 0 },
      }),
      tick: 20,
    };

    const bubbleB = {
      ...createBubble({
        id: bubbleId('b'),
        entityIds: [entityId('player2')],
        entities: [{ id: entityId('player2'), speed: 80 }],
        center: { x: 5, y: 5 },
      }),
      tick: 10,
    };

    const merged = mergeBubbles(bubbleA as Bubble, bubbleB as Bubble);

    // player2 should have 10 extra ticks of AP (10 * 80 = 800 extra AP)
    const player1Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player1')
    );
    const player2Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player2')
    );

    expect(player1Entry?.actionPoints).toBe(0);
    expect(player2Entry?.actionPoints).toBe(800); // 10 ticks * 80 speed
    expect(merged.tick).toBe(20);
  });

  it('does not fast-forward when bubbles have same tick', () => {
    const bubbleA = {
      ...createBubble({
        id: bubbleId('a'),
        entityIds: [entityId('player1')],
        entities: [{ id: entityId('player1'), speed: 100 }],
        center: { x: 0, y: 0 },
      }),
      tick: 15,
    };

    const bubbleB = {
      ...createBubble({
        id: bubbleId('b'),
        entityIds: [entityId('player2')],
        entities: [{ id: entityId('player2'), speed: 100 }],
        center: { x: 5, y: 5 },
      }),
      tick: 15,
    };

    const merged = mergeBubbles(bubbleA as Bubble, bubbleB as Bubble);

    const player1Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player1')
    );
    const player2Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player2')
    );

    // Both should have 0 AP (no fast-forward needed)
    expect(player1Entry?.actionPoints).toBe(0);
    expect(player2Entry?.actionPoints).toBe(0);
  });

  it('combines command queues from both bubbles', () => {
    let bubbleA = createBubble({
      id: bubbleId('a'),
      entityIds: [entityId('player1')],
      entities: [{ id: entityId('player1'), speed: 100 }],
      center: { x: 0, y: 0 },
    });
    bubbleA = queueCommand(bubbleA, entityId('player1'), {
      action: 'wait',
      reasoning: 'a',
    }).bubble;

    let bubbleB = createBubble({
      id: bubbleId('b'),
      entityIds: [entityId('player2')],
      entities: [{ id: entityId('player2'), speed: 100 }],
      center: { x: 5, y: 5 },
    });
    bubbleB = queueCommand(bubbleB, entityId('player2'), {
      action: 'move',
      direction: 'north',
      reasoning: 'b',
    }).bubble;

    const merged = mergeBubbles(bubbleA, bubbleB);

    expect(merged.commandQueues.get(entityId('player1'))).toBeDefined();
    expect(merged.commandQueues.get(entityId('player2'))).toBeDefined();
  });

  it('preserves existing AP and adds fast-forward AP', () => {
    // Create bubbleA at tick 10, advance its scheduler to give player1 some AP
    let bubbleA = createBubble({
      id: bubbleId('a'),
      entityIds: [entityId('player1')],
      entities: [{ id: entityId('player1'), speed: 100 }],
      center: { x: 0, y: 0 },
    });
    // Advance scheduler twice to give player1 200 AP
    bubbleA = { ...bubbleA, scheduler: advanceScheduler(bubbleA.scheduler) };
    bubbleA = { ...bubbleA, scheduler: advanceScheduler(bubbleA.scheduler) };
    bubbleA = { ...bubbleA, tick: 10 };

    const bubbleB = {
      ...createBubble({
        id: bubbleId('b'),
        entityIds: [entityId('player2')],
        entities: [{ id: entityId('player2'), speed: 100 }],
        center: { x: 5, y: 5 },
      }),
      tick: 15,
    };

    const merged = mergeBubbles(bubbleA as Bubble, bubbleB as Bubble);

    const player1Entry = merged.scheduler.entries.find(
      e => e.entityId === entityId('player1')
    );

    // player1 had 200 AP, plus 5 ticks of fast-forward (5 * 100 = 500), total 700
    expect(player1Entry?.actionPoints).toBe(700);
  });
});

describe('command queues', () => {
  it('createBubble initializes empty command queues', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 0, y: 0 },
    });

    expect(bubble.commandQueues).toBeDefined();
    expect(bubble.commandQueues.size).toBe(0);
  });

  describe('queueCommand', () => {
    it('adds command to empty queue', () => {
      const bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 0, y: 0 },
      });

      const action: Action = { action: 'wait', reasoning: 'test' };
      const result = queueCommand(bubble, entityId('player'), action);

      expect(result.success).toBe(true);
      const queue = result.bubble.commandQueues.get(entityId('player'));
      expect(queue).toBeDefined();
      expect(queue!.commands).toHaveLength(1);
      expect(queue!.commands[0]).toEqual(action);
    });

    it('appends command to existing queue', () => {
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 0, y: 0 },
      });

      const action1: Action = { action: 'wait', reasoning: 'first' };
      const action2: Action = { action: 'move', direction: 'north', reasoning: 'second' };

      bubble = queueCommand(bubble, entityId('player'), action1).bubble;
      bubble = queueCommand(bubble, entityId('player'), action2).bubble;

      const queue = bubble.commandQueues.get(entityId('player'));
      expect(queue!.commands).toHaveLength(2);
      expect(queue!.commands[0]).toEqual(action1);
      expect(queue!.commands[1]).toEqual(action2);
    });

    it('drops oldest command when queue is full', () => {
      let bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 0, y: 0 },
      });

      // Fill queue to max
      for (let i = 0; i < DEFAULT_COMMAND_QUEUE_SIZE; i++) {
        bubble = queueCommand(bubble, entityId('player'), {
          action: 'wait',
          reasoning: `cmd-${i}`,
        }).bubble;
      }

      // Add one more - should drop oldest
      const result = queueCommand(bubble, entityId('player'), {
        action: 'wait',
        reasoning: 'newest',
      });
      bubble = result.bubble;

      expect(result.success).toBe(true);
      expect(result.droppedOldest).toBe(true);
      const queue = bubble.commandQueues.get(entityId('player'));
      expect(queue!.commands).toHaveLength(DEFAULT_COMMAND_QUEUE_SIZE);
      expect(queue!.commands[0].reasoning).toBe('cmd-1'); // cmd-0 was dropped
      expect(queue!.commands[DEFAULT_COMMAND_QUEUE_SIZE - 1].reasoning).toBe('newest');
    });

    it('returns failure for entity not in bubble', () => {
      const bubble = createBubble({
        id: bubbleId('test'),
        entityIds: [entityId('player')],
        entities: [{ id: entityId('player'), speed: 100 }],
        center: { x: 0, y: 0 },
      });

      const action: Action = { action: 'wait', reasoning: 'test' };
      const result = queueCommand(bubble, entityId('ghost'), action);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ghost');
      expect(result.bubble.commandQueues.get(entityId('ghost'))).toBeUndefined();
    });
  });
});

describe('checkTimeout', () => {
  // Helper to create bubble in idle state
  function createBubbleInIdleState(): Bubble {
    return createBubble({
      id: bubbleId('test-bubble'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 5, y: 5 },
    });
  }

  // Helper to create bubble awaiting input
  function createBubbleAwaitingInput(waitingSince: number): Bubble {
    const base = createBubbleInIdleState();
    return {
      ...base,
      executionState: {
        status: 'awaiting_input',
        actorId: entityId('player'),
        waitingSince,
        warningEmitted: false,
      },
    };
  }

  // Helper to create bubble with warning already emitted
  function createBubbleWithWarningEmitted(waitingSince: number): Bubble {
    const base = createBubbleInIdleState();
    return {
      ...base,
      executionState: {
        status: 'awaiting_input',
        actorId: entityId('player'),
        waitingSince,
        warningEmitted: true,
      },
    };
  }

  it('returns none when not awaiting input', () => {
    const bubble = createBubbleInIdleState();
    const now = Date.now();

    const result = checkTimeout(bubble, now);

    expect(result.action).toBe('none');
    expect(result.bubble).toBe(bubble);
  });

  it('returns none when within warning threshold', () => {
    const now = Date.now();
    const bubble = createBubbleAwaitingInput(now - 1000); // 1 second ago

    const result = checkTimeout(bubble, now);

    expect(result.action).toBe('none');
  });

  it('returns warn when past warning threshold', () => {
    const now = Date.now();
    const bubble = createBubbleAwaitingInput(now - 6000); // 6 seconds ago (past 5s warning)

    const result = checkTimeout(bubble, now);

    expect(result.action).toBe('warn');
    expect(result.bubble.executionState).toEqual({
      status: 'awaiting_input',
      actorId: entityId('player'),
      waitingSince: now - 6000,
      warningEmitted: true,
    });
  });

  it('returns force_wait when past auto-wait threshold', () => {
    const now = Date.now();
    const bubble = createBubbleAwaitingInput(now - 11000); // 11 seconds ago (past 10s auto-wait)

    const result = checkTimeout(bubble, now);

    expect(result.action).toBe('force_wait');
  });

  it('only warns once', () => {
    const now = Date.now();
    const bubble = createBubbleWithWarningEmitted(now - 6000); // Warning already emitted

    const result = checkTimeout(bubble, now);

    expect(result.action).toBe('none'); // Already warned, not yet force_wait
  });

  it('force_wait even if warning was emitted', () => {
    const now = Date.now();
    const bubble = createBubbleWithWarningEmitted(now - 11000); // Warning emitted, past auto-wait

    const result = checkTimeout(bubble, now);

    expect(result.action).toBe('force_wait');
  });
});

describe('dequeueCommand', () => {
  it('returns first command and removes it from queue', () => {
    let bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 0, y: 0 },
    });

    const action1: Action = { action: 'wait', reasoning: 'first' };
    const action2: Action = { action: 'move', direction: 'north', reasoning: 'second' };
    bubble = queueCommand(bubble, entityId('player'), action1).bubble;
    bubble = queueCommand(bubble, entityId('player'), action2).bubble;

    const result = dequeueCommand(bubble, entityId('player'));

    expect(result.action).toEqual(action1);
    expect(result.bubble.commandQueues.get(entityId('player'))!.commands).toHaveLength(1);
    expect(result.bubble.commandQueues.get(entityId('player'))!.commands[0]).toEqual(action2);
  });

  it('returns null action for empty queue', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 0, y: 0 },
    });

    const result = dequeueCommand(bubble, entityId('player'));

    expect(result.action).toBeNull();
    expect(result.bubble).toBe(bubble); // Unchanged
  });

  it('returns null action for entity not in bubble', () => {
    const bubble = createBubble({
      id: bubbleId('test'),
      entityIds: [entityId('player')],
      entities: [{ id: entityId('player'), speed: 100 }],
      center: { x: 0, y: 0 },
    });

    const result = dequeueCommand(bubble, entityId('ghost'));

    expect(result.action).toBeNull();
    expect(result.bubble).toBe(bubble);
  });
});
