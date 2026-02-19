'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { CrawlerCharacterSystem } from '../lib/engine/character-system';
import type { CharacterClass } from '../lib/engine/types';

/**
 * Result from the useBioGeneration hook.
 */
export interface UseBioGenerationResult {
  /** Whether a bio generation request is in progress */
  isGenerating: boolean;
  /** Current loading message (cycles through themed messages during generation) */
  loadingMessage: string;
  /** Error message if generation failed, null otherwise */
  error: string | null;
  /** Trigger bio generation for given name and class. Returns bio string or null on error. */
  generate: (name: string, characterClass: CharacterClass) => Promise<string | null>;
}

export function useBioGeneration(): UseBioGenerationResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef(CrawlerCharacterSystem.getLoadingMessages());

  // Cycle through loading messages
  useEffect(() => {
    // Always clear any existing interval first to prevent memory leaks
    // if isGenerating toggles rapidly
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isGenerating) {
      const messages = messagesRef.current;
      let index = Math.floor(Math.random() * messages.length);
      setLoadingMessage(messages[index]);

      intervalRef.current = setInterval(() => {
        index = (index + 1) % messages.length;
        setLoadingMessage(messages[index]);
      }, 1500);
    } else {
      setLoadingMessage('');
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isGenerating]);

  const generate = useCallback(async (
    name: string,
    characterClass: CharacterClass
  ): Promise<string | null> => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, characterClass }),
      });

      // Safely parse JSON response (handles non-JSON error pages)
      let data: { bio?: string; error?: string };
      try {
        data = await response.json();
      } catch {
        throw new Error(
          response.ok
            ? 'Invalid response from server'
            : `Server error (${response.status})`
        );
      }

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to generate backstory');
      }

      return data.bio ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(message);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return {
    isGenerating,
    loadingMessage,
    error,
    generate,
  };
}
