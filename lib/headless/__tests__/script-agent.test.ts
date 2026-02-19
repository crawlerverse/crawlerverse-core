/**
 * ScriptAgent Tests
 *
 * Tests for the rule-based ScriptAgent that attacks adjacent monsters
 * or moves toward the nearest one.
 */

import { describe, it, expect } from 'vitest';
import { ScriptAgent } from '../agents/script-agent';
import type { GameState } from '../../engine/state';
import type { Entity } from '../../engine/types';
import type { CrawlerId } from '../../engine/crawler-id';

// Helper to create a minimal game state for testing
function createTestState(
  crawlerPos: { x: number; y: number },
  monsters: Array<{ x: number; y: number; id?: string; name?: string }>
): GameState {
  const crawler: Entity = {
    id: 'crawler-1',
    type: 'crawler',
    x: crawlerPos.x,
    y: crawlerPos.y,
    areaId: 'area-1',
    hp: 10,
    maxHp: 10,
    name: 'Test Crawler',
    char: '@',
    attack: 5,
    defense: 2,
    speed: 100,
  };

  const entities: Record<string, Entity> = {
    'crawler-1': crawler,
  };

  monsters.forEach((m, i) => {
    const id = m.id ?? `monster-${i + 1}`;
    entities[id] = {
      id,
      type: 'monster',
      x: m.x,
      y: m.y,
      areaId: 'area-1',
      hp: 5,
      maxHp: 5,
      name: m.name ?? 'Goblin',
      monsterTypeId: 'goblin',
      attack: 3,
      defense: 1,
      speed: 100,
    };
  });

  return {
    zone: {
      id: 'zone-1',
      name: 'Test Zone',
      entryAreaId: 'area-1',
      victoryAreaIds: ['area-1'],
      areas: {
        'area-1': {
          metadata: {
            id: 'area-1',
            name: 'Test Area',
            dangerLevel: 1,
          },
          map: {
            width: 20,
            height: 20,
            tiles: Array(20).fill(null).map(() =>
              Array(20).fill(null).map(() => ({ type: 'floor' as const }))
            ),
            rooms: [],
            seed: 12345,
          },
        },
      },
    },
    currentAreaId: 'area-1',
    entities,
    items: [],
    bubbles: [],
    hibernating: [],
    exploredTiles: {},
    objectives: [],
    turn: 1,
    messages: [],
    gameStatus: { status: 'playing' },
  };
}

describe('ScriptAgent', () => {
  const agent = new ScriptAgent();

  describe('attacking adjacent monsters', () => {
    it('should attack monster directly north', async () => {
      // Crawler at (5, 5), monster at (5, 4) - north
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 4 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('attack');
      expect(response.action).toHaveProperty('direction', 'north');
      expect(response.reasoning).toContain('adjacent');
    });

    it('should attack monster directly east', async () => {
      // Crawler at (5, 5), monster at (6, 5) - east
      const state = createTestState({ x: 5, y: 5 }, [{ x: 6, y: 5 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('attack');
      expect(response.action).toHaveProperty('direction', 'east');
    });

    it('should attack monster diagonally (northeast)', async () => {
      // Crawler at (5, 5), monster at (6, 4) - northeast
      const state = createTestState({ x: 5, y: 5 }, [{ x: 6, y: 4 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('attack');
      expect(response.action).toHaveProperty('direction', 'northeast');
    });

    it('should attack monster diagonally (southwest)', async () => {
      // Crawler at (5, 5), monster at (4, 6) - southwest
      const state = createTestState({ x: 5, y: 5 }, [{ x: 4, y: 6 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('attack');
      expect(response.action).toHaveProperty('direction', 'southwest');
    });

    it('should prioritize closer monster when multiple are adjacent', async () => {
      // Both monsters are adjacent (distance 1), should pick the first one found
      // This tests that we don't crash with multiple adjacent monsters
      const state = createTestState({ x: 5, y: 5 }, [
        { x: 5, y: 4 }, // north
        { x: 6, y: 5 }, // east
      ]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('attack');
      // Should attack one of the adjacent monsters
      expect(['north', 'east']).toContain(
        (response.action as { direction?: string }).direction
      );
    });
  });

  describe('moving toward monsters', () => {
    it('should move toward monster when not adjacent (north)', async () => {
      // Crawler at (5, 5), monster at (5, 2) - 3 tiles north
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 2 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('move');
      expect(response.action).toHaveProperty('direction', 'north');
      expect(response.reasoning).toContain('Moving toward');
    });

    it('should move toward monster when not adjacent (southeast)', async () => {
      // Crawler at (5, 5), monster at (8, 8) - 3 tiles southeast
      const state = createTestState({ x: 5, y: 5 }, [{ x: 8, y: 8 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('move');
      expect(response.action).toHaveProperty('direction', 'southeast');
    });

    it('should prioritize closer monster when multiple exist', async () => {
      // Crawler at (5, 5)
      // Monster A at (5, 3) - 2 tiles north (closer)
      // Monster B at (5, 0) - 5 tiles north (farther)
      const state = createTestState({ x: 5, y: 5 }, [
        { x: 5, y: 0, id: 'monster-far' },
        { x: 5, y: 3, id: 'monster-close' },
      ]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('move');
      expect(response.action).toHaveProperty('direction', 'north');
      expect(response.reasoning).toContain('monster-close');
    });

    it('should handle diagonal movement to reach monster', async () => {
      // Crawler at (5, 5), monster at (7, 3) - northeast
      const state = createTestState({ x: 5, y: 5 }, [{ x: 7, y: 3 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('move');
      expect(response.action).toHaveProperty('direction', 'northeast');
    });
  });

  describe('waiting when no monsters', () => {
    it('should wait when no monsters are visible', async () => {
      const state = createTestState({ x: 5, y: 5 }, []);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.action.action).toBe('wait');
      expect(response.reasoning).toContain('No monsters in area');
    });
  });

  describe('response format', () => {
    it('should include reasoning in response', async () => {
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 4 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.reasoning).toBeTruthy();
      expect(typeof response.reasoning).toBe('string');
    });

    it('should include shortThought in response', async () => {
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 4 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.shortThought).toBeTruthy();
      expect(typeof response.shortThought).toBe('string');
    });

    it('should set modelId to "script-agent"', async () => {
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 4 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.modelId).toBe('script-agent');
    });

    it('should have minimal durationMs', async () => {
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 4 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      expect(response.durationMs).toBeDefined();
      expect(response.durationMs).toBeLessThan(100); // Should be near-instant
    });
  });

  describe('edge cases', () => {
    it('should handle monster at same position gracefully', async () => {
      // Edge case: monster at same position as crawler (shouldn't happen in game)
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 5 }]);
      const response = await agent.getAction(
        'crawler-1' as CrawlerId,
        'test prompt',
        state
      );

      // Should wait since we can't determine a direction for same-position
      expect(response.action.action).toBe('wait');
    });

    it('should handle crawler not found gracefully', async () => {
      const state = createTestState({ x: 5, y: 5 }, [{ x: 5, y: 4 }]);
      const response = await agent.getAction(
        'crawler-99' as CrawlerId, // Non-existent crawler
        'test prompt',
        state
      );

      // Should wait if crawler not found
      expect(response.action.action).toBe('wait');
      expect(response.reasoning).toContain('not found');
    });
  });
});
