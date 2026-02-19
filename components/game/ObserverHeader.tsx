'use client';

/**
 * ObserverHeader Component
 *
 * A slim header for observer/spectator mode that displays:
 * - Crawler portraits/icons with HP bars showing current health
 * - Pause/play button to control game loop
 * - Speed toggle (1x/2x) for faster playback
 *
 * Used by ObserverMode.tsx to provide playback controls when watching AI gameplay.
 * The header is designed to be responsive for mobile viewing.
 */

import React from 'react';

interface CrawlerInfo {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  characterClass?: string;
}

export interface ObserverHeaderProps {
  /** Array of crawlers to display in the header */
  crawlers: readonly CrawlerInfo[];
  /** Whether the game is currently paused */
  isPaused: boolean;
  /** Current playback speed (1x or 2x) */
  speed: 1 | 2;
  /** Callback when pause/play button is clicked */
  onTogglePause: () => void;
  /** Callback when speed toggle is clicked */
  onToggleSpeed: () => void;
}

/**
 * Returns the color for HP display based on health ratio.
 * - Green (success) when above 60%
 * - Blue (player) when between 30-60%
 * - Red (danger) when below 30%
 */
function getHpColor(ratio: number): string {
  if (ratio > 0.6) return 'var(--success)';
  if (ratio > 0.3) return 'var(--player)';
  return 'var(--danger)';
}

/**
 * ObserverHeader component for spectator mode.
 * Displays crawler health bars and playback controls.
 */
export function ObserverHeader({
  crawlers,
  isPaused,
  speed,
  onTogglePause,
  onToggleSpeed,
}: ObserverHeaderProps) {
  return (
    <header className="observer-header">
      <div className="observer-header__crawlers">
        {crawlers.map((crawler) => {
          const isDead = crawler.hp <= 0;
          const hpRatio = crawler.hp / crawler.maxHp;
          const hpColor = getHpColor(hpRatio);

          return (
            <div
              key={crawler.id}
              className={`observer-header__crawler ${isDead ? 'observer-header__crawler--dead' : ''}`}
            >
              {isDead ? (
                <span
                  className="observer-header__skull"
                  data-testid={`${crawler.id}-dead`}
                  aria-label={`${crawler.name} is dead`}
                >
                  💀
                </span>
              ) : (
                <span className="observer-header__portrait">
                  {crawler.characterClass?.[0]?.toUpperCase() ?? '@'}
                </span>
              )}
              <span className="observer-header__name">{crawler.name}</span>
              <div
                className="observer-header__hp"
                role="progressbar"
                aria-valuenow={crawler.hp}
                aria-valuemin={0}
                aria-valuemax={crawler.maxHp}
                aria-label={`${crawler.name} health`}
              >
                <div
                  className="observer-header__hp-bar"
                  style={{
                    width: `${hpRatio * 100}%`,
                    backgroundColor: hpColor,
                  }}
                />
              </div>
              <span className="observer-header__hp-text" style={{ color: hpColor }}>
                {crawler.hp}/{crawler.maxHp}
              </span>
            </div>
          );
        })}
      </div>

      <div className="observer-header__controls">
        <button
          onClick={onTogglePause}
          className="observer-header__btn"
          aria-label={isPaused ? 'Play' : 'Pause'}
          title={isPaused ? 'Play (Space)' : 'Pause (Space)'}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
        <button
          onClick={onToggleSpeed}
          className="observer-header__btn"
          aria-label={speed === 1 ? 'Speed up to 2x' : 'Slow down to 1x'}
          title={speed === 1 ? 'Speed up to 2x (F)' : 'Slow down to 1x (F)'}
        >
          {speed === 1 ? '▶▶' : '1x'}
        </button>
      </div>
    </header>
  );
}

export default ObserverHeader;
