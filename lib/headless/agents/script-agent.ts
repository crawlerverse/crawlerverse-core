/**
 * Script Agent
 *
 * A rule-based agent for deterministic testing without AI calls.
 * Strategy: Attack adjacent monsters, else move toward the nearest one.
 *
 * Useful for:
 * - Testing game mechanics without network dependencies
 * - Performance benchmarking (no AI latency)
 * - Reproducible test scenarios
 */

import type { AgentAdapter, AgentResponse } from '../types';
import type { GameState } from '../../engine/state';
import { getMonstersInArea } from '../../engine/state';
import type { Direction, Entity } from '../../engine/types';
import type { CrawlerId } from '../../engine/crawler-id';

/**
 * Get Manhattan distance between two points.
 * Used for sorting monsters by proximity.
 */
function manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

/**
 * Check if a monster is adjacent (within 1 tile including diagonals).
 * Chebyshev distance of 1.
 */
function isAdjacent(entity: Entity, monster: Entity): boolean {
  const dx = Math.abs(monster.x - entity.x);
  const dy = Math.abs(monster.y - entity.y);
  return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
}

/**
 * Get the direction from one position to another.
 * Returns the best direction to move to reach the target.
 */
function getDirectionToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Direction | null {
  const dx = toX - fromX;
  const dy = toY - fromY;

  if (dx === 0 && dy === 0) return null;

  // Determine horizontal component
  const horizontal = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  // Determine vertical component (y increases downward)
  const vertical = dy > 0 ? 'south' : dy < 0 ? 'north' : '';

  // Combine into a direction
  if (vertical && horizontal) {
    // Diagonal direction
    return `${vertical}${horizontal}` as Direction;
  } else if (vertical) {
    return vertical as Direction;
  } else if (horizontal) {
    return horizontal as Direction;
  }

  return null;
}

/**
 * ScriptAgent - A rule-based agent for deterministic testing.
 *
 * Decision logic:
 * 1. If any monster is adjacent, attack it (prioritize closer by Manhattan distance)
 * 2. If monsters exist but none adjacent, move toward the nearest one
 * 3. If no monsters, wait
 */
export class ScriptAgent implements AgentAdapter {
  async getAction(
    crawlerId: CrawlerId,
    _prompt: string,
    state: GameState
  ): Promise<AgentResponse> {
    const startTime = performance.now();

    const crawler = state.entities[crawlerId];
    if (!crawler) {
      return this.createResponse(
        { action: 'wait', reasoning: `Crawler ${crawlerId} not found` },
        'Wait',
        startTime
      );
    }

    // Only consider monsters in the same area to prevent targeting across floors
    const monsters = getMonstersInArea(state, crawler.areaId);
    if (monsters.length === 0) {
      return this.createResponse(
        { action: 'wait', reasoning: 'No monsters in area' },
        'Wait',
        startTime
      );
    }

    // Sort monsters by Manhattan distance (closest first)
    const sortedMonsters = [...monsters].sort((a, b) => {
      const distA = manhattanDistance(crawler.x, crawler.y, a.x, a.y);
      const distB = manhattanDistance(crawler.x, crawler.y, b.x, b.y);
      return distA - distB;
    });

    // Find adjacent monsters (within 1 tile including diagonals)
    const adjacentMonsters = sortedMonsters.filter(m => isAdjacent(crawler, m));

    if (adjacentMonsters.length > 0) {
      // Attack the closest adjacent monster
      const target = adjacentMonsters[0];
      const direction = getDirectionToward(crawler.x, crawler.y, target.x, target.y);

      if (direction) {
        return this.createResponse(
          {
            action: 'attack',
            direction,
            reasoning: `Attacking ${target.id} (${target.name}) adjacent to the ${direction}`,
          },
          `Attack ${target.name}`,
          startTime
        );
      }
    }

    // No adjacent monsters, move toward the nearest one
    const nearestMonster = sortedMonsters[0];
    const direction = getDirectionToward(
      crawler.x,
      crawler.y,
      nearestMonster.x,
      nearestMonster.y
    );

    if (direction) {
      return this.createResponse(
        {
          action: 'move',
          direction,
          reasoning: `Moving toward ${nearestMonster.id} (${nearestMonster.name}) to the ${direction}`,
        },
        `Move ${direction}`,
        startTime
      );
    }

    // Fallback: wait (shouldn't reach here normally)
    return this.createResponse(
      { action: 'wait', reasoning: 'No valid action available' },
      'Wait',
      startTime
    );
  }

  /**
   * Create a properly formatted AgentResponse.
   */
  private createResponse(
    action: { action: string; direction?: Direction; reasoning: string },
    shortThought: string,
    startTime: number
  ): AgentResponse {
    const durationMs = Math.round(performance.now() - startTime);

    return {
      action: action as AgentResponse['action'],
      reasoning: action.reasoning,
      shortThought,
      modelId: 'script-agent',
      durationMs,
    };
  }
}
