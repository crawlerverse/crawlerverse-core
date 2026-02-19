import { describe, it, expect } from 'vitest';
import type { GameCallbacks, GameCompleteData, ErrorContext } from '../callbacks';
import { generateSessionId } from '../callbacks';

describe('GameCallbacks types', () => {
  it('allows all callbacks to be optional', () => {
    const callbacks: GameCallbacks = {};
    expect(callbacks.onGameStart).toBeUndefined();
    expect(callbacks.onGameComplete).toBeUndefined();
    expect(callbacks.onAIAction).toBeUndefined();
    expect(callbacks.onError).toBeUndefined();
  });

  it('accepts valid callback implementations', () => {
    const callbacks: GameCallbacks = {
      onGameStart: (sessionId, playerType) => {
        expect(typeof sessionId).toBe('string');
        expect(['human', 'ai']).toContain(playerType);
      },
      onGameComplete: (data) => {
        expect(data.sessionId).toBeDefined();
        expect(['win', 'loss']).toContain(data.outcome);
      },
      onAIAction: (valid, actionType, sessionId) => {
        expect(typeof valid).toBe('boolean');
        expect(typeof actionType).toBe('string');
        expect(typeof sessionId).toBe('string');
      },
      onError: (error, context) => {
        expect(error).toBeInstanceOf(Error);
        expect(typeof context).toBe('object');
        expect(typeof context.component).toBe('string');
      },
    };

    // Call each callback to verify signatures
    callbacks.onGameStart?.('session-123', 'human');
    callbacks.onGameComplete?.({
      sessionId: 'session-123',
      outcome: 'win',
      turns: 10,
      playerType: 'human',
      durationMs: 5000,
    });
    callbacks.onAIAction?.(true, 'move', 'session-123');
    callbacks.onError?.(new Error('test'), { component: 'TestComponent' });
  });
});

describe('GameCompleteData', () => {
  it('includes all required fields', () => {
    const data: GameCompleteData = {
      sessionId: 'session-123',
      outcome: 'win',
      turns: 15,
      playerType: 'ai',
      durationMs: 10000,
    };
    expect(data.sessionId).toBe('session-123');
    expect(data.outcome).toBe('win');
    expect(data.turns).toBe(15);
    expect(data.playerType).toBe('ai');
    expect(data.durationMs).toBe(10000);
  });

  it('allows optional validActionRate', () => {
    const data: GameCompleteData = {
      sessionId: 'session-123',
      outcome: 'loss',
      turns: 5,
      playerType: 'ai',
      validActionRate: 0.85,
      durationMs: 3000,
    };
    expect(data.validActionRate).toBe(0.85);
  });

  it('accepts both outcome types', () => {
    const winData: GameCompleteData = {
      sessionId: 's1',
      outcome: 'win',
      turns: 10,
      playerType: 'human',
      durationMs: 5000,
    };
    const lossData: GameCompleteData = {
      sessionId: 's2',
      outcome: 'loss',
      turns: 5,
      playerType: 'ai',
      durationMs: 2000,
    };
    expect(winData.outcome).toBe('win');
    expect(lossData.outcome).toBe('loss');
  });
});

describe('ErrorContext', () => {
  it('requires component field', () => {
    const context: ErrorContext = {
      component: 'PlayGame',
    };
    expect(context.component).toBe('PlayGame');
  });

  it('allows optional fields', () => {
    const context: ErrorContext = {
      component: 'ErrorBoundary',
      sessionId: 'session-123',
      turn: 5,
      action: 'move',
      errorId: 'ERR-ABC123',
    };
    expect(context.component).toBe('ErrorBoundary');
    expect(context.sessionId).toBe('session-123');
    expect(context.turn).toBe(5);
    expect(context.action).toBe('move');
    expect(context.errorId).toBe('ERR-ABC123');
  });
});

describe('generateSessionId', () => {
  it('returns a valid UUID v4 format', () => {
    const sessionId = generateSessionId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('returns unique values on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, generateSessionId));
    expect(ids.size).toBe(100);
  });

  it('returns a string', () => {
    const sessionId = generateSessionId();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBe(36); // UUID length with dashes
  });
});
