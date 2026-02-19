import { describe, it, expect, beforeEach } from 'vitest';
import {
  transitionToAlerted,
  transitionToChase,
  transitionToHunt,
  transitionToSearch,
  transitionToIdle,
  updateBehaviorState,
  handleDamage,
  reachedHuntTarget,
  hasRangedWeapon,
  hasAmmo,
  getOptimalRange,
  getKiteDirection,
  selectRangedAction,
} from '../behavior';
import { createMonster, resetMonsterCounter } from '../monsters';
import type { Entity } from '../types';
import type { ItemInstance } from '../items';
import type { DungeonMap, Tile } from '../map';

/** Default arena size for tests - reduces repetition */
const DEFAULT_ARENA = { width: 20, height: 20 };

describe('behavior state transitions', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  describe('transitionToAlerted', () => {
    it('sets behaviorState to alerted', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const targetPos = { x: 10, y: 10 };

      const result = transitionToAlerted(monster, targetPos);

      expect(result.behaviorState).toBe('alerted');
    });

    it('stores target position as lastKnownTarget', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const targetPos = { x: 10, y: 12 };

      const result = transitionToAlerted(monster, targetPos);

      expect(result.lastKnownTarget).toEqual({ x: 10, y: 12 });
    });

    it('returns a new entity object (immutable)', () => {
      const monster = createMonster('orc', { x: 3, y: 3 }, DEFAULT_ARENA);
      const targetPos = { x: 8, y: 8 };

      const result = transitionToAlerted(monster, targetPos);

      expect(result).not.toBe(monster);
      expect(monster.behaviorState).not.toBe('alerted'); // Original unchanged
    });

    it('preserves other entity fields', () => {
      const monster = createMonster('troll', { x: 2, y: 2 }, DEFAULT_ARENA);
      const targetPos = { x: 15, y: 15 };

      const result = transitionToAlerted(monster, targetPos);

      expect(result.id).toBe(monster.id);
      expect(result.hp).toBe(monster.hp);
      expect(result.x).toBe(monster.x);
      expect(result.y).toBe(monster.y);
      expect(result.monsterTypeId).toBe(monster.monsterTypeId);
    });
  });

  describe('transitionToChase', () => {
    it('sets behaviorState to chase', () => {
      const monster = createMonster('skeleton', { x: 5, y: 5 }, DEFAULT_ARENA);
      const targetPos = { x: 10, y: 10 };

      const result = transitionToChase(monster, targetPos);

      expect(result.behaviorState).toBe('chase');
    });

    it('updates lastKnownTarget with current target position', () => {
      const monster = createMonster('rat', { x: 3, y: 3 }, DEFAULT_ARENA);
      const targetPos = { x: 7, y: 9 };

      const result = transitionToChase(monster, targetPos);

      expect(result.lastKnownTarget).toEqual({ x: 7, y: 9 });
    });

    it('returns a new entity object (immutable)', () => {
      const monster = createMonster('goblin', { x: 4, y: 4 }, DEFAULT_ARENA);
      const targetPos = { x: 12, y: 12 };

      const result = transitionToChase(monster, targetPos);

      expect(result).not.toBe(monster);
    });

    it('can update target when already in chase state', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
      const firstTarget = { x: 8, y: 8 };
      const secondTarget = { x: 12, y: 14 };

      const afterFirst = transitionToChase(monster, firstTarget);
      const afterSecond = transitionToChase(afterFirst, secondTarget);

      expect(afterSecond.lastKnownTarget).toEqual({ x: 12, y: 14 });
    });
  });

  describe('transitionToHunt', () => {
    it('sets behaviorState to hunt', () => {
      // Start with a monster that has a lastKnownTarget from chasing
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const chasing = transitionToChase(monster, { x: 10, y: 10 });

      const result = transitionToHunt(chasing);

      expect(result.behaviorState).toBe('hunt');
    });

    it('preserves lastKnownTarget', () => {
      const monster = createMonster('orc', { x: 3, y: 3 }, DEFAULT_ARENA);
      const chasing = transitionToChase(monster, { x: 15, y: 12 });

      const result = transitionToHunt(chasing);

      expect(result.lastKnownTarget).toEqual({ x: 15, y: 12 });
    });

    it('returns a new entity object (immutable)', () => {
      const monster = createMonster('troll', { x: 4, y: 4 }, DEFAULT_ARENA);
      const chasing = transitionToChase(monster, { x: 8, y: 8 });

      const result = transitionToHunt(chasing);

      expect(result).not.toBe(chasing);
    });
  });

  describe('transitionToSearch', () => {
    it('sets behaviorState to search', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const hunting = transitionToHunt(transitionToChase(monster, { x: 10, y: 10 }));

      const result = transitionToSearch(hunting);

      expect(result.behaviorState).toBe('search');
    });

    it('initializes searchTurnsRemaining from monster type searchDuration', () => {
      // goblin has searchDuration of 5
      const goblin = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const result = transitionToSearch(goblin);
      expect(result.searchTurnsRemaining).toBe(5);

      // rat has searchDuration of 3
      resetMonsterCounter();
      const rat = createMonster('rat', { x: 5, y: 5 }, DEFAULT_ARENA);
      const ratResult = transitionToSearch(rat);
      expect(ratResult.searchTurnsRemaining).toBe(3);

      // skeleton has searchDuration of 10
      resetMonsterCounter();
      const skeleton = createMonster('skeleton', { x: 5, y: 5 }, DEFAULT_ARENA);
      const skeletonResult = transitionToSearch(skeleton);
      expect(skeletonResult.searchTurnsRemaining).toBe(10);
    });

    it('uses default of 5 for entities without monsterTypeId', () => {
      // Create an entity without monsterTypeId (edge case)
      const entity: Entity = {
        id: 'custom-monster',
        type: 'monster',
        x: 5,
        y: 5,
        hp: 10,
        maxHp: 10,
        name: 'Custom',
        attack: 2,
        defense: 1,
        speed: 100,
        areaId: 'area-1',
        monsterTypeId: undefined as unknown as 'goblin', // Cast to satisfy type but missing value
      };

      // Remove the monsterTypeId to simulate edge case
      const entityWithoutType = { ...entity, monsterTypeId: undefined };

      const result = transitionToSearch(entityWithoutType as Entity);
      expect(result.searchTurnsRemaining).toBe(5);
    });

    it('returns a new entity object (immutable)', () => {
      const monster = createMonster('orc', { x: 3, y: 3 }, DEFAULT_ARENA);

      const result = transitionToSearch(monster);

      expect(result).not.toBe(monster);
    });
  });

  describe('transitionToIdle', () => {
    it('sets behaviorState to idle', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        lastKnownTarget: { x: 10, y: 10 },
        searchTurnsRemaining: 3,
      };

      const result = transitionToIdle(searching);

      expect(result.behaviorState).toBe('idle');
    });

    it('clears searchTurnsRemaining', () => {
      const monster = createMonster('orc', { x: 3, y: 3 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        lastKnownTarget: { x: 8, y: 8 },
        searchTurnsRemaining: 5,
      };

      const result = transitionToIdle(searching);

      expect(result.searchTurnsRemaining).toBeUndefined();
    });

    it('clears lastKnownTarget', () => {
      const monster = createMonster('troll', { x: 4, y: 4 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        lastKnownTarget: { x: 12, y: 12 },
        searchTurnsRemaining: 2,
      };

      const result = transitionToIdle(searching);

      expect(result.lastKnownTarget).toBeUndefined();
    });

    it('returns a new entity object (immutable)', () => {
      const monster = createMonster('skeleton', { x: 6, y: 6 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        lastKnownTarget: { x: 10, y: 10 },
        searchTurnsRemaining: 7,
      };

      const result = transitionToIdle(searching);

      expect(result).not.toBe(searching);
    });

    it('preserves core entity fields', () => {
      const monster = createMonster('rat', { x: 2, y: 2 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        lastKnownTarget: { x: 5, y: 5 },
        searchTurnsRemaining: 2,
      };

      const result = transitionToIdle(searching);

      expect(result.id).toBe(monster.id);
      expect(result.hp).toBe(monster.hp);
      expect(result.x).toBe(monster.x);
      expect(result.y).toBe(monster.y);
      expect(result.monsterTypeId).toBe(monster.monsterTypeId);
      expect(result.attack).toBe(monster.attack);
      expect(result.defense).toBe(monster.defense);
    });
  });
});

