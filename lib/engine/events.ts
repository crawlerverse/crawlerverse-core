/**
 * Event Detection Infrastructure
 *
 * Layer-agnostic event system that detects and emits game events.
 * This is infrastructure—it knows nothing about narration, spawning,
 * or world state manipulation. It only detects and emits events.
 *
 * Events are emitted synchronously during action processing with full
 * GameState snapshots to ensure async handlers see consistent state.
 */

import { z } from 'zod';
import type { GameState } from './state';
import type { Entity } from './types';
import { createLogger } from '../logging';

const logger = createLogger({ module: 'events' });

// --- Event Type Taxonomy ---

/**
 * Event types organized by category.
 * Note: Uses crawler-specific names (CRAWLER_DEATH, MONSTER_SEEN) to match
 * existing engine terminology. Phase 6 may abstract these to game-agnostic
 * names when extracting dm-core (see CRA-189).
 */
export enum EventType {
  // Combat events
  FIRST_BLOOD = 'combat.first_blood',  // First damage in encounter
  KILL = 'combat.kill',                // Entity defeated
  CRITICAL_HP = 'combat.critical_hp',  // Entity drops below 25% HP
  COMBAT_END = 'combat.end',           // All enemies defeated/fled

  // Exploration events
  AREA_ENTERED = 'exploration.area_entered',      // New area discovered
  MONSTER_SEEN = 'exploration.monster_seen',      // First encounter with species
  ITEM_FOUND = 'exploration.item_found',          // Loot discovered
  PORTAL_FOUND = 'exploration.portal_found',      // Stairs/exit found

  // Party events
  CRAWLER_DEATH = 'party.crawler_death',
  VICTORY = 'party.victory',  // Objectives completed
}

// --- Event Schema ---

/**
 * Event-specific metadata. Loosely typed to allow flexibility.
 * Handlers can type-narrow based on event.type.
 */
export type EventMetadata = Record<string, unknown>;

// --- Event Metadata Schemas ---

/**
 * Metadata schema for FIRST_BLOOD event
 */
export const FirstBloodMetadataSchema = z.object({
  damage: z.number().nonnegative(),
  isCritical: z.boolean(),
  weapon: z.string().optional(),
});

/**
 * Metadata schema for KILL event
 */
export const KillMetadataSchema = z.object({
  damage: z.number().nonnegative(),
  isCritical: z.boolean(),
  weapon: z.string().optional(),
  killsThisEncounter: z.number().int().positive(),
});

/**
 * Metadata schema for CRITICAL_HP event
 */
export const CriticalHpMetadataSchema = z.object({
  currentHp: z.number().nonnegative(),
  maxHp: z.number().positive(),
  hpPercentage: z.number().min(0).max(100),
});

/**
 * Metadata schema for COMBAT_END event
 */
export const CombatEndMetadataSchema = z.object({
  totalKills: z.number().int().nonnegative(),
  turnsDuration: z.number().int().nonnegative().optional(),
});

/**
 * Metadata schema for AREA_ENTERED event
 */
export const AreaEnteredMetadataSchema = z.object({
  areaId: z.string().min(1),
  areaName: z.string().min(1),
  dangerLevel: z.number().int().positive(),
  fromAreaId: z.string().min(1).optional(),
});

/**
 * Metadata schema for MONSTER_SEEN event
 */
export const MonsterSeenMetadataSchema = z.object({
  monsterType: z.string().min(1),
  firstTime: z.boolean(),
});

/**
 * Metadata schema for ITEM_FOUND event
 */
export const ItemFoundMetadataSchema = z.object({
  itemType: z.string().min(1),
  quantity: z.number().int().positive(),
});

/**
 * Metadata schema for PORTAL_FOUND event
 */
export const PortalFoundMetadataSchema = z.object({
  portalType: z.enum(['up', 'down', 'generic']).optional(),
  targetAreaId: z.string().min(1).optional(),
});

/**
 * Metadata schema for CRAWLER_DEATH event
 */
export const CrawlerDeathMetadataSchema = z.object({
  killedBy: z.string().min(1),
});

/**
 * Metadata schema for VICTORY event
 */
export const VictoryMetadataSchema = z.object({
  objectivesCompleted: z.number().int().nonnegative(),
  totalTurns: z.number().int().nonnegative(),
});

/**
 * Type-safe event metadata by event type.
 * Allows handlers to type-narrow based on event.type.
 */
