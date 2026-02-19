'use client';

/**
 * GameCanvas
 *
 * Wrapper component for rot.js Display.
 * Renders the game map using canvas with fog of war visibility.
 */

import { useEffect, useRef, useState } from 'react';
import * as ROT from 'rot-js';
import { getTile, getTileAppearance } from '../../lib/engine/map';
import { getEntityAppearance } from '../../lib/engine/monsters';
import { getPlayer, getEntity, getCrawlers, getMonstersInArea, getItemsInArea, getCurrentArea } from '../../lib/engine/state';
import { getItemTemplate } from '../../lib/engine/items';
import type { GameState } from '../../lib/engine/state';
import { getCrawlerColor } from '../../lib/engine/helpers';
import { computeVisibleTiles, DEFAULT_VISION_RADIUS, tileKey } from '../../lib/engine/fov';
import type { EntityId } from '../../lib/engine/scheduler';
import type { TargetingState } from '../../lib/engine/targeting';
import { getCurrentTargetId } from '../../lib/engine/targeting';
import { logger } from '../../lib/logging';

/** Default viewport size in tiles */
const DEFAULT_VIEWPORT_WIDTH = 40;
const DEFAULT_VIEWPORT_HEIGHT = 20;

interface GameCanvasProps {
  state: GameState;
  viewerId?: EntityId;  // Whose perspective to render (defaults to player)
  tileSize?: number;
  viewportWidth?: number;  // Viewport width in tiles (defaults to 40)
  viewportHeight?: number; // Viewport height in tiles (defaults to 25)
  targetingState?: TargetingState;
  /** Override camera position (for observer mode auto-follow) */
  cameraPosition?: { x: number; y: number };
}

/**
 * Dim a hex color by a factor (0-1).
 * @param hex - Hex color string (e.g., "#ff0000")
 * @param factor - Brightness factor (0 = black, 1 = original)
 * @returns Dimmed hex color string
 */
function dimColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

/**
 * Draw a targeting line from player to target.
 */
function drawTargetingLine(
  display: ROT.Display,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  cameraX: number,
  cameraY: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  for (let i = 1; i < steps; i++) {
    const x = Math.round(fromX + (dx * i) / steps);
    const y = Math.round(fromY + (dy * i) / steps);
    const screenX = x - cameraX;
    const screenY = y - cameraY;

    if (screenX >= 0 && screenX < viewportWidth &&
        screenY >= 0 && screenY < viewportHeight) {
      display.draw(screenX, screenY, '·', '#ff6666', '#1a1a2e');
    }
  }
}

type CanvasStatus =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly message: string };

