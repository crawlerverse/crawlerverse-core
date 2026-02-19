/**
 * Field of View (FOV) Module
 *
 * Computes visible tiles using ROT.js shadowcasting algorithm.
 * Used for fog of war rendering and filtering AI observations.
 */

import * as ROT from 'rot-js';
import type { DungeonMap } from './map';
import { getTile } from './map';
import { getEntityVisionRadius } from './monsters';
import type { Entity } from './types';

// --- Constants ---

export const DEFAULT_VISION_RADIUS = 8;
export const MAX_VISION_RADIUS = 50;
const FOV_CACHE_MAX_SIZE = 100;

// --- TileKey Branded Type ---

/**
 * Branded type for tile coordinate keys. Format: "x,y"
 */
export type TileKey = string & { readonly __brand: 'TileKey' };

/**
 * Regex pattern for validating tile key format (used by ExploredTilesSchema).
 */
export const TILE_KEY_PATTERN = /^-?\d+,-?\d+$/;

/**
 * Create a tile key from coordinates.
 */
export function tileKey(x: number, y: number): TileKey {
  return `${x},${y}` as TileKey;
}

// --- FOV Cache ---

/**
 * Position-based cache for computed visible tiles.
 * Provides significant performance improvement for rendering and observations.
 */
const fovCache = new Map<string, Set<TileKey>>();

/**
 * Clear the FOV cache. Call when map is mutated (e.g., door opened/closed).
 */
export function clearFOVCache(): void {
  fovCache.clear();
}

/**
 * Get cache statistics for debugging/monitoring.
 */
export function getFOVCacheStats(): { size: number; maxSize: number } {
  return { size: fovCache.size, maxSize: FOV_CACHE_MAX_SIZE };
}

// --- Core FOV Functions ---

/**
 * Check if a tile allows light to pass through.
 */
function isTransparent(map: DungeonMap, x: number, y: number): boolean {
  const tile = getTile(map, x, y);
  if (!tile) return false;
  if (tile.type === 'wall') return false;
  if (tile.type === 'door' && !tile.open) return false;
  return true; // floors, open doors, stairs pass light
}

/**
 * Bresenham's line algorithm - generates all integer points along a line.
 * Used for line-of-sight checks to determine which tiles a projectile passes through.
 *
 * @returns Array of [x, y] coordinate pairs from start to end (inclusive)
 */
function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number][] {
  const points: [number, number][] = [];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  while (true) {
    points.push([x, y]);

    if (x === x1 && y === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
}

/**
 * Check if there's a clear line of sight between two positions.
 * Uses Bresenham's line algorithm to trace the path.
 * Returns false if any wall or closed door blocks the path.
 *
 * This is separate from FOV - an entity might be able to "see through walls"
 * (future ability) but still not be able to shoot through them.
 */
export function hasLineOfSight(
  map: DungeonMap,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): boolean {
  // Same position is always clear
  if (fromX === toX && fromY === toY) return true;

  // Get all points along the line
  const line = bresenhamLine(fromX, fromY, toX, toY);

  // Check each tile in the line (except start and end)
  for (let i = 1; i < line.length - 1; i++) {
    const [x, y] = line[i];
    if (!isTransparent(map, x, y)) {
      return false;
    }
  }

  return true;
}

/**
 * Compute visible tiles from a position using shadowcasting.
 * Results are cached by position and radius for performance.
 *
 * @throws Error if position is out of bounds
 */
export function computeVisibleTiles(
  map: DungeonMap,
  x: number,
  y: number,
  visionRadius: number = DEFAULT_VISION_RADIUS
): Set<TileKey> {
  // Bounds check - catches bugs early
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
    throw new Error(
      `Observer position (${x}, ${y}) is out of bounds for map ${map.width}x${map.height}`
    );
  }

  // Check cache
  const cacheKey = `${map.seed}:${x},${y}:${visionRadius}`;
  const cached = fovCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute FOV
  const visible = new Set<TileKey>();
  const fov = new ROT.FOV.PreciseShadowcasting((tx, ty) =>
    isTransparent(map, tx, ty)
  );

  fov.compute(x, y, visionRadius, (tx, ty, _r, visibility) => {
    if (visibility > 0) {
      visible.add(tileKey(tx, ty));
    }
  });

  // Store in cache with LRU eviction
  if (fovCache.size >= FOV_CACHE_MAX_SIZE) {
    const firstKey = fovCache.keys().next().value;
    if (firstKey) fovCache.delete(firstKey);
  }
  fovCache.set(cacheKey, visible);

  return visible;
}

/**
 * Compute visible tiles from an entity's position using its type-specific vision radius.
 *
 * For monsters, uses the monsterTypeId to look up visionRadius from MONSTER_TYPES.
 * For crawlers and other entities, uses DEFAULT_VISION_RADIUS.
 * Wraps computeVisibleTiles with the entity's position and vision radius.
 */
export function computeMonsterFOV(monster: Entity, map: DungeonMap): Set<TileKey> {
  const visionRadius = getEntityVisionRadius(monster);
  return computeVisibleTiles(map, monster.x, monster.y, visionRadius);
}

/**
 * Check if a monster can see a specific target entity.
 * Uses the monster's type-specific vision radius and FOV computation.
 * Returns false if walls or closed doors block line-of-sight, even within range.
 */
export function canMonsterSee(
  monster: Entity,
  target: Entity,
  map: DungeonMap
): boolean {
  const visibleTiles = computeMonsterFOV(monster, map);
  return isEntityVisible(target, visibleTiles);
}

/**
 * Merge visible tiles into explored tiles for a specific area.
 * Returns new record (immutable).
 *
 * @param exploredTiles - Previously explored tiles per area
 * @param visible - Currently visible tiles
 * @param areaId - The area where exploration occurred
 * @returns New record containing all explored tiles including newly visible ones
 */
export function updateExploredTiles(
  exploredTiles: Record<string, Set<TileKey>>,
  visible: Set<TileKey>,
  areaId: string
): Record<string, Set<TileKey>> {
  const currentAreaExplored = exploredTiles[areaId] ?? new Set<TileKey>();
  const updatedAreaExplored = new Set([...currentAreaExplored, ...visible]);

  return {
    ...exploredTiles,
    [areaId]: updatedAreaExplored,
  };
}

/**
 * Check if an entity is visible from a set of visible tiles.
 */
export function isEntityVisible(
  entity: { x: number; y: number },
  visibleTiles: Set<TileKey>
): boolean {
  return visibleTiles.has(tileKey(entity.x, entity.y));
}
