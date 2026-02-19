'use client';

/**
 * ObjectivesPanel Component
 *
 * Displays game objectives grouped by assignee:
 * - Global objectives (assignee: null) shown first
 * - Per-crawler objectives grouped by crawler name
 *
 * Shows completion animation when objectives transition to completed status.
 */

import type { Objective } from '../../lib/engine/objective';
import type { Entity } from '../../lib/engine/types';

interface ObjectivesPanelProps {
  /** All objectives from game state */
  objectives: readonly Objective[];
  /** All crawlers (for displaying names in section headers) */
  crawlers: readonly Entity[];
  /** Set of objective IDs that recently completed (for animation) */
  recentlyCompletedIds?: Set<string>;
}

/** Renders a single objective item */
function ObjectiveItem({
  objective,
  isRecentlyCompleted,
}: {
  objective: Objective;
  isRecentlyCompleted: boolean;
}) {
  const isCompleted = objective.status === 'completed';
  const showAnimation = isRecentlyCompleted && isCompleted;

  return (
    <div
      className={`flex items-start gap-2 py-1 ${showAnimation ? 'objective-complete' : ''}`}
      data-testid={`objective-${objective.id}`}
    >
      <span
        className={`mt-0.5 text-xs ${
          isCompleted ? 'text-[var(--success)]' : 'text-[var(--player)]'
        }`}
      >
        {isCompleted ? '✓' : '◆'}
      </span>
      <span
        className={`text-xs ${
          isCompleted ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'
        }`}
      >
        {objective.description}
      </span>
    </div>
  );
}

/** Renders a section header for grouped objectives */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-[0.6rem] text-[var(--text-muted)] uppercase tracking-wider mt-2 mb-1 first:mt-0">
      {title}
    </div>
  );
}

export function ObjectivesPanel({
  objectives,
  crawlers,
  recentlyCompletedIds = new Set(),
}: ObjectivesPanelProps) {
  // Group objectives: global (assignee: null) vs per-crawler
  const globalObjectives = objectives.filter((o) => o.assignee === null);
  const crawlerObjectives = new Map<string, Objective[]>();

  for (const objective of objectives) {
    if (objective.assignee !== null) {
      const existing = crawlerObjectives.get(objective.assignee) ?? [];
      crawlerObjectives.set(objective.assignee, [...existing, objective]);
    }
  }

  // Build crawler name lookup
  const crawlerNames = new Map<string, string>();
  for (const crawler of crawlers) {
    crawlerNames.set(crawler.id, crawler.name);
  }

  const hasObjectives = objectives.length > 0;

  return (
    <div data-testid="objectives-panel">
      <div className="text-[0.7rem] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-widest">
        Objectives ({objectives.length})
      </div>
      <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border)]">
        {!hasObjectives ? (
          <div className="text-xs text-[var(--text-muted)] italic">
            No active objectives
          </div>
        ) : (
          <>
            {/* Global objectives section */}
            {globalObjectives.length > 0 && (
              <div data-testid="objectives-global">
                <SectionHeader title="Global" />
                {globalObjectives.map((objective) => (
                  <ObjectiveItem
                    key={objective.id}
                    objective={objective}
                    isRecentlyCompleted={recentlyCompletedIds.has(objective.id)}
                  />
                ))}
              </div>
            )}

            {/* Per-crawler objectives sections */}
            {Array.from(crawlerObjectives.entries()).map(([crawlerId, objs]) => (
              <div key={crawlerId} data-testid={`objectives-${crawlerId}`}>
                <SectionHeader title={crawlerNames.get(crawlerId) ?? crawlerId} />
                {objs.map((objective) => (
                  <ObjectiveItem
                    key={objective.id}
                    objective={objective}
                    isRecentlyCompleted={recentlyCompletedIds.has(objective.id)}
                  />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
