// packages/crawler-core/lib/ai/__tests__/decision-context.test.ts
/**
 * Tests for the AI decision context module.
 *
 * These tests verify that prepareAIDecision produces the same output as the
 * original stateToPrompt function, plus adds perception generation.
 *
 * Migrated from state.test.ts as part of the AI decision context consolidation.
 */
import { describe, it, expect } from 'vitest';
import {
  computeVisibility,
  prepareAIDecision,
  analyzeTile,
  estimateCombat,
  detectPickupConflict,
  computeStatusDetails,
  generateStatusSection,
  type AIDecisionContext,
} from '../decision-context';
import {
  renderMapSnapshot,
  buildStateSnapshot,
} from '../trace-utils';
import { createMultiFloorTestDungeon } from '../../engine/maps';
import { createTestDungeon } from '../../engine/maps/test-dungeon';
import { createInitialState } from '../../engine/state';
import { crawlerIdFromIndex, type CrawlerId } from '../../engine/crawler-id';
import { tileKey } from '../../engine/fov';
import { createCooldowns } from '../../engine/perception-cooldowns';
import {
  getPlayer,
  getCrawlers,
  getMonsters,
  getMonstersInArea,
  getCurrentArea,
  DEFAULT_AREA_ID,
  type Entity,
  type GameState,
} from '../../engine/state';
import { createBubble, bubbleId } from '../../engine/bubble';
import { entityId, advanceScheduler, completeCurrentTurn } from '../../engine/scheduler';
import { parseAsciiMap, type DungeonMap } from '../../engine/map';
import { createTestZone } from '../../engine/__tests__/test-helpers';
import {
  createClearZoneObjective,
  createKillObjective,
  createReachObjective,
} from '../../engine/objective';

// Primary player ID constant for tests
const PLAYER_ID = crawlerIdFromIndex(1);

// --- Original computeVisibility, renderMapSnapshot, buildStateSnapshot tests ---

describe('computeVisibility', () => {
  it('returns visible tiles for crawler position', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const visibility = computeVisibility(state, crawlerId);

    expect(visibility.visibleTiles.size).toBeGreaterThan(0);
    expect(visibility.exploredTiles.size).toBeGreaterThanOrEqual(visibility.visibleTiles.size);
  });

  it('filters entities to only visible ones (excluding self)', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const visibility = computeVisibility(state, crawlerId);

    // Should not include the crawler itself
    const selfIncluded = visibility.visibleEntities.some(e => e.id === crawlerId);
    expect(selfIncluded).toBe(false);
  });

  it('filters items to only those on visible tiles', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const visibility = computeVisibility(state, crawlerId);

    // All visible items should be on visible tiles
    for (const item of visibility.visibleItems) {
      const key = tileKey(item.x, item.y);
      expect(visibility.visibleTiles.has(key)).toBe(true);
    }
  });
});

describe('renderMapSnapshot', () => {
  it('returns ASCII map string', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const snapshot = renderMapSnapshot(state, crawlerId);

    expect(typeof snapshot).toBe('string');
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot).toContain('@'); // Player character
  });

  it('shows only visible and explored tiles', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const snapshot = renderMapSnapshot(state, crawlerId);
    const lines = snapshot.split('\n');

    // Should have some content (not all spaces)
    const hasContent = lines.some(line => line.trim().length > 0);
    expect(hasContent).toBe(true);
  });
});

describe('buildStateSnapshot', () => {
  it('returns structured snapshot with visible monsters', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const snapshot = buildStateSnapshot(state, crawlerId);

    expect(snapshot).toHaveProperty('visibleMonsters');
    expect(snapshot).toHaveProperty('visibleItems');
    expect(snapshot).toHaveProperty('inventory');
    expect(snapshot).toHaveProperty('equipped');
    expect(Array.isArray(snapshot.visibleMonsters)).toBe(true);
  });

  it('includes crawler inventory and equipment', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);

    const snapshot = buildStateSnapshot(state, crawlerId);

    expect(Array.isArray(snapshot.inventory)).toBe(true);
    expect(snapshot.equipped).toHaveProperty('weapon');
    expect(snapshot.equipped).toHaveProperty('armor');
  });
});

// --- Migrated stateToPrompt tests (now testing prepareAIDecision) ---

describe('prepareAIDecision', () => {
  it('returns prompt string with game state sections', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.prompt).toContain('GAME STATE');
    expect(result.prompt).toContain('YOUR STATUS');
    expect(result.prompt).toContain('AVAILABLE ACTIONS');
  });

  it('includes perceptions in prompt when generated', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(Array.isArray(result.perceptions)).toBe(true);
  });

  it('returns updated cooldowns', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.updatedCooldowns).toBeDefined();
  });

  it('returns priority perception for thought bubble', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect('priorityPerception' in result).toBe(true);
  });

  it('throws error for non-existent crawler', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const invalidId = crawlerIdFromIndex(999);
    const cooldowns = createCooldowns();

    expect(() => prepareAIDecision(state, invalidId, cooldowns)).toThrow('Crawler not found');
  });

  it('includes turn info section when isYourTurn is true', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.prompt).toContain('TURN INFO');
    expect(result.prompt).toContain('Your turn: Yes');
  });

  it('includes character section when crawler has character class', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.prompt).toContain('YOUR CHARACTER');
    expect(result.prompt).toContain('Personality');
  });

  it('includes inventory section', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.prompt).toContain('INVENTORY');
  });

  it('includes objectives section', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.prompt).toContain('OBJECTIVES');
  });

  it('includes tactical situation section', () => {
    const state = createMultiFloorTestDungeon({ seed: 42 });
    const crawlerId = crawlerIdFromIndex(1);
    const cooldowns = createCooldowns();

    const result = prepareAIDecision(state, crawlerId, cooldowns, { isYourTurn: true });

    expect(result.prompt).toContain('TACTICAL SITUATION');
  });

  // --- Basic stateToPrompt tests migrated ---

  it('generates prompt with map and status', () => {
    const state = createTestDungeon();
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('GAME STATE');
    expect(prompt).toContain('YOUR STATUS:');
    expect(prompt).toContain('MONSTERS:');
    expect(prompt).toContain('AVAILABLE ACTIONS:');
  });

  it('includes attack, defense, and speed in player status', () => {
    const state = createTestDungeon({ seed: 42 });
    const crawler = getCrawlers(state)[0]!;
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Verify stats in prompt match the crawler's class-appropriate stats
    expect(prompt).toContain(`Attack: ${crawler.attack}`);
    expect(prompt).toContain(`Defense: ${crawler.defense}`);
    expect(prompt).toContain(`Speed: ${crawler.speed}`);
  });

  it('includes stats in monster listing', () => {
    const state = createTestDungeon();
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Monster stats should be in ATK/DEF/SPD format
    // With random selection, we check that the format is correct rather than specific values
    expect(prompt).toMatch(/ATK: \d+/);
    expect(prompt).toMatch(/DEF: \d+/);
    expect(prompt).toMatch(/SPD: \d+/);
    // Monster names should be from the MONSTER_TYPES
    expect(prompt).toMatch(/(Rat|Goblin|Orc|Skeleton|Troll)/);
  });
});

