import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NarrationPanel } from '../NarrationPanel';
import type { NarrationEntry } from '../../../lib/ai/narrative-dm';
import { EventType } from '../../../lib/engine/events';

describe('NarrationPanel', () => {
  const mockNarrations: NarrationEntry[] = [
    {
      id: '1',
      text: 'Throk strikes down the goblin with a mighty blow.',
      eventType: EventType.KILL,
      timestamp: Date.now() - 2000,
      turn: 5,
    },
    {
      id: '2',
      text: 'The party enters a dark, foreboding chamber.',
      eventType: EventType.AREA_ENTERED,
      timestamp: Date.now() - 1000,
      turn: 6,
    },
  ];

  it('should render narrations in chronological order', () => {
    render(<NarrationPanel narrations={mockNarrations} />);

    const narrationElements = screen.getAllByTestId('narration-entry');
    expect(narrationElements).toHaveLength(2);

    // First narration should appear first
    expect(narrationElements[0]).toHaveTextContent('Throk strikes down the goblin');
    expect(narrationElements[1]).toHaveTextContent('The party enters a dark');
  });

  it('should show empty state when no narrations', () => {
    render(<NarrationPanel narrations={[]} />);

    expect(screen.getByText(/no narrations yet/i)).toBeInTheDocument();
  });

  it('should display event type badges', () => {
    render(<NarrationPanel narrations={mockNarrations} />);

    expect(screen.getByText(/combat/i)).toBeInTheDocument();
    expect(screen.getByText(/exploration/i)).toBeInTheDocument();
  });
});