export type TypedEventMetadata = {
  [EventType.FIRST_BLOOD]: z.infer<typeof FirstBloodMetadataSchema>;
  [EventType.KILL]: z.infer<typeof KillMetadataSchema>;
  [EventType.CRITICAL_HP]: z.infer<typeof CriticalHpMetadataSchema>;
  [EventType.COMBAT_END]: z.infer<typeof CombatEndMetadataSchema>;
  [EventType.AREA_ENTERED]: z.infer<typeof AreaEnteredMetadataSchema>;
  [EventType.MONSTER_SEEN]: z.infer<typeof MonsterSeenMetadataSchema>;
  [EventType.ITEM_FOUND]: z.infer<typeof ItemFoundMetadataSchema>;
  [EventType.PORTAL_FOUND]: z.infer<typeof PortalFoundMetadataSchema>;
  [EventType.CRAWLER_DEATH]: z.infer<typeof CrawlerDeathMetadataSchema>;
  [EventType.VICTORY]: z.infer<typeof VictoryMetadataSchema>;
};

/**
 * Core event interface. All game events conform to this shape.
 */
export interface GameEvent {
  /** Event type identifier */
  type: EventType;
  /** Timestamp when event occurred (milliseconds since epoch) */
  timestamp: number;
  /** Full game state snapshot at event time (deep clone) */
  context: GameState;
  /** Entities involved in this event */
  entities: Entity[];
  /** Event-specific data */
  metadata: EventMetadata;
}

/**
 * Validate event metadata against its schema.
 * Returns validation result with parsed data or error.
 *
 * @param event - Event to validate
 * @returns Zod SafeParseReturnType with validation result
 */
export function validateEventMetadata<T extends EventType>(
  event: GameEvent & { type: T }
): z.SafeParseReturnType<EventMetadata, TypedEventMetadata[T]> {
  const schemaMap: Record<EventType, z.ZodSchema> = {
    [EventType.FIRST_BLOOD]: FirstBloodMetadataSchema,
    [EventType.KILL]: KillMetadataSchema,
    [EventType.CRITICAL_HP]: CriticalHpMetadataSchema,
    [EventType.COMBAT_END]: CombatEndMetadataSchema,
    [EventType.AREA_ENTERED]: AreaEnteredMetadataSchema,
    [EventType.MONSTER_SEEN]: MonsterSeenMetadataSchema,
    [EventType.ITEM_FOUND]: ItemFoundMetadataSchema,
    [EventType.PORTAL_FOUND]: PortalFoundMetadataSchema,
    [EventType.CRAWLER_DEATH]: CrawlerDeathMetadataSchema,
    [EventType.VICTORY]: VictoryMetadataSchema,
  };

  const schema = schemaMap[event.type];
  return schema.safeParse(event.metadata) as z.SafeParseReturnType<
    EventMetadata,
    TypedEventMetadata[T]
  >;
}

/**
 * Create a game event with proper state cloning.
 * Centralizes the structuredClone pattern for future optimization.
 *
 * Phase 1: Full state clone on every event (acknowledged performance tradeoff)
 * Phase 2+: Can optimize to lazy cloning via Proxy or structural sharing
 *
 * @param type - Event type
 * @param state - Game state to snapshot
 * @param entities - Entities involved in event
 * @param metadata - Event-specific metadata
 * @returns Complete GameEvent ready for emission
 */
export function createEvent(
  type: EventType,
  state: GameState,
  entities: Entity[],
  metadata: EventMetadata
): GameEvent {
  // Destructure to remove eventEmitter before cloning
  const { eventEmitter, ...stateWithoutEmitter } = state;

  return {
    type,
    timestamp: Date.now(),
    context: structuredClone(stateWithoutEmitter) as GameState,
    entities,
    metadata,
  };
}

/**
 * Event handler function type.
 * May be sync or async. Async handlers are fire-and-forget.
 */
export type EventHandler = (event: GameEvent) => void | Promise<void>;

/**
 * Unsubscribe function returned by subscribe methods.
 */
export type Unsubscribe = () => void;

// --- GameEventEmitter Class ---

/**
 * Event emitter for game events.
 * Manages subscriptions and emits events to handlers with error isolation.
 */
export class GameEventEmitter {
  private handlers: Map<EventType | 'all', Set<EventHandler>>;

  constructor() {
    this.handlers = new Map();
  }

