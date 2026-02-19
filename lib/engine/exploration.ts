/**
 * Exploration Guidance Module
 *
 * Computes exploration values for AI decision-making using flood fill.
 * Helps AI crawlers navigate toward unexplored areas efficiently.
 */

import type { DungeonMap } from './map';
import { isPassable } from './map';
import { tileKey, type TileKey } from './fov';
import type { Direction, Position } from './types';

const MIN_EXPLORATION_DEPTH = 10;
const MAX_EXPLORATION_DEPTH = 30;

// Direction deltas for 8-way movement
const DIRECTION_DELTAS: Record<Direction, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};

const ALL_DIRECTIONS: readonly Direction[] = [
  'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
];

/**
 * Compute the exploration depth limit based on map dimensions.
 * Uses map diagonal / 4, clamped between MIN and MAX.
 *
 * @param width - Map width in tiles
 * @param height - Map height in tiles
 * @returns Depth limit for BFS flood fill
 */
export function computeExplorationDepthLimit(width: number, height: number): number {
  const diagonal = Math.sqrt(width * width + height * height);
  const rawDepth = Math.floor(diagonal / 4);
  return Math.max(MIN_EXPLORATION_DEPTH, Math.min(MAX_EXPLORATION_DEPTH, rawDepth));
}

/**
 * Check if a position is valid and passable.
 */
function isValidAndPassable(map: DungeonMap, x: number, y: number): boolean {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
    return false;
  }
  return isPassable(map, x, y);
}

/**
 * Check if a tile is strictly in the valid direction from origin.
 * For cardinal directions, restricts to strict half-plane (excludes the origin axis).
 * For diagonal directions, restricts to strict quadrant.
 */
function isInDirection(
  tileX: number,
  tileY: number,
  originX: number,
  originY: number,
  dx: number,
  dy: number
): boolean {
  // For each axis with movement, tile must be strictly past origin
  // For axes without movement (dx=0 or dy=0), any position on that axis is ok
  const xOk = dx === 0 || (dx > 0 ? tileX > originX : tileX < originX);
  const yOk = dy === 0 || (dy > 0 ? tileY > originY : tileY < originY);
  return xOk && yOk;
}

/**
 * BFS through known tiles, counting unexplored tiles at the frontier.
 * Only explores tiles in the direction of movement from the origin.
 */
function bfsCountUnexplored(
  map: DungeonMap,
  startX: number,
  startY: number,
  knownTiles: Set<TileKey>,
  maxDepth: number,
  originX: number,
  originY: number,
  dirDx: number,
  dirDy: number
): number {
  const visited = new Set<TileKey>();
  const unexploredFound = new Set<TileKey>();

  // Queue entries: [x, y, depth]
  const queue: Array<[number, number, number]> = [[startX, startY, 0]];
  visited.add(tileKey(startX, startY));

  // If start tile itself is unexplored, count it
  if (!knownTiles.has(tileKey(startX, startY)) && isValidAndPassable(map, startX, startY)) {
    unexploredFound.add(tileKey(startX, startY));
  }

  while (queue.length > 0) {
    const [x, y, depth] = queue.shift()!;

    // Stop if we've reached max depth
    if (depth >= maxDepth) continue;

    // Check all 8 neighbors
    for (const [dx, dy] of Object.values(DIRECTION_DELTAS)) {
      const nx = x + dx;
      const ny = y + dy;
      const key = tileKey(nx, ny);

      if (visited.has(key)) continue;
      visited.add(key);

      // Skip tiles that go backwards past the origin
      if (!isInDirection(nx, ny, originX, originY, dirDx, dirDy)) continue;

      // Skip if not passable
      if (!isValidAndPassable(map, nx, ny)) continue;

      // If unexplored, count it
      if (!knownTiles.has(key)) {
        unexploredFound.add(key);
        // Don't traverse into unexplored tiles (we don't know what's there)
        continue;
      }

      // If known, add to queue to continue BFS
      queue.push([nx, ny, depth + 1]);
    }
  }

  return unexploredFound.size;
}

