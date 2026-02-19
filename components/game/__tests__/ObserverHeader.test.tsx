/**
 * ObserverHeader Component Tests
 *
 * Tests the observer mode header that displays:
 * - Crawler portraits/icons with HP bars
 * - Pause/play button
 * - Speed toggle (1x/2x)
 *
 * The header provides playback controls for spectating AI gameplay.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObserverHeader } from '../ObserverHeader';

describe('ObserverHeader', () => {
  const mockCrawlers = [
    { id: 'crawler-1', name: 'Theron', hp: 15, maxHp: 20, characterClass: 'warrior' },
    { id: 'crawler-2', name: 'Lyra', hp: 8, maxHp: 20, characterClass: 'mage' },
  ];

  it('renders crawler names and HP', () => {
    render(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={false}
        speed={1}
        onTogglePause={vi.fn()}
        onToggleSpeed={vi.fn()}
      />
    );

    expect(screen.getByText(/Theron/)).toBeInTheDocument();
    expect(screen.getByText(/15\/20/)).toBeInTheDocument();
    expect(screen.getByText(/Lyra/)).toBeInTheDocument();
    expect(screen.getByText(/8\/20/)).toBeInTheDocument();
  });

  it('shows pause button when playing', () => {
    render(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={false}
        speed={1}
        onTogglePause={vi.fn()}
        onToggleSpeed={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('shows play button when paused', () => {
    render(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={true}
        speed={1}
        onTogglePause={vi.fn()}
        onToggleSpeed={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('calls onTogglePause when pause button clicked', () => {
    const onTogglePause = vi.fn();
    render(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={false}
        speed={1}
        onTogglePause={onTogglePause}
        onToggleSpeed={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Pause'));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it('shows correct aria-labels for speed button based on current speed', () => {
    const { rerender } = render(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={false}
        speed={1}
        onTogglePause={vi.fn()}
        onToggleSpeed={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Speed up to 2x')).toBeInTheDocument();

    rerender(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={false}
        speed={2}
        onTogglePause={vi.fn()}
        onToggleSpeed={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Slow down to 1x')).toBeInTheDocument();
  });

  it('calls onToggleSpeed when speed button clicked', () => {
    const onToggleSpeed = vi.fn();
    render(
      <ObserverHeader
        crawlers={mockCrawlers}
        isPaused={false}
        speed={1}
        onTogglePause={vi.fn()}
        onToggleSpeed={onToggleSpeed}
      />
    );

    fireEvent.click(screen.getByLabelText('Speed up to 2x'));
    expect(onToggleSpeed).toHaveBeenCalledTimes(1);
  });

  it('shows skull icon for dead crawlers', () => {
    const deadCrawlers = [
      { id: 'crawler-1', name: 'Theron', hp: 0, maxHp: 20, characterClass: 'warrior' },
      { id: 'crawler-2', name: 'Lyra', hp: 8, maxHp: 20, characterClass: 'mage' },
    ];

    render(
      <ObserverHeader
        crawlers={deadCrawlers}
        isPaused={false}
        speed={1}
        onTogglePause={vi.fn()}
        onToggleSpeed={vi.fn()}
      />
    );

    expect(screen.getByTestId('crawler-1-dead')).toBeInTheDocument();
  });
});
