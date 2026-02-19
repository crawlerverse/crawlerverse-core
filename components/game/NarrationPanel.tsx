'use client';

import type { NarrationEntry } from '../../lib/ai/narrative-dm';
import { EventType } from '../../lib/engine/events';

export interface NarrationPanelProps {
  narrations: NarrationEntry[];
}

/**
 * Get event category for badge display.
 */
function getEventCategory(eventType: EventType): string {
  if (eventType.startsWith('combat.')) return 'Combat';
  if (eventType.startsWith('exploration.')) return 'Exploration';
  if (eventType.startsWith('party.')) return 'Party';
  return 'Event';
}

/**
 * Get badge color based on event category.
 */
function getBadgeColor(category: string): string {
  switch (category) {
    case 'Combat':
      return 'var(--danger)';
    case 'Exploration':
      return 'var(--player)';
    case 'Party':
      return 'var(--success)';
    default:
      return 'var(--text-dim)';
  }
}

/**
 * NarrationPanel - displays AI-generated narration history.
 *
 * Shows narrations in chronological order with event type badges.
 * Auto-scrolls to newest narration when new entries appear.
 */
export function NarrationPanel({ narrations }: NarrationPanelProps) {
  if (narrations.length === 0) {
    return (
      <div
        style={{
          padding: '1rem',
          color: 'var(--text-dim)',
          fontStyle: 'italic',
          textAlign: 'center',
        }}
      >
        No narrations yet. Events will be narrated as they occur.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '1rem',
        maxHeight: '300px',
        overflowY: 'auto',
      }}
    >
      {narrations.map((narration) => {
        const category = getEventCategory(narration.eventType);
        const badgeColor = getBadgeColor(category);

        return (
          <div
            key={narration.id}
            data-testid="narration-entry"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              padding: '0.5rem',
              backgroundColor: 'var(--bg-alt)',
              borderLeft: `3px solid ${badgeColor}`,
              borderRadius: '0.25rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--text-dim)',
              }}
            >
              <span
                style={{
                  padding: '0.125rem 0.375rem',
                  backgroundColor: badgeColor,
                  color: 'var(--bg)',
                  borderRadius: '0.25rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  fontSize: '0.625rem',
                }}
              >
                {category}
              </span>
              <span>Turn {narration.turn}</span>
            </div>
            <div style={{ color: 'var(--text)', lineHeight: 1.5 }}>
              {narration.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