// Map direction to its opposite for backtrack detection
const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  northeast: 'southwest',
  southwest: 'northeast',
  northwest: 'southeast',
  southeast: 'northwest',
};

// Penalty applied to backtracking (going opposite of last move)
const BACKTRACK_PENALTY = 5;

/**
 * Compute exploration values for all 8 directions from a position.
 *
 * For each direction, performs BFS through explored/visible tiles and counts
 * unexplored tiles at the frontier. Higher values indicate more unexplored
 * territory in that direction.
 *
 * @param map - The dungeon map
 * @param position - Current entity position
 * @param visibleTiles - Currently visible tiles
 * @param exploredTiles - Previously explored tiles
 * @param options - Optional configuration
 * @param options.maxDepth - Depth limit (defaults to computed from map size)
 * @param options.lastMoveDirection - Last move direction to penalize backtracking
 * @returns Map of direction to exploration value (count of reachable unexplored tiles)
 */
export function computeExplorationValues(
  map: DungeonMap,
  position: Position,
  visibleTiles: Set<TileKey>,
  exploredTiles: Set<TileKey>,
  options?: {
    maxDepth?: number;
    lastMoveDirection?: Direction;
  }
): Map<Direction, number> {
  const depthLimit = options?.maxDepth ?? computeExplorationDepthLimit(map.width, map.height);
  const lastMove = options?.lastMoveDirection;
  const result = new Map<Direction, number>();

  // Combine visible and explored for traversal
  const knownTiles = new Set([...visibleTiles, ...exploredTiles]);

  for (const direction of ALL_DIRECTIONS) {
    const [dx, dy] = DIRECTION_DELTAS[direction];
    const adjX = position.x + dx;
    const adjY = position.y + dy;

    // Check if adjacent tile is blocked
    if (!isValidAndPassable(map, adjX, adjY)) {
      result.set(direction, 0);
      continue;
    }

    // BFS from adjacent tile through known (explored/visible) tiles
    // Only explore tiles in the direction of movement (no backtracking past origin)
    let explorationValue = bfsCountUnexplored(
      map,
      adjX,
      adjY,
      knownTiles,
      depthLimit,
      position.x,
      position.y,
      dx,
      dy
    );

    // Apply backtrack penalty to prevent oscillation
    // If we just moved in a direction, penalize going back the opposite way
    if (lastMove && direction === OPPOSITE_DIRECTION[lastMove]) {
      explorationValue = Math.max(0, explorationValue - BACKTRACK_PENALTY);
    }

    result.set(direction, explorationValue);
  }

  return result;
}

/**
 * Result of exploration analysis.
 */
export type ExplorationRecommendation =
  | {
      readonly type: 'explore';
      readonly bestDirection: Direction;
      readonly bestValue: number;
      readonly fullyExploredDirections: readonly Direction[];
    }
  | {
      readonly type: 'fully_explored';
      readonly bestDirection: null;
      readonly bestValue: 0;
      readonly fullyExploredDirections: readonly Direction[];
    };

/**
 * Analyze exploration values and return a recommendation.
 */
export function getExplorationRecommendation(
  values: Map<Direction, number>
): ExplorationRecommendation {
  let bestDirection: Direction | null = null;
  let bestValue = 0;
  const fullyExploredDirections: Direction[] = [];

  for (const [direction, value] of values) {
    if (value === 0) {
      fullyExploredDirections.push(direction);
    } else if (value > bestValue) {
      bestValue = value;
      bestDirection = direction;
    }
  }

  if (bestDirection === null) {
    return {
      type: 'fully_explored',
      bestDirection: null,
      bestValue: 0,
      fullyExploredDirections,
    };
  }

  return {
    type: 'explore',
    bestDirection,
    bestValue,
    fullyExploredDirections,
  };
}
