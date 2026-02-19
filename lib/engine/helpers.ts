/**
 * Game State Helpers
 *
 * Utility functions for querying and manipulating game state.
 */

import type { GameState, Entity } from './state';
import { isCrawler } from './state';
import { CRAWLER_COLORS } from './maps/test-dungeon';
import { logger } from '../logging';
import type { CrawlerId } from './crawler-id';
import { isCrawlerId, getCrawlerIndex } from './crawler-id';

// Re-export isCrawlerId for convenience
export { isCrawlerId } from './crawler-id';

/**
 * Get all crawlers whose bubble is awaiting input.
 * These are crawlers that can currently accept an action.
 *
 * @param state - Current game state
 * @returns Array of crawler entities awaiting input
 */
export function getPendingCrawlers(state: GameState): Entity[] {
  const pending: Entity[] = [];

  for (const bubble of state.bubbles) {
    if (bubble.executionState.status === 'awaiting_input') {
      const actorId = bubble.executionState.actorId;
      const actor = state.entities[actorId as string];

      if (!actor) {
        logger.warn(
          { actorId, bubbleId: bubble.id },
          'getPendingCrawlers: Actor referenced in bubble not found in entities'
        );
        continue;
      }

      if (!isCrawler(actor)) {
        logger.warn(
          { actorId, bubbleId: bubble.id },
          'getPendingCrawlers: Actor is not a crawler but bubble is awaiting_input'
        );
        continue;
      }

      pending.push(actor);
    }
  }

  return pending;
}

/**
 * Color type from the CRAWLER_COLORS palette.
 */
export type CrawlerColor = typeof CRAWLER_COLORS[number];

/**
 * Get the color for a crawler based on its ID.
 * IDs must be in format "crawler-N" where N is 1-based index.
 *
 * @param crawlerId - Crawler entity ID (e.g., "crawler-1")
 * @returns Hex color string from the palette, or white if ID is invalid
 */
export function getCrawlerColor(crawlerId: CrawlerId): CrawlerColor;
export function getCrawlerColor(crawlerId: string): string;
export function getCrawlerColor(crawlerId: string): string {
  if (!isCrawlerId(crawlerId)) {
    if (crawlerId.startsWith('crawler-')) {
      logger.warn({ crawlerId }, 'Malformed crawler ID, expected format crawler-N');
    }
    return '#ffffff';
  }

  // getCrawlerIndex returns 1-based index for valid CrawlerId, so subtract 1 for 0-based array access
  const colorIndex = (getCrawlerIndex(crawlerId) - 1) % CRAWLER_COLORS.length;
  return CRAWLER_COLORS[colorIndex];
}
