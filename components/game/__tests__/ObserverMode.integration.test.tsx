// packages/crawler-core/components/game/__tests__/ObserverMode.integration.test.tsx
/**
 * ObserverMode Integration Tests
 *
 * Tests the real component behavior without mocking hooks.
 * These tests verify actual pause, speed toggle, and keyboard shortcut functionality.
 *
 * Note: GameCanvas is mocked because rot.js requires canvas (unavailable in jsdom).
 * fetch is mocked to simulate AI API responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObserverMode } from '../ObserverMode';

// Mock GameCanvas - rot.js requires canvas which isn't available in jsdom
vi.mock('../GameCanvas', () => ({
  GameCanvas: () => <div data-testid="game-canvas">Game Canvas Mock</div>,
}));

// Don't mock hooks - test real integration
describe('ObserverMode Integration', () => {
  beforeEach(() => {
    // Mock fetch for AI API
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          action: { action: 'move', direction: 'east', reasoning: 'Exploring' },
          shortThought: 'Going east',
        }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders and starts with AI playing', async () => {
    render(<ObserverMode seed={12345} crawlerCount={2} />);

    // Should see two crawlers in header
    await waitFor(() => {
      const hpTexts = screen.getAllByText(/\/\d+/); // HP format: X/Y
      expect(hpTexts.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('pauses when pause button clicked', async () => {
    render(<ObserverMode seed={12345} crawlerCount={2} />);

    const pauseButton = await screen.findByLabelText('Pause');
    fireEvent.click(pauseButton);

    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('toggles speed when speed button clicked', async () => {
    render(<ObserverMode seed={12345} crawlerCount={2} />);

    const speedButton = await screen.findByLabelText('Speed up to 2x');
    fireEvent.click(speedButton);

    expect(screen.getByLabelText('Slow down to 1x')).toBeInTheDocument();
  });

  it('responds to keyboard shortcuts', async () => {
    render(<ObserverMode seed={12345} crawlerCount={2} />);

    // Wait for render
    await screen.findByLabelText('Pause');

    // Press space to pause
    fireEvent.keyDown(window, { code: 'Space' });

    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });
});
