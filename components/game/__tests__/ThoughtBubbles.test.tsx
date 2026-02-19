/**
 * ThoughtBubbles Component Tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThoughtBubbles } from '../ThoughtBubbles';
import type { Thought } from '../../../hooks/useGame';
import type { Entity } from '../../../lib/engine/types';
import type { CrawlerId } from '../../../lib/engine/crawler-id';

describe('ThoughtBubbles', () => {
  const mockCrawlers: Entity[] = [
    {
      id: 'crawler-1',
      type: 'crawler',
      name: 'Test Crawler',
      x: 5,
      y: 5,
      hp: 10,
      maxHp: 10,
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    },
    {
      id: 'crawler-2',
      type: 'crawler',
      name: 'Test Crawler 2',
      x: 8,
      y: 3,
      hp: 10,
      maxHp: 10,
      char: '@',
      attack: 2,
      defense: 0,
      speed: 100,
      areaId: 'area-1',
    },
  ];

  describe('rendering', () => {
    it('renders nothing when thoughts array is empty', () => {
      const { container } = render(
        <ThoughtBubbles thoughts={[]} crawlers={mockCrawlers} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders a thought bubble for a valid thought', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'For glory!',
          timestamp: Date.now(),
        },
      ];

      render(<ThoughtBubbles thoughts={thoughts} crawlers={mockCrawlers} />);
      expect(screen.getByText('For glory!')).toBeInTheDocument();
    });

    it('renders multiple thought bubbles', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'For glory!',
          timestamp: Date.now(),
        },
        {
          id: 'thought-2',
          crawlerId: 'crawler-2' as CrawlerId,
          text: 'Easy prey...',
          timestamp: Date.now(),
        },
      ];

      render(<ThoughtBubbles thoughts={thoughts} crawlers={mockCrawlers} />);
      expect(screen.getByText('For glory!')).toBeInTheDocument();
      expect(screen.getByText('Easy prey...')).toBeInTheDocument();
    });

    it('does not render thought if crawler is not found', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'nonexistent-crawler' as CrawlerId,
          text: 'Hidden thought',
          timestamp: Date.now(),
        },
      ];

      render(<ThoughtBubbles thoughts={thoughts} crawlers={mockCrawlers} />);
      expect(screen.queryByText('Hidden thought')).not.toBeInTheDocument();
    });
  });

  describe('positioning', () => {
    it('positions bubble based on crawler coordinates', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'Test thought',
          timestamp: Date.now(),
        },
      ];

      render(
        <ThoughtBubbles
          thoughts={thoughts}
          crawlers={mockCrawlers}
          tileSize={32}
        />
      );

      const bubble = screen.getByText('Test thought');
      const style = bubble.style;

      // Crawler is at (5, 5), cellWidth = round(32 * 0.65) = 21, cellHeight = 32
      // left = 5 * 21 + 21/2 = 105 + 10.5 = 115.5
      // top = 5 * 32 - 36 = 160 - 36 = 124
      expect(style.left).toBe('115.5px');
      expect(style.top).toBe('124px');
    });

    it('applies offset when provided', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'Offset thought',
          timestamp: Date.now(),
        },
      ];

      render(
        <ThoughtBubbles
          thoughts={thoughts}
          crawlers={mockCrawlers}
          tileSize={32}
          offsetX={10}
          offsetY={20}
        />
      );

      const bubble = screen.getByText('Offset thought');
      const style = bubble.style;

      // With offsets: left = 115.5 + 10 = 125.5, top = 124 + 20 = 144
      expect(style.left).toBe('125.5px');
      expect(style.top).toBe('144px');
    });

    it('uses default tileSize of 24 when not specified', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'Default size',
          timestamp: Date.now(),
        },
      ];

      render(<ThoughtBubbles thoughts={thoughts} crawlers={mockCrawlers} />);

      const bubble = screen.getByText('Default size');
      const style = bubble.style;

      // cellWidth = 24 * 0.65 = 16 (rounded)
      // left = 5 * 16 + 8 = 88
      // top = 5 * 24 - 36 = 84
      expect(style.left).toBe('88px');
      expect(style.top).toBe('84px');
    });
  });

  describe('container', () => {
    it('renders with thought-bubbles-container class', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'Container test',
          timestamp: Date.now(),
        },
      ];

      const { container } = render(
        <ThoughtBubbles thoughts={thoughts} crawlers={mockCrawlers} />
      );

      expect(container.querySelector('.thought-bubbles-container')).toBeInTheDocument();
    });

    it('renders bubbles with thought-bubble class', () => {
      const thoughts: Thought[] = [
        {
          id: 'thought-1',
          crawlerId: 'crawler-1' as CrawlerId,
          text: 'Class test',
          timestamp: Date.now(),
        },
      ];

      const { container } = render(
        <ThoughtBubbles thoughts={thoughts} crawlers={mockCrawlers} />
      );

      expect(container.querySelector('.thought-bubble')).toBeInTheDocument();
    });
  });
});
