import { describe, it, expect, afterEach } from 'vitest';
import {
  createScheduler,
  advanceScheduler,
  completeCurrentTurn,
  completeAction,
  addToScheduler,
  removeFromScheduler,
  enableSchedulerDebugLogging,
  resetSchedulerWarnLog,
  entityId,
  speed,
  EntitySpeedSchema,
  SchedulerStateSchema,
  canAct,
  ACTION_COST,
} from '../scheduler';

// Helper to create entity speed with branded EntityId
const entity = (id: string, speed: number) => ({ id: entityId(id), speed });

// Reset logging after each test to avoid cross-test pollution
afterEach(() => {
  resetSchedulerWarnLog();
});

describe('ACTION_COST', () => {
  it('is exported and equals 100', () => {
    expect(ACTION_COST).toBe(100);
  });
});

describe('entityId', () => {
  it('creates branded EntityId from valid string', () => {
    const id = entityId('player');
    expect(id).toBe('player');
  });

  it('throws error for empty string', () => {
    expect(() => entityId('')).toThrow('EntityId cannot be empty');
  });

  it('throws error for whitespace-only string', () => {
    expect(() => entityId('   ')).toThrow('EntityId cannot be empty');
  });

  it('accepts strings with embedded whitespace', () => {
    const id = entityId('player 1');
    expect(id).toBe('player 1');
  });
});

describe('speed', () => {
  it('creates branded Speed from valid positive integer', () => {
    const s = speed(100);
    expect(s).toBe(100);
  });

  it('accepts speed 1 (minimum valid speed)', () => {
    const s = speed(1);
    expect(s).toBe(1);
  });

  it('accepts large speed values', () => {
    const s = speed(1000);
    expect(s).toBe(1000);
  });

  it('throws error for zero', () => {
    expect(() => speed(0)).toThrow('Speed must be positive, got 0');
  });

  it('throws error for negative values', () => {
    expect(() => speed(-10)).toThrow('Speed must be positive, got -10');
  });

  it('throws error for non-integers', () => {
    expect(() => speed(100.5)).toThrow('Speed must be an integer, got 100.5');
  });

  it('throws error for Infinity', () => {
    expect(() => speed(Infinity)).toThrow('Speed must be finite, got Infinity');
  });

  it('throws error for -Infinity', () => {
    expect(() => speed(-Infinity)).toThrow('Speed must be positive, got -Infinity');
  });

  it('throws error for NaN', () => {
    expect(() => speed(NaN)).toThrow('Speed must be finite, got NaN');
  });
});