// --- Helper functions for turn info tests ---

function advanceToNextTurn(state: GameState): GameState {
  if (state.bubbles.length === 0) return state;
  const bubble = state.bubbles[0];
  const advancedScheduler = advanceScheduler(bubble.scheduler);
  return {
    ...state,
    bubbles: [{ ...bubble, scheduler: advancedScheduler }, ...state.bubbles.slice(1)],
  };
}

function completeTurn(state: GameState): GameState {
  if (state.bubbles.length === 0) return state;
  const bubble = state.bubbles[0];
  const completedScheduler = completeCurrentTurn(bubble.scheduler);
  return {
    ...state,
    bubbles: [{ ...bubble, scheduler: completedScheduler }, ...state.bubbles.slice(1)],
  };
}

function createStateWithTwoCrawlers(): GameState {
  const state = createTestDungeon();
  const player2: Entity = {
    id: 'player2',
    type: 'crawler',
    x: 7, y: 7,
    areaId: 'area-1',
    hp: 10, maxHp: 10,
    name: 'Player 2', char: '@',
    attack: 2, defense: 0, speed: 100,
  };

  // Add player2 to entities
  const entities = { ...state.entities, player2 };

  // Add player2 to bubble
  const bubble = state.bubbles[0];
  const updatedBubble = createBubble({
    id: bubbleId(bubble.id),
    entityIds: [...bubble.entityIds, entityId('player2')],
    entities: [
      ...bubble.scheduler.entries.map(e => ({ id: entityId(e.entityId), speed: e.speed })),
      { id: entityId('player2'), speed: 100 },
    ],
    center: bubble.center,
  });

  return {
    ...state,
    entities,
    bubbles: [updatedBubble],
  };
}

describe('prepareAIDecision with monster appearances', () => {
  it('generates valid prompt without undefined values', () => {
    const state = createInitialState({ seed: 42 });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Prompt should not contain undefined or errors
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('MONSTERS:');
  });

  it('renders actual monster type chars from getEntityAppearance', () => {
    const state = createInitialState({ seed: 42, monsterCount: 3 });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });
    const monsters = getMonsters(state);

    // Each monster's char in the map should come from getEntityAppearance
    for (const monster of monsters) {
      const monsterTypeId = monster.monsterTypeId;
      if (monsterTypeId) {
        // Map section should be present and not have '?' fallbacks
        expect(prompt).not.toContain('?');
      }
    }
  });
});

describe('prepareAIDecision with turn info', () => {
  it('includes turn info section when crawlerId provided', () => {
    let state = createTestDungeon();
    // Advance to set current actor
    state = advanceToNextTurn(state);
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('TURN INFO:');
    expect(prompt).toMatch(/Your turn: (Yes|No)/);
  });

  it('shows your turn as Yes when current actor', () => {
    let state = createTestDungeon();
    // Keep advancing and completing turns until player's turn
    // Rat is faster (120 speed) so it will often go first
    for (let i = 0; i < 20; i++) {
      state = advanceToNextTurn(state);
      if (state.bubbles[0]?.scheduler.currentActorId === entityId(PLAYER_ID)) break;
      // Complete the current turn so we can advance to the next
      state = completeTurn(state);
    }
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('Your turn: Yes');
  });

  it('shows your turn as No when not current actor', () => {
    let state = createTestDungeon();
    // Keep advancing until NOT player's turn (rat is faster so it should get turn)
    for (let i = 0; i < 10; i++) {
      state = advanceToNextTurn(state);
      if (state.bubbles[0]?.scheduler.currentActorId !== entityId(PLAYER_ID)) break;
    }
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns);

    // May or may not be player's turn, depends on scheduling
    // Just check the format is correct
    expect(prompt).toMatch(/Your turn: (Yes|No)/);
  });

  it('includes other crawlers section when multiple crawlers', () => {
    // Create state with two crawlers
    const state = createStateWithTwoCrawlers();
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('OTHER CRAWLERS:');
    expect(prompt).toContain('player2');
  });

  it('omits other crawlers section for single player', () => {
    let state = createTestDungeon();
    state = advanceToNextTurn(state);
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    expect(prompt).not.toContain('OTHER CRAWLERS:');
  });

  it('shows other crawler stats in multi-crawler game', () => {
    const state = createStateWithTwoCrawlers();
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Should include player2's info
    expect(prompt).toContain('Player 2');
    expect(prompt).toContain('player2');
    expect(prompt).toMatch(/HP: \d+\/\d+/);
  });

  it('uses viewer perspective based on crawlerId', () => {
    const state = createStateWithTwoCrawlers();
    const cooldowns = createCooldowns();

    // From player1's perspective
    const { prompt: prompt1 } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(prompt1).toContain('OTHER CRAWLERS:');
    expect(prompt1).toContain('player2');

    // From player2's perspective
    const { prompt: prompt2 } = prepareAIDecision(state, 'player2' as CrawlerId, cooldowns, { isYourTurn: true });
    expect(prompt2).toContain('OTHER CRAWLERS:');
    // crawler-1 should be in OTHER CRAWLERS for player2 (name varies, but ID is fixed)
    expect(prompt2).toContain('crawler-1' as CrawlerId);
  });

  it('respects isYourTurn option override', () => {
    // Create a state where it's NOT the player's turn by scheduler
    let state = createTestDungeon();
    state = advanceToNextTurn(state);
    // Force a scenario where scheduler says it's not player's turn
    // by keeping the rat as current actor
    for (let i = 0; i < 10; i++) {
      if (state.bubbles[0]?.scheduler.currentActorId !== entityId(PLAYER_ID)) break;
      state = completeTurn(state);
      state = advanceToNextTurn(state);
    }
    const cooldowns = createCooldowns();

    // With isYourTurn: true, should always show "Your turn: Yes"
    const { prompt: promptWithOverrideTrue } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(promptWithOverrideTrue).toContain('Your turn: Yes');

    // With isYourTurn: false, should always show "Your turn: No"
    const { prompt: promptWithOverrideFalse } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: false });
    expect(promptWithOverrideFalse).toContain('Your turn: No');
  });

  it('uses scheduler currentActorId when isYourTurn not provided', () => {
    let state = createTestDungeon();
    // Keep advancing until player's turn
    for (let i = 0; i < 20; i++) {
      state = advanceToNextTurn(state);
      if (state.bubbles[0]?.scheduler.currentActorId === entityId(PLAYER_ID)) break;
      state = completeTurn(state);
    }
    const cooldowns = createCooldowns();

    // Scheduler says it's player's turn, should show "Your turn: Yes"
    if (state.bubbles[0]?.scheduler.currentActorId === entityId(PLAYER_ID)) {
      const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns);
      expect(prompt).toContain('Your turn: Yes');
    }
  });
});

