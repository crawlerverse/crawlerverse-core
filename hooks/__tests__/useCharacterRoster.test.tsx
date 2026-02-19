import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { CharacterRosterProvider, useCharacterRoster } from '../useCharacterRoster';
import type { CharacterRepository } from '../../lib/engine/character-repository';
import { createSavedCharacter, type CharacterCreation } from '../../lib/engine/character-system';
import type { ReactNode } from 'react';

function createTestCharacter(name: string): CharacterCreation {
  return {
    name,
    characterClass: 'warrior',
    bio: 'Test',
    statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
  };
}

function createMockRepository(initialCharacters: ReturnType<typeof createSavedCharacter>[] = []): CharacterRepository {
  let characters = [...initialCharacters];

  return {
    list: vi.fn(async () => [...characters].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)),
    get: vi.fn(async (id: string) => characters.find((c) => c.id === id) ?? null),
    save: vi.fn(async (char) => {
      const idx = characters.findIndex((c) => c.id === char.id);
      if (idx >= 0) {
        characters[idx] = char;
      } else {
        characters.push(char);
      }
    }),
    delete: vi.fn(async (id: string) => {
      characters = characters.filter((c) => c.id !== id);
    }),
    updatePlayStats: vi.fn(async () => {}),
    count: vi.fn(async () => characters.length),
  };
}

describe('useCharacterRoster', () => {
  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useCharacterRoster());
    }).toThrow('useCharacterRoster must be used within CharacterRosterProvider');
  });

  it('loads characters on mount', async () => {
    const saved = createSavedCharacter(createTestCharacter('Test'));
    const repo = createMockRepository([saved]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <CharacterRosterProvider repository={repo}>{children}</CharacterRosterProvider>
    );

    const { result } = renderHook(() => useCharacterRoster(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.characters).toHaveLength(1);
    expect(result.current.characters[0].character.name).toBe('Test');
  });

  it('saveCharacter adds to roster and returns saved character', async () => {
    const repo = createMockRepository();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CharacterRosterProvider repository={repo}>{children}</CharacterRosterProvider>
    );

    const { result } = renderHook(() => useCharacterRoster(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let savedChar;
    await act(async () => {
      savedChar = await result.current.saveCharacter(createTestCharacter('New'));
    });

    expect(savedChar).toBeDefined();
    expect(result.current.characters).toHaveLength(1);
  });

  it('deleteCharacter removes from roster', async () => {
    const saved = createSavedCharacter(createTestCharacter('ToDelete'));
    const repo = createMockRepository([saved]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <CharacterRosterProvider repository={repo}>{children}</CharacterRosterProvider>
    );

    const { result } = renderHook(() => useCharacterRoster(), { wrapper });

    await waitFor(() => expect(result.current.characters).toHaveLength(1));

    await act(async () => {
      await result.current.deleteCharacter(saved.id);
    });

    expect(result.current.characters).toHaveLength(0);
  });

  it('isFull is true when at max capacity', async () => {
    const chars = Array.from({ length: 10 }, (_, i) =>
      createSavedCharacter(createTestCharacter(`Char${i}`))
    );
    const repo = createMockRepository(chars);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <CharacterRosterProvider repository={repo} maxCharacters={10}>
        {children}
      </CharacterRosterProvider>
    );

    const { result } = renderHook(() => useCharacterRoster(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isFull).toBe(true);
    expect(result.current.maxCharacters).toBe(10);
  });
});