describe('updateBehaviorState', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  describe('from patrol state', () => {
    it('transitions to alerted when seeing player', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const patrolling: Entity = { ...monster, behaviorState: 'patrol' };
      const playerPos = { x: 10, y: 10 };

      const result = updateBehaviorState(patrolling, true, playerPos);

      expect(result.behaviorState).toBe('alerted');
      expect(result.lastKnownTarget).toEqual({ x: 10, y: 10 });
    });

    it('stays in patrol when not seeing player', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const patrolling: Entity = { ...monster, behaviorState: 'patrol' };

      const result = updateBehaviorState(patrolling, false, null);

      expect(result.behaviorState).toBe('patrol');
      expect(result).toBe(patrolling); // Same object reference - no change
    });
  });

  describe('from alerted state', () => {
    it('transitions to chase when seeing player', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
      const alerted: Entity = {
        ...monster,
        behaviorState: 'alerted',
        lastKnownTarget: { x: 8, y: 8 },
      };
      const playerPos = { x: 10, y: 10 };

      const result = updateBehaviorState(alerted, true, playerPos);

      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 10, y: 10 });
    });

    it('transitions to chase toward last known even when losing sight', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
      const alerted: Entity = {
        ...monster,
        behaviorState: 'alerted',
        lastKnownTarget: { x: 8, y: 8 },
      };

      const result = updateBehaviorState(alerted, false, null);

      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 8, y: 8 });
    });
  });

  describe('from chase state', () => {
    it('updates target when still seeing player', () => {
      const monster = createMonster('troll', { x: 5, y: 5 }, DEFAULT_ARENA);
      const chasing: Entity = {
        ...monster,
        behaviorState: 'chase',
        lastKnownTarget: { x: 8, y: 8 },
      };
      const newPlayerPos = { x: 12, y: 14 };

      const result = updateBehaviorState(chasing, true, newPlayerPos);

      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 12, y: 14 });
    });

    it('transitions to hunt when losing sight of player', () => {
      const monster = createMonster('skeleton', { x: 5, y: 5 }, DEFAULT_ARENA);
      const chasing: Entity = {
        ...monster,
        behaviorState: 'chase',
        lastKnownTarget: { x: 10, y: 10 },
      };

      const result = updateBehaviorState(chasing, false, null);

      expect(result.behaviorState).toBe('hunt');
      expect(result.lastKnownTarget).toEqual({ x: 10, y: 10 });
    });
  });

  describe('from hunt state', () => {
    it('transitions to chase when seeing player again', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const hunting: Entity = {
        ...monster,
        behaviorState: 'hunt',
        lastKnownTarget: { x: 8, y: 8 },
      };
      const playerPos = { x: 15, y: 12 };

      const result = updateBehaviorState(hunting, true, playerPos);

      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 15, y: 12 });
    });

    it('stays in hunt when not seeing player', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const hunting: Entity = {
        ...monster,
        behaviorState: 'hunt',
        lastKnownTarget: { x: 8, y: 8 },
      };

      const result = updateBehaviorState(hunting, false, null);

      expect(result.behaviorState).toBe('hunt');
      expect(result).toBe(hunting); // Same object reference - no change
    });
  });

  describe('from search state', () => {
    it('transitions to chase when seeing player', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        searchTurnsRemaining: 3,
      };
      const playerPos = { x: 10, y: 10 };

      const result = updateBehaviorState(searching, true, playerPos);

      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 10, y: 10 });
    });

    it('decrements timer when not seeing player', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        searchTurnsRemaining: 3,
      };

      const result = updateBehaviorState(searching, false, null);

      expect(result.behaviorState).toBe('search');
      expect(result.searchTurnsRemaining).toBe(2);
    });

    it('transitions to idle when timer expires', () => {
      const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        searchTurnsRemaining: 1,
      };

      const result = updateBehaviorState(searching, false, null);

      expect(result.behaviorState).toBe('idle');
      expect(result.searchTurnsRemaining).toBeUndefined();
    });

    it('transitions to idle when timer is already 0', () => {
      const monster = createMonster('troll', { x: 5, y: 5 }, DEFAULT_ARENA);
      const searching: Entity = {
        ...monster,
        behaviorState: 'search',
        searchTurnsRemaining: 0,
      };

      const result = updateBehaviorState(searching, false, null);

      expect(result.behaviorState).toBe('idle');
    });
  });

  describe('from idle state', () => {
    it('transitions to chase when seeing player', () => {
      const monster = createMonster('rat', { x: 5, y: 5 }, DEFAULT_ARENA);
      const idle: Entity = { ...monster, behaviorState: 'idle' };
      const playerPos = { x: 8, y: 8 };

      const result = updateBehaviorState(idle, true, playerPos);

      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 8, y: 8 });
    });

    it('stays in idle when not seeing player', () => {
      const monster = createMonster('rat', { x: 5, y: 5 }, DEFAULT_ARENA);
      const idle: Entity = { ...monster, behaviorState: 'idle' };

      const result = updateBehaviorState(idle, false, null);

      expect(result.behaviorState).toBe('idle');
      expect(result).toBe(idle); // Same object reference - no change
    });
  });

  describe('default behavior', () => {
    it('treats undefined behaviorState as chase (aggressive default)', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      // Monster without explicit behaviorState
      const playerPos = { x: 10, y: 10 };

      const result = updateBehaviorState(monster, true, playerPos);

      // Should behave as chase - update target
      expect(result.behaviorState).toBe('chase');
      expect(result.lastKnownTarget).toEqual({ x: 10, y: 10 });
    });

    it('transitions from undefined state to hunt when losing sight', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      // Monster without explicit behaviorState (defaults to chase)

      const result = updateBehaviorState(monster, false, null);

      // Should behave as chase → hunt
      expect(result.behaviorState).toBe('hunt');
    });
  });

  describe('immutability', () => {
    it('returns new object when state changes', () => {
      const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
      const patrolling: Entity = { ...monster, behaviorState: 'patrol' };
      const playerPos = { x: 10, y: 10 };

      const result = updateBehaviorState(patrolling, true, playerPos);

      expect(result).not.toBe(patrolling);
    });

    it('preserves entity fields through transitions', () => {
      const monster = createMonster('orc', { x: 3, y: 4 }, DEFAULT_ARENA);
      const patrolling: Entity = { ...monster, behaviorState: 'patrol' };
      const playerPos = { x: 10, y: 10 };

      const result = updateBehaviorState(patrolling, true, playerPos);

      expect(result.id).toBe(monster.id);
      expect(result.x).toBe(3);
      expect(result.y).toBe(4);
      expect(result.hp).toBe(monster.hp);
      expect(result.monsterTypeId).toBe('orc');
    });
  });
});

