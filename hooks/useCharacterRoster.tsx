'use client';

/**
 * Character Roster Hook
 *
 * Context provider and hook for managing saved characters.
 * Repository is injected via props for platform-agnostic storage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { CharacterRepository } from '../lib/engine/character-repository';
import {
  createSavedCharacter,
  type CharacterCreation,
  type PlayStats,
  type SavedCharacter,
} from '../lib/engine/character-system';

// --- Context Types ---

export interface CharacterRosterContextValue {
  characters: SavedCharacter[];
  isLoading: boolean;
  error: Error | null;

  saveCharacter: (character: CharacterCreation) => Promise<SavedCharacter>;
  deleteCharacter: (id: string) => Promise<void>;
  updatePlayStats: (id: string, stats: Partial<PlayStats>) => Promise<void>;

  isFull: boolean;
  maxCharacters: number;
}

const CharacterRosterContext = createContext<CharacterRosterContextValue | null>(null);

// --- Provider ---

export interface CharacterRosterProviderProps {
  repository: CharacterRepository;
  maxCharacters?: number;
  children: ReactNode;
}

export function CharacterRosterProvider({
  repository,
  maxCharacters = 10,
  children,
}: CharacterRosterProviderProps) {
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load characters on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await repository.list();
        if (!cancelled) {
          setCharacters(list);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [repository]);

  const saveCharacter = useCallback(
    async (character: CharacterCreation): Promise<SavedCharacter> => {
      const saved = createSavedCharacter(character);
      await repository.save(saved);
      setCharacters((prev) => [saved, ...prev]);
      return saved;
    },
    [repository]
  );

  const deleteCharacter = useCallback(
    async (id: string): Promise<void> => {
      await repository.delete(id);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
    },
    [repository]
  );

  const updatePlayStats = useCallback(
    async (id: string, stats: Partial<PlayStats>): Promise<void> => {
      await repository.updatePlayStats(id, stats);
      // Refresh the character in local state
      const updated = await repository.get(id);
      if (updated) {
        setCharacters((prev) =>
          prev.map((c) => (c.id === id ? updated : c))
        );
      }
    },
    [repository]
  );

  const isFull = characters.length >= maxCharacters;

  const value: CharacterRosterContextValue = {
    characters,
    isLoading,
    error,
    saveCharacter,
    deleteCharacter,
    updatePlayStats,
    isFull,
    maxCharacters,
  };

  return (
    <CharacterRosterContext.Provider value={value}>
      {children}
    </CharacterRosterContext.Provider>
  );
}

// --- Hook ---

export function useCharacterRoster(): CharacterRosterContextValue {
  const context = useContext(CharacterRosterContext);
  if (!context) {
    throw new Error('useCharacterRoster must be used within CharacterRosterProvider');
  }
  return context;
}
