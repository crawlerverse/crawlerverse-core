/**
 * ObjectivesPanel Component Tests
 *
 * Tests objective display, grouping (global vs per-crawler), and completion styling.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ObjectivesPanel } from '../ObjectivesPanel';
import type { Objective } from '../../../lib/engine/objective';
import type { Entity } from '../../../lib/engine/types';
import { crawlerIdFromIndex, type CrawlerId } from '../../../lib/engine/crawler-id';

/** Creates a test objective with sensible defaults */
function createObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-1',
    type: 'kill',
    description: 'Test objective',
    status: 'active',
    priority: 'primary',
    assignee: null,
    target: { entityId: 'monster-1' },
    ...overrides,
  } as Objective;
}

/** Creates a test crawler entity */
function createCrawler(overrides: Partial<Omit<Entity, 'id'>> & { id?: CrawlerId } = {}): Entity {
  return {
    id: crawlerIdFromIndex(1),
    type: 'crawler',
    x: 5,
    y: 5,
    hp: 10,
    maxHp: 10,
    name: 'Test Crawler',
    attack: 5,
    defense: 2,
    speed: 100,
    char: '@',
    areaId: 'area-1',
    ...overrides,
  };
}

describe('ObjectivesPanel', () => {
  describe('empty state', () => {
    it('shows "No active objectives" when objectives array is empty', () => {
      render(<ObjectivesPanel objectives={[]} crawlers={[]} />);

      expect(screen.getByText('No active objectives')).toBeInTheDocument();
      expect(screen.getByText('Objectives (0)')).toBeInTheDocument();
    });
  });

  describe('objective display', () => {
    it('shows objective description', () => {
      const objectives = [createObjective({ description: 'Kill the dragon' })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      expect(screen.getByText('Kill the dragon')).toBeInTheDocument();
    });

    it('shows active objective with diamond icon', () => {
      const objectives = [createObjective({ id: 'obj-1', status: 'active' })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      const item = screen.getByTestId('objective-obj-1');
      expect(within(item).getByText('◆')).toBeInTheDocument();
    });

    it('shows completed objective with checkmark icon', () => {
      const objectives = [createObjective({ id: 'obj-1', status: 'completed' })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      const item = screen.getByTestId('objective-obj-1');
      expect(within(item).getByText('✓')).toBeInTheDocument();
    });

    it('shows completed objective with muted text styling', () => {
      const objectives = [createObjective({ id: 'obj-1', status: 'completed' })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      const item = screen.getByTestId('objective-obj-1');
      const description = within(item).getByText('Test objective');
      expect(description.className).toContain('text-[var(--text-muted)]');
    });

    it('shows objective count in header', () => {
      const objectives = [
        createObjective({ id: 'obj-1' }),
        createObjective({ id: 'obj-2' }),
        createObjective({ id: 'obj-3' }),
      ];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      expect(screen.getByText('Objectives (3)')).toBeInTheDocument();
    });
  });

  describe('grouping', () => {
    it('shows global section for objectives with null assignee', () => {
      const objectives = [createObjective({ assignee: null })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      expect(screen.getByTestId('objectives-global')).toBeInTheDocument();
      expect(screen.getByText('Global')).toBeInTheDocument();
    });

    it('shows crawler section for objectives with crawler assignee', () => {
      const crawlerId = crawlerIdFromIndex(1);
      const crawler = createCrawler({ id: crawlerId, name: 'Grok the Warrior' });
      const objectives = [createObjective({ assignee: crawlerId })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[crawler]} />);

      expect(screen.getByTestId('objectives-crawler-1')).toBeInTheDocument();
      expect(screen.getByText('Grok the Warrior')).toBeInTheDocument();
    });

    it('shows both global and crawler sections when mixed', () => {
      const crawlerId = crawlerIdFromIndex(1);
      const crawler = createCrawler({ id: crawlerId, name: 'Grok' });
      const objectives = [
        createObjective({ id: 'global-obj', assignee: null, description: 'Clear the dungeon' }),
        createObjective({ id: 'crawler-obj', assignee: crawlerId, description: 'Kill the troll' }),
      ];
      render(<ObjectivesPanel objectives={objectives} crawlers={[crawler]} />);

      expect(screen.getByTestId('objectives-global')).toBeInTheDocument();
      expect(screen.getByTestId('objectives-crawler-1')).toBeInTheDocument();
      expect(screen.getByText('Clear the dungeon')).toBeInTheDocument();
      expect(screen.getByText('Kill the troll')).toBeInTheDocument();
    });

    it('falls back to crawler ID when crawler name not found', () => {
      const crawlerId = crawlerIdFromIndex(99); // Use a valid ID format that won't have a matching crawler
      const objectives = [createObjective({ assignee: crawlerId })];
      render(<ObjectivesPanel objectives={objectives} crawlers={[]} />);

      expect(screen.getByText('crawler-99')).toBeInTheDocument();
    });

    it('groups multiple objectives by same crawler', () => {
      const crawlerId = crawlerIdFromIndex(1);
      const crawler = createCrawler({ id: crawlerId, name: 'Hero' });
      const objectives = [
        createObjective({ id: 'obj-1', assignee: crawlerId, description: 'Task 1' }),
        createObjective({ id: 'obj-2', assignee: crawlerId, description: 'Task 2' }),
      ];
      render(<ObjectivesPanel objectives={objectives} crawlers={[crawler]} />);

      const section = screen.getByTestId('objectives-crawler-1');
      expect(within(section).getByText('Task 1')).toBeInTheDocument();
      expect(within(section).getByText('Task 2')).toBeInTheDocument();
    });
  });

  describe('completion animation', () => {
    it('applies animation class to recently completed objectives', () => {
      const objectives = [createObjective({ id: 'obj-1', status: 'completed' })];
      const recentlyCompleted = new Set(['obj-1']);

      render(
        <ObjectivesPanel
          objectives={objectives}
          crawlers={[]}
          recentlyCompletedIds={recentlyCompleted}
        />
      );

      const item = screen.getByTestId('objective-obj-1');
      expect(item.className).toContain('objective-complete');
    });

    it('does not apply animation class to non-recently completed objectives', () => {
      const objectives = [createObjective({ id: 'obj-1', status: 'completed' })];
      const recentlyCompleted = new Set<string>(); // empty

      render(
        <ObjectivesPanel
          objectives={objectives}
          crawlers={[]}
          recentlyCompletedIds={recentlyCompleted}
        />
      );

      const item = screen.getByTestId('objective-obj-1');
      expect(item.className).not.toContain('objective-complete');
    });

    it('does not apply animation class to active objectives', () => {
      const objectives = [createObjective({ id: 'obj-1', status: 'active' })];
      const recentlyCompleted = new Set(['obj-1']); // in set but still active

      render(
        <ObjectivesPanel
          objectives={objectives}
          crawlers={[]}
          recentlyCompletedIds={recentlyCompleted}
        />
      );

      const item = screen.getByTestId('objective-obj-1');
      expect(item.className).not.toContain('objective-complete');
    });
  });
});
