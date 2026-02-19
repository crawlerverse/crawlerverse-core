'use client';

/**
 * SaveCharacterPrompt Component
 *
 * Modal prompting user to save character to roster after creation.
 * Shows replacement picker when roster is full.
 */

import { useState, useCallback, useEffect } from 'react';
import type { CharacterCreation, SavedCharacter } from '../../lib/engine/character-system';
import { formatCharacterTitle } from '../../lib/engine/character';
import { formatRelativeTime } from '../../lib/utils';

const MODAL_BACKDROP = 'fixed inset-0 bg-black/75 flex items-center justify-center z-50';

export interface SaveCharacterPromptProps {
  isOpen: boolean;
  character: CharacterCreation;
  onSave: (replaceId?: string) => void;
  onSkip: () => void;
  isFull: boolean;
  savedCharacters: SavedCharacter[];
}

export function SaveCharacterPrompt({
  isOpen,
  character,
  onSave,
  onSkip,
  isFull,
  savedCharacters,
}: SaveCharacterPromptProps) {
  const [selectedReplaceId, setSelectedReplaceId] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    onSave(isFull ? selectedReplaceId ?? undefined : undefined);
  }, [onSave, isFull, selectedReplaceId]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onSkip]);

  // Handle backdrop click to close modal
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onSkip();
    }
  }, [onSkip]);

  if (!isOpen) return null;

  const characterTitle = formatCharacterTitle(character.name, character.characterClass);

  return (
    <div
      className={MODAL_BACKDROP}
      style={{ animation: 'fadeIn 200ms ease-out' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-prompt-title"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-6 max-w-md w-full shadow-2xl"
        style={{ animation: 'scaleIn 200ms ease-out' }}
      >
        {isFull ? (
          <>
            <h2
              id="save-prompt-title"
              className="text-lg font-semibold text-[var(--text)] mb-2"
            >
              Roster Full ({savedCharacters.length}/{savedCharacters.length})
            </h2>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Choose a character to replace:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {savedCharacters.map((saved) => (
                <button
                  key={saved.id}
                  onClick={() => setSelectedReplaceId(saved.id)}
                  className={`w-full p-3 rounded border text-left transition-all ${
                    selectedReplaceId === saved.id
                      ? 'border-[var(--player)] bg-[var(--bg-elevated)]'
                      : 'border-[var(--border)] hover:border-[var(--text-muted)]'
                  }`}
                >
                  <div className="font-medium text-sm text-[var(--text)]">
                    {formatCharacterTitle(saved.character.name, saved.character.characterClass)}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {saved.playStats.gamesPlayed} games · Last played {formatRelativeTime(saved.lastPlayedAt)}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2
              id="save-prompt-title"
              className="text-lg font-semibold text-[var(--text)] mb-2"
            >
              Save to Roster?
            </h2>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              <span className="text-[var(--text)]">{characterTitle}</span> will be available for future adventures.
            </p>
          </>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onSkip}
            className="px-4 py-2 bg-transparent border border-[var(--border)] rounded text-[var(--text-muted)] hover:border-[var(--text-muted)] transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSave}
            disabled={isFull && !selectedReplaceId}
            className={`px-4 py-2 rounded text-white font-medium transition-all ${
              !isFull || selectedReplaceId
                ? 'bg-[var(--player)] hover:brightness-110 cursor-pointer'
                : 'bg-[var(--bg-elevated)] cursor-not-allowed opacity-50'
            }`}
          >
            {isFull ? 'Replace' : 'Save & Play'}
          </button>
        </div>
      </div>
    </div>
  );
}