describe('Zod schemas', () => {
  describe('EntitySpeedSchema', () => {
    it('validates correct entity speed', () => {
      const result = EntitySpeedSchema.safeParse({ id: 'player', speed: 100 });
      expect(result.success).toBe(true);
    });

    it('rejects zero speed', () => {
      const result = EntitySpeedSchema.safeParse({ id: 'player', speed: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects negative speed', () => {
      const result = EntitySpeedSchema.safeParse({ id: 'player', speed: -50 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer speed', () => {
      const result = EntitySpeedSchema.safeParse({ id: 'player', speed: 100.5 });
      expect(result.success).toBe(false);
    });

    it('rejects empty id', () => {
      const result = EntitySpeedSchema.safeParse({ id: '', speed: 100 });
      expect(result.success).toBe(false);
    });
  });

  describe('SchedulerStateSchema', () => {
    it('validates correct scheduler state', () => {
      const validState = {
        entries: [{ entityId: 'player', speed: 100, actionPoints: 50 }],
        currentActorId: 'player',
      };
      expect(SchedulerStateSchema.parse(validState)).toBeDefined();
    });

    it('validates scheduler state with null currentActorId', () => {
      const state = {
        entries: [],
        currentActorId: null,
      };
      expect(SchedulerStateSchema.parse(state)).toBeDefined();
    });

    it('validates scheduler state with negative action points', () => {
      const state = {
        entries: [{ entityId: 'player', speed: 100, actionPoints: -50 }],
        currentActorId: null,
      };
      expect(SchedulerStateSchema.parse(state)).toBeDefined();
    });
  });
});

describe('createScheduler', () => {
  it('initializes entities with 0 action points', () => {
    const entities = [entity('player', 100), entity('rat', 120)];
    const scheduler = createScheduler(entities);

    expect(scheduler.entries).toHaveLength(2);
    expect(scheduler.entries[0].actionPoints).toBe(0);
    expect(scheduler.entries[1].actionPoints).toBe(0);
    expect(scheduler.currentActorId).toBeNull();
  });

  it('stores speed from input entities', () => {
    const entities = [entity('player', 100), entity('rat', 120)];
    const scheduler = createScheduler(entities);

    expect(scheduler.entries.find(e => e.entityId === entityId('player'))?.speed).toBe(100);
    expect(scheduler.entries.find(e => e.entityId === entityId('rat'))?.speed).toBe(120);
  });

  it('handles empty entity list', () => {
    const scheduler = createScheduler([]);

    expect(scheduler.entries).toHaveLength(0);
    expect(scheduler.currentActorId).toBeNull();
  });

  it('throws error for zero speed', () => {
    expect(() => createScheduler([entity('player', 0)])).toThrow('speed must be positive');
  });

  it('throws error for negative speed', () => {
    expect(() => createScheduler([entity('player', -50)])).toThrow('speed must be positive');
  });

  it('throws error for NaN speed', () => {
    expect(() => createScheduler([entity('player', NaN)])).toThrow('speed must be a finite number');
  });

  it('throws error for Infinity speed', () => {
    expect(() => createScheduler([entity('player', Infinity)])).toThrow('speed must be a finite number');
  });

  it('throws error for non-integer speed', () => {
    expect(() => createScheduler([entity('player', 100.5)])).toThrow('speed must be an integer');
  });
});

describe('advanceScheduler', () => {
  it('accumulates action points based on speed', () => {
    const scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);

    const advanced = advanceScheduler(scheduler);

    const player = advanced.entries.find(e => e.entityId === entityId('player'));
    const rat = advanced.entries.find(e => e.entityId === entityId('rat'));
    expect(player?.actionPoints).toBe(100);
    expect(rat?.actionPoints).toBe(120);
  });

  it('selects entity with highest action points as current actor', () => {
    const scheduler = createScheduler([
      entity('player', 100),
      entity('rat', 120),
      entity('orc', 80),
    ]);

    const advanced = advanceScheduler(scheduler);

    expect(advanced.currentActorId).toBe(entityId('rat')); // Highest speed = highest AP
  });

  it('breaks ties by entry order (first in list wins)', () => {
    const scheduler = createScheduler([entity('playerA', 100), entity('playerB', 100)]);

    const advanced = advanceScheduler(scheduler);

    expect(advanced.currentActorId).toBe(entityId('playerA'));
  });

  it('returns empty scheduler unchanged', () => {
    const scheduler = createScheduler([]);
    const advanced = advanceScheduler(scheduler);

    expect(advanced.entries).toHaveLength(0);
    expect(advanced.currentActorId).toBeNull();
  });
});

describe('completeCurrentTurn', () => {
  it('deducts 100 action points from current actor', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);
    expect(scheduler.currentActorId).toBe(entityId('rat'));

    const completed = completeCurrentTurn(scheduler);

    const rat = completed.entries.find(e => e.entityId === entityId('rat'));
    expect(rat?.actionPoints).toBe(20); // 120 - 100 = 20
  });

  it('clears currentActorId', () => {
    let scheduler = createScheduler([entity('player', 100)]);
    scheduler = advanceScheduler(scheduler);

    const completed = completeCurrentTurn(scheduler);

    expect(completed.currentActorId).toBeNull();
  });

  it('preserves other entities action points', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);

    const completed = completeCurrentTurn(scheduler);

    const player = completed.entries.find(e => e.entityId === entityId('player'));
    expect(player?.actionPoints).toBe(100); // Unchanged
  });

  it('handles null currentActorId gracefully', () => {
    const scheduler = createScheduler([entity('player', 100)]);
    // No advance, so currentActorId is null

    const completed = completeCurrentTurn(scheduler);

    expect(completed.entries[0].actionPoints).toBe(0); // Unchanged
  });
});