describe('prepareAIDecision with character info', () => {
  it('includes YOUR CHARACTER section when crawler has characterClass', () => {
    const state = createTestDungeon();
    const crawlers = getCrawlers(state);
    const crawler = crawlers[0]!;
    const cooldowns = createCooldowns();

    // Crawlers from createTestDungeon have characterClass
    expect(crawler.characterClass).toBeDefined();

    const { prompt } = prepareAIDecision(state, crawler.id as CrawlerId, cooldowns, { isYourTurn: true });
    expect(prompt).toContain('YOUR CHARACTER:');
    expect(prompt).toContain('Name:');
    expect(prompt).toContain('Class:');
    expect(prompt).toContain('Personality:');
  });

  it('includes correct class in prompt', () => {
    const state = createTestDungeon();
    const crawlers = getCrawlers(state);
    const crawler = crawlers[0]!;
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, crawler.id as CrawlerId, cooldowns, { isYourTurn: true });
    expect(prompt).toContain(`Class: ${crawler.characterClass}`);
  });

  it('includes formatted character title', () => {
    const state = createTestDungeon();
    const crawlers = getCrawlers(state);
    const crawler = crawlers[0]!;
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, crawler.id as CrawlerId, cooldowns, { isYourTurn: true });
    // Title format: "Name the Class"
    const classCapitalized = crawler.characterClass!.charAt(0).toUpperCase() + crawler.characterClass!.slice(1);
    expect(prompt).toContain(`${crawler.name} the ${classCapitalized}`);
  });
});