  /**
   * Emit an event to all subscribed handlers.
   * Handlers are executed in subscription order (FIFO).
   * Handler errors are caught and logged but do not throw.
   *
   * @param event - The game event to emit
   */
  emit(event: GameEvent): void {
    const typeHandlers = this.handlers.get(event.type) ?? new Set();
    const allHandlers = this.handlers.get('all') ?? new Set();

    // Combine type-specific and wildcard handlers
    const allMatchingHandlers = [...typeHandlers, ...allHandlers];

    // Execute each handler with error isolation
    for (const handler of allMatchingHandlers) {
      this.executeHandler(handler, event);
    }
  }

  /**
   * Execute a single handler with error isolation.
   * Async handlers execute without blocking emit() (fire-and-forget pattern),
   * but rejections are caught and logged to prevent silent failures.
   */
  private executeHandler(handler: EventHandler, event: GameEvent): void {
    try {
      const result = handler(event);

      // If handler returns a promise, catch rejections and log with full context
      if (result instanceof Promise) {
        result.catch((error) => {
          logger.error(
            {
              error: error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
                cause: (error as Error & { cause?: unknown }).cause,
              } : String(error),
              eventType: event.type,
              turn: event.context.turn,
              areaId: event.context.currentAreaId,
              entityCount: Object.keys(event.context.entities).length,
              metadata: event.metadata,
              handlerName: handler.name || 'anonymous',
            },
            'Async event handler failed'
          );
        });
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
            cause: error.cause,
          } : String(error),
          eventType: event.type,
          turn: event.context.turn,
          areaId: event.context.currentAreaId,
          entityCount: Object.keys(event.context.entities).length,
          metadata: event.metadata,
          handlerName: handler.name || 'anonymous',
        },
        'Event handler failed'
      );
    }
  }

  /**
   * Subscribe to specific event type(s).
   * Returns unsubscribe function for cleanup.
   *
   * @param types - Event type or array of event types to subscribe to
   * @param handler - Handler function to call when event is emitted
   * @returns Unsubscribe function
   */
  subscribe(
    types: EventType | EventType[],
    handler: EventHandler
  ): Unsubscribe {
    const typeArray = Array.isArray(types) ? types : [types];

    for (const type of typeArray) {
      if (!this.handlers.has(type)) {
        this.handlers.set(type, new Set());
      }
      this.handlers.get(type)!.add(handler);
    }

    // Return cleanup function
    return () => this.unsubscribe(handler);
  }

  /**
   * Subscribe to all events (wildcard subscription).
   * Returns unsubscribe function for cleanup.
   *
   * @param handler - Handler function to call for all events
   * @returns Unsubscribe function
   */
  subscribeAll(handler: EventHandler): Unsubscribe {
    if (!this.handlers.has('all')) {
      this.handlers.set('all', new Set());
    }
    this.handlers.get('all')!.add(handler);

    return () => this.unsubscribe(handler);
  }

  /**
   * Unsubscribe a handler from all event types.
   *
   * @param handler - Handler function to remove
   */
  unsubscribe(handler: EventHandler): void {
    for (const handlers of this.handlers.values()) {
      handlers.delete(handler);
    }
  }

  /**
   * Unsubscribe a handler from specific event type(s).
   * More efficient than unsubscribe() when you know which types the handler is subscribed to.
   *
   * @param types - Event type or array of event types to unsubscribe from
   * @param handler - Handler function to remove
   */
  unsubscribeFrom(
    types: EventType | EventType[] | 'all',
    handler: EventHandler
  ): void {
    const typeArray = Array.isArray(types) ? types : [types];

    for (const type of typeArray) {
      const handlers = this.handlers.get(type);
      if (handlers) {
        handlers.delete(handler);
      }
    }
  }

  /**
   * Get the total number of handlers across all event types.
   * Useful for debugging and memory leak detection.
   *
   * @returns Total handler count
   */
  getHandlerCount(): number {
    let count = 0;
    for (const handlers of this.handlers.values()) {
      count += handlers.size;
    }
    return count;
  }

  /**
   * Get the number of handlers for a specific event type.
   *
   * @param type - Event type or 'all' for wildcard handlers
   * @returns Handler count for the specified type
   */
  getHandlerCountForType(type: EventType | 'all'): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /**
   * Remove all handlers and clean up resources.
   * Call this when the game ends to prevent memory leaks.
   */
  destroy(): void {
    this.handlers.clear();
  }
}