describe('addToScheduler', () => {
  it('adds new entity with 0 action points', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    const updated = addToScheduler(scheduler, entity('rat', 120));

    expect(updated.entries).toHaveLength(2);
    const rat = updated.entries.find(e => e.entityId === entityId('rat'));
    expect(rat?.actionPoints).toBe(0);
    expect(rat?.speed).toBe(120);
  });

  it('does not duplicate existing entity', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    const updated = addToScheduler(scheduler, entity('player', 120));

    expect(updated.entries).toHaveLength(1);
    // Speed should remain unchanged (no update on duplicate)
    expect(updated.entries[0].speed).toBe(100);
  });

  it('logs warning when duplicate entity is added', () => {
    const warnings: string[] = [];
    enableSchedulerDebugLogging((msg) => warnings.push(msg));

    const scheduler = createScheduler([entity('player', 100)]);
    addToScheduler(scheduler, entity('player', 120));

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('player');
    expect(warnings[0]).toContain('already exists');
  });

  it('throws error for invalid speed when adding', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    expect(() => addToScheduler(scheduler, entity('rat', 0))).toThrow('speed must be positive');

    expect(() => addToScheduler(scheduler, entity('rat', -50))).toThrow('speed must be positive');
  });

  it('throws error for NaN speed when adding', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    expect(() => addToScheduler(scheduler, entity('rat', NaN))).toThrow('speed must be a finite number');
  });

  it('throws error for Infinity speed when adding', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    expect(() => addToScheduler(scheduler, entity('rat', Infinity))).toThrow('speed must be a finite number');
    // -Infinity is caught by positive check first (speed <= 0)
    expect(() => addToScheduler(scheduler, entity('rat', -Infinity))).toThrow('speed must be positive');
  });

  it('throws error for non-integer speed when adding', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    expect(() => addToScheduler(scheduler, entity('rat', 100.5))).toThrow('speed must be an integer');
  });
});

describe('removeFromScheduler', () => {
  it('removes entity from entries', () => {
    const scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);

    const updated = removeFromScheduler(scheduler, entityId('rat'));

    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].entityId).toBe(entityId('player'));
  });

  it('preserves other entities action points', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);

    const updated = removeFromScheduler(scheduler, entityId('rat'));

    const player = updated.entries.find(e => e.entityId === entityId('player'));
    expect(player?.actionPoints).toBe(100);
  });

  it('clears currentActorId if removed entity was current', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);
    expect(scheduler.currentActorId).toBe(entityId('rat'));

    const updated = removeFromScheduler(scheduler, entityId('rat'));

    expect(updated.currentActorId).toBeNull();
  });

  it('preserves currentActorId if different entity removed', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);

    const updated = removeFromScheduler(scheduler, entityId('player'));

    expect(updated.currentActorId).toBe(entityId('rat'));
  });

  it('handles removing non-existent entity', () => {
    const scheduler = createScheduler([entity('player', 100)]);

    const updated = removeFromScheduler(scheduler, entityId('ghost'));

    expect(updated.entries).toHaveLength(1);
  });

  it('logs warning when removing non-existent entity', () => {
    const warnings: string[] = [];
    enableSchedulerDebugLogging((msg) => warnings.push(msg));

    const scheduler = createScheduler([entity('player', 100)]);
    removeFromScheduler(scheduler, entityId('ghost'));

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('ghost');
    expect(warnings[0]).toContain('not found');
  });
});

