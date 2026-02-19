# Scheduler Redesign: Independent Bubble Time with Command Queuing

**Date:** 2026-01-10
**Status:** Proposed
**Related Issues:** Troll/goblin movement bugs, multiplayer foundation

## Problem Statement

The current scheduler has fundamental issues:

1. **Slow monsters don't get turns** - A speed-80 troll can never "win" the AP race against faster entities because `advanceScheduler` gives everyone AP proportional to speed, widening the gap each tick.

2. **Batching assumes crawler primacy** - The loop "process monsters until crawler has highest AP" doesn't generalize to multiple crawlers with different speeds.

3. **Hardcoded assumptions** - Fixes assume player speed is 100, which breaks if crawlers have variable speeds.

4. **Synchronous input model** - `processAction` blocks until the action is processed, which doesn't fit multiplayer where players act independently.

## Existing Implementation

### Bubble System (`bubble.ts`) - Keep As-Is

The bubble lifecycle is well-implemented and remains unchanged:

| Function | Purpose | Status |
|----------|---------|--------|
| `mergeBubbles(a, b)` | Combine entity lists, take max AP | Extend with tick sync |
| `splitBubble(bubble, state)` | Split when crawlers distant | Keep |
| `shouldMerge(a, b, entities)` | Distance-based merge detection | Keep |
| `reconcileBubbles(state)` | Orchestrate merge/split/hibernate | Keep |
| `wakeNearbyEntities()` | Wake hibernating entities | Keep |
| `hibernateBubble()` | Hibernate crawler-less bubbles | Keep |
| `checkTimeout(bubble, now)` | Detect input timeout | Keep |

### Execution State Machine - Keep As-Is

The `BubbleExecutionState` is already implemented:
- `idle` - No turn in progress
- `processing` - Action being resolved
- `paused` - Merge negotiation
- `awaiting_input` - Waiting for crawler input

This integrates with command queuing: when a crawler's turn comes and queue is empty, transition to `awaiting_input`. When command arrives, transition to `processing`.

### Scheduler (`scheduler.ts`) - Modify

Current functions:

| Function | Current Behavior | Change Needed |
|----------|------------------|---------------|
| `advanceScheduler` | Adds AP AND sets currentActorId | Decouple: only add AP |
| `completeCurrentTurn` | Deducts 100 AP from currentActorId | Rename to `completeAction(entityId)` |
| `createScheduler` | Initialize with 0 AP | Keep |
| `addToScheduler` | Add entity with 0 AP | Keep |
| `removeFromScheduler` | Remove entity | Keep |

New function needed: `canAct()` - query who has highest AP >= 100.

### Action Processing (`actions.ts`) - Replace

Current `processAction` has embedded:
- Turn validation
- Monster batching loop
- "Slow monster fairness" hack (lines 501-544)
- Message generation

All of this gets replaced by the new simulation loop.

### What This Design Adds

1. **Tick counter** - Bubbles have no logical clock
2. **Fast-forward reconciliation** - Merge synchronizes time, not just max AP
3. **Command queues** - Per-crawler FIFO queues don't exist
4. **Scheduler refactoring** - Extract `canAct()` as separate query
5. **Simulation loop** - Replace monster batching with proper simulation

## Design Goals

1. **Speed-proportional turns** - A speed-80 entity gets ~0.8 turns per speed-100 entity turn
2. **Uniform rules** - Same mechanics for crawlers and monsters
3. **Independent bubble simulation** - Bubbles run at their own pace
4. **Non-blocking input** - Commands queue; simulation runs independently
5. **Multiplayer-ready** - Multiple crawlers in one bubble work naturally
6. **Pluggable scheduler** - Engine supports different turn paradigms (AP, initiative, etc.)

## Scheduler Paradigms (OSS Extensibility)

The engine should support multiple scheduler paradigms through a pluggable interface. This is critical for OSS adoption - different games have different turn models.

### Paradigm 1: AP Accumulation (Roguelike)

**Used by:** Crawl, ToME, many roguelikes

- Speed determines turn *frequency*
- Faster entities get more turns over time
- Speed 120 entity gets ~1.2x turns vs speed 100

```typescript
interface APScheduler {
  type: 'ap_accumulation';
  canAct(state: SchedulerState): EntityId | null;
  completeAction(state: SchedulerState, entityId: EntityId): SchedulerState;
  advanceTick(state: SchedulerState): SchedulerState;
}
```

