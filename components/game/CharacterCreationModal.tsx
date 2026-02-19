'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  CrawlerCharacterSystem,
  calculateFinalStats,
  calculatePointsSpent,
  createEmptyAllocation,
  isValidCharacterName,
  SAFE_NAME_PATTERN,
  type CharacterCreation,
  type StatAllocation,
  type SavedCharacter,
} from '../../lib/engine/character-system';
import type { CharacterClass } from '../../lib/engine/types';
import { useBioGeneration } from '../../hooks/useBioGeneration';
import { createRNG, pickRandom } from '../../lib/engine/rng';
import { formatCharacterTitle } from '../../lib/engine/character';
import { useCharacterRoster, type CharacterRosterContextValue } from '../../hooks/useCharacterRoster';
import { formatRelativeTime } from '../../lib/utils';

export interface CharacterCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (character: CharacterCreation, savedId?: string) => void;
  onQuickStart: () => void;
  /** Seed for deterministic placeholder selection (avoids hydration mismatch) */
  seed?: number;
}

type TabId = 'create' | 'saved';

/**
 * Safely try to use the character roster hook.
 * Returns null if not wrapped in provider.
 */
function useSafeCharacterRoster(): CharacterRosterContextValue | null {
  try {
    return useCharacterRoster();
  } catch {
    return null;
  }
}

const MODAL_BACKDROP = 'fixed inset-0 bg-black/75 flex items-center justify-center z-50';