describe('prepareAIDecision with bio', () => {
  it('includes bio in YOUR CHARACTER section when present', () => {
    const state = createTestDungeon();
    const crawler = getCrawlers(state)[0]!;
    const cooldowns = createCooldowns();

    // Add bio to the crawler
    const crawlerWithBio = {
      ...crawler,
      bio: 'A former blacksmith seeking redemption.',
    };
    const stateWithBio = {
      ...state,
      entities: {
        ...state.entities,
        [crawler.id]: crawlerWithBio,
      },
    };

    const { prompt } = prepareAIDecision(stateWithBio, crawler.id as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('YOUR CHARACTER');
    expect(prompt).toContain('Backstory: A former blacksmith seeking redemption.');
  });

  it('omits backstory line when bio is empty', () => {
    const state = createTestDungeon();
    const crawler = getCrawlers(state)[0]!;
    const cooldowns = createCooldowns();

    // Ensure crawler has no bio
    const crawlerWithoutBio = {
      ...crawler,
      bio: undefined,
    };
    const stateWithoutBio = {
      ...state,
      entities: {
        ...state.entities,
        [crawler.id]: crawlerWithoutBio,
      },
    };

    const { prompt } = prepareAIDecision(stateWithoutBio, crawler.id as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('YOUR CHARACTER');
    expect(prompt).not.toContain('Backstory:');
  });

  it('omits backstory line when bio is empty string', () => {
    const state = createTestDungeon();
    const crawler = getCrawlers(state)[0]!;
    const cooldowns = createCooldowns();

    // Set bio to empty string
    const crawlerWithEmptyBio = {
      ...crawler,
      bio: '',
    };
    const stateWithEmptyBio = {
      ...state,
      entities: {
        ...state.entities,
        [crawler.id]: crawlerWithEmptyBio,
      },
    };

    const { prompt } = prepareAIDecision(stateWithEmptyBio, crawler.id as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).not.toContain('Backstory:');
  });
});

describe('prepareAIDecision with items', () => {
  it('includes ITEMS section in prompt with relative positions', () => {
    const state = createTestDungeon();
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Add an item at player's position for testing (should show as "here")
    const stateWithItems = {
      ...state,
      items: [{ id: 'item-0', templateId: 'health_potion', x: player.x, y: player.y, areaId: player.areaId }],
    };
    const { prompt } = prepareAIDecision(stateWithItems, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(prompt).toContain('ITEMS:');
    // Items now use relative positions like "Health Potion (here)" or "Health Potion (3 tiles north)"
    expect(prompt).toContain('Health Potion (here)');
  });

  it('shows None visible when no items', () => {
    const state = createTestDungeon();
    const cooldowns = createCooldowns();

    // Remove items to test the "None visible" display (createTestDungeon now includes items by default)
    const stateWithNoItems = { ...state, items: [] };
    const { prompt } = prepareAIDecision(stateWithNoItems, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(prompt).toContain('ITEMS:');
    expect(prompt).toContain('None visible');
  });

  it('includes AVAILABLE ACTIONS section', () => {
    const state = createTestDungeon();
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(prompt).toContain('AVAILABLE ACTIONS:');
    // Should list move options
    expect(prompt).toMatch(/- move (north|south|east|west)/);
    // Should include wait option
    expect(prompt).toContain('- wait: skip turn');
  });

  it('includes TACTICAL SITUATION section', () => {
    const state = createTestDungeon();
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(prompt).toContain('TACTICAL SITUATION:');
    // Should include threat assessment
    expect(prompt).toMatch(/- Adjacent threats:/);
    // Should include escape routes
    expect(prompt).toMatch(/- Escape routes:/);
    // Should include recommendation
    expect(prompt).toMatch(/- Recommendation:/);
  });

  it('shows attack options for adjacent monsters', () => {
    const state = createTestDungeon();
    const cooldowns = createCooldowns();

    // Place player adjacent to a monster
    const monsters = getMonsters(state);
    const monster = monsters[0];
    const player = getPlayer(state)!;
    // Create state with player adjacent to monster
    const modifiedState = {
      ...state,
      entities: {
        ...state.entities,
        [PLAYER_ID]: { ...player, x: monster.x - 1, y: monster.y },
      },
    };
    const { prompt } = prepareAIDecision(modifiedState, PLAYER_ID, cooldowns, { isYourTurn: true });
    // Should show attack option
    expect(prompt).toMatch(/- attack east:/);
  });
});

// --- analyzeTile tests ---

describe('analyzeTile', () => {
  it('returns blocked for wall tiles', () => {
    const state = createTestDungeon();
    // Top-left corner is a wall at (0, 0)
    const result = analyzeTile(state, 1, 1, 'northwest');
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe('wall');
  });

  it('returns clear for floor tiles', () => {
    const state = createTestDungeon();
    // Move from inside left room (avoiding monster positions)
    // Rat1 is at (3,3), Rat2 is at (6,5), Player is at (4,4)
    const result = analyzeTile(state, 5, 6, 'east');
    expect(result.blocked).toBe(false);
    expect(result.blockedBy).toBeNull();
  });

  it('returns blocked with monster info when monster present', () => {
    const state = createTestDungeon();
    const monsters = getMonsters(state);
    const monster = monsters[0];
    // Analyze from position adjacent to monster
    const result = analyzeTile(state, monster.x - 1, monster.y, 'east');
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(monster.name);
    expect(result.hasMonster).toBe(monster);
  });

  it('returns blocked for edge of map', () => {
    const state = createTestDungeon();
    // Try to go north from top row
    const result = analyzeTile(state, 5, 0, 'north');
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe('edge');
  });

  it('detects items on tiles', () => {
    const state = createTestDungeon();
    // Place item at (6, 6) - a clear floor position east of (5, 6)
    const stateWithItems = {
      ...state,
      items: [{ id: 'item-0', templateId: 'health_potion', x: 6, y: 6, areaId: 'area-1' }],
    };
    const result = analyzeTile(stateWithItems, 5, 6, 'east');
    expect(result.hasItem).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('allows diagonal moves when only ONE cardinal is blocked (moderate approach)', () => {
    const state = createTestDungeon();
    // The moderate approach allows squeezing past a single corner
    // At (1, 1), northwest goes to (0, 0) which is wall - but that's blocked by wall itself
    // So test that diagonal moves in the middle of the room work
    const result = analyzeTile(state, 5, 7, 'southeast');
    expect(result.blocked).toBe(false);
    expect(result.blockedBy).toBeNull();
  });
});

describe('estimateCombat', () => {
  it('calculates damage correctly', () => {
    const attacker: Entity = {
      id: 'a', type: 'crawler', x: 0, y: 0, hp: 10, maxHp: 10,
      name: 'A', char: '@', attack: 5, defense: 1, speed: 100, areaId: 'area-1',
    };
    const defender: Entity = {
      id: 'd', type: 'monster', x: 1, y: 0, hp: 8, maxHp: 8,
      name: 'D', monsterTypeId: 'goblin', attack: 3, defense: 2, speed: 100, areaId: 'area-1',
    };
    const result = estimateCombat(attacker, defender);
    // Damage = attack - defense = 5 - 2 = 3
    expect(result.damageDealt).toBe(3);
    // Hits to kill = ceil(8 / 3) = 3
    expect(result.hitsToKill).toBe(3);
    // Damage received = 3 - 1 = 2
    expect(result.damageReceived).toBe(2);
    // Hits to survive = ceil(10 / 2) = 5
    expect(result.hitsToSurvive).toBe(5);
  });

  it('enforces minimum 1 damage', () => {
    const attacker: Entity = {
      id: 'a', type: 'crawler', x: 0, y: 0, hp: 10, maxHp: 10,
      name: 'A', char: '@', attack: 1, defense: 0, speed: 100, areaId: 'area-1',
    };
    const defender: Entity = {
      id: 'd', type: 'monster', x: 1, y: 0, hp: 5, maxHp: 5,
      name: 'D', monsterTypeId: 'troll', attack: 2, defense: 10, speed: 100, areaId: 'area-1',
    };
    const result = estimateCombat(attacker, defender);
    // Attack 1 - Defense 10 would be -9, but minimum is 1
    expect(result.damageDealt).toBe(1);
    expect(result.hitsToKill).toBe(5);
  });
});

// --- prepareAIDecision with FOV tests ---

/**
 * Helper to create a test state with custom map and entities.
 * Used for testing FOV-filtered prompts.
 */
function createTestStateWithMap(params: {
  ascii: string;
  playerPos: { x: number; y: number };
  monsters?: Array<{ x: number; y: number; name: string; char: string }>;
  exploredTiles?: string[];
}): GameState {
  const { tiles, width, height } = parseAsciiMap(params.ascii);
  const map: DungeonMap = {
    width,
    height,
    tiles,
    rooms: [{
      x: 1, y: 1, width: width - 2, height: height - 2,
      center: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
      tags: ['starting'],
    }],
    seed: 0,
  };

  const player: Entity = {
    id: PLAYER_ID,
    type: 'crawler',
    x: params.playerPos.x,
    y: params.playerPos.y,
    hp: 10,
    maxHp: 10,
    name: 'Player',
    char: '@',
    attack: 2,
    defense: 0,
    speed: 100,
    areaId: 'area-1',
  };

  const entities: Record<string, Entity> = { [PLAYER_ID]: player };

  const monsters = params.monsters ?? [];
  monsters.forEach((m, i) => {
    const monster: Entity = {
      id: `monster-${i}`,
      type: 'monster',
      x: m.x,
      y: m.y,
      hp: 3,
      maxHp: 3,
      name: m.name,
      monsterTypeId: 'goblin',
      attack: 2,
      defense: 1,
      speed: 100,
      areaId: 'area-1',
    };
    entities[monster.id] = monster;
  });

  // Create bubble with all entities
  const allEntityIds = Object.keys(entities).map(id => entityId(id));
  const allEntitySpeeds = Object.values(entities).map(e => ({
    id: entityId(e.id),
    speed: e.speed,
  }));

  const bubble = createBubble({
    id: bubbleId('bubble-main'),
    entityIds: allEntityIds,
    entities: allEntitySpeeds,
    center: { x: player.x, y: player.y },
  });

  // Initialize exploredTiles for player
  const exploredTiles: Record<string, string[]> = {};
  if (params.exploredTiles) {
    exploredTiles[PLAYER_ID] = params.exploredTiles;
  }

  return {
    zone: createTestZone(map),
    currentAreaId: DEFAULT_AREA_ID,
    entities,
    items: [],
    bubbles: [bubble],
    hibernating: [],
    exploredTiles,
    objectives: [],
    turn: 0,
    messages: [{ id: 'msg-0-0', text: 'Test game started.', turn: 0 }],
    gameStatus: { status: 'playing' },
  };
}

describe('prepareAIDecision with FOV', () => {
  it('excludes monsters behind walls from prompt', () => {
    // Map with completely separate rooms - solid wall between player and goblin
    const state = createTestStateWithMap({
      ascii: [
        '##########',
        '#.@..#...#',
        '#....#.g.#',
        '#....#...#',
        '##########',
      ].join('\n'),
      playerPos: { x: 2, y: 1 },
      monsters: [{ x: 7, y: 2, name: 'Goblin', char: 'g' }],
    });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Monster should not appear in prompt (in separate room, not visible)
    expect(prompt).not.toContain('Goblin');
  });

  it('includes visible monsters in prompt', () => {
    // Map with player and goblin in same room
    const state = createTestStateWithMap({
      ascii: [
        '#######',
        '#.....#',
        '#.@.g.#',
        '#.....#',
        '#######',
      ].join('\n'),
      playerPos: { x: 2, y: 2 },
      monsters: [{ x: 4, y: 2, name: 'Goblin', char: 'g' }],
    });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Monster should appear in prompt (visible)
    expect(prompt).toContain('Goblin');
  });
});

describe('prepareAIDecision with objectives', () => {
  it('includes objectives section in prompt', () => {
    // Create test dungeon and manually add objectives for testing prepareAIDecision
    const baseState = createTestDungeon({ crawlerCount: 1 });
    const state = {
      ...baseState,
      objectives: [
        createClearZoneObjective({
          id: 'obj-primary',
          description: 'Kill all monsters in the dungeon',
          target: { x1: 0, y1: 0, x2: 29, y2: 14 },
          assignee: null,
          priority: 'primary',
        }),
      ],
    };
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, crawlerIdFromIndex(1), cooldowns, { isYourTurn: true });

    expect(prompt).toContain('OBJECTIVES');
    expect(prompt).toContain('[PRIMARY]');
    expect(prompt).toContain('Kill all monsters');
  });

  it('shows per-crawler objectives only for that crawler', () => {
    // Create test dungeon with 2 crawlers and manually add objectives
    const baseState = createTestDungeon({ crawlerCount: 2 });
    const state = {
      ...baseState,
      objectives: [
        createClearZoneObjective({
          id: 'obj-primary',
          description: 'Kill all monsters in the dungeon',
          target: { x1: 0, y1: 0, x2: 29, y2: 14 },
          assignee: null,
          priority: 'primary',
        }),
        createKillObjective({
          id: 'obj-troll',
          description: 'Defeat the Troll',
          target: { entityId: 'troll' },
          assignee: crawlerIdFromIndex(1),
          priority: 'secondary',
        }),
        createReachObjective({
          id: 'obj-explore',
          description: 'Scout the eastern corridor',
          target: { x: 18, y: 7 },
          assignee: crawlerIdFromIndex(2),
          priority: 'secondary',
        }),
      ],
    };
    const cooldowns = createCooldowns();

    const { prompt: prompt1 } = prepareAIDecision(state, crawlerIdFromIndex(1), cooldowns, { isYourTurn: true });
    expect(prompt1).toContain('Defeat the Troll');

    const { prompt: prompt2 } = prepareAIDecision(state, crawlerIdFromIndex(2), cooldowns, { isYourTurn: true });
    expect(prompt2).not.toContain('Defeat the Troll');
    expect(prompt2).toContain('Scout the eastern');
  });

  it('includes fallback instruction when no active secondary objectives', () => {
    // Create test dungeon and manually add only a primary objective
    const baseState = createTestDungeon({ crawlerCount: 1 });
    const state = {
      ...baseState,
      objectives: [
        createClearZoneObjective({
          id: 'obj-primary',
          description: 'Kill all monsters in the dungeon',
          target: { x1: 0, y1: 0, x2: 29, y2: 14 },
          assignee: null,
          priority: 'primary',
        }),
      ],
    };
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, crawlerIdFromIndex(1), cooldowns, { isYourTurn: true });
    expect(prompt).toMatch(/explore|assist/i);
  });
});

describe('prepareAIDecision exploration values', () => {
  it('includes exploration values in AVAILABLE ACTIONS', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    // Player starts in left room with partial exploration
    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Should have exploration values in move lines
    expect(prompt).toMatch(/move \w+: clear.*\(exploration: \d+/);
  });

  it('marks best exploration direction', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Should mark one direction as best (if any have unexplored)
    // Pattern: "exploration: N - best" or "exploration: N"
    expect(prompt).toMatch(/exploration: \d+( - best)?/);
  });

  it('shows exploration: 0 - fully explored for directions with no unexplored tiles', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // For blocked directions, there should still be exploration info
    // For fully explored directions, should show "fully explored"
    // This tests that exploration values are appended to all move lines
    expect(prompt).toContain('AVAILABLE ACTIONS:');
    // At minimum, we should have multiple move lines with exploration info
    const moveLines = prompt.split('\n').filter(line => line.includes('- move'));
    const linesWithExploration = moveLines.filter(line => line.includes('exploration:'));
    // All non-blocked move lines should have exploration info
    const clearMoveLines = moveLines.filter(line => line.includes(': clear'));
    expect(linesWithExploration.length).toBeGreaterThan(0);
    expect(linesWithExploration.length).toBe(clearMoveLines.length);
  });

  it('shows BLOCKED without exploration for blocked directions', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    const { prompt } = prepareAIDecision(state, PLAYER_ID, cooldowns, { isYourTurn: true });

    // Blocked directions should not have exploration values
    const moveLines = prompt.split('\n').filter(line => line.includes('- move'));
    const blockedLines = moveLines.filter(line => line.includes('BLOCKED'));

    // Blocked lines should exist (walls in test dungeon)
    expect(blockedLines.length).toBeGreaterThan(0);

    // Blocked lines should NOT have exploration info
    for (const line of blockedLines) {
      expect(line).not.toContain('exploration:');
    }
  });
});

describe('prepareAIDecision tactical exploration', () => {
  it('includes exploration recommendation in TACTICAL SITUATION when no enemies adjacent', () => {
    // Create a state where player has no adjacent enemies
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    // Kill all monsters to simulate post-combat exploration
    const stateNoMonsters = {
      ...state,
      entities: Object.fromEntries(
        Object.entries(state.entities).filter(([_, e]) => e.type !== 'monster')
      ),
    };

    const { prompt } = prepareAIDecision(stateNoMonsters, 'crawler-1' as CrawlerId, cooldowns, { isYourTurn: true });

    // Should have exploration section in tactical situation
    expect(prompt).toMatch(/Exploration:/);
  });

  it('shows fully explored message when all areas explored', () => {
    const state = createTestDungeon({ seed: 42 });
    const cooldowns = createCooldowns();

    // Mark entire map as explored
    const fullyExploredState = {
      ...state,
      exploredTiles: {
        [state.currentAreaId]: Array.from({ length: 30 * 15 }, (_, i) =>
          `${i % 30},${Math.floor(i / 30)}`
        ),
      },
      entities: Object.fromEntries(
        Object.entries(state.entities).filter(([_, e]) => e.type !== 'monster')
      ),
    };

    const { prompt } = prepareAIDecision(fullyExploredState, 'crawler-1' as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).toMatch(/All areas explored/);
  });

  it('does not show exploration when enemies are adjacent', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const monsters = getMonsters(state);
    const monster = monsters[0];
    const cooldowns = createCooldowns();

    // Place player adjacent to monster
    const stateWithAdjacentEnemy = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: { ...player, x: monster.x - 1, y: monster.y },
      },
    };

    const { prompt } = prepareAIDecision(stateWithAdjacentEnemy, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    // Should NOT have exploration section when enemies adjacent
    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    expect(tacticalSection).not.toMatch(/- Exploration:/);
  });
});

