/**
 * Trace Utilities
 *
 * Utilities for debugging and trace generation.
 * These are separate from the main AI decision context to keep concerns clean.
 *
 * - renderMapSnapshot: ASCII map rendering for debug logging
 * - buildStateSnapshot: Structured state for game traces
 */

import type { GameState } from '../engine/state';
import { getCurrentArea } from '../engine/state';
import type { CrawlerId } from '../engine/crawler-id';
import { getItemTemplate } from '../engine/items';
import { tileKey } from '../engine/fov';
import { getEntityAppearance } from '../engine/monsters';
import { isMonster } from '../engine/types';
import type { StateSnapshot } from '../headless/types';
import { computeVisibility } from './decision-context';

// Re-export StateSnapshot type for consumers
export type { StateSnapshot };

// --- Map Snapshot ---

// Helper to get tile character
function getTileChar(tile: { type: string; open?: boolean }): string {
  switch (tile.type) {
    case 'floor': return '.';
    case 'wall': return '#';
    case 'door': return tile.open ? "'" : '+';
    case 'portal': return '>';
    default: return '?';
  }
}

/**
 * Render ASCII map showing what crawler can see.
 * For debug logging and RL training data.
 */
export function renderMapSnapshot(
  state: GameState,
  crawlerId: CrawlerId
): string {
  const crawler = state.entities[crawlerId];
  if (!crawler) {
    throw new Error(`Crawler not found: ${crawlerId}`);
  }

  const { map } = getCurrentArea(state);
  const visibility = computeVisibility(state, crawlerId);

  // Build ASCII map
  const mapChars: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    mapChars[y] = [];
    for (let x = 0; x < map.width; x++) {
      const key = tileKey(x, y);
      const tile = map.tiles[y][x];
      if (visibility.visibleTiles.has(key) || visibility.exploredTiles.has(key)) {
        mapChars[y][x] = getTileChar(tile);
      } else {
        mapChars[y][x] = ' ';
      }
    }
  }

  // Place visible items
  for (const item of visibility.visibleItems) {
    const template = getItemTemplate(item.templateId);
    mapChars[item.y][item.x] = template?.appearance.char ?? '?';
  }

  // Place visible entities
  for (const entity of visibility.visibleEntities) {
    if (isMonster(entity)) {
      const { char } = getEntityAppearance(entity);
      mapChars[entity.y][entity.x] = char;
    }
  }

  // Place the crawler
  const { char: playerChar } = getEntityAppearance(crawler);
  mapChars[crawler.y][crawler.x] = playerChar;

  return mapChars.map((row) => row.join('')).join('\n');
}

// --- State Snapshot ---

/**
 * Build structured state snapshot for traces.
 * Used by headless mode for game traces.
 */
export function buildStateSnapshot(
  state: GameState,
  crawlerId: CrawlerId
): StateSnapshot {
  const crawler = state.entities[crawlerId];
  if (!crawler) {
    throw new Error(`Crawler not found: ${crawlerId}`);
  }

  const visibility = computeVisibility(state, crawlerId);

  const visibleMonsters = visibility.visibleEntities
    .filter(isMonster)
    .map((m) => ({
      id: m.id,
      name: m.name,
      hp: m.hp,
      x: m.x,
      y: m.y,
    }));

  const visibleItems = visibility.visibleItems.map((item) => ({
    templateId: item.templateId,
    x: item.x,
    y: item.y,
  }));

  return {
    visibleMonsters,
    visibleItems,
    inventory: (crawler.inventory ?? []).map((item) => item.templateId),
    equipped: {
      weapon: crawler.equippedWeapon?.templateId,
      armor: crawler.equippedArmor?.templateId,
    },
  };
}