describe('reachedHuntTarget', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('transitions from hunt to search when at target', () => {
    let monster = createMonster('goblin', { x: 10, y: 10 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'hunt', lastKnownTarget: { x: 10, y: 10 } };
    const result = reachedHuntTarget(monster);
    expect(result.behaviorState).toBe('search');
    expect(result.searchTurnsRemaining).toBe(5); // goblin searchDuration
  });

  it('returns unchanged if not in hunt state', () => {
    let monster = createMonster('goblin', { x: 10, y: 10 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'chase' };
    const result = reachedHuntTarget(monster);
    expect(result.behaviorState).toBe('chase');
    expect(result).toBe(monster); // Same object
  });

  it('returns unchanged if not at target position', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'hunt', lastKnownTarget: { x: 10, y: 10 } };
    const result = reachedHuntTarget(monster);
    expect(result.behaviorState).toBe('hunt');
    expect(result).toBe(monster); // Same object
  });

  it('transitions to search if no target (edge case)', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'hunt', lastKnownTarget: undefined };
    const result = reachedHuntTarget(monster);
    expect(result.behaviorState).toBe('search');
  });
});

describe('handleDamage', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('transitions patrol to alerted', () => {
    let monster = createMonster('skeleton', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'patrol' };
    const result = handleDamage(monster, { x: 8, y: 8 });
    expect(result.behaviorState).toBe('alerted');
    expect(result.lastKnownTarget).toEqual({ x: 8, y: 8 });
  });

  it('transitions idle to alerted', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'idle' };
    const result = handleDamage(monster, { x: 8, y: 8 });
    expect(result.behaviorState).toBe('alerted');
  });

  it('transitions search to alerted', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'search', searchTurnsRemaining: 3 };
    const result = handleDamage(monster, { x: 8, y: 8 });
    expect(result.behaviorState).toBe('alerted');
  });

  it('keeps chase in chase but updates target', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'chase', lastKnownTarget: { x: 10, y: 10 } };
    const result = handleDamage(monster, { x: 8, y: 8 });
    expect(result.behaviorState).toBe('chase');
    expect(result.lastKnownTarget).toEqual({ x: 8, y: 8 });
  });

  it('keeps alerted and updates target via chase transition', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'alerted', lastKnownTarget: { x: 10, y: 10 } };
    const result = handleDamage(monster, { x: 8, y: 8 });
    // Alerted monsters switch to chase when updating target (transitionToChase is called)
    expect(result.behaviorState).toBe('chase');
    expect(result.lastKnownTarget).toEqual({ x: 8, y: 8 });
  });

  it('transitions hunt to alerted', () => {
    let monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    monster = { ...monster, behaviorState: 'hunt', lastKnownTarget: { x: 10, y: 10 } };
    const result = handleDamage(monster, { x: 8, y: 8 });
    expect(result.behaviorState).toBe('alerted');
  });

  it('returns a new entity object (immutable)', () => {
    const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
    const patrolling: Entity = { ...monster, behaviorState: 'patrol' };
    const result = handleDamage(patrolling, { x: 8, y: 8 });
    expect(result).not.toBe(patrolling);
  });

  it('preserves entity fields', () => {
    const monster = createMonster('troll', { x: 3, y: 4 }, DEFAULT_ARENA);
    const idle: Entity = { ...monster, behaviorState: 'idle' };
    const result = handleDamage(idle, { x: 10, y: 10 });
    expect(result.id).toBe(monster.id);
    expect(result.x).toBe(3);
    expect(result.y).toBe(4);
    expect(result.hp).toBe(monster.hp);
    expect(result.monsterTypeId).toBe('troll');
  });
});