describe('Multi-crawler explored tiles with prepareAIDecision', () => {
  it('uses correct crawler perspective for explored tiles', () => {
    const state = createStateWithTwoCrawlers();
    const cooldowns = createCooldowns();

    // Player has explored left side, player2 has explored right side
    const stateWithExplored = {
      ...state,
      exploredTiles: {
        [PLAYER_ID]: [tileKey(1, 1), tileKey(1, 2)],
        player2: [tileKey(7, 7), tileKey(8, 7)],
      },
    };

    // Each crawler should get their own perspective in the prompt
    const { prompt: prompt1 } = prepareAIDecision(stateWithExplored, PLAYER_ID, cooldowns, { isYourTurn: true });
    expect(prompt1).toContain('YOUR STATUS:');

    const { prompt: prompt2 } = prepareAIDecision(stateWithExplored, 'player2' as CrawlerId, cooldowns, { isYourTurn: true });
    expect(prompt2).toContain('YOUR STATUS:');
  });
});

// --- Pickup Conflict Detection Tests ---

import { getItemTemplate } from '../../engine/items';

describe('detectPickupConflict', () => {
  it('returns null when no conflict exists', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const template = getItemTemplate('short_sword')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).toBeNull();
  });

  it('detects already equipped weapon', () => {
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 4, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: equippedSword,
      equippedArmor: null,
    };

    const template = getItemTemplate('short_sword')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).not.toBeNull();
    expect(conflict!.type).toBe('already_equipped');
    expect(conflict!.warning).toContain('ALREADY EQUIPPED');
    expect(conflict!.warning).toContain('Short Sword');
  });

  it('detects already equipped armor', () => {
    const equippedArmor = { id: 'item-1', templateId: 'leather_armor', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 1, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: equippedArmor,
    };

    const template = getItemTemplate('leather_armor')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).not.toBeNull();
    expect(conflict!.type).toBe('already_equipped');
    expect(conflict!.warning).toContain('ALREADY EQUIPPED');
    expect(conflict!.warning).toContain('Leather Armor');
  });

  it('detects duplicate equipment in bag', () => {
    // Sword in bag (not equipped), trying to pick up another sword
    const swordInBag = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [swordInBag],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const template = getItemTemplate('short_sword')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).not.toBeNull();
    expect(conflict!.type).toBe('duplicate_in_bag');
    expect(conflict!.warning).toContain('DUPLICATE');
    expect(conflict!.warning).toContain('already have 1 in bag');
  });

  it('counts multiple duplicate equipment in bag', () => {
    const sword1 = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const sword2 = { id: 'item-2', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [sword1, sword2],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const template = getItemTemplate('short_sword')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).not.toBeNull();
    expect(conflict!.warning).toContain('already have 2 in bag');
  });

  it('allows stacking consumables (no warning for duplicate potions)', () => {
    // Having multiple potions is a valid strategy
    const potion1 = { id: 'item-1', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const potion2 = { id: 'item-2', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [potion1, potion2],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const template = getItemTemplate('health_potion')!;
    const conflict = detectPickupConflict(entity, template);

    // No conflict - stacking consumables is valid
    expect(conflict).toBeNull();
  });

  it('prioritizes already_equipped over duplicate_in_bag for equipment', () => {
    // Entity has sword equipped AND another sword in bag
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const swordInBag = { id: 'item-2', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 4, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [swordInBag],
      equippedWeapon: equippedSword,
      equippedArmor: null,
    };

    const template = getItemTemplate('short_sword')!;
    const conflict = detectPickupConflict(entity, template);

    // Should report already_equipped (more important) not duplicate_in_bag
    expect(conflict).not.toBeNull();
    expect(conflict!.type).toBe('already_equipped');
  });

  it('allows picking up different equipment type', () => {
    // Entity has sword equipped, picking up armor should be fine
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 4, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: equippedSword,
      equippedArmor: null,
    };

    const template = getItemTemplate('leather_armor')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).toBeNull();
  });

  it('allows picking up upgraded equipment', () => {
    // Entity has short sword, picking up long sword is fine (upgrade)
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 4, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: equippedSword,
      equippedArmor: null,
    };

    const template = getItemTemplate('long_sword')!;
    const conflict = detectPickupConflict(entity, template);

    expect(conflict).toBeNull();
  });
});

