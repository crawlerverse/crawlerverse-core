/**
 * Character System
 *
 * Defines character classes, names, and personalities for crawlers.
 * Used to give AI-controlled crawlers distinct identities and thought patterns.
 */

import { type CharacterClass } from './types';
import { type RNG, pickRandom } from './rng';
import type { PerceptionTraits } from './perception-types';

// Re-export type for convenience
export type { CharacterClass } from './types';

// --- Character Classes ---

export const CHARACTER_CLASSES: readonly CharacterClass[] = ['warrior', 'rogue', 'mage', 'cleric'];

// --- Personality Descriptions (for AI prompts) ---

export const CLASS_PERSONALITIES: Record<CharacterClass, string> = {
  warrior: 'Aggressive and direct. Loves combat. Speaks with bravado and confidence.',
  rogue: 'Calculating and opportunistic. Values self-preservation. Sarcastic and cunning.',
  mage: 'Intellectual and slightly arrogant. Analyzes situations coolly and methodically.',
  cleric: 'Cautious and thoughtful. Speaks with quiet determination and compassion.',
};

// --- Perception Trait Defaults by Class ---

export const CLASS_TRAIT_DEFAULTS: Record<CharacterClass, PerceptionTraits> = {
  warrior: { bravery: 2, observant: -1 },
  rogue: { bravery: 0, observant: 2 },
  mage: { bravery: -1, observant: 1 },
  cleric: { bravery: 1, observant: 0 },
};

// --- Name Pools ---

const CLASS_NAMES: Record<CharacterClass, readonly string[]> = {
  warrior: ['Grimjaw', 'Ironhide', 'Bloodaxe', 'Thornhelm', 'Drakebane', 'Steelfist', 'Warhammer', 'Bonecrusher'],
  rogue: ['Shadowstep', 'Whisper', 'Nightshade', 'Silvertongue', 'Vex', 'Phantom', 'Quickfingers', 'Shade'],
  mage: ['Ashwind', 'Frostweave', 'Sparkwright', 'Glimmer', 'Runekeeper', 'Starfire', 'Voidwalker', 'Arcanus'],
  cleric: ['Dawnbringer', 'Faithguard', 'Lighttouch', 'Mercy', 'Solace', 'Radiance', 'Hopebringer', 'Blessing'],
};

// --- Random Selection ---

/**
 * Get a random character class using provided RNG.
 */
export function getRandomCharacterClass(rng: RNG): CharacterClass {
  return pickRandom(CHARACTER_CLASSES, rng);
}

/**
 * Get a random name for a character class using provided RNG.
 */
export function getRandomName(characterClass: CharacterClass, rng: RNG): string {
  return pickRandom(CLASS_NAMES[characterClass], rng);
}

/**
 * Generate a full character identity (class + name) using provided RNG.
 */
export function generateCharacterIdentity(rng: RNG): { characterClass: CharacterClass; name: string } {
  const characterClass = getRandomCharacterClass(rng);
  const name = getRandomName(characterClass, rng);
  return { characterClass, name };
}

/**
 * Get the personality description for a character class.
 */
export function getPersonalityDescription(characterClass: CharacterClass): string {
  return CLASS_PERSONALITIES[characterClass];
}

/**
 * Format the full character title (e.g., "Grimjaw the Warrior").
 */
export function formatCharacterTitle(name: string, characterClass: CharacterClass): string {
  const classTitle = characterClass.charAt(0).toUpperCase() + characterClass.slice(1);
  return `${name} the ${classTitle}`;
}

/**
 * Generate perception traits for a character with variance from class defaults.
 * Variance is ±1, clamped to valid range [-2, 2].
 */
export function generateTraits(
  characterClass: CharacterClass,
  rng: RNG
): PerceptionTraits {
  const defaults = CLASS_TRAIT_DEFAULTS[characterClass];

  // Variance: -1, 0, or +1 (using RNG which returns [0, 1))
  const braveryVariance = Math.floor(rng() * 3) - 1; // -1 to 1 inclusive
  const observantVariance = Math.floor(rng() * 3) - 1;

  return {
    bravery: Math.max(-2, Math.min(2, defaults.bravery + braveryVariance)),
    observant: Math.max(-2, Math.min(2, defaults.observant + observantVariance)),
  };
}