describe('edge cases', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('treats canSeePlayer=true with null position as cannot see player (patrol)', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const patrolling: Entity = { ...monster, behaviorState: 'patrol' };

    // Bug scenario: caller says canSee=true but forgot position
    const result = updateBehaviorState(patrolling, true, null);

    // Stays in patrol because playerPosition is null
    expect(result.behaviorState).toBe('patrol');
    expect(result).toBe(patrolling);
  });

  it('transitions alerted state without lastKnownTarget to idle (defensive)', () => {
    const monster = createMonster('orc', { x: 5, y: 5 }, DEFAULT_ARENA);
    // Invalid state: alerted without lastKnownTarget (schema violation)
    const alerted: Entity = {
      ...monster,
      behaviorState: 'alerted',
      // lastKnownTarget intentionally omitted
    } as Entity;

    const result = updateBehaviorState(alerted, false, null);

    // Defensive behavior: transitions to idle when target is missing
    expect(result.behaviorState).toBe('idle');
  });

  it('handles missing searchTurnsRemaining with default of 1 (transitions to idle)', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    // Invalid state: search without searchTurnsRemaining (schema violation)
    const searching: Entity = {
      ...monster,
      behaviorState: 'search',
      lastKnownTarget: { x: 10, y: 10 },
      // searchTurnsRemaining intentionally omitted
    } as Entity;

    const result = updateBehaviorState(searching, false, null);

    // Default 1, then decrement to 0, then transition to idle
    expect(result.behaviorState).toBe('idle');
  });

  it('follows full detection -> pursuit -> loss -> search -> idle cycle', () => {
    let monster = createMonster('skeleton', { x: 5, y: 5 }, DEFAULT_ARENA);
    // Skeleton starts in patrol
    expect(monster.behaviorState).toBe('patrol');

    // 1. Patrol -> Alerted (spot player)
    monster = updateBehaviorState(monster, true, { x: 10, y: 10 });
    expect(monster.behaviorState).toBe('alerted');

    // 2. Alerted -> Chase (next turn)
    monster = updateBehaviorState(monster, true, { x: 11, y: 10 });
    expect(monster.behaviorState).toBe('chase');

    // 3. Chase -> Hunt (lose sight)
    monster = updateBehaviorState(monster, false, null);
    expect(monster.behaviorState).toBe('hunt');

    // 4. Hunt -> Search (reach target)
    monster = { ...monster, x: 11, y: 10 };
    monster = reachedHuntTarget(monster);
    expect(monster.behaviorState).toBe('search');
    expect(monster.searchTurnsRemaining).toBe(10); // skeleton searchDuration

    // 5. Search countdown (skeleton has 10 turns)
    for (let i = 9; i >= 1; i--) {
      monster = updateBehaviorState(monster, false, null);
      expect(monster.behaviorState).toBe('search');
      expect(monster.searchTurnsRemaining).toBe(i);
    }

    // 6. Search -> Idle (timer expires)
    monster = updateBehaviorState(monster, false, null);
    expect(monster.behaviorState).toBe('idle');
    expect(monster.searchTurnsRemaining).toBeUndefined();
    expect(monster.lastKnownTarget).toBeUndefined();
  });
});

