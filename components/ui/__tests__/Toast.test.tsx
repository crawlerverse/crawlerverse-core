import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast, showToast } from '../Toast';

describe('Toast', () => {
  it('should display toast when shown', async () => {
    render(<Toast />);

    act(() => {
      showToast('Test message');
    });

    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('should display info toast with correct styling', async () => {
    render(<Toast />);

    act(() => {
      showToast('AI finishing its turn…', 'info');
    });

    const toast = await screen.findByText('AI finishing its turn…');
    expect(toast).toBeInTheDocument();
    expect(toast.style.backgroundColor).toBe('var(--bg-elevated)');
  });

  it('should default to error type', async () => {
    render(<Toast />);

    act(() => {
      showToast('Something broke');
    });

    const toast = await screen.findByText('Something broke');
    expect(toast.style.backgroundColor).toBe('var(--danger)');
  });

  it('should auto-dismiss after 5 seconds', async () => {
    vi.useFakeTimers();

    try {
      render(<Toast />);

      act(() => {
        showToast('Test message');
      });

      // Message should be visible immediately after act
      expect(screen.getByText('Test message')).toBeInTheDocument();

      // Advance fake clock and flush React state updates triggered by the timer
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Message should be gone
      expect(screen.queryByText('Test message')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