describe('scheduler turn ratio property', () => {
  it('faster entity acts proportionally more often over many turns', () => {
    let scheduler = createScheduler([entity('normal', 100), entity('fast', 120)]);

    const turnCounts: Record<string, number> = { normal: 0, fast: 0 };
    const NUM_TURNS = 1000;

    for (let i = 0; i < NUM_TURNS; i++) {
      scheduler = advanceScheduler(scheduler);
      // currentActorId is a branded type, so cast to string for record key
      turnCounts[scheduler.currentActorId as string]++;
      scheduler = completeCurrentTurn(scheduler);
    }

    // In action point accumulation scheduler, fast (120) gets ~60% of turns,
    // normal (100) gets ~40% of turns. Ratio is approximately 1.5.
    const fastNormalRatio = turnCounts.fast / turnCounts.normal;
    expect(fastNormalRatio).toBeGreaterThan(1.4);
    expect(fastNormalRatio).toBeLessThan(1.6);

    // Verify fast entity gets more turns than normal
    expect(turnCounts.fast).toBeGreaterThan(turnCounts.normal);
  });

  it('speed difference amplifies turn advantage', () => {
    let scheduler = createScheduler([entity('slow', 80), entity('fast', 120)]);

    const turnCounts: Record<string, number> = { slow: 0, fast: 0 };
    const NUM_TURNS = 1000;

    for (let i = 0; i < NUM_TURNS; i++) {
      scheduler = advanceScheduler(scheduler);
      turnCounts[scheduler.currentActorId as string]++;
      scheduler = completeCurrentTurn(scheduler);
    }

    // Larger speed difference (120 vs 80) creates bigger turn ratio (~2.3)
    const fastSlowRatio = turnCounts.fast / turnCounts.slow;
    expect(fastSlowRatio).toBeGreaterThan(2.0);
    expect(fastSlowRatio).toBeLessThan(2.6);

    // Verify fast entity gets significantly more turns
    expect(turnCounts.fast).toBeGreaterThan(turnCounts.slow);
  });

  it('three entities: turn distribution reflects relative speeds', () => {
    let scheduler = createScheduler([
      entity('slow', 80),
      entity('normal', 100),
      entity('fast', 120),
    ]);

    const turnCounts: Record<string, number> = { slow: 0, normal: 0, fast: 0 };
    const NUM_TURNS = 1000;

    for (let i = 0; i < NUM_TURNS; i++) {
      scheduler = advanceScheduler(scheduler);
      turnCounts[scheduler.currentActorId as string]++;
      scheduler = completeCurrentTurn(scheduler);
    }

    // Verify ordering: fast > normal > slow
    expect(turnCounts.fast).toBeGreaterThan(turnCounts.normal);
    expect(turnCounts.normal).toBeGreaterThan(turnCounts.slow);

    // In 3-way competition, differences compound - fast gets ~4x more turns than slow
    const fastSlowRatio = turnCounts.fast / turnCounts.slow;
    expect(fastSlowRatio).toBeGreaterThan(3.5);
    expect(fastSlowRatio).toBeLessThan(4.5);
  });

  it('action points can go negative after deduction but recover', () => {
    let scheduler = createScheduler([entity('a', 50), entity('b', 150)]);

    for (let i = 0; i < 500; i++) {
      scheduler = advanceScheduler(scheduler);
      scheduler = completeCurrentTurn(scheduler);

      for (const entry of scheduler.entries) {
        // Action points can dip negative after deduction (e.g., entity with 50 speed
        // accumulates 50 AP, then when it acts, deducts 100 = -50 AP)
        // But they should never go below -100 (action cost) minus max single accumulation
        expect(entry.actionPoints).toBeGreaterThanOrEqual(-100);
      }
    }
  });

  it('explicitly shows action points going negative after turn completion', () => {
    // Entity with 50 speed gains 50 AP per tick, but turn costs 100 AP
    let scheduler = createScheduler([entity('slow', 50)]);

    // Advance twice: 0 + 50 = 50, then 50 + 50 = 100 AP
    scheduler = advanceScheduler(scheduler);
    scheduler = advanceScheduler(scheduler);

    expect(scheduler.entries[0].actionPoints).toBe(100);
    expect(scheduler.currentActorId).toBe(entityId('slow'));

    // Complete turn: 100 - 100 = 0 AP
    scheduler = completeCurrentTurn(scheduler);
    expect(scheduler.entries[0].actionPoints).toBe(0);

    // Advance once more and complete: 0 + 50 = 50, then 50 - 100 = -50 AP
    scheduler = advanceScheduler(scheduler);
    expect(scheduler.entries[0].actionPoints).toBe(50);
    scheduler = completeCurrentTurn(scheduler);
    expect(scheduler.entries[0].actionPoints).toBe(-50); // Explicitly negative!
  });
});