// --- Task 7: Ranged Behavior Utility Functions ---

describe('hasRangedWeapon', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('returns true for bow equipped', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withBow: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'bow-1',
        templateId: 'shortbow',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
    };
    expect(hasRangedWeapon(withBow)).toBe(true);
  });

  it('returns true for thrown weapon equipped', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withThrown: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'dagger-1',
        templateId: 'throwing_dagger',
        x: 0,
        y: 0,
        areaId: 'area-1',
        quantity: 3,
      },
    };
    expect(hasRangedWeapon(withThrown)).toBe(true);
  });

  it('returns false for melee weapon', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withMelee: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'sword-1',
        templateId: 'short_sword',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
    };
    expect(hasRangedWeapon(withMelee)).toBe(false);
  });

  it('returns false when no weapon equipped', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const noWeapon: Entity = {
      ...monster,
      equippedWeapon: null,
    };
    expect(hasRangedWeapon(noWeapon)).toBe(false);
  });

  it('returns false when equippedWeapon is undefined', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    expect(hasRangedWeapon(monster)).toBe(false);
  });
});

describe('hasAmmo', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('returns true for bow with quiver containing arrows', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withBowAndQuiver: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'bow-1',
        templateId: 'shortbow',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
      equippedOffhand: {
        id: 'quiver-1',
        templateId: 'leather_quiver',
        x: 0,
        y: 0,
        areaId: 'area-1',
        currentAmmo: 15,
      },
    };
    expect(hasAmmo(withBowAndQuiver)).toBe(true);
  });

  it('returns false for bow with empty quiver', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withBowEmptyQuiver: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'bow-1',
        templateId: 'shortbow',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
      equippedOffhand: {
        id: 'quiver-1',
        templateId: 'leather_quiver',
        x: 0,
        y: 0,
        areaId: 'area-1',
        currentAmmo: 0,
      },
    };
    expect(hasAmmo(withBowEmptyQuiver)).toBe(false);
  });

  it('returns false for bow without quiver', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withBowNoQuiver: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'bow-1',
        templateId: 'shortbow',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
      equippedOffhand: null,
    };
    expect(hasAmmo(withBowNoQuiver)).toBe(false);
  });

  it('returns true for thrown weapon with quantity > 0', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withThrown: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'dagger-1',
        templateId: 'throwing_dagger',
        x: 0,
        y: 0,
        areaId: 'area-1',
        quantity: 3,
      },
    };
    expect(hasAmmo(withThrown)).toBe(true);
  });

  it('returns false for thrown weapon with quantity 0 or undefined', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withEmptyThrown: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'dagger-1',
        templateId: 'throwing_dagger',
        x: 0,
        y: 0,
        areaId: 'area-1',
        quantity: 0,
      },
    };
    expect(hasAmmo(withEmptyThrown)).toBe(false);
  });

  it('returns false when no ranged weapon equipped', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withMelee: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'sword-1',
        templateId: 'short_sword',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
    };
    expect(hasAmmo(withMelee)).toBe(false);
  });
});

