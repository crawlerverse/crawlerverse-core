/**
 * Character Repository
 *
 * Storage-agnostic interface for persisting saved characters.
 * Default implementation uses localStorage.
 */

import type { PlayStats, SavedCharacter } from './character-system';

// --- Configuration ---

export interface CharacterRepositoryConfig {
  readonly maxCharacters: number;
}

export const DEFAULT_REPOSITORY_CONFIG: CharacterRepositoryConfig = {
  maxCharacters: 10,
};

// --- Repository Interface ---

export interface CharacterRepository {
  /** Get all saved characters, sorted by lastPlayedAt descending */
  list(): Promise<SavedCharacter[]>;

  /** Get a single character by ID */
  get(id: string): Promise<SavedCharacter | null>;

  /** Save a character (insert or update based on id) */
  save(character: SavedCharacter): Promise<void>;

  /** Delete a character by ID */
  delete(id: string): Promise<void>;

  /** Update play stats after a game session */
  updatePlayStats(id: string, stats: Partial<PlayStats>): Promise<void>;

  /** Get current count (for roster limit checks) */
  count(): Promise<number>;
}

// --- Errors ---

export class RosterFullError extends Error {
  constructor(readonly maxCharacters: number) {
    super(`Character roster is full (max: ${maxCharacters})`);
    this.name = 'RosterFullError';
  }
}

// --- LocalStorage Implementation ---

export class LocalStorageCharacterRepository implements CharacterRepository {
  private readonly storageKey = 'crawler:savedCharacters';
  private readonly config: CharacterRepositoryConfig;

  constructor(config: Partial<CharacterRepositoryConfig> = {}) {
    this.config = { ...DEFAULT_REPOSITORY_CONFIG, ...config };
  }

  async list(): Promise<SavedCharacter[]> {
    const data = this.readStorage();
    return data.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }

  async get(id: string): Promise<SavedCharacter | null> {
    const data = this.readStorage();
    return data.find((c) => c.id === id) ?? null;
  }

  async save(character: SavedCharacter): Promise<void> {
    const data = this.readStorage();
    const existingIndex = data.findIndex((c) => c.id === character.id);

    if (existingIndex >= 0) {
      data[existingIndex] = character;
    } else {
      if (data.length >= this.config.maxCharacters) {
        throw new RosterFullError(this.config.maxCharacters);
      }
      data.push(character);
    }

    this.writeStorage(data);
  }

  async delete(id: string): Promise<void> {
    const data = this.readStorage().filter((c) => c.id !== id);
    this.writeStorage(data);
  }

  async updatePlayStats(id: string, stats: Partial<PlayStats>): Promise<void> {
    const data = this.readStorage();
    const index = data.findIndex((c) => c.id === id);
    if (index < 0) return;

    const character = data[index];
    data[index] = {
      ...character,
      playStats: { ...character.playStats, ...stats },
      lastPlayedAt: Date.now(),
    };
    this.writeStorage(data);
  }

  async count(): Promise<number> {
    return this.readStorage().length;
  }

  private readStorage(): SavedCharacter[] {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(this.storageKey);
    return raw ? JSON.parse(raw) : [];
  }

  private writeStorage(data: SavedCharacter[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }
}