export function CharacterCreationModal({
  isOpen,
  onClose,
  onSubmit,
  onQuickStart,
  seed,
}: CharacterCreationModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('create');
  const [selectedClass, setSelectedClass] = useState<CharacterClass>('warrior');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [allocations, setAllocations] = useState<StatAllocation>(createEmptyAllocation());
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Try to get roster context (gracefully degrades when not available)
  const roster = useSafeCharacterRoster();

  const system = CrawlerCharacterSystem;
  const baseStats = system.getBaseStats(selectedClass);
  const finalStats = calculateFinalStats(baseStats, allocations);
  const pointsSpent = calculatePointsSpent(allocations);
  const pointsRemaining = system.allocationPoints - pointsSpent;

  const selectedClassDef = system.classes.find(c => c.id === selectedClass)!;

  // Seeded placeholder for bio (deterministic to avoid hydration mismatch)
  const bioPlaceholder = useMemo(() => {
    const placeholders = system.getBioPlaceholders(selectedClass);
    if (seed !== undefined) {
      // Use seeded RNG for deterministic selection across server/client
      const rng = createRNG(seed);
      return pickRandom(placeholders, rng);
    }
    // Fallback to first placeholder if no seed provided
    return placeholders[0];
  }, [selectedClass, system, seed]);

  // Bio generation hook
  const { isGenerating, loadingMessage, error: bioError, generate: generateBio } = useBioGeneration();

  const handleGenerateBio = useCallback(async () => {
    if (!name.trim()) {
      return;
    }
    const generatedBio = await generateBio(name.trim(), selectedClass);
    if (generatedBio) {
      setBio(generatedBio);
    }
  }, [name, selectedClass, generateBio]);

  const handleRandomName = useCallback(() => {
    const names = system.getNamePool(selectedClass);
    const randomName = names[Math.floor(Math.random() * names.length)];
    setName(randomName);
  }, [selectedClass, system]);

  const handleClassChange = useCallback((classId: CharacterClass) => {
    setSelectedClass(classId);
    // Reset allocations when class changes
    setAllocations(createEmptyAllocation());
    // If name was from pool, update to new class pool
    const currentPool = system.getNamePool(selectedClass);
    if (currentPool.includes(name)) {
      const newPool = system.getNamePool(classId);
      setName(newPool[Math.floor(Math.random() * newPool.length)]);
    }
  }, [name, selectedClass, system]);

  const handleAllocationChange = useCallback((stat: keyof StatAllocation, delta: number) => {
    setAllocations(prev => {
      const newValue = prev[stat] + delta;
      if (newValue < 0) return prev;

      const newAllocations = { ...prev, [stat]: newValue };
      const newPointsSpent = calculatePointsSpent(newAllocations);
      if (newPointsSpent > system.allocationPoints) return prev;

      return newAllocations;
    });
  }, [system.allocationPoints]);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    onSubmit(
      {
        name: name.trim(),
        characterClass: selectedClass,
        bio: bio.trim(),
        statAllocations: allocations,
      },
      selectedSavedId ?? undefined
    );
  }, [name, selectedClass, bio, allocations, onSubmit, selectedSavedId]);

  const handleSelectSavedCharacter = useCallback((saved: SavedCharacter) => {
    // Populate form with saved character data
    setName(saved.character.name);
    setSelectedClass(saved.character.characterClass);
    setBio(saved.character.bio);
    setAllocations(saved.character.statAllocations);
    setSelectedSavedId(saved.id);
    // Switch back to create tab and clear any delete confirmation
    setActiveTab('create');
    setDeleteConfirmId(null);
  }, []);

  const handleDeleteCharacter = useCallback(async (id: string) => {
    if (!roster) return;
    await roster.deleteCharacter(id);
    setDeleteConfirmId(null);
  }, [roster]);

  const handleClearSelection = useCallback(() => {
    setSelectedSavedId(null);
  }, []);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setDeleteConfirmId(null);
  }, []);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleTabChange(activeTab === 'create' ? 'saved' : 'create');
      // Focus the other tab button
      const nextTabId = activeTab === 'create' ? 'saved-tab' : 'create-tab';
      (document.getElementById(nextTabId) as HTMLButtonElement | null)?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handleTabChange(activeTab === 'create' ? 'saved' : 'create');
      // Focus the other tab button
      const nextTabId = activeTab === 'create' ? 'saved-tab' : 'create-tab';
      (document.getElementById(nextTabId) as HTMLButtonElement | null)?.focus();
    }
  }, [activeTab, handleTabChange]);

  const isValid = isValidCharacterName(name);
  const hasInvalidChars = name.trim().length > 0 && !SAFE_NAME_PATTERN.test(name.trim());

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle backdrop click to close modal
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={MODAL_BACKDROP}
      style={{ animation: 'fadeIn 200ms ease-out' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="character-creation-title"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-6 max-w-3xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ animation: 'scaleIn 200ms ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 id="character-creation-title" className="text-xl font-bold text-[var(--text)]">
            {activeTab === 'create' ? 'Create Your Crawler' : 'Your Roster'}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 mb-6 border-b border-[var(--border)]" role="tablist">
          <button
            id="create-tab"
            role="tab"
            aria-selected={activeTab === 'create'}
            aria-controls="create-panel"
            tabIndex={activeTab === 'create' ? 0 : -1}
            onClick={() => handleTabChange('create')}
            onKeyDown={handleTabKeyDown}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === 'create'
                ? 'text-[var(--text)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Create New
            {activeTab === 'create' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--player)]" />
            )}
          </button>
          <button
            id="saved-tab"
            role="tab"
            aria-selected={activeTab === 'saved'}
            aria-controls="saved-panel"
            tabIndex={activeTab === 'saved' ? 0 : -1}
            onClick={() => handleTabChange('saved')}
            onKeyDown={handleTabKeyDown}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === 'saved'
                ? 'text-[var(--text)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Saved Characters
            {roster && roster.characters.length > 0 && (
              <span className="ml-1.5 text-xs text-[var(--text-muted)]">
                ({roster.characters.length})
              </span>
            )}
            {activeTab === 'saved' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--player)]" />
            )}
          </button>
        </div>

        {/* Create Tab Content */}
        {activeTab === 'create' && (
          <div id="create-panel" role="tabpanel" aria-labelledby="create-tab">
            {/* Selected saved character indicator */}
            {selectedSavedId && (
              <div className="mb-4 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg flex items-center justify-between">
                <span className="text-sm text-[var(--text-muted)]">
                  Playing as saved character: <span className="text-[var(--text)]">{name}</span>
                </span>
                <button
                  onClick={handleClearSelection}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="flex gap-6">
              {/* Left: Form */}
              <div className="flex-1 space-y-6">
                {/* Class Selection */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">
                    Class
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {system.classes.map(cls => (
                      <button
                        key={cls.id}
                        onClick={() => handleClassChange(cls.id)}
                        className={`p-3 rounded border text-left transition-all ${
                          selectedClass === cls.id
                            ? 'border-2 bg-[var(--bg-elevated)]'
                            : 'border-[var(--border)] hover:border-[var(--text-muted)]'
                        }`}
                        style={{
                          borderColor: selectedClass === cls.id ? cls.color : undefined,
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-lg font-bold"
                            style={{ color: cls.color }}
                          >
                            @
                          </span>
                          <span className="font-medium text-[var(--text)]">{cls.name}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                          {cls.tagline}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Name Input */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">
                    Name
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter crawler name..."
                      maxLength={20}
                      className={`flex-1 px-3 py-2 bg-[var(--bg-elevated)] border rounded text-[var(--text)] text-sm outline-none focus:border-[var(--text-muted)] ${
                        hasInvalidChars ? 'border-[var(--danger)]' : 'border-[var(--border)]'
                      }`}
                    />
                    <button
                      onClick={handleRandomName}
                      className="px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded text-[var(--text-muted)] hover:text-[var(--text)] text-sm"
                    >
                      Random
                    </button>
                  </div>
                  {hasInvalidChars && (
                    <p className="text-xs text-[var(--danger)] mt-1">
                      Only letters, numbers, spaces, hyphens, and apostrophes allowed
                    </p>
                  )}
                </div>

                {/* Bio Input */}
                <div>
                  <label
                    htmlFor="bio-textarea"
                    className="block text-sm font-medium text-[var(--text-muted)] mb-1"
                  >
                    Backstory <span className="text-[var(--text-muted)]/60">(optional)</span>
                  </label>
                  <p id="bio-description" className="text-xs text-[var(--text-muted)]/80 mb-2">
                    This influences how your character thinks and speaks
                  </p>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={handleGenerateBio}
                      disabled={isGenerating || !name.trim()}
                      className="px-3 py-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded text-[var(--text-muted)] hover:text-[var(--text)] text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!name.trim() ? 'Enter a name first to generate a backstory' : undefined}
                    >
                      {isGenerating ? loadingMessage : 'Generate'}
                    </button>
                    {bioError && (
                      <span className="text-xs text-[var(--danger)]" role="alert">{bioError}</span>
                    )}
                  </div>
                  <div className="relative">
                    <textarea
                      id="bio-textarea"
                      value={bio}
                      onChange={(e) => setBio(e.target.value.slice(0, 250))}
                      placeholder={bioPlaceholder}
                      rows={3}
                      aria-describedby="bio-description"
                      className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded text-[var(--text)] text-sm outline-none focus:border-[var(--text-muted)] resize-none"
                    />
                    <span
                      className={`absolute bottom-2 right-2 text-xs ${
                        bio.length >= 250
                          ? 'text-[var(--danger)]'
                          : bio.length >= 200
                          ? 'text-[var(--player)]'
                          : 'text-[var(--text-muted)]'
                      }`}
                      aria-live="polite"
                    >
                      {bio.length} / 250
                    </span>
                  </div>
                </div>

                {/* Stat Allocation */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-[var(--text-muted)]">
                      Stats
                    </label>
                    <span className="text-sm text-[var(--text)]">
                      {pointsRemaining} points remaining
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(['hp', 'attack', 'defense', 'speed'] as const).map(stat => (
                      <div key={stat} className="flex items-center gap-3">
                        <span className="w-16 text-xs text-[var(--text-muted)] uppercase">
                          {stat === 'hp' ? 'HP' : stat === 'attack' ? 'ATK' : stat === 'defense' ? 'DEF' : 'SPD'}
                        </span>
                        <button
                          onClick={() => handleAllocationChange(stat, -1)}
                          disabled={allocations[stat] <= 0}
                          className="w-6 h-6 rounded bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] disabled:opacity-30"
                        >
                          -
                        </button>
                        <span className="w-12 text-center text-sm text-[var(--text)]">
                          {finalStats[stat]}
                          {allocations[stat] > 0 && (
                            <span className="text-[var(--success)]"> (+{allocations[stat] * system.allocationCosts[stat].increment})</span>
                          )}
                        </span>
                        <button
                          onClick={() => handleAllocationChange(stat, 1)}
                          disabled={pointsRemaining <= 0}
                          className="w-6 h-6 rounded bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Preview */}
              <div className="w-48 flex flex-col">
                <div className="text-sm font-medium text-[var(--text-muted)] mb-2">Preview</div>
                <div className="flex-1 bg-[var(--bg-deep)] border border-[var(--border)] rounded p-4">
                  {/* Character tile */}
                  <div
                    className="w-12 h-12 mx-auto mb-3 flex items-center justify-center text-3xl font-bold rounded"
                    style={{
                      color: selectedClassDef.color,
                      backgroundColor: 'var(--bg-surface)',
                      textShadow: `0 0 10px ${selectedClassDef.color}40`,
                    }}
                  >
                    @
                  </div>

                  {/* Title */}
                  <div className="text-center mb-3">
                    <div className="text-sm font-medium text-[var(--text)]">
                      {name || '???'} the {selectedClassDef.name}
                    </div>
                  </div>

                  {/* Personality */}
                  <p className="text-xs text-[var(--text-muted)] italic mb-3 text-center">
                    {selectedClassDef.personality}
                  </p>

                  {/* Stats */}
                  <div className="text-xs text-[var(--text-muted)] space-y-1">
                    <div className="flex justify-between">
                      <span>HP</span>
                      <span className="text-[var(--text)]">{finalStats.hp}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>ATK</span>
                      <span className="text-[var(--text)]">{finalStats.attack}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>DEF</span>
                      <span className="text-[var(--text)]">{finalStats.defense}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SPD</span>
                      <span className="text-[var(--text)]">{finalStats.speed}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saved Characters Tab Content */}
        {activeTab === 'saved' && (
          <div id="saved-panel" role="tabpanel" aria-labelledby="saved-tab">
            {!roster || roster.characters.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[var(--text-muted)] mb-4">No saved characters yet.</p>
                <button
                  onClick={() => handleTabChange('create')}
                  className="px-4 py-2 bg-[var(--player)] text-white rounded font-medium hover:brightness-110 transition-all"
                >
                  Create Your First Character
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
                {roster.characters.map((saved) => {
                  const classDef = system.classes.find(c => c.id === saved.character.characterClass);
                  return (
                    <div
                      key={saved.id}
                      className="p-4 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg hover:border-[var(--text-muted)] transition-colors"
                    >
                      {/* Character Header */}
                      <div className="flex items-center gap-3 mb-3">
                        <span
                          className="text-2xl font-bold"
                          style={{ color: classDef?.color ?? '#fff' }}
                        >
                          @
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[var(--text)] truncate">
                            {formatCharacterTitle(saved.character.name, saved.character.characterClass)}
                          </div>
                          <div className="text-xs text-[var(--text-muted)]">
                            Last played {formatRelativeTime(saved.lastPlayedAt)}
                          </div>
                        </div>
                      </div>

                      {/* Play Stats */}
                      <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Games</span>
                          <span className="text-[var(--text)]">{saved.playStats.gamesPlayed}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Max Floor</span>
                          <span className="text-[var(--text)]">{saved.playStats.maxFloorReached}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Deaths</span>
                          <span className="text-[var(--text)]">{saved.playStats.deaths}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Kills</span>
                          <span className="text-[var(--text)]">{saved.playStats.monstersKilled}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      {deleteConfirmId === saved.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeleteCharacter(saved.id)}
                            className="flex-1 px-3 py-1.5 bg-[var(--danger)] text-white rounded text-sm font-medium hover:brightness-110 transition-all"
                          >
                            Confirm Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-3 py-1.5 border border-[var(--border)] rounded text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSelectSavedCharacter(saved)}
                            className="flex-1 px-3 py-1.5 bg-[var(--player)] text-white rounded text-sm font-medium hover:brightness-110 transition-all"
                          >
                            Select
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(saved.id)}
                            className="px-3 py-1.5 border border-[var(--border)] rounded text-sm text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer - only show on create tab */}
        {activeTab === 'create' && (
          <div className="flex justify-between mt-6 pt-4 border-t border-[var(--border)]">
            <button
              onClick={onQuickStart}
              className="px-4 py-2 bg-transparent border border-[var(--border)] rounded text-[var(--text-muted)] hover:border-[var(--text-muted)] transition-colors"
            >
              Quick Start
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid}
              className={`px-6 py-2 rounded text-white font-medium transition-all ${
                isValid
                  ? 'bg-[var(--player)] hover:brightness-110 cursor-pointer'
                  : 'bg-[var(--bg-elevated)] cursor-not-allowed opacity-50'
              }`}
            >
              Begin Adventure
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
