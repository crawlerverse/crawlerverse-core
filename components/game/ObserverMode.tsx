'use client';

/**
 * ObserverMode Component
 *
 * The main spectator view for watching AI crawlers play the game.
 * Ties together:
 * - useGame hook (all crawlers as AI)
 * - useAutoCamera hook (smooth camera following)
 * - GameCanvas (with cameraPosition prop)
 * - ObserverHeader (stats and controls)
 *
 * Provides the full spectator experience with speed controls and game end overlay.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameCanvas } from './GameCanvas';
import { ObserverHeader } from './ObserverHeader';
import { ErrorBoundary } from './ErrorBoundary';
import { useGame, type CrawlerConfig } from '../../hooks/useGame';
import { useAutoCamera } from '../../hooks/useAutoCamera';
import { getCrawlers, getMonstersInArea } from '../../lib/engine/state';
import { crawlerIdFromIndex } from '../../lib/engine/crawler-id';

/** Default tile size - can be overridden via CSS custom property */
const DEFAULT_TILE_SIZE = 32;

/** Viewport dimensions */
const VIEWPORT_WIDTH = 40;
const VIEWPORT_HEIGHT = 20;

export interface ObserverModeProps {
  /** Title displayed (optional) */
  title?: string;
  /** Seed for deterministic generation */
  seed?: number;
  /** Base AI delay in ms (will be halved at 2x speed) */
  aiDelayMs?: number;
  /** Number of AI crawlers (1 or 2) */
  crawlerCount?: 1 | 2;
  /** Initial tile size in pixels */
  tileSize?: number;
}

export function ObserverMode({
  title,
  seed,
  aiDelayMs = 500,
  crawlerCount = 2,
  tileSize = DEFAULT_TILE_SIZE,
}: ObserverModeProps) {
  const [speed, setSpeed] = useState<1 | 2>(1);

  // All crawlers are AI-controlled in observer mode
  const crawlerConfigs = useMemo<[CrawlerConfig, ...CrawlerConfig[]]>(() => {
    const configs: CrawlerConfig[] = [];
    for (let i = 1; i <= crawlerCount; i++) {
      configs.push({ id: crawlerIdFromIndex(i), control: 'ai' });
    }
    return configs as [CrawlerConfig, ...CrawlerConfig[]];
  }, [crawlerCount]);

  const {
    state,
    isPaused,
    togglePause,
    reset,
  } = useGame({
    crawlerConfigs,
    seed,
    aiDelayMs: aiDelayMs / speed, // Faster AI at 2x
    startPaused: false,
  });

  const crawlers = getCrawlers(state);
  const monsters = getMonstersInArea(state, state.currentAreaId);

  // Determine if in combat (any crawler adjacent to monster)
  const isInCombat = useMemo(() => {
    for (const crawler of crawlers) {
      for (const monster of monsters) {
        const dx = Math.abs(crawler.x - monster.x);
        const dy = Math.abs(crawler.y - monster.y);
        if (dx <= 1 && dy <= 1) return true;
      }
    }
    return false;
  }, [crawlers, monsters]);

  const { focus } = useAutoCamera({
    crawlers: crawlers.map((c) => ({ id: c.id, x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp })),
    monsters: monsters.map((m) => ({ id: m.id, x: m.x, y: m.y })),
    isInCombat,
    speedMultiplier: speed,
  });

  const handleToggleSpeed = useCallback(() => {
    setSpeed((s) => (s === 1 ? 2 : 1));
  }, []);

  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  const isEnded = state.gameStatus.status === 'ended';
  const isVictory = isEnded && state.gameStatus.victory;

  // Keyboard shortcuts for desktop users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePause();
          break;
        case 'KeyF':
          e.preventDefault();
          handleToggleSpeed();
          break;
        case 'KeyR':
          if (isEnded) {
            e.preventDefault();
            handleReset();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause, handleToggleSpeed, handleReset, isEnded]);

  // Map crawlers to header format
  const headerCrawlers = crawlers.map((c) => ({
    id: c.id,
    name: c.name,
    hp: c.hp,
    maxHp: c.maxHp,
    characterClass: c.characterClass,
  }));

  return (
    <ErrorBoundary onReset={handleReset}>
      <div className="observer-mode">
        {title && <h1 className="observer-mode__title">{title}</h1>}

        <ObserverHeader
          crawlers={headerCrawlers}
          isPaused={isPaused}
          speed={speed}
          onTogglePause={togglePause}
          onToggleSpeed={handleToggleSpeed}
        />

        <div className="observer-mode__canvas">
          <GameCanvas
            state={state}
            tileSize={tileSize}
            viewportWidth={VIEWPORT_WIDTH}
            viewportHeight={VIEWPORT_HEIGHT}
            cameraPosition={focus}
          />
        </div>

        {/* Victory/Defeat overlay */}
        {isEnded && (
          <div className="observer-mode__overlay">
            <div className="observer-mode__result">
              <p className={`observer-mode__result-text ${isVictory ? 'observer-mode__result-text--victory' : 'observer-mode__result-text--defeat'}`}>
                {isVictory ? 'Victory!' : 'Game Over'}
              </p>
              <button onClick={handleReset} className="observer-mode__replay-btn">
                Watch Again
              </button>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default ObserverMode;
