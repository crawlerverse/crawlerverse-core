'use client';

/**
 * ThoughtBubbles Component
 *
 * Renders floating thought bubbles above AI-controlled crawlers.
 * Bubbles fade in, display briefly, then fade out using CSS animations.
 */

import React from 'react';
import type { Thought } from '../../hooks/useGame';
import type { Entity } from '../../lib/engine/types';

export interface ThoughtBubblesProps {
  /** Active thoughts to display */
  thoughts: readonly Thought[];
  /** All crawlers to get positions from */
  crawlers: readonly Entity[];
  /** Tile size in pixels (default: 24) */
  tileSize?: number;
  /** Canvas offset for positioning (default: 0) */
  offsetX?: number;
  /** Canvas offset for positioning (default: 0) */
  offsetY?: number;
}

/**
 * Renders thought bubbles as an overlay on top of the game canvas.
 * Should be positioned absolutely over the canvas element.
 */
export function ThoughtBubbles({
  thoughts,
  crawlers,
  tileSize = 24,
  offsetX = 0,
  offsetY = 0,
}: ThoughtBubblesProps) {
  if (thoughts.length === 0) return null;

  // rot.js uses non-square tiles for monospace fonts
  // The actual ratio depends on the font - typically between 0.55-0.65
  const cellWidth = Math.round(tileSize * 0.65);
  const cellHeight = tileSize;

  return (
    <div className="thought-bubbles-container">
      {thoughts.map((thought) => {
        const crawler = crawlers.find((c) => c.id === thought.crawlerId);
        if (!crawler) return null;

        // Position bubble centered above the crawler's tile
        // Arrow should point to center of the glyph
        const left = crawler.x * cellWidth + offsetX + cellWidth / 2;
        const top = crawler.y * cellHeight + offsetY - 36; // Higher above the glyph

        return (
          <div
            key={thought.id}
            className="thought-bubble"
            style={{
              left: `${left}px`,
              top: `${top}px`,
            }}
          >
            {thought.text}
          </div>
        );
      })}
    </div>
  );
}

export default ThoughtBubbles;
