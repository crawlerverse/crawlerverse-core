'use client';

/**
 * AIPauseControls Component
 *
 * Floating overlay for controlling AI playback: pause/resume, step through,
 * and switch between action and round step modes.
 */

import React from 'react';
import type { StepMode } from '../../hooks/useGame';

export interface AIPauseControlsProps {
  /** Whether AI is currently paused */
  isPaused: boolean;
  /** Current step mode */
  stepMode: StepMode;
  /** Callback to toggle pause/resume */
  onTogglePause: () => void;
  /** Callback to step forward one action/round */
  onStep: () => void;
  /** Callback to change step mode */
  onStepModeChange: (mode: StepMode) => void;
}

/**
 * Floating control overlay for AI pause/step functionality.
 * Shows pause/play, step button, and mode toggle.
 */
export function AIPauseControls({
  isPaused,
  stepMode,
  onTogglePause,
  onStep,
  onStepModeChange,
}: AIPauseControlsProps) {
  return (
    <div className="ai-pause-controls">
      {/* Pause/Play button */}
      <button
        onClick={onTogglePause}
        className="ai-pause-btn"
        title={isPaused ? 'Resume (Space)' : 'Pause (Space)'}
        aria-label={isPaused ? 'Resume' : 'Pause'}
      >
        {isPaused ? '▶' : '⏸'}
      </button>

      {/* Step button - only enabled when paused */}
      <button
        onClick={onStep}
        disabled={!isPaused}
        className="ai-pause-btn"
        title="Step (Tab)"
        aria-label="Step"
      >
        ⏭
      </button>

      {/* Mode toggle */}
      <div className="ai-pause-mode-toggle">
        <button
          onClick={() => onStepModeChange('action')}
          className={`ai-pause-mode-btn ${stepMode === 'action' ? 'active' : ''}`}
          title="Step per action (M)"
        >
          Action
        </button>
        <button
          onClick={() => onStepModeChange('round')}
          className={`ai-pause-mode-btn ${stepMode === 'round' ? 'active' : ''}`}
          title="Step per round (M)"
        >
          Round
        </button>
      </div>
    </div>
  );
}

export default AIPauseControls;
