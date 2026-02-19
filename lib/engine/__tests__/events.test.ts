import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEventEmitter, EventType, type GameEvent } from '../events';
import type { GameState } from '../state';

describe('GameEventEmitter', () => {
  let emitter: GameEventEmitter;
  let mockState: GameState;

  beforeEach(() => {
    emitter = new GameEventEmitter();
    // Minimal mock state for testing
    mockState = {
      turn: 1,
      entities: {},
      currentAreaId: 'area-1',
    } as GameState;
  });

  it('emits events to subscribed handlers', () => {
    const handler = vi.fn();

    emitter.subscribe(EventType.KILL, handler);

    const event: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: { damage: 10 }
    };

    emitter.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('supports multiple event type subscriptions', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    emitter.subscribe(EventType.KILL, handler1);
    emitter.subscribe(EventType.KILL, handler2);
    emitter.subscribe(EventType.KILL, handler3);

    const event: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    emitter.emit(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
    expect(handler3).toHaveBeenCalledWith(event);
  });

  it('isolates handler errors', () => {
    const handler1 = vi.fn(() => {
      throw new Error('Handler 1 error');
    });
    const handler2 = vi.fn();
    const handler3 = vi.fn(() => {
      throw new Error('Handler 3 error');
    });

    emitter.subscribe(EventType.KILL, handler1);
    emitter.subscribe(EventType.KILL, handler2);
    emitter.subscribe(EventType.KILL, handler3);

    const event: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    // Should not throw - errors are isolated
    expect(() => emitter.emit(event)).not.toThrow();

    // All handlers should still be called
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
  });

  it('unsubscribes handlers', () => {
    const handler = vi.fn();

    const unsubscribe = emitter.subscribe(EventType.KILL, handler);

    const event: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    emitter.emit(event);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();

    emitter.emit(event);
    expect(handler).toHaveBeenCalledOnce(); // Still only called once
  });

  it('subscribeAll receives all event types', () => {
    const allHandler = vi.fn();
    const killHandler = vi.fn();

    emitter.subscribeAll(allHandler);
    emitter.subscribe(EventType.KILL, killHandler);

    const killEvent: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    const firstBloodEvent: GameEvent = {
      type: EventType.FIRST_BLOOD,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    emitter.emit(killEvent);
    emitter.emit(firstBloodEvent);

    expect(allHandler).toHaveBeenCalledTimes(2);
    expect(allHandler).toHaveBeenCalledWith(killEvent);
    expect(allHandler).toHaveBeenCalledWith(firstBloodEvent);
    expect(killHandler).toHaveBeenCalledOnce();
    expect(killHandler).toHaveBeenCalledWith(killEvent);
  });

  it('handles async handler rejections without crashing', async () => {
    const asyncHandler1 = vi.fn(async () => {
      throw new Error('Async handler error');
    });
    const asyncHandler2 = vi.fn(async () => {
      return Promise.resolve();
    });

    emitter.subscribe(EventType.KILL, asyncHandler1);
    emitter.subscribe(EventType.KILL, asyncHandler2);

    const event: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    // Should not throw - async errors are isolated
    expect(() => emitter.emit(event)).not.toThrow();

    // Wait for async handlers to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(asyncHandler1).toHaveBeenCalledOnce();
    expect(asyncHandler2).toHaveBeenCalledOnce();
  });

  it('subscribes to multiple event types with array syntax', () => {
    const handler = vi.fn();
    const unsubscribe = emitter.subscribe([EventType.KILL, EventType.CRITICAL_HP], handler);

    const killEvent: GameEvent = {
      type: EventType.KILL,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    const criticalHpEvent: GameEvent = {
      type: EventType.CRITICAL_HP,
      timestamp: Date.now(),
      context: mockState,
      entities: [],
      metadata: {}
    };

    emitter.emit(killEvent);
    emitter.emit(criticalHpEvent);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(killEvent);
    expect(handler).toHaveBeenCalledWith(criticalHpEvent);

    // Unsubscribe should remove from both event types
    unsubscribe();
    emitter.emit(killEvent);
    expect(handler).toHaveBeenCalledTimes(2); // Still 2, not 3
  });
});