describe('getOptimalRange', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  it('returns floor(range * 0.75) for shortbow (range 6 -> 4)', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withBow: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'bow-1',
        templateId: 'shortbow',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
    };
    expect(getOptimalRange(withBow)).toBe(4);
  });

  it('returns floor(range * 0.75) for throwing_dagger (range 4 -> 3)', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withThrown: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'dagger-1',
        templateId: 'throwing_dagger',
        x: 0,
        y: 0,
        areaId: 'area-1',
        quantity: 5,
      },
    };
    expect(getOptimalRange(withThrown)).toBe(3);
  });

  it('returns 0 when no ranged weapon equipped', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    expect(getOptimalRange(monster)).toBe(0);
  });

  it('returns 0 for melee weapon', () => {
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const withMelee: Entity = {
      ...monster,
      equippedWeapon: {
        id: 'sword-1',
        templateId: 'short_sword',
        x: 0,
        y: 0,
        areaId: 'area-1',
      },
    };
    expect(getOptimalRange(withMelee)).toBe(0);
  });
});

// --- Task 8: getKiteDirection ---

/**
 * Helper to create a simple test map with all floor tiles.
 */
function createTestMap(width: number, height: number, walls: Array<{ x: number; y: number }> = []): DungeonMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = { type: 'floor' };
    }
  }
  // Add walls around the edges
  for (let x = 0; x < width; x++) {
    tiles[0][x] = { type: 'wall' };
    tiles[height - 1][x] = { type: 'wall' };
  }
  for (let y = 0; y < height; y++) {
    tiles[y][0] = { type: 'wall' };
    tiles[y][width - 1] = { type: 'wall' };
  }
  // Add custom walls
  for (const wall of walls) {
    if (wall.y >= 0 && wall.y < height && wall.x >= 0 && wall.x < width) {
      tiles[wall.y][wall.x] = { type: 'wall' };
    }
  }
  return {
    width,
    height,
    tiles,
    rooms: [],
    seed: 12345,
  };
}

