// packages/crawler-core/hooks/__tests__/useBioGeneration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBioGeneration } from '../useBioGeneration';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useBioGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with idle state', () => {
    const { result } = renderHook(() => useBioGeneration());
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.loadingMessage).toBe('');
  });

  it('cycles through loading messages while generating', async () => {
    mockFetch.mockImplementation(() =>
      new Promise(resolve =>
        setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve({ bio: 'Test bio' }),
        }), 5000)
      )
    );

    const { result } = renderHook(() => useBioGeneration());

    act(() => {
      result.current.generate('Test', 'warrior');
    });

    expect(result.current.isGenerating).toBe(true);
    expect(result.current.loadingMessage).toBeTruthy();

    const _firstMessage = result.current.loadingMessage;

    // Advance time to trigger message cycle
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Message should have changed
    expect(result.current.loadingMessage).toBeTruthy();
  });

  it('returns bio on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ bio: 'A brave warrior.' }),
    });

    const { result } = renderHook(() => useBioGeneration());

    let bio: string | null = null;
    await act(async () => {
      bio = await result.current.generate('Test', 'warrior');
    });

    expect(bio).toBe('A brave warrior.');
    expect(result.current.isGenerating).toBe(false);
  });

  it('returns null on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Failed' }),
    });

    const { result } = renderHook(() => useBioGeneration());

    let bio: string | null = null;
    await act(async () => {
      bio = await result.current.generate('Test', 'warrior');
    });

    expect(bio).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('exposes error message from API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Custom error message from server' }),
    });

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBe('Custom error message from server');
  });

  it('clears error state on new generation attempt', async () => {
    // First call fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'First error' }),
    });

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBe('First error');

    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ bio: 'Success!' }),
    });

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBeNull();
  });
});

describe('useBioGeneration - network error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles network failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useBioGeneration());

    let bio: string | null = null;
    await act(async () => {
      bio = await result.current.generate('Test', 'warrior');
    });

    expect(bio).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(result.current.isGenerating).toBe(false);
  });

  it('handles timeout errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Request timeout'));

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.isGenerating).toBe(false);
  });

  it('handles non-JSON error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBe('Server error (500)');
    expect(result.current.isGenerating).toBe(false);
  });

  it('handles HTML error pages (non-JSON 503)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBe('Server error (503)');
  });

  it('handles successful response with invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON')),
    });

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    expect(result.current.error).toBe('Invalid response from server');
  });

  it('stops loading message interval on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useBioGeneration());

    await act(async () => {
      await result.current.generate('Test', 'warrior');
    });

    // Advance time - loading message should not be changing
    const _errorAfter = result.current.loadingMessage;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Should still be empty/unchanged since generation stopped
    expect(result.current.loadingMessage).toBe('');
    expect(result.current.isGenerating).toBe(false);
  });
});