describe('prepareAIDecision with pickup warnings', () => {
  it('shows warning when picking up already equipped item', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Give player an equipped short sword
    const equippedSword = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place identical sword at player's position
    const swordOnGround = { id: 'item-1', templateId: 'short_sword', x: player.x, y: player.y, areaId: player.areaId };

    const stateWithEquipment = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: { ...player, equippedWeapon: equippedSword },
      },
      items: [swordOnGround],
    };

    const { prompt } = prepareAIDecision(stateWithEquipment, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    // Should show pickup action with warning
    expect(prompt).toContain('- pickup: Short Sword');
    expect(prompt).toContain('⚠️ ALREADY EQUIPPED');
  });

  it('shows warning when picking up duplicate equipment from bag', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Give player a sword in bag (not equipped)
    const swordInBag = { id: 'item-bag', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place identical sword at player's position
    const swordOnGround = { id: 'item-ground', templateId: 'short_sword', x: player.x, y: player.y, areaId: player.areaId };

    const stateWithSword = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: { ...player, inventory: [swordInBag] },
      },
      items: [swordOnGround],
    };

    const { prompt } = prepareAIDecision(stateWithSword, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    // Should show pickup action with warning for duplicate equipment
    expect(prompt).toContain('- pickup: Short Sword');
    expect(prompt).toContain('⚠️ DUPLICATE');
  });

  it('shows no warning for stacking consumables', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Give player potions in bag
    const potion1 = { id: 'item-1', templateId: 'health_potion', x: 0, y: 0, areaId: player.areaId };
    const potion2 = { id: 'item-2', templateId: 'health_potion', x: 0, y: 0, areaId: player.areaId };

    // Place another potion at player's position
    const potionOnGround = { id: 'item-ground', templateId: 'health_potion', x: player.x, y: player.y, areaId: player.areaId };

    const stateWithPotions = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: { ...player, inventory: [potion1, potion2] },
      },
      items: [potionOnGround],
    };

    const { prompt } = prepareAIDecision(stateWithPotions, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    // Should show pickup action WITHOUT warning - stacking consumables is valid
    expect(prompt).toContain('- pickup: Health Potion');
    expect(prompt).not.toContain('⚠️');
  });

  it('shows no warning for new items', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Place a sword at player's position (player has no sword)
    const swordOnGround = { id: 'item-1', templateId: 'short_sword', x: player.x, y: player.y, areaId: player.areaId };

    const stateWithItem = {
      ...state,
      items: [swordOnGround],
    };

    const { prompt } = prepareAIDecision(stateWithItem, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    // Should show pickup action without warning
    expect(prompt).toContain('- pickup: Short Sword');
    expect(prompt).not.toContain('⚠️');
  });
});

