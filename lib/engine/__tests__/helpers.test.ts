import { describe, it, expect } from 'vitest';
import { getPendingCrawlers, getCrawlerColor, isCrawlerId } from '../helpers';
import { createTestDungeon, CRAWLER_COLORS } from '../maps/test-dungeon';
import type { Bubble } from '../bubble';
import type { EntityId } from '../scheduler';

describe('getCrawlerColor', () => {
  it('returns red for crawler-1', () => {
    expect(getCrawlerColor('crawler-1')).toBe(CRAWLER_COLORS[0]);
  });

  it('returns blue for crawler-2', () => {
    expect(getCrawlerColor('crawler-2')).toBe(CRAWLER_COLORS[1]);
  });

  it('wraps around for large indices', () => {
    // crawler-7 should wrap to index 0 (7-1=6, 6%6=0)
    expect(getCrawlerColor('crawler-7')).toBe(CRAWLER_COLORS[0]);
  });

  it('returns white for non-crawler IDs', () => {
    expect(getCrawlerColor('player')).toBe('#ffffff');
    expect(getCrawlerColor('goblin')).toBe('#ffffff');
  });

  it('returns white for malformed crawler IDs', () => {
    expect(getCrawlerColor('crawler-')).toBe('#ffffff');
    expect(getCrawlerColor('crawler-abc')).toBe('#ffffff');
  });

  it('returns white for crawler-0 (invalid: IDs are 1-based)', () => {
    // crawler-0 is invalid because crawler IDs are 1-based (crawler-1, crawler-2, etc.)
    expect(getCrawlerColor('crawler-0')).toBe('#ffffff');
  });
});

describe('isCrawlerId', () => {
  it('returns true for valid crawler IDs', () => {
    expect(isCrawlerId('crawler-1')).toBe(true);
    expect(isCrawlerId('crawler-99')).toBe(true);
  });

  it('returns false for non-crawler IDs', () => {
    expect(isCrawlerId('player')).toBe(false);
    expect(isCrawlerId('goblin')).toBe(false);
    expect(isCrawlerId('crawler-')).toBe(false);
    expect(isCrawlerId('crawler-0')).toBe(false); // 0 is invalid (IDs are 1-based)
  });
});

describe('getPendingCrawlers', () => {
  it('returns empty array when no bubbles await input', () => {
    const state = createTestDungeon({ crawlerCount: 1 });
    // Bubbles start in idle state, not awaiting_input
    const pending = getPendingCrawlers(state);
    expect(pending).toHaveLength(0);
  });

  it('returns crawler when bubble is awaiting input', () => {
    const state = createTestDungeon({ crawlerCount: 1 });

    // Manually set bubble to awaiting_input
    const updatedBubble: Bubble = {
      ...state.bubbles[0],
      executionState: {
        status: 'awaiting_input',
        actorId: 'crawler-1' as EntityId,
        waitingSince: Date.now(),
        warningEmitted: false,
      },
    };
    const updatedState = { ...state, bubbles: [updatedBubble] };

    const pending = getPendingCrawlers(updatedState);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('crawler-1');
  });

  it('returns multiple crawlers from different bubbles', () => {
    const state = createTestDungeon({ crawlerCount: 2 });

    // Set both bubbles to awaiting_input
    const updatedBubbles = state.bubbles.map((bubble, i) => ({
      ...bubble,
      executionState: {
        status: 'awaiting_input' as const,
        actorId: `crawler-${i + 1}` as EntityId,
        waitingSince: Date.now(),
        warningEmitted: false,
      },
    }));
    const updatedState = { ...state, bubbles: updatedBubbles };

    const pending = getPendingCrawlers(updatedState);
    expect(pending).toHaveLength(2);
  });

  it('ignores monsters in awaiting_input bubbles', () => {
    const state = createTestDungeon({ crawlerCount: 1 });

    // Set bubble to awaiting monster (edge case)
    const updatedBubble: Bubble = {
      ...state.bubbles[0],
      executionState: {
        status: 'awaiting_input',
        actorId: 'rat-1' as EntityId,
        waitingSince: Date.now(),
        warningEmitted: false,
      },
    };
    const updatedState = { ...state, bubbles: [updatedBubble] };

    const pending = getPendingCrawlers(updatedState);
    expect(pending).toHaveLength(0);
  });
});