### Paradigm 2: Initiative Order (D&D/CRPG)

**Used by:** D&D 5e, Baldur's Gate, Pathfinder

- Initiative determines turn *order*, not frequency
- Everyone gets exactly 1 turn per round
- Fixed order for entire combat encounter

```typescript
interface InitiativeScheduler {
  type: 'initiative';
  rollInitiative(entities: Entity[]): InitiativeOrder;
  nextInOrder(state: SchedulerState): EntityId;
  advanceRound(state: SchedulerState): SchedulerState;
}
```

Key differences:
- Reactions (act on others' turns) require interrupt mechanism
- No speed-based turn ratio - everyone equal
- Initiative ties broken by DEX, then coin flip

### Paradigm 3: Simultaneous Resolution (Tactics)

**Used by:** Frozen Synapse, some tactical games

- All entities plan moves simultaneously
- Resolution phase executes all at once
- Conflicts resolved by priority rules

### Scheduler Interface (Future Work)

```typescript
interface Scheduler<TState> {
  /** Who can act now? Returns null if no one (advance time) */
  getNextActor(state: TState): EntityId | null;

  /** Complete an entity's action */
  completeAction(state: TState, entityId: EntityId): TState;

  /** Advance time/round when no one can act */
  advanceTime(state: TState): TState;

  /** Add entity to scheduler */
  addEntity(state: TState, entity: EntitySpeed): TState;

  /** Remove entity from scheduler */
  removeEntity(state: TState, entityId: EntityId): TState;
}
```

This design focuses on **Paradigm 1 (AP Accumulation)** but the architecture should not preclude swapping schedulers. Key coupling points to avoid:

1. **Don't hardcode 100 AP cost** - Make it configurable
2. **Don't assume speed = frequency** - Initiative mode has different semantics
3. **Keep scheduler state opaque** - Bubble holds `scheduler: TSchedulerState`
4. **Simulation loop calls scheduler interface** - Not specific implementation

## Research: MMO Patterns

Research into MMO architecture revealed key patterns:

- **Tick-based simulation** - All MMOs use discrete time steps (20-60 Hz), not continuous time
- **Independent zones** - EVE Online runs one process per Solar System; zones don't stay synchronized
- **Reconciliation on merge** - When zones interact, server reconciles "like a git merge"
- **Planning phases** - Turn-based MMOs (FEUDUMS) queue commands during planning, execute simultaneously
- **Interest management** - Filter updates by relevance (distance, line-of-sight) - this is what bubbles do

Sources:
- [Source Engine Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- [FEUDUMS Turn-Based Architecture](https://www.indiedb.com/features/feudums-the-anatomy-of-a-turn-based-mmo)
- [Gabriel Gambetta - Client-Server Architecture](https://www.gabrielgambetta.com/client-server-game-architecture.html)

## Architecture

### 1. Scheduler as Pure Oracle

The scheduler becomes a stateless query/command system:

```typescript
// Query: Who can act right now?
function canAct(scheduler: SchedulerState): EntityId | null;
// Returns entity with highest AP if AP >= 100, else null

// Command: Entity completed their action
function completeAction(scheduler: SchedulerState, entityId: EntityId): SchedulerState;
// Deducts 100 AP from the entity

// Command: Advance time (when no one can act)
function advanceScheduler(scheduler: SchedulerState): SchedulerState;
// Everyone gains AP equal to their speed
```

**Key invariant:** After any operation, either someone has >= 100 AP (they should act) or no one does (call `advanceScheduler`).

### 2. Independent Bubble Time

Each bubble maintains its own tick counter:

```typescript
interface Bubble {
  id: BubbleId;
  entityIds: EntityId[];
  scheduler: SchedulerState;
  tick: number;  // NEW: Logical clock for this bubble
  commandQueues: Map<EntityId, Action[]>;  // NEW: Per-crawler queues
}
```

Bubbles run independently:
- Bubble A might be at tick 1000
- Bubble B might be at tick 850
- This is fine - they're isolated simulations

### 3. Command Queuing

Crawlers have command queues instead of synchronous input:

```typescript
interface CommandQueue {
  entityId: EntityId;
  commands: Action[];  // FIFO queue
  maxSize: number;     // Prevent unbounded growth (e.g., 10)
}
```

Input flow:
1. Player presses key → action appended to their queue
2. Simulation runs → pops from queue when it's their turn
3. Empty queue when turn comes → auto-wait (no blocking)

### 4. Simulation Loop

Each bubble processes turns independently:

```typescript
function simulateBubble(bubble: Bubble, entities: EntityMap, maxIterations: number): SimulationResult {
  let iterations = 0;

  while (iterations < maxIterations) {
    const actorId = canAct(bubble.scheduler);

    if (!actorId) {
      // No one can act - advance time
      bubble.scheduler = advanceScheduler(bubble.scheduler);
      bubble.tick++;
      continue;
    }

    const entity = entities[actorId];
    let action: Action;

    if (isCrawler(entity)) {
      const queue = bubble.commandQueues.get(actorId);
      if (!queue || queue.length === 0) {
        // No command queued - auto-wait
        action = { action: 'wait' };
      } else {
        action = queue.shift()!;
      }
    } else {
      // Monster - run AI
      action = computeMonsterAI(entity, entities, bubble);
    }

    // Execute action
    entities = executeAction(entities, actorId, action);
    bubble.scheduler = completeAction(bubble.scheduler, actorId);
    iterations++;

    // Check win/lose conditions
    if (checkGameEnd(entities)) break;
  }

  return { bubble, entities, iterations };
}
```

### 5. Bubble Merging

When entities from different bubbles come into contact:

**Detection:** Position-based check during movement processing.

**Merge Strategy: Fast-Forward**
1. Identify slower bubble (lower tick count)
2. Fast-forward slower bubble by auto-waiting all entities until ticks match
3. Merge entity lists and scheduler entries
4. Continue as unified bubble

Why fast-forward (not rewind/replay):
- Simpler implementation
- No gameplay impact - entities weren't interacting anyway
- "Lost" ticks just become auto-waits

```typescript
function mergeBubbles(a: Bubble, b: Bubble, entities: EntityMap): Bubble {
  const [behind, ahead] = a.tick < b.tick ? [a, b] : [b, a];

  // Fast-forward the slower bubble
  while (behind.tick < ahead.tick) {
    // All entities auto-wait
    for (const entityId of behind.entityIds) {
      if (canAct(behind.scheduler) === entityId) {
        behind.scheduler = completeAction(behind.scheduler, entityId);
      }
    }
    behind.scheduler = advanceScheduler(behind.scheduler);
    behind.tick++;
  }

  // Merge into single bubble
  return {
    id: generateBubbleId(),
    entityIds: [...behind.entityIds, ...ahead.entityIds],
    scheduler: mergeSchedulers(behind.scheduler, ahead.scheduler),
    tick: ahead.tick,
    commandQueues: new Map([...behind.commandQueues, ...ahead.commandQueues]),
  };
}
```

### 6. Public API

```typescript
// Queue a command (non-blocking)
function queueCommand(
  state: GameState,
  crawlerId: EntityId,
  action: Action
): GameState;

// Run simulation until input needed or limit reached
function simulate(
  state: GameState,
  options?: { maxTicks?: number }
): {
  state: GameState;
  waitingFor: EntityId[];  // Crawlers with empty queues who could act
  ticksProcessed: number;
};

// Convenience: queue + simulate (migration path from old API)
function processAction(
  state: GameState,
  crawlerId: EntityId,
  action: Action
): {
  state: GameState;
  waitingFor: EntityId[];
};
```

## Integration Considerations

### Message Generation

Messages are currently generated inline during action processing. With the new simulation model:

1. **Accumulate during simulation** - Each `executeAction` call returns messages
2. **Return with result** - `SimulationResult` includes `messages: Message[]`
3. **Append to state** - Caller appends messages to `state.messages`

```typescript
interface SimulationResult {
  bubble: Bubble;
  entities: EntityMap;
  messages: Message[];  // NEW: accumulated messages
  ticksProcessed: number;
}
```

### Entity Death During Simulation

When an entity dies (hp <= 0) during simulation:

1. Remove from `entities` map immediately
2. Remove from scheduler via `removeFromScheduler(scheduler, entityId)`
3. If in command queue (shouldn't happen for monsters), remove
4. Continue simulation with remaining entities

### Execution State Transitions

With command queuing, the state machine transitions:

```
                    queueCommand()
                         │
                         ▼
idle ──────────► awaiting_input ──────────► processing
  ▲                     │                       │
  │                     │ (queue has command)   │
  │                     ▼                       │
  │               processing ◄──────────────────┘
  │                     │
  └─────────────────────┘
        (action complete)
```

### BubbleSchema Migration

New fields need defaults for backward compatibility:

```typescript
const BubbleSchema = z.object({
  // ... existing fields ...
  tick: z.number().int().nonnegative().default(0),
  commandQueues: z.map(z.string(), z.array(ActionSchema)).default(new Map()),
});
```

## Migration Path

1. **Phase 1:** Define `Scheduler` interface, refactor current scheduler to implement it
   - Extract `canAct()` as separate query
   - Rename `completeCurrentTurn` → `completeAction(entityId)`
   - Make `ACTION_COST` configurable (default 100)
   - Ensure bubble holds scheduler via interface, not concrete type

2. **Phase 2:** Add command queues to bubbles, update `processAction` to use them

3. **Phase 3:** Add `tick` to bubbles, implement `simulate()`

4. **Phase 4:** Extend existing `mergeBubbles()` with fast-forward time synchronization

5. **Phase 5:** Deprecate old `processAction` signature

6. **Phase 6 (Future):** Add `InitiativeScheduler` as alternative paradigm

Each phase is independently deployable and testable. Phase 1 is critical for decoupling - if we get the interface right, other scheduler paradigms become straightforward to add later.

## Testing Strategy

1. **Unit tests for scheduler oracle** - `canAct`, `completeAction`, `advanceScheduler` in isolation
2. **Turn ratio tests** - Verify speed-80 gets ~0.8 turns per speed-100 turn over many iterations
3. **Queue tests** - Empty queue = auto-wait, queue overflow handling
4. **Merge tests** - Fast-forward produces correct tick alignment
5. **Integration tests** - Full game scenarios with multiple crawlers

## Breaking Changes

### Scheduler API

| Old | New | Impact |
|-----|-----|--------|
| `advanceScheduler` sets `currentActorId` | `advanceScheduler` only adds AP | Tests checking `currentActorId` after advance |
| `completeCurrentTurn(scheduler)` | `completeAction(scheduler, entityId)` | All callers must specify entity |
| `scheduler.currentActorId` | Use `canAct(scheduler)` | Any code reading currentActorId |

### Test Updates Required

1. **scheduler.test.ts** - All tests using `advanceScheduler().currentActorId`
2. **actions.test.ts** - Tests checking turn order
3. **test-dungeon.test.ts** - Troll movement tests

### React Hook Updates

`useGame.ts` currently calls `processAction(state, 'player', action)`. This will need to call `queueCommand` + `simulate` in the new model, or use the backwards-compatible `processAction` wrapper.

## Open Questions

1. **Queue overflow policy** - Drop oldest command? Reject new input? Configurable?
2. **AI agent rate limiting** - Separate concern or built into queue?
3. **Tick limit per frame** - What's the right cap to prevent runaway simulation?
4. **Observation timing** - When do AI agents receive observations? After each of their turns? After each simulation batch?

## Appendix: Turn Ratio Math

With the new system, turn ratios emerge naturally:

- Speed 100 entity: gains 100 AP per tick, acts every 1 tick
- Speed 80 entity: gains 80 AP per tick, acts every 1.25 ticks (0.8x rate)
- Speed 120 entity: gains 120 AP per tick, acts every 0.83 ticks (1.2x rate)

### Worked Example: Player (100) vs Troll (80)

```
Tick 0: Player=0, Troll=0
  canAct() → null (no one has ≥100)
  advanceScheduler() → Player=100, Troll=80

Tick 1: Player=100, Troll=80
  canAct() → Player (highest with ≥100)
  Player acts, completeAction() → Player=0, Troll=80
  canAct() → null
  advanceScheduler() → Player=100, Troll=160

Tick 2: Player=100, Troll=160
  canAct() → Troll (160 > 100)
  Troll acts, completeAction() → Player=100, Troll=60
  canAct() → Player (100 ≥ 100, Troll only 60)
  Player acts, completeAction() → Player=0, Troll=60
  canAct() → null
  advanceScheduler() → Player=100, Troll=140

Tick 3: Player=100, Troll=140
  canAct() → Troll (140 > 100)
  Troll acts, completeAction() → Player=100, Troll=40
  canAct() → Player
  Player acts, completeAction() → Player=0, Troll=40
  ...
```

After 5 ticks: Player gets 5 turns, Troll gets 4 turns (0.8 ratio).

This eliminates the need for "slow monster fairness" hacks - the math works naturally.