// --- Enhanced Status Section Tests ---

describe('computeStatusDetails', () => {
  it('shows critical HP warning when HP is 30% or below', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 3, maxHp: 10,  // 30% - exactly at threshold
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.hpWarning).toBe(' ⚠️ CRITICAL');
  });

  it('shows low HP warning when HP is between 30% and 50%', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 4, maxHp: 10,  // 40% - between thresholds
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.hpWarning).toBe(' ⚠️ LOW');
  });

  it('shows no HP warning when HP is above 50%', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 6, maxHp: 10,  // 60% - healthy
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.hpWarning).toBe('');
  });

  it('shows attack breakdown with equipped weapon', () => {
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 4, defense: 0, speed: 100,  // base 2 + sword +2
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: equippedSword,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.attackBreakdown).toBe('4 (base 2 + Short Sword +2)');
  });

  it('shows plain attack when no weapon equipped', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.attackBreakdown).toBe('2');
  });

  it('shows defense breakdown with equipped armor', () => {
    const equippedArmor = { id: 'item-1', templateId: 'leather_armor', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 1, speed: 100,  // base 0 + armor +1
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: equippedArmor,
    };

    const status = computeStatusDetails(entity);
    expect(status.defenseBreakdown).toBe('1 (base 0 + Leather Armor +1)');
  });

  it('shows plain defense when no armor equipped', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.defenseBreakdown).toBe('0');
  });

  it('summarizes single healing potion with HP amount', () => {
    const potion = { id: 'item-1', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [potion],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.healingPotions).toBe('Health Potion (+5 HP)');
  });

  it('summarizes multiple same-type potions with count', () => {
    const potion1 = { id: 'item-1', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const potion2 = { id: 'item-2', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [potion1, potion2],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.healingPotions).toBe('2x Health Potion (+5 HP each)');
  });

  it('summarizes different potion types separately', () => {
    const healthPotion = { id: 'item-1', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const greaterPotion = { id: 'item-2', templateId: 'greater_health_potion', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [healthPotion, greaterPotion],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.healingPotions).toContain('Health Potion (+5 HP)');
    expect(status.healingPotions).toContain('Greater Health Potion (+10 HP)');
  });

  it('returns empty string when no healing potions', () => {
    const sword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [sword],  // Equipment, not consumable
      equippedWeapon: null,
      equippedArmor: null,
    };

    const status = computeStatusDetails(entity);
    expect(status.healingPotions).toBe('');
  });
});

describe('generateStatusSection', () => {
  it('generates complete status section with all components', () => {
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: 'area-1' };
    const equippedArmor = { id: 'item-2', templateId: 'leather_armor', x: 0, y: 0, areaId: 'area-1' };
    const potion1 = { id: 'item-3', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };
    const potion2 = { id: 'item-4', templateId: 'health_potion', x: 0, y: 0, areaId: 'area-1' };

    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 3, maxHp: 10,  // Critical HP
      name: 'Test',
      char: '@',
      attack: 4, defense: 1, speed: 100,
      areaId: 'area-1',
      inventory: [potion1, potion2],
      equippedWeapon: equippedSword,
      equippedArmor: equippedArmor,
    };

    const section = generateStatusSection(entity);

    expect(section).toContain('HP: 3/10 ⚠️ CRITICAL');
    expect(section).toContain('Attack: 4 (base 2 + Short Sword +2)');
    expect(section).toContain('Defense: 1 (base 0 + Leather Armor +1)');
    expect(section).toContain('Speed: 100');
    expect(section).toContain('Healing: 2x Health Potion (+5 HP each)');
  });

  it('omits healing line when no potions available', () => {
    const entity: Entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 0, y: 0,
      hp: 10, maxHp: 10,
      name: 'Test',
      char: '@',
      attack: 2, defense: 0, speed: 100,
      areaId: 'area-1',
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
    };

    const section = generateStatusSection(entity);

    expect(section).not.toContain('Healing:');
  });
});

describe('Enhanced status in prompt', () => {
  it('includes equipment breakdown in YOUR STATUS section', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Equip player with sword
    const equippedSword = { id: 'item-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };
    const stateWithEquipment = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: {
          ...player,
          attack: 4,  // base 2 + sword +2
          equippedWeapon: equippedSword,
        },
      },
    };

    const { prompt } = prepareAIDecision(stateWithEquipment, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('YOUR STATUS:');
    expect(prompt).toContain('Attack: 4 (base 2 + Short Sword +2)');
  });

  it('includes healing potions in YOUR STATUS section', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Give player potions
    const potion1 = { id: 'item-1', templateId: 'health_potion', x: 0, y: 0, areaId: player.areaId };
    const potion2 = { id: 'item-2', templateId: 'health_potion', x: 0, y: 0, areaId: player.areaId };
    const stateWithPotions = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: {
          ...player,
          inventory: [potion1, potion2],
        },
      },
    };

    const { prompt } = prepareAIDecision(stateWithPotions, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('YOUR STATUS:');
    expect(prompt).toContain('Healing: 2x Health Potion (+5 HP each)');
  });

  it('shows HP warning in YOUR STATUS when health is low', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Set player to low HP
    const stateWithLowHp = {
      ...state,
      entities: {
        ...state.entities,
        [player.id]: {
          ...player,
          hp: 2,  // Low HP (2/8 = 25% = CRITICAL)
        },
      },
    };

    const { prompt } = prepareAIDecision(stateWithLowHp, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    expect(prompt).toContain('HP: 2/8 ⚠️ CRITICAL');
  });
});

// --- Tactical Recommendation Filtering Tests (CRA-158) ---

