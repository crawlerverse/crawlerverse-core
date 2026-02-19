/**
 * ObserverMode Component Tests
 *
 * Tests the main observer/spectator mode component that:
 * - Renders ObserverHeader with crawler stats
 * - Renders GameCanvas with auto-following camera
 * - Provides pause/speed controls
 * - Shows victory/defeat overlay at game end
 *
 * The component ties together useGame, useAutoCamera, GameCanvas, and ObserverHeader.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ObserverMode } from '../ObserverMode';

// Mock the hooks
vi.mock('../../../hooks/useGame', () => ({
  useGame: () => ({
    state: {
      turn: 1,
      currentAreaId: 'area-1',
      areas: {
        'area-1': {
          id: 'area-1',
          map: { width: 40, height: 20, tiles: [] },
          metadata: { name: 'Floor 1', dangerLevel: 1 },
        },
      },
      entities: {
        'crawler-1': { id: 'crawler-1', type: 'crawler', name: 'Theron', x: 10, y: 10, hp: 20, maxHp: 20, areaId: 'area-1', characterClass: 'warrior' },
        'crawler-2': { id: 'crawler-2', type: 'crawler', name: 'Lyra', x: 12, y: 10, hp: 15, maxHp: 20, areaId: 'area-1', characterClass: 'mage' },
      },
      messages: [],
      gameStatus: { status: 'playing' },
    },
    gameStatus: { status: 'ai_thinking', crawlerIds: ['crawler-1'] },
    isPaused: false,
    togglePause: vi.fn(),
    reset: vi.fn(),
    thoughts: [],
  }),
}));

vi.mock('../../../hooks/useAutoCamera', () => ({
  useAutoCamera: () => ({
    focus: { x: 10, y: 10 },
    targetFocus: { x: 10, y: 10 },
  }),
}));

// Mock state helpers
vi.mock('../../../lib/engine/state', () => ({
  getCrawlers: () => [
    { id: 'crawler-1', type: 'crawler', name: 'Theron', x: 10, y: 10, hp: 20, maxHp: 20, areaId: 'area-1', characterClass: 'warrior' },
    { id: 'crawler-2', type: 'crawler', name: 'Lyra', x: 12, y: 10, hp: 15, maxHp: 20, areaId: 'area-1', characterClass: 'mage' },
  ],
  getMonstersInArea: () => [],
}));

// Mock GameCanvas - it uses rot.js which requires canvas
vi.mock('../GameCanvas', () => ({
  GameCanvas: () => <div data-testid="game-canvas">Game Canvas Mock</div>,
}));

describe('ObserverMode', () => {
  it('renders observer header with crawlers', () => {
    render(<ObserverMode />);

    expect(screen.getByText(/Theron/)).toBeInTheDocument();
    expect(screen.getByText(/Lyra/)).toBeInTheDocument();
  });

  it('renders game canvas', () => {
    render(<ObserverMode />);

    // GameCanvas is mocked with a test id
    expect(screen.getByTestId('game-canvas')).toBeInTheDocument();
  });

  it('renders pause button', () => {
    render(<ObserverMode />);

    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('renders with custom title when provided', () => {
    render(<ObserverMode title="AI Arena" />);

    expect(screen.getByText('AI Arena')).toBeInTheDocument();
  });

  it('renders speed toggle button', () => {
    render(<ObserverMode />);

    expect(screen.getByLabelText('Speed up to 2x')).toBeInTheDocument();
  });
});
