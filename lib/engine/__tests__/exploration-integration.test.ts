// packages/crawler-core/lib/engine/__tests__/exploration-integration.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDungeon } from '../maps/test-dungeon';
import { getCurrentArea } from '../state';
import { prepareAIDecision } from '../../ai/decision-context';
import { createCooldowns } from '../perception-cooldowns';
import type { CrawlerId } from '../crawler-id';

describe('Exploration integration with test dungeon', () => {
  it('recommends exploring toward corridor after clearing starting room', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    // Simulate: player has explored left room, killed rats
    // Remove monsters from left room
    const stateAfterCombat = {
      ...state,
      entities: Object.fromEntries(
        Object.entries(state.entities).filter(
          ([id, e]) => e.type !== 'monster' || !['rat-1', 'rat-2'].includes(id)
        )
      ),
    };

    // Move player to corridor entrance at (8, 7) - right edge of left room
    const player = stateAfterCombat.entities['crawler-1'];
    const playerAtCorridorEntrance = {
      ...stateAfterCombat,
      entities: {
        ...stateAfterCombat.entities,
        'crawler-1': { ...player, x: 8, y: 7 },
      },
    };

    // Add explored tiles for the entire left room (x=1-8, y=1-13) and the room border
    // Note: The corridor at y=7 starts at x=9, which is NOT explored
    const exploredCoords: string[] = [];
    for (let y = 1; y < 14; y++) {
      for (let x = 1; x < 9; x++) {
        exploredCoords.push(`${x},${y}`);
      }
    }

    const stateWithExplored = {
      ...playerAtCorridorEntrance,
      exploredTiles: {
        [state.currentAreaId]: exploredCoords,
      },
    };

    const { prompt } = prepareAIDecision(stateWithExplored, 'crawler-1' as CrawlerId, cooldowns, { isYourTurn: true });

    // At corridor entrance (8, 7), east leads to unexplored corridor (9, 7)
    // East should show exploration value > 0 (the unexplored corridor tile)
    expect(prompt).toMatch(/move east:.*exploration: [1-9]\d*/);

    // Prompt should show exploration guidance with a "best" direction
    // and mark some directions as "fully explored" (dead ends: northeast, southeast are walls)
    expect(prompt).toMatch(/exploration: \d+ - best/);
    expect(prompt).toMatch(/Dead ends:/);
  });

  it('shows exploration values decrease as area is explored', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    // Initial exploration - most directions should have values
    const { prompt: prompt1 } = prepareAIDecision(state, 'crawler-1' as CrawlerId, cooldowns, { isYourTurn: true });

    // After exploring more - mark left half as explored
    const { map } = getCurrentArea(state);
    const moreExplored: string[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < 15; x++) { // Explore left half
        moreExplored.push(`${x},${y}`);
      }
    }

    const stateMoreExplored = {
      ...state,
      exploredTiles: {
        [state.currentAreaId]: moreExplored,
      },
    };

    const { prompt: prompt2 } = prepareAIDecision(stateMoreExplored, 'crawler-1' as CrawlerId, cooldowns, { isYourTurn: true });

    // West should now have lower value (more explored)
    expect(prompt2).toMatch(/move west:.*exploration: 0 - fully explored/);
  });

  it('shows all areas explored when dungeon is fully explored', () => {
    const state = createTestDungeon({ seed: 42 });
    const { map } = getCurrentArea(state);
    const cooldowns = createCooldowns();

    // Mark entire map as explored
    const fullyExplored: string[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        fullyExplored.push(`${x},${y}`);
      }
    }

    // Also remove monsters so we see exploration guidance
    const stateFullyExplored = {
      ...state,
      exploredTiles: {
        [state.currentAreaId]: fullyExplored,
      },
      entities: Object.fromEntries(
        Object.entries(state.entities).filter(([_, e]) => e.type !== 'monster')
      ),
    };

    const { prompt } = prepareAIDecision(stateFullyExplored, 'crawler-1' as CrawlerId, cooldowns, { isYourTurn: true });

    // Tactical situation should show all areas explored
    expect(prompt).toMatch(/All areas explored/);
  });
});
