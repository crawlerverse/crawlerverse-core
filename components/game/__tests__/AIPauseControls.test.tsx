/**
 * AIPauseControls Component Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIPauseControls } from '../AIPauseControls';

describe('AIPauseControls', () => {
  const defaultProps = {
    isPaused: false,
    stepMode: 'action' as const,
    onTogglePause: vi.fn(),
    onStep: vi.fn(),
    onStepModeChange: vi.fn(),
  };

  describe('rendering', () => {
    it('renders pause button when not paused', () => {
      render(<AIPauseControls {...defaultProps} isPaused={false} />);

      const pauseButton = screen.getByRole('button', { name: /pause/i });
      expect(pauseButton).toBeInTheDocument();
      expect(pauseButton).toHaveTextContent('⏸');
    });

    it('renders resume button when paused', () => {
      render(<AIPauseControls {...defaultProps} isPaused={true} />);

      const resumeButton = screen.getByRole('button', { name: /resume/i });
      expect(resumeButton).toBeInTheDocument();
      expect(resumeButton).toHaveTextContent('▶');
    });

    it('renders step button', () => {
      render(<AIPauseControls {...defaultProps} />);

      const stepButton = screen.getByRole('button', { name: /step/i });
      expect(stepButton).toBeInTheDocument();
      expect(stepButton).toHaveTextContent('⏭');
    });

    it('renders mode toggle buttons', () => {
      render(<AIPauseControls {...defaultProps} />);

      expect(screen.getByRole('button', { name: /action/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /round/i })).toBeInTheDocument();
    });
  });

  describe('step button state', () => {
    it('step button is disabled when not paused', () => {
      render(<AIPauseControls {...defaultProps} isPaused={false} />);

      const stepButton = screen.getByRole('button', { name: /step/i });
      expect(stepButton).toBeDisabled();
    });

    it('step button is enabled when paused', () => {
      render(<AIPauseControls {...defaultProps} isPaused={true} />);

      const stepButton = screen.getByRole('button', { name: /step/i });
      expect(stepButton).not.toBeDisabled();
    });
  });

  describe('mode toggle highlighting', () => {
    it('highlights action button when in action mode', () => {
      render(<AIPauseControls {...defaultProps} stepMode="action" />);

      const actionButton = screen.getByRole('button', { name: /action/i });
      const roundButton = screen.getByRole('button', { name: /round/i });

      expect(actionButton).toHaveClass('active');
      expect(roundButton).not.toHaveClass('active');
    });

    it('highlights round button when in round mode', () => {
      render(<AIPauseControls {...defaultProps} stepMode="round" />);

      const actionButton = screen.getByRole('button', { name: /action/i });
      const roundButton = screen.getByRole('button', { name: /round/i });

      expect(actionButton).not.toHaveClass('active');
      expect(roundButton).toHaveClass('active');
    });
  });

  describe('interactions', () => {
    it('calls onTogglePause when pause/resume button clicked', () => {
      const onTogglePause = vi.fn();
      render(<AIPauseControls {...defaultProps} onTogglePause={onTogglePause} />);

      fireEvent.click(screen.getByRole('button', { name: /pause/i }));
      expect(onTogglePause).toHaveBeenCalledTimes(1);
    });

    it('calls onStep when step button clicked (while paused)', () => {
      const onStep = vi.fn();
      render(<AIPauseControls {...defaultProps} isPaused={true} onStep={onStep} />);

      fireEvent.click(screen.getByRole('button', { name: /step/i }));
      expect(onStep).toHaveBeenCalledTimes(1);
    });

    it('does not call onStep when step button clicked while running', () => {
      const onStep = vi.fn();
      render(<AIPauseControls {...defaultProps} isPaused={false} onStep={onStep} />);

      const stepButton = screen.getByRole('button', { name: /step/i });
      fireEvent.click(stepButton);
      // Button is disabled, so click should not trigger callback
      expect(onStep).not.toHaveBeenCalled();
    });

    it('calls onStepModeChange with "action" when action button clicked', () => {
      const onStepModeChange = vi.fn();
      render(<AIPauseControls {...defaultProps} stepMode="round" onStepModeChange={onStepModeChange} />);

      fireEvent.click(screen.getByRole('button', { name: /action/i }));
      expect(onStepModeChange).toHaveBeenCalledWith('action');
    });

    it('calls onStepModeChange with "round" when round button clicked', () => {
      const onStepModeChange = vi.fn();
      render(<AIPauseControls {...defaultProps} stepMode="action" onStepModeChange={onStepModeChange} />);

      fireEvent.click(screen.getByRole('button', { name: /round/i }));
      expect(onStepModeChange).toHaveBeenCalledWith('round');
    });
  });

  describe('accessibility', () => {
    it('has correct aria-labels for buttons', () => {
      render(<AIPauseControls {...defaultProps} isPaused={false} />);

      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
      expect(screen.getByLabelText('Step')).toBeInTheDocument();
    });

    it('updates aria-label when paused', () => {
      render(<AIPauseControls {...defaultProps} isPaused={true} />);

      expect(screen.getByLabelText('Resume')).toBeInTheDocument();
    });

    it('has keyboard shortcut hints in titles', () => {
      render(<AIPauseControls {...defaultProps} isPaused={false} />);

      const pauseButton = screen.getByRole('button', { name: /pause/i });
      expect(pauseButton).toHaveAttribute('title', expect.stringContaining('Space'));

      const stepButton = screen.getByRole('button', { name: /step/i });
      expect(stepButton).toHaveAttribute('title', expect.stringContaining('Tab'));
    });
  });

  describe('container', () => {
    it('renders with correct class', () => {
      const { container } = render(<AIPauseControls {...defaultProps} />);

      expect(container.querySelector('.ai-pause-controls')).toBeInTheDocument();
    });
  });
});
