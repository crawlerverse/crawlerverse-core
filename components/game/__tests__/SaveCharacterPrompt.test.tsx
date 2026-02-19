import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveCharacterPrompt } from '../SaveCharacterPrompt';
import { createSavedCharacter, type CharacterCreation } from '../../../lib/engine/character-system';

const testCharacter: CharacterCreation = {
  name: 'Grimjaw',
  characterClass: 'warrior',
  bio: 'Test bio',
  statAllocations: { hp: 0, attack: 0, defense: 0, speed: 0 },
};

describe('SaveCharacterPrompt', () => {
  it('renders nothing when not open', () => {
    render(
      <SaveCharacterPrompt
        isOpen={false}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={vi.fn()}
        isFull={false}
        savedCharacters={[]}
      />
    );

    expect(screen.queryByText('Save to Roster?')).not.toBeInTheDocument();
  });

  it('shows save prompt when not full', () => {
    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={vi.fn()}
        isFull={false}
        savedCharacters={[]}
      />
    );

    expect(screen.getByText('Save to Roster?')).toBeInTheDocument();
    expect(screen.getByText(/Grimjaw the Warrior/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('calls onSave when Save button clicked', () => {
    const onSave = vi.fn();
    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={onSave}
        onSkip={vi.fn()}
        isFull={false}
        savedCharacters={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(undefined); // No replacement
  });

  it('calls onSkip when Skip button clicked', () => {
    const onSkip = vi.fn();
    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={onSkip}
        isFull={false}
        savedCharacters={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('shows replacement picker when roster is full', () => {
    const savedChars = [
      createSavedCharacter({ ...testCharacter, name: 'OldChar1' }),
      createSavedCharacter({ ...testCharacter, name: 'OldChar2' }),
    ];

    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={vi.fn()}
        isFull={true}
        savedCharacters={savedChars}
      />
    );

    expect(screen.getByText(/Roster Full/)).toBeInTheDocument();
    expect(screen.getByText(/OldChar1/)).toBeInTheDocument();
    expect(screen.getByText(/OldChar2/)).toBeInTheDocument();
  });

  it('calls onSave with replacement id when character selected and Replace clicked', () => {
    const savedChars = [
      createSavedCharacter({ ...testCharacter, name: 'ToReplace' }),
    ];
    const onSave = vi.fn();

    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={onSave}
        onSkip={vi.fn()}
        isFull={true}
        savedCharacters={savedChars}
      />
    );

    // Select the character to replace
    fireEvent.click(screen.getByText(/ToReplace/));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onSave).toHaveBeenCalledWith(savedChars[0].id);
  });

  it('calls onSkip when Escape key is pressed', () => {
    const onSkip = vi.fn();
    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={onSkip}
        isFull={false}
        savedCharacters={[]}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalled();
  });

  it('calls onSkip when backdrop is clicked', () => {
    const onSkip = vi.fn();
    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={onSkip}
        isFull={false}
        savedCharacters={[]}
      />
    );

    // Click on the backdrop (the dialog element itself)
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onSkip).toHaveBeenCalled();
  });

  it('does not call onSkip when modal content is clicked', () => {
    const onSkip = vi.fn();
    render(
      <SaveCharacterPrompt
        isOpen={true}
        character={testCharacter}
        onSave={vi.fn()}
        onSkip={onSkip}
        isFull={false}
        savedCharacters={[]}
      />
    );

    // Click on the modal content (title text)
    fireEvent.click(screen.getByText('Save to Roster?'));
    expect(onSkip).not.toHaveBeenCalled();
  });
});