describe('getKiteDirection', () => {
  it('returns direction away from target when retreat is possible', () => {
    // Monster at (5, 5), target at (5, 3) (north of monster)
    // Monster should retreat south
    const map = createTestMap(10, 10);
    const result = getKiteDirection({ x: 5, y: 5 }, { x: 5, y: 3 }, map);
    expect(result).toBe('south');
  });

  it('prefers cardinal directions over diagonals', () => {
    // Monster at (5, 5), target at (4, 4) (northwest of monster)
    // Both south and east increase distance equally, but south/east are cardinal
    const map = createTestMap(10, 10);
    const result = getKiteDirection({ x: 5, y: 5 }, { x: 4, y: 4 }, map);
    // Should pick a cardinal direction (south or east)
    expect(['south', 'east']).toContain(result);
  });

  it('returns null when cornered (no valid retreat)', () => {
    // Monster at (1, 1), all adjacent positions are walls except toward target
    const walls = [
      { x: 1, y: 2 }, // south
      { x: 2, y: 1 }, // east
      { x: 2, y: 2 }, // southeast
    ];
    const map = createTestMap(10, 10, walls);
    // Target at (3, 3), monster at (1, 1) - only escape is toward target
    const result = getKiteDirection({ x: 1, y: 1 }, { x: 3, y: 3 }, map);
    // Since all positions either move toward target or are blocked, should return null
    expect(result).toBeNull();
  });

  it('avoids walls when choosing retreat direction', () => {
    // Monster at (5, 5), target at (5, 3)
    // Wall at (5, 6) blocking south, should retreat southeast or southwest
    const walls = [{ x: 5, y: 6 }];
    const map = createTestMap(10, 10, walls);
    const result = getKiteDirection({ x: 5, y: 5 }, { x: 5, y: 3 }, map);
    expect(['southeast', 'southwest']).toContain(result);
  });

  it('returns direction that maximizes distance from target', () => {
    // Monster at (5, 5), target at (3, 5) (west of monster)
    // Should retreat east to maximize distance
    const map = createTestMap(10, 10);
    const result = getKiteDirection({ x: 5, y: 5 }, { x: 3, y: 5 }, map);
    expect(result).toBe('east');
  });

  it('handles edge case when monster is at map edge', () => {
    // Monster at (2, 5), target at (4, 5)
    // West is blocked by wall at x=0, but (1, 5) is valid floor
    const map = createTestMap(10, 10);
    const result = getKiteDirection({ x: 2, y: 5 }, { x: 4, y: 5 }, map);
    // Should retreat west to increase distance
    expect(result).toBe('west');
  });

  it('returns null when no direction increases distance', () => {
    // Monster at (1, 5), target at (3, 5)
    // West is wall, north/south don't increase Chebyshev distance
    const map = createTestMap(10, 10);
    const result = getKiteDirection({ x: 1, y: 5 }, { x: 3, y: 5 }, map);
    // With Chebyshev distance, moving perpendicular doesn't help
    // Only moving away (west) would help, but that's a wall
    expect(result).toBeNull();
  });
});

// --- Task 9: selectRangedAction ---

