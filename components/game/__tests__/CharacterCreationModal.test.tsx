// packages/crawler-core/components/game/__tests__/CharacterCreationModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CharacterCreationModal } from '../CharacterCreationModal';
import { CharacterRosterProvider } from '../../../hooks/useCharacterRoster';
import type { CharacterRepository } from '../../../lib/engine/character-repository';
import type { SavedCharacter } from '../../../lib/engine/character-system';

const createMockSavedCharacter = (
  overrides: Partial<SavedCharacter> = {}
): SavedCharacter => ({
  id: 'test-id-1',
  character: {
    name: 'TestWarrior',
    characterClass: 'warrior',
    bio: 'A brave warrior',
    statAllocations: { hp: 1, attack: 1, defense: 1, speed: 0 },
  },
  playStats: {
    gamesPlayed: 5,
    deaths: 2,
    maxFloorReached: 8,
    monstersKilled: 42,
  },
  createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7, // 1 week ago
  lastPlayedAt: Date.now() - 1000 * 60 * 60 * 24, // Yesterday
  ...overrides,
});

const createMockRepository = (
  characters: SavedCharacter[] = []
): CharacterRepository => ({
  list: vi.fn().mockResolvedValue(characters),
  get: vi.fn().mockImplementation((id) =>
    Promise.resolve(characters.find((c) => c.id === id) ?? null)
  ),
  save: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  updatePlayStats: vi.fn().mockResolvedValue(undefined),
  count: vi.fn().mockResolvedValue(characters.length),
});

describe('CharacterCreationModal', () => {
  it('renders when isOpen is true', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    expect(screen.getByText('Create Your Crawler')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(
      <CharacterCreationModal
        isOpen={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    expect(screen.queryByText('Create Your Crawler')).not.toBeInTheDocument();
  });

  it('calls onQuickStart when Quick Start button is clicked', () => {
    const onQuickStart = vi.fn();
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={onQuickStart}
      />
    );

    fireEvent.click(screen.getByText('Quick Start'));
    expect(onQuickStart).toHaveBeenCalled();
  });

  it('renders all four class options', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    expect(screen.getByText('Warrior')).toBeInTheDocument();
    expect(screen.getByText('Rogue')).toBeInTheDocument();
    expect(screen.getByText('Mage')).toBeInTheDocument();
    expect(screen.getByText('Cleric')).toBeInTheDocument();
  });

  it('disables Begin Adventure button when name is empty', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    const button = screen.getByText('Begin Adventure');
    expect(button).toBeDisabled();
  });

  it('enables Begin Adventure button when name is entered', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: 'TestHero' } });

    const button = screen.getByText('Begin Adventure');
    expect(button).not.toBeDisabled();
  });

  it('calls onSubmit with character data when Begin Adventure is clicked', () => {
    const onSubmit = vi.fn();
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onQuickStart={vi.fn()}
      />
    );

    // Enter a name
    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: 'TestHero' } });

    // Click submit
    fireEvent.click(screen.getByText('Begin Adventure'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TestHero',
        characterClass: 'warrior', // Default class
        bio: '',
        statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
      }),
      undefined // No saved character ID for new characters
    );
  });

  it('changes class when class button is clicked', () => {
    const onSubmit = vi.fn();
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onQuickStart={vi.fn()}
      />
    );

    // Click Rogue class
    fireEvent.click(screen.getByText('Rogue'));

    // Enter name and submit
    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: 'TestHero' } });
    fireEvent.click(screen.getByText('Begin Adventure'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        characterClass: 'rogue',
      }),
      undefined // No saved character ID for new characters
    );
  });

  it('shows points remaining counter', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    expect(screen.getByText('3 points remaining')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={onClose}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // Click the × button
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CharacterCreationModal - Name validation', () => {
  it('keeps Begin Adventure disabled for whitespace-only name', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: '   ' } });

    const button = screen.getByText('Begin Adventure');
    expect(button).toBeDisabled();
  });

  it('trims whitespace from name when submitting', () => {
    const onSubmit = vi.fn();
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onQuickStart={vi.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: '  TestHero  ' } });
    fireEvent.click(screen.getByText('Begin Adventure'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TestHero',
      }),
      undefined // No saved character ID for new characters
    );
  });

  it('shows error message for invalid characters', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: '<script>alert(1)</script>' } });

    expect(screen.getByText(/only letters, numbers, spaces/i)).toBeInTheDocument();
  });

  it('disables Begin Adventure for names with invalid characters', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText('Enter crawler name...');
    fireEvent.change(nameInput, { target: { value: 'Hero;DROP TABLE' } });

    const button = screen.getByText('Begin Adventure');
    expect(button).toBeDisabled();
  });
});

