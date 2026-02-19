import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LocalStorageCharacterRepository,
  RosterFullError,
  type CharacterRepository,
} from '../character-repository';
import { createSavedCharacter, type CharacterCreation } from '../character-system';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

function createTestCharacter(name: string): CharacterCreation {
  return {
    name,
    characterClass: 'warrior',
    bio: 'Test bio',
    statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
  };
}

describe('LocalStorageCharacterRepository', () => {
  let repo: CharacterRepository;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    repo = new LocalStorageCharacterRepository();
  });

  describe('list', () => {
    it('returns empty array when no characters saved', async () => {
      const result = await repo.list();
      expect(result).toEqual([]);
    });

    it('returns characters sorted by lastPlayedAt descending', async () => {
      const char1 = createSavedCharacter(createTestCharacter('First'));
      const char2 = createSavedCharacter(createTestCharacter('Second'));
      // Manually set lastPlayedAt to control order
      const older = { ...char1, lastPlayedAt: 1000 };
      const newer = { ...char2, lastPlayedAt: 2000 };

      await repo.save(older);
      await repo.save(newer);

      const result = await repo.list();
      expect(result[0].character.name).toBe('Second');
      expect(result[1].character.name).toBe('First');
    });
  });

  describe('get', () => {
    it('returns null for non-existent id', async () => {
      const result = await repo.get('non-existent');
      expect(result).toBeNull();
    });

    it('returns character by id', async () => {
      const saved = createSavedCharacter(createTestCharacter('Test'));
      await repo.save(saved);

      const result = await repo.get(saved.id);
      expect(result?.character.name).toBe('Test');
    });
  });

  describe('save', () => {
    it('inserts new character', async () => {
      const saved = createSavedCharacter(createTestCharacter('New'));
      await repo.save(saved);

      const result = await repo.get(saved.id);
      expect(result).not.toBeNull();
    });

    it('updates existing character', async () => {
      const saved = createSavedCharacter(createTestCharacter('Original'));
      await repo.save(saved);

      const updated = {
        ...saved,
        character: { ...saved.character, name: 'Updated' },
      };
      await repo.save(updated);

      const result = await repo.get(saved.id);
      expect(result?.character.name).toBe('Updated');
      expect(await repo.count()).toBe(1);
    });

    it('throws RosterFullError when at max capacity', async () => {
      const smallRepo = new LocalStorageCharacterRepository({ maxCharacters: 2 });

      await smallRepo.save(createSavedCharacter(createTestCharacter('One')));
      await smallRepo.save(createSavedCharacter(createTestCharacter('Two')));

      await expect(
        smallRepo.save(createSavedCharacter(createTestCharacter('Three')))
      ).rejects.toThrow(RosterFullError);
    });
  });

  describe('delete', () => {
    it('removes character by id', async () => {
      const saved = createSavedCharacter(createTestCharacter('ToDelete'));
      await repo.save(saved);
      expect(await repo.count()).toBe(1);

      await repo.delete(saved.id);
      expect(await repo.count()).toBe(0);
    });

    it('does nothing for non-existent id', async () => {
      await repo.delete('non-existent');
      expect(await repo.count()).toBe(0);
    });
  });

  describe('updatePlayStats', () => {
    it('merges partial stats and updates lastPlayedAt', async () => {
      const saved = createSavedCharacter(createTestCharacter('Player'));
      await repo.save(saved);

      const beforeUpdate = Date.now();
      await repo.updatePlayStats(saved.id, { gamesPlayed: 5, deaths: 2 });

      const result = await repo.get(saved.id);
      expect(result?.playStats.gamesPlayed).toBe(5);
      expect(result?.playStats.deaths).toBe(2);
      expect(result?.playStats.maxFloorReached).toBe(0); // unchanged
      expect(result?.lastPlayedAt).toBeGreaterThanOrEqual(beforeUpdate);
    });

    it('does nothing for non-existent id', async () => {
      await repo.updatePlayStats('non-existent', { gamesPlayed: 1 });
      // No error thrown
    });
  });

  describe('count', () => {
    it('returns number of saved characters', async () => {
      expect(await repo.count()).toBe(0);

      await repo.save(createSavedCharacter(createTestCharacter('One')));
      expect(await repo.count()).toBe(1);

      await repo.save(createSavedCharacter(createTestCharacter('Two')));
      expect(await repo.count()).toBe(2);
    });
  });
});