describe('selectRangedAction', () => {
  beforeEach(() => {
    resetMonsterCounter();
  });

  /**
   * Helper to create monster with ranged weapon setup
   */
  function createRangedMonster(
    position: { x: number; y: number },
    options: {
      weapon: 'shortbow' | 'throwing_dagger';
      hasAmmo: boolean;
    }
  ): Entity {
    const monster = createMonster('goblin_archer', position, DEFAULT_ARENA);

    if (options.weapon === 'shortbow') {
      return {
        ...monster,
        equippedWeapon: {
          id: 'bow-1',
          templateId: 'shortbow',
          x: 0,
          y: 0,
          areaId: 'area-1',
        },
        equippedOffhand: options.hasAmmo
          ? {
              id: 'quiver-1',
              templateId: 'leather_quiver',
              x: 0,
              y: 0,
              areaId: 'area-1',
              currentAmmo: 10,
            }
          : {
              id: 'quiver-1',
              templateId: 'leather_quiver',
              x: 0,
              y: 0,
              areaId: 'area-1',
              currentAmmo: 0,
            },
      };
    }

    return {
      ...monster,
      equippedWeapon: {
        id: 'dagger-1',
        templateId: 'throwing_dagger',
        x: 0,
        y: 0,
        areaId: 'area-1',
        quantity: options.hasAmmo ? 5 : 0,
      },
    };
  }

  it('returns ranged_attack when target at optimal range', () => {
    // Shortbow: range 6, optimal = 4
    // Monster at (5, 5), target at (5, 1) - distance 4
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 1 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('ranged_attack');
  });

  it('returns ranged_attack when target within weapon range', () => {
    // Shortbow: range 6
    // Monster at (5, 5), target at (5, 2) - distance 3
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 2 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('ranged_attack');
  });

  it('returns move toward when target too far (> weapon range)', () => {
    // Shortbow: range 6
    // Monster at (5, 5), target at (5, 13) - distance 8 (> 6)
    const map = createTestMap(20, 20);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 13 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('move');
    // Should move south toward target
    expect((result as { direction: string }).direction).toBe('south');
  });

  it('returns move away when target too close (< optimal - 1)', () => {
    // Shortbow: range 6, optimal = 4
    // Monster at (5, 5), target at (5, 3) - distance 2 (< optimal - 1 = 3)
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 3 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('move');
    // Should move south (away from target that is north)
    expect((result as { direction: string }).direction).toBe('south');
  });

  it('returns null when adjacent (fall back to melee)', () => {
    // Monster at (5, 5), target at (5, 4) - distance 1
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 4 }, map);

    // Adjacent = melee range, fall back to melee behavior
    expect(result).toBeNull();
  });

  it('returns null when out of ammo', () => {
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: false });
    const result = selectRangedAction(monster, { x: 5, y: 1 }, map);

    expect(result).toBeNull();
  });

  it('returns null when no ranged weapon equipped', () => {
    const map = createTestMap(15, 15);
    const monster = createMonster('goblin', { x: 5, y: 5 }, DEFAULT_ARENA);
    const result = selectRangedAction(monster, { x: 5, y: 1 }, map);

    expect(result).toBeNull();
  });

  it('includes correct direction and distance in ranged_attack action', () => {
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    // Target directly north at distance 4
    const result = selectRangedAction(monster, { x: 5, y: 1 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('ranged_attack');
    expect((result as { direction: string }).direction).toBe('north');
    expect((result as { distance: number }).distance).toBe(4);
  });

  it('handles diagonal targets correctly', () => {
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    // Target at northeast diagonal, distance 3
    const result = selectRangedAction(monster, { x: 8, y: 2 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('ranged_attack');
    expect((result as { direction: string }).direction).toBe('northeast');
    expect((result as { distance: number }).distance).toBe(3);
  });

  it('returns ranged_attack at boundary of weapon range', () => {
    // Shortbow: range 6
    // Monster at (5, 5), target at (5, 11) - distance exactly 6
    const map = createTestMap(20, 20);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'shortbow', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 11 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('ranged_attack');
    expect((result as { distance: number }).distance).toBe(6);
  });

  it('works with thrown weapons', () => {
    // Throwing dagger: range 4, optimal = 3
    const map = createTestMap(15, 15);
    const monster = createRangedMonster({ x: 5, y: 5 }, { weapon: 'throwing_dagger', hasAmmo: true });
    const result = selectRangedAction(monster, { x: 5, y: 2 }, map);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('ranged_attack');
    expect((result as { distance: number }).distance).toBe(3);
  });
});