describe('canAct', () => {
  it('returns null when no entity has >= 100 AP', () => {
    const scheduler = createScheduler([entity('player', 100), entity('rat', 80)]);
    // No advance, everyone at 0 AP
    expect(canAct(scheduler)).toBeNull();
  });

  it('returns entity with highest AP when >= 100', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);
    // rat has 120 AP, player has 100 AP
    expect(canAct(scheduler)).toBe(entityId('rat'));
  });

  it('returns entity with highest AP among multiple >= 100', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);
    scheduler = advanceScheduler(scheduler);
    // rat has 240 AP, player has 200 AP - both >= 100
    expect(canAct(scheduler)).toBe(entityId('rat'));
  });

  it('breaks ties by entry order (first wins)', () => {
    let scheduler = createScheduler([entity('a', 100), entity('b', 100)]);
    scheduler = advanceScheduler(scheduler);
    // Both have 100 AP - first in list wins
    expect(canAct(scheduler)).toBe(entityId('a'));
  });

  it('returns null for empty scheduler', () => {
    const scheduler = createScheduler([]);
    expect(canAct(scheduler)).toBeNull();
  });
});

describe('completeAction', () => {
  it('deducts ACTION_COST from specified entity', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);
    // rat has 120 AP

    const completed = completeAction(scheduler, entityId('rat'));

    const rat = completed.entries.find(e => e.entityId === entityId('rat'));
    expect(rat?.actionPoints).toBe(20); // 120 - 100 = 20
  });

  it('preserves other entities action points', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);

    const completed = completeAction(scheduler, entityId('rat'));

    const player = completed.entries.find(e => e.entityId === entityId('player'));
    expect(player?.actionPoints).toBe(100); // Unchanged
  });

  it('clears currentActorId if it matches', () => {
    let scheduler = createScheduler([entity('player', 100)]);
    scheduler = advanceScheduler(scheduler);
    expect(scheduler.currentActorId).toBe(entityId('player'));

    const completed = completeAction(scheduler, entityId('player'));

    expect(completed.currentActorId).toBeNull();
  });

  it('preserves currentActorId if different entity', () => {
    let scheduler = createScheduler([entity('player', 100), entity('rat', 120)]);
    scheduler = advanceScheduler(scheduler);
    expect(scheduler.currentActorId).toBe(entityId('rat'));

    const completed = completeAction(scheduler, entityId('player'));

    expect(completed.currentActorId).toBe(entityId('rat'));
  });

  it('logs warning if entity not found', () => {
    const warnings: string[] = [];
    enableSchedulerDebugLogging((msg) => warnings.push(msg));

    const scheduler = createScheduler([entity('player', 100)]);
    completeAction(scheduler, entityId('ghost'));

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('ghost');
  });

  it('returns unchanged scheduler if entity not found', () => {
    const scheduler = createScheduler([entity('player', 100)]);
    const completed = completeAction(scheduler, entityId('ghost'));

    expect(completed.entries).toEqual(scheduler.entries);
  });
});