describe('CharacterCreationModal - Stat allocation UI', () => {
  it('disables all + buttons when 0 points remaining', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // Click + three times to use all points
    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[0]); // HP +1
    fireEvent.click(plusButtons[0]); // HP +1
    fireEvent.click(plusButtons[0]); // HP +1

    expect(screen.getByText('0 points remaining')).toBeInTheDocument();

    // All + buttons should be disabled
    plusButtons.forEach(button => {
      expect(button).toBeDisabled();
    });
  });

  it('disables - button when stat allocation is 0', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // All - buttons should initially be disabled (0 allocation)
    const minusButtons = screen.getAllByText('-');
    minusButtons.forEach(button => {
      expect(button).toBeDisabled();
    });
  });

  it('enables - button after allocating points to a stat', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // Click + on first stat (HP)
    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[0]);

    // The first - button (HP) should now be enabled
    const minusButtons = screen.getAllByText('-');
    expect(minusButtons[0]).not.toBeDisabled();
  });

  it('resets stat allocations when changing class', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // Allocate some points
    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[0]); // HP +1
    fireEvent.click(plusButtons[1]); // ATK +1

    expect(screen.getByText('1 points remaining')).toBeInTheDocument();

    // Change class
    fireEvent.click(screen.getByText('Rogue'));

    // Points should be reset to 3
    expect(screen.getByText('3 points remaining')).toBeInTheDocument();
  });
});

describe('CharacterCreationModal - Tabs and Saved Characters', () => {
  it('renders tab bar with Create New and Saved Characters tabs', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: /create new/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /saved characters/i })).toBeInTheDocument();
  });

  it('shows create tab content by default', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // Create tab should be selected
    const createTab = screen.getByRole('tab', { name: /create new/i });
    expect(createTab).toHaveAttribute('aria-selected', 'true');

    // Create form content should be visible
    expect(screen.getByText('Class')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter crawler name...')).toBeInTheDocument();
  });

  it('switches to saved tab when clicked', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    const savedTab = screen.getByRole('tab', { name: /saved characters/i });
    fireEvent.click(savedTab);

    expect(savedTab).toHaveAttribute('aria-selected', 'true');
    // Should show empty state when no roster context
    expect(screen.getByText(/no saved characters/i)).toBeInTheDocument();
  });

  it('shows empty state message when no saved characters', () => {
    render(
      <CharacterCreationModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onQuickStart={vi.fn()}
      />
    );

    // Switch to saved tab
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));

    expect(screen.getByText(/no saved characters/i)).toBeInTheDocument();
  });
});