describe('generateTacticalSituation filters useless items', () => {
  it('excludes adjacent items that are already equipped from tactical recs', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Give player an equipped short sword
    const equippedSword = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place identical sword adjacent to player (1 tile east)
    const adjacentSword = { id: 'item-adj', templateId: 'short_sword', x: player.x + 1, y: player.y, areaId: player.areaId };

    // Remove all monsters so item recommendations show up
    const stateWithSetup = {
      ...state,
      entities: {
        ...Object.fromEntries(
          Object.entries(state.entities).filter(([_, e]) => e.type !== 'monster')
        ),
        [player.id]: { ...player, equippedWeapon: equippedSword, attack: 4 },
      },
      items: [adjacentSword],
    };

    const { prompt } = prepareAIDecision(stateWithSetup, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    // Tactical situation should NOT mention the adjacent Short Sword as a pickup target
    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    expect(tacticalSection).not.toContain('Adjacent items:');
    // Should NOT recommend moving toward useless item
    expect(tacticalSection).not.toMatch(/Recommendation:.*Short Sword/);
  });

  it('excludes nearby items that are already equipped from tactical recs', () => {
    const state = createTestStateWithMap({
      ascii: [
        '###########',
        '#.........#',
        '#.........#',
        '#.........#',
        '#.........#',
        '###########',
      ].join('\n'),
      playerPos: { x: 2, y: 2 },
    });
    const player = state.entities[PLAYER_ID]!;
    const cooldowns = createCooldowns();

    // Equip player with short sword
    const equippedSword = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place identical sword 3 tiles away (nearby, not adjacent)
    const nearbySword = { id: 'item-far', templateId: 'short_sword', x: 5, y: 2, areaId: player.areaId };

    const stateWithSetup = {
      ...state,
      entities: {
        ...state.entities,
        [PLAYER_ID]: { ...player, equippedWeapon: equippedSword, attack: 4 },
      },
      items: [nearbySword],
    };

    const { prompt } = prepareAIDecision(stateWithSetup, PLAYER_ID, cooldowns, { isYourTurn: true });

    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    // Should NOT list the useless sword in nearby items
    expect(tacticalSection).not.toContain('Nearby items:');
    // Should NOT recommend moving toward it
    expect(tacticalSection).not.toMatch(/Recommendation:.*Short Sword/);
  });

  it('excludes items that duplicate equipment in bag from tactical recs', () => {
    const state = createTestStateWithMap({
      ascii: [
        '###########',
        '#.........#',
        '#.........#',
        '#.........#',
        '#.........#',
        '###########',
      ].join('\n'),
      playerPos: { x: 2, y: 2 },
    });
    const player = state.entities[PLAYER_ID]!;
    const cooldowns = createCooldowns();

    // Put a short sword in the bag (not equipped)
    const swordInBag = { id: 'bag-sword', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place identical sword nearby
    const nearbySword = { id: 'item-far', templateId: 'short_sword', x: 5, y: 2, areaId: player.areaId };

    const stateWithSetup = {
      ...state,
      entities: {
        ...state.entities,
        [PLAYER_ID]: { ...player, inventory: [swordInBag] },
      },
      items: [nearbySword],
    };

    const { prompt } = prepareAIDecision(stateWithSetup, PLAYER_ID, cooldowns, { isYourTurn: true });

    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    expect(tacticalSection).not.toContain('Nearby items:');
  });

  it('still recommends useful items (consumables, upgrades)', () => {
    const state = createTestStateWithMap({
      ascii: [
        '###########',
        '#.........#',
        '#.........#',
        '#.........#',
        '#.........#',
        '###########',
      ].join('\n'),
      playerPos: { x: 2, y: 2 },
    });
    const player = state.entities[PLAYER_ID]!;
    const cooldowns = createCooldowns();

    // Equip player with short sword
    const equippedSword = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place a health potion nearby (always useful) and a duplicate sword
    const nearbyPotion = { id: 'item-potion', templateId: 'health_potion', x: 5, y: 2, areaId: player.areaId };
    const nearbySword = { id: 'item-sword', templateId: 'short_sword', x: 7, y: 2, areaId: player.areaId };

    const stateWithSetup = {
      ...state,
      entities: {
        ...state.entities,
        [PLAYER_ID]: { ...player, equippedWeapon: equippedSword, attack: 4 },
      },
      items: [nearbyPotion, nearbySword],
    };

    const { prompt } = prepareAIDecision(stateWithSetup, PLAYER_ID, cooldowns, { isYourTurn: true });

    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    // Should show Health Potion (useful) but NOT Short Sword (duplicate)
    expect(tacticalSection).toContain('Health Potion');
    expect(tacticalSection).not.toMatch(/Nearby items:.*Short Sword/);
  });

  it('falls through to exploration when all visible items are useless', () => {
    const state = createTestStateWithMap({
      ascii: [
        '###########',
        '#.........#',
        '#.........#',
        '#.........#',
        '#.........#',
        '###########',
      ].join('\n'),
      playerPos: { x: 2, y: 2 },
    });
    const player = state.entities[PLAYER_ID]!;
    const cooldowns = createCooldowns();

    // Equip player with short sword
    const equippedSword = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place ONLY a duplicate sword nearby
    const nearbySword = { id: 'item-sword', templateId: 'short_sword', x: 5, y: 2, areaId: player.areaId };

    const stateWithSetup = {
      ...state,
      entities: {
        ...state.entities,
        [PLAYER_ID]: { ...player, equippedWeapon: equippedSword, attack: 4 },
      },
      items: [nearbySword],
    };

    const { prompt } = prepareAIDecision(stateWithSetup, PLAYER_ID, cooldowns, { isYourTurn: true });

    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    // Should NOT recommend the sword, should fall through to explore/enemies
    expect(tacticalSection).not.toMatch(/Recommendation:.*Short Sword/);
    expect(tacticalSection).toMatch(/Recommendation:.*(Explore|enemy|enemies)/i);
  });

  it('still shows useful adjacent items when mixed with useless ones', () => {
    const state = createTestDungeon({ seed: 42 });
    const player = getPlayer(state)!;
    const cooldowns = createCooldowns();

    // Equip short sword
    const equippedSword = { id: 'weapon-1', templateId: 'short_sword', x: 0, y: 0, areaId: player.areaId };

    // Place duplicate sword and useful potion on adjacent tiles
    const adjacentSword = { id: 'item-sword', templateId: 'short_sword', x: player.x + 1, y: player.y, areaId: player.areaId };
    const adjacentPotion = { id: 'item-potion', templateId: 'health_potion', x: player.x - 1, y: player.y, areaId: player.areaId };

    const stateWithSetup = {
      ...state,
      entities: {
        ...Object.fromEntries(
          Object.entries(state.entities).filter(([_, e]) => e.type !== 'monster')
        ),
        [player.id]: { ...player, equippedWeapon: equippedSword, attack: 4 },
      },
      items: [adjacentSword, adjacentPotion],
    };

    const { prompt } = prepareAIDecision(stateWithSetup, player.id as CrawlerId, cooldowns, { isYourTurn: true });

    const tacticalSection = prompt.split('TACTICAL SITUATION:')[1]?.split('INVENTORY:')[0] ?? '';
    // Should show the potion but NOT the duplicate sword
    expect(tacticalSection).toContain('Health Potion');
    expect(tacticalSection).not.toMatch(/Adjacent items:.*Short Sword/);
  });
});