export function GameCanvas({
  state,
  viewerId,
  tileSize = 24,
  viewportWidth = DEFAULT_VIEWPORT_WIDTH,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
  targetingState,
  cameraPosition,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<ROT.Display | null>(null);
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({ status: 'loading' });

  // Get the current area's map
  const { map } = getCurrentArea(state);

  // Compute actual viewport size (clamped to map size if map is smaller)
  const actualViewportWidth = Math.min(viewportWidth, map.width);
  const actualViewportHeight = Math.min(viewportHeight, map.height);

  // Initialize rot.js display with viewport dimensions (not full map)
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    try {
      // Clear previous display (use replaceChildren for safety)
      containerEl.replaceChildren();

      // Create new display with VIEWPORT size, not full map size
      const display = new ROT.Display({
        width: actualViewportWidth,
        height: actualViewportHeight,
        fontSize: tileSize,
        fontFamily: 'monospace',
        bg: '#1a1a2e',
        fg: '#eee',
      });

      const container = display.getContainer();
      if (!container) {
        setCanvasStatus({
          status: 'error',
          message: 'Failed to create game display. Your browser may not support canvas.',
        });
        return;
      }

      containerEl.appendChild(container);
      displayRef.current = display;
      setCanvasStatus({ status: 'ready' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error initializing display';
      setCanvasStatus({ status: 'error', message });
    }

    return () => {
      containerEl.replaceChildren();
      displayRef.current = null;
    };
  }, [actualViewportWidth, actualViewportHeight, tileSize]);

  // Render state to display with fog of war
  useEffect(() => {
    const display = displayRef.current;
    if (!display || canvasStatus.status !== 'ready') return;

    display.clear();

    // Get the viewer entity (defaults to player)
    const viewer = viewerId ? getEntity(state, viewerId) : getPlayer(state);
    if (!viewer) {
      if (state.gameStatus.status !== 'ended') {
        logger.warn({ turn: state.turn, viewerId }, 'Viewer entity not found during render');
      }
      return;
    }

    // Compute camera offset to center on viewer (or use provided cameraPosition)
    // Camera represents the top-left corner of the viewport in world coordinates
    const halfViewportW = Math.floor(actualViewportWidth / 2);
    const halfViewportH = Math.floor(actualViewportHeight / 2);

    let cameraX: number;
    let cameraY: number;

    if (cameraPosition) {
      // Use provided camera position (observer mode)
      cameraX = Math.round(cameraPosition.x) - halfViewportW;
      cameraY = Math.round(cameraPosition.y) - halfViewportH;
    } else {
      // Default: center on viewer
      cameraX = viewer.x - halfViewportW;
      cameraY = viewer.y - halfViewportH;
    }

    // Clamp camera so we don't show beyond map edges
    cameraX = Math.max(0, Math.min(cameraX, map.width - actualViewportWidth));
    cameraY = Math.max(0, Math.min(cameraY, map.height - actualViewportHeight));

    // Helper to convert world coords to screen coords
    const toScreen = (worldX: number, worldY: number): { sx: number; sy: number } | null => {
      const sx = worldX - cameraX;
      const sy = worldY - cameraY;
      // Check if within viewport bounds
      if (sx < 0 || sx >= actualViewportWidth || sy < 0 || sy >= actualViewportHeight) {
        return null;
      }
      return { sx, sy };
    };

    // Compute visible tiles for the viewer using FOV
    const visibleTiles = computeVisibleTiles(
      map,
      viewer.x,
      viewer.y,
      viewer.visionRadius ?? DEFAULT_VISION_RADIUS
    );

    // Get explored tiles for this area (explored tiles are shared by all crawlers per area)
    const exploredTiles = new Set(state.exploredTiles?.[viewer.areaId] ?? []);

    // Brightness factors for visibility states
    const EXPLORED_DIM_FACTOR = 0.4;
    const BG_COLOR = '#1a1a2e';

    // Draw map tiles based on visibility state (only within viewport)
    for (let sy = 0; sy < actualViewportHeight; sy++) {
      for (let sx = 0; sx < actualViewportWidth; sx++) {
        const worldX = sx + cameraX;
        const worldY = sy + cameraY;
        const key = tileKey(worldX, worldY);
        const tile = getTile(map, worldX, worldY);
        if (!tile) continue;

        const isVisible = visibleTiles.has(key);
        const isExplored = exploredTiles.has(key) || isVisible; // Visible tiles are always "explored"

        if (isVisible) {
          // Currently visible: full brightness
          const { char, fg } = getTileAppearance(tile);
          display.draw(sx, sy, char, fg, BG_COLOR);
        } else if (isExplored) {
          // Explored but not visible: dimmed (40% brightness)
          const { char, fg } = getTileAppearance(tile);
          display.draw(sx, sy, char, dimColor(fg, EXPLORED_DIM_FACTOR), BG_COLOR);
        }
        // Unexplored: don't draw (stays black/background color from clear())
      }
    }

    // Draw items only if on visible tiles, within viewport, and in current area
    const currentAreaItems = getItemsInArea(state, state.currentAreaId);
    for (const item of currentAreaItems) {
      const itemKey = tileKey(item.x, item.y);
      if (visibleTiles.has(itemKey)) {
        const screen = toScreen(item.x, item.y);
        if (screen) {
          const template = getItemTemplate(item.templateId);
          if (template) {
            display.draw(
              screen.sx,
              screen.sy,
              template.appearance.char,
              template.appearance.color,
              BG_COLOR
            );
          } else {
            // Render placeholder for unknown template and log error
            display.draw(screen.sx, screen.sy, '?', '#FF00FF', BG_COLOR);
            logger.error(
              { templateId: item.templateId, itemId: item.id, position: { x: item.x, y: item.y } },
              'Unknown item template - rendering placeholder'
            );
          }
        }
      }
    }

    // Draw monsters only if they are on visible tiles, within viewport, and in current area
    const monsters = getMonstersInArea(state, state.currentAreaId);
    for (const monster of monsters) {
      const monsterKey = tileKey(monster.x, monster.y);
      if (visibleTiles.has(monsterKey)) {
        const screen = toScreen(monster.x, monster.y);
        if (screen) {
          const { char, fg } = getEntityAppearance(monster);
          display.draw(screen.sx, screen.sy, char, fg, BG_COLOR);
        }
      }
    }

    // Draw all crawlers with their colors (always visible to viewer)
    const crawlers = getCrawlers(state);
    for (const crawler of crawlers) {
      const crawlerKey = tileKey(crawler.x, crawler.y);
      // Only draw crawlers that are visible to the viewer
      if (visibleTiles.has(crawlerKey) || crawler.id === viewer.id) {
        const screen = toScreen(crawler.x, crawler.y);
        if (screen) {
          const color = getCrawlerColor(crawler.id);
          display.draw(screen.sx, screen.sy, crawler.char ?? '@', color, BG_COLOR);
        }
      }
    }

    // Draw target highlight if in targeting mode
    if (targetingState?.active) {
      const targetId = getCurrentTargetId(targetingState);
      if (targetId) {
        const target = state.entities[targetId as string];
        if (target && target.areaId === state.currentAreaId) {
          const screenX = target.x - cameraX;
          const screenY = target.y - cameraY;

          if (screenX >= 0 && screenX < actualViewportWidth &&
              screenY >= 0 && screenY < actualViewportHeight) {
            // Draw pulsing highlight - get monster appearance and redraw with highlight
            const appearance = getEntityAppearance(target);
            const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
            const highlightColor = `rgba(255, 100, 100, ${pulse})`;

            // Draw the entity with highlighted background
            display.draw(screenX, screenY, appearance.char, appearance.fg, highlightColor);
          }
        }
      }
    }

    // Draw targeting line
    if (targetingState?.active && viewer) {
      const targetId = getCurrentTargetId(targetingState);
      if (targetId) {
        const target = state.entities[targetId as string];
        if (target) {
          drawTargetingLine(
            display,
            viewer.x,
            viewer.y,
            target.x,
            target.y,
            cameraX,
            cameraY,
            actualViewportWidth,
            actualViewportHeight
          );
        }
      }
    }

    // Fallback: if no crawlers found and game is active, log warning
    if (crawlers.length === 0 && state.gameStatus.status !== 'ended') {
      logger.warn({ turn: state.turn }, 'No crawler entities found during render');
    }
  }, [state, viewerId, canvasStatus, map, actualViewportWidth, actualViewportHeight, targetingState, cameraPosition]);

  if (canvasStatus.status === 'error') {
    return (
      <div className="inline-block border border-[var(--danger)] rounded p-4 bg-[var(--danger)]/10">
        <p className="text-[var(--danger)] font-medium">Display Error</p>
        <p className="text-[var(--danger)]/80 text-sm mt-1">{canvasStatus.message}</p>
      </div>
    );
  }

  // Always render the container div so the ref is available for useEffect
  return (
    <div className="relative inline-block">
      <div
        ref={containerRef}
        className="inline-block"
        style={{ boxShadow: '0 0 20px var(--glow-player)' }}
      />
      {canvasStatus.status === 'loading' && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-[var(--bg-surface)]"
          style={{
            width: actualViewportWidth * tileSize,
            height: actualViewportHeight * tileSize,
          }}
        >
          <p className="text-[var(--text-muted)]">Loading game...</p>
        </div>
      )}
    </div>
  );
}