describe('CharacterCreationModal - With Roster Provider', () => {
  it('displays saved characters in the saved tab', async () => {
    const savedCharacter = createMockSavedCharacter();
    const repository = createMockRepository([savedCharacter]);

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Switch to saved tab
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));

    // Wait for the character to appear
    await waitFor(() => {
      expect(screen.getByText('TestWarrior the Warrior')).toBeInTheDocument();
    });

    // Verify play stats are displayed
    expect(screen.getByText('5')).toBeInTheDocument(); // gamesPlayed
    expect(screen.getByText('8')).toBeInTheDocument(); // maxFloorReached
  });

  it('shows character count in saved tab badge', async () => {
    const savedCharacters = [
      createMockSavedCharacter({ id: 'test-1' }),
      createMockSavedCharacter({ id: 'test-2', character: { ...createMockSavedCharacter().character, name: 'TestMage', characterClass: 'mage' } }),
    ];
    const repository = createMockRepository(savedCharacters);

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Wait for characters to load
    await waitFor(() => {
      expect(screen.getByText('(2)')).toBeInTheDocument();
    });
  });

  it('populates form when selecting a saved character', async () => {
    const savedCharacter = createMockSavedCharacter({
      character: {
        name: 'TestRogue',
        characterClass: 'rogue',
        bio: 'A sneaky rogue',
        statAllocations: { hp: 0, attack: 2, defense: 0, speed: 1 },
      },
    });
    const repository = createMockRepository([savedCharacter]);

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Switch to saved tab
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));

    // Wait for and click the Select button
    await waitFor(() => {
      expect(screen.getByText('TestRogue the Rogue')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Select'));

    // Should switch back to create tab and populate form
    expect(screen.getByRole('tab', { name: /create new/i })).toHaveAttribute('aria-selected', 'true');

    // Name input should have the saved character's name
    const nameInput = screen.getByPlaceholderText('Enter crawler name...') as HTMLInputElement;
    expect(nameInput.value).toBe('TestRogue');

    // Should show the saved character indicator
    expect(screen.getByText(/playing as saved character/i)).toBeInTheDocument();
  });

  it('submits with savedId when playing as a saved character', async () => {
    const savedCharacter = createMockSavedCharacter();
    const repository = createMockRepository([savedCharacter]);
    const onSubmit = vi.fn();

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={onSubmit}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Switch to saved tab and select a character
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));
    await waitFor(() => {
      expect(screen.getByText('TestWarrior the Warrior')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Select'));

    // Submit the form
    fireEvent.click(screen.getByText('Begin Adventure'));

    // Should be called with the savedId
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TestWarrior',
        characterClass: 'warrior',
      }),
      'test-id-1' // The saved character ID
    );
  });

  it('clears savedId selection when Clear is clicked', async () => {
    const savedCharacter = createMockSavedCharacter();
    const repository = createMockRepository([savedCharacter]);
    const onSubmit = vi.fn();

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={onSubmit}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Select a saved character
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));
    await waitFor(() => {
      expect(screen.getByText('TestWarrior the Warrior')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Select'));

    // Clear the selection
    fireEvent.click(screen.getByText('Clear'));

    // Submit form
    fireEvent.click(screen.getByText('Begin Adventure'));

    // Should submit without savedId
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TestWarrior',
      }),
      undefined
    );
  });

  it('shows delete confirmation when Delete is clicked', async () => {
    const savedCharacter = createMockSavedCharacter();
    const repository = createMockRepository([savedCharacter]);

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Switch to saved tab
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));
    await waitFor(() => {
      expect(screen.getByText('TestWarrior the Warrior')).toBeInTheDocument();
    });

    // Click Delete
    fireEvent.click(screen.getByText('Delete'));

    // Should show confirmation UI
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('cancels delete when Cancel is clicked', async () => {
    const savedCharacter = createMockSavedCharacter();
    const repository = createMockRepository([savedCharacter]);

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Switch to saved tab
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));
    await waitFor(() => {
      expect(screen.getByText('TestWarrior the Warrior')).toBeInTheDocument();
    });

    // Click Delete, then Cancel
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Cancel'));

    // Should go back to normal state
    expect(screen.queryByText('Confirm Delete')).not.toBeInTheDocument();
    expect(screen.getByText('Select')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('deletes character when Confirm Delete is clicked', async () => {
    const savedCharacter = createMockSavedCharacter();
    const repository = createMockRepository([savedCharacter]);

    render(
      <CharacterRosterProvider repository={repository}>
        <CharacterCreationModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onQuickStart={vi.fn()}
        />
      </CharacterRosterProvider>
    );

    // Switch to saved tab
    fireEvent.click(screen.getByRole('tab', { name: /saved characters/i }));
    await waitFor(() => {
      expect(screen.getByText('TestWarrior the Warrior')).toBeInTheDocument();
    });

    // Click Delete, then Confirm Delete
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Confirm Delete'));

    // Repository delete should have been called
    await waitFor(() => {
      expect(repository.delete).toHaveBeenCalledWith('test-id-1');
    });
  });
});
