/**
 * Perception Engine
 *
 * Generates perceptions from game state using thresholds modified by character traits.
 */

import type { CharacterClass } from './character';
import type {
  HealthBand,
  QualityBand,
  ComparisonBand,
  PerceptionTraits,
  Perception,
} from './perception-types';
import { PERCEPTION_PRIORITY } from './perception-types';
import type { Entity } from './types';
import {
  shouldEmitPerception,
  updateCooldowns,
  type PerceptionCooldowns,
} from './perception-cooldowns';
import type { EntityId } from './scheduler';

// --- Ground Item placeholder (items on the dungeon floor) ---

export interface GroundItem {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly templateId: string;
}

// --- Health Band Thresholds ---

// Base thresholds (percentage of max HP)
const HEALTH_THRESHOLDS = {
  healthy: 75, // > 75%
  wounded: 50, // 51-75%
  badly_hurt: 25, // 26-50%
  nearly_dead: 10, // 11-25%
  deaths_door: 0, // 1-10%
};

/**
 * Calculate health band from current/max HP with bravery modifier.
 * Bravery shifts thresholds by 5% per point (positive = notice danger later).
 */
export function getHealthBand(
  currentHp: number,
  maxHp: number,
  braveryModifier: number
): HealthBand {
  const percentage = (currentHp / maxHp) * 100;
  const shift = braveryModifier * 5; // 5% per point

  if (percentage > HEALTH_THRESHOLDS.healthy - shift) return 'healthy';
  if (percentage > HEALTH_THRESHOLDS.wounded - shift) return 'wounded';
  if (percentage > HEALTH_THRESHOLDS.badly_hurt - shift) return 'badly_hurt';
  if (percentage > HEALTH_THRESHOLDS.nearly_dead - shift) return 'nearly_dead';
  return 'deaths_door';
}

/**
 * Get self health perception using character's bravery trait.
 */
export function getSelfHealthBand(
  currentHp: number,
  maxHp: number,
  traits: PerceptionTraits
): HealthBand {
  return getHealthBand(currentHp, maxHp, traits.bravery);
}

/**
 * Get enemy health perception (no bravery modifier - objective observation).
 */
export function getEnemyHealthBand(
  currentHp: number,
  maxHp: number,
  _traits: PerceptionTraits
): HealthBand {
  return getHealthBand(currentHp, maxHp, 0);
}

// --- Equipment Quality Thresholds ---

/**
 * Get item quality perception based on stat vs baseline.
 * Baseline represents an "average" item of this type.
 */
export function getItemQualityBand(
  itemStat: number,
  baseline: number,
  _traits: PerceptionTraits
): QualityBand {
  const diff = itemStat - baseline;

  if (diff >= 3) return 'masterwork';
  if (diff >= 1) return 'good';
  if (diff >= 0) return 'average'; // diff === 0
  if (diff >= -2) return 'crude';
  return 'junk';
}

/**
 * Get item comparison perception vs currently equipped item.
 * Observant trait affects detection granularity.
 */
export function getItemComparisonBand(
  newItemStat: number,
  currentItemStat: number,
  traits: PerceptionTraits
): ComparisonBand {
  const diff = newItemStat - currentItemStat;

  // Observant affects minimum noticeable difference
  // Neutral (0): notices ±1 differences (minNoticeable = 1)
  // High observant (+2): notices ±1 differences (floor at 1)
  // Low observant (-2): only notices ±3 differences (minNoticeable = 3)
  const minNoticeable = Math.max(1, 1 - traits.observant);

  if (diff >= 3) return 'far_superior';
  if (diff >= minNoticeable) return 'better';
  if (diff > -minNoticeable) return 'similar';
  if (diff > -3) return 'worse';
  return 'much_worse';
}

// --- Text Templates ---

const ENEMY_HEALTH_TEXT: Record<CharacterClass, Partial<Record<HealthBand, string>>> = {
  warrior: {
    nearly_dead: "One more blow will finish it!",
    badly_hurt: "It's weakening!",
    wounded: "I've drawn blood.",
  },
  rogue: {
    nearly_dead: "Easy pickings now...",
    badly_hurt: "Almost there...",
    wounded: "It's feeling that.",
  },
  mage: {
    nearly_dead: "Insignificant.",
    badly_hurt: "Weakening fast.",
    wounded: "Adequate damage.",
  },
  cleric: {
    nearly_dead: "Nearly done.",
    badly_hurt: "Keep the faith.",
    wounded: "Progress.",
  },
};

const SELF_HEALTH_TEXT: Record<CharacterClass, Partial<Record<HealthBand, string>>> = {
  warrior: {
    deaths_door: "I won't fall here!",
    nearly_dead: "Just a scratch!",
    badly_hurt: "Pain fuels me!",
    wounded: "I've had worse.",
  },
  rogue: {
    deaths_door: "Need to get out...",
    nearly_dead: "This is bad...",
    badly_hurt: "Getting rough...",
    wounded: "Took a hit.",
  },
  mage: {
    deaths_door: "Unacceptable...",
    nearly_dead: "Must focus...",
    badly_hurt: "Concentration...",
    wounded: "Minor setback.",
  },
  cleric: {
    deaths_door: "Light preserve me...",
    nearly_dead: "Stay strong...",
    badly_hurt: "Endure...",
    wounded: "A test of faith.",
  },
};

const ITEM_COMPARISON_TEXT: Record<CharacterClass, Partial<Record<ComparisonBand, string>>> = {
  warrior: {
    far_superior: "Now THIS is a weapon!",
    better: "Better than mine.",
    worse: "My gear is better.",
    much_worse: "Worthless junk.",
  },
  rogue: {
    far_superior: "This changes things...",
    better: "An upgrade.",
    worse: "I'll pass.",
    much_worse: "Garbage.",
  },
  mage: {
    far_superior: "Excellent find.",
    better: "Marginally better.",
    worse: "Inferior.",
    much_worse: "Utterly useless.",
  },
  cleric: {
    far_superior: "A blessing!",
    better: "This will help.",
    worse: "Mine serves better.",
    much_worse: "Leave it.",
  },
};

const ITEM_QUALITY_TEXT: Record<CharacterClass, Partial<Record<QualityBand, string>>> = {
  warrior: {
    masterwork: "Fine craftsmanship!",
    good: "Well-made.",
    crude: "Crude work.",
    junk: "Barely holds together.",
  },
  rogue: {
    masterwork: "Quality gear...",
    good: "Not bad.",
    crude: "Rough work.",
    junk: "Worthless.",
  },
  mage: {
    masterwork: "Exceptional quality.",
    good: "Adequate.",
    crude: "Substandard.",
    junk: "Refuse.",
  },
  cleric: {
    masterwork: "Blessed craft.",
    good: "Serviceable.",
    crude: "Humble work.",
    junk: "Beyond repair.",
  },
};

/**
 * Get display text for a perception, styled by character class.
 * Returns null if the perception is not "interesting" (healthy, average, similar).
 */
export function getPerceptionText(
  perception: Perception,
  characterClass: CharacterClass
): string | null {
  switch (perception.type) {
    case 'enemy_health':
      if (perception.band === 'healthy') return null;
      return ENEMY_HEALTH_TEXT[characterClass][perception.band] ?? null;

    case 'self_health':
      if (perception.band === 'healthy') return null;
      return SELF_HEALTH_TEXT[characterClass][perception.band] ?? null;

    case 'item_comparison':
      if (perception.comparison === 'similar') return null;
      return ITEM_COMPARISON_TEXT[characterClass][perception.comparison] ?? null;

    case 'item_quality':
      if (perception.quality === 'average') return null;
      return ITEM_QUALITY_TEXT[characterClass][perception.quality] ?? null;

    case 'relative_danger':
      // TODO: Add relative danger text templates (not in spec for Task 6)
      return null;

    default:
      return null;
  }
}

// --- Perception Context ---

export interface PerceptionContext {
  readonly crawler: Entity;
  readonly visibleEntities: readonly Entity[];
  readonly groundItems: readonly GroundItem[];
  readonly cooldowns: PerceptionCooldowns;
}

export interface PerceptionResult {
  readonly perceptions: readonly Perception[];
  readonly priority: Perception | null;
  readonly cooldowns: PerceptionCooldowns;
}

/**
 * Check if a perception is "interesting" (worth displaying).
 */
function isInteresting(perception: Perception): boolean {
  switch (perception.type) {
    case 'self_health':
      return perception.band !== 'healthy';
    case 'enemy_health':
      return perception.band !== 'healthy';
    case 'item_quality':
      return perception.quality !== 'average';
    case 'item_comparison':
      return perception.comparison !== 'similar';
    case 'relative_danger':
      return true;
    default:
      return false;
  }
}

/**
 * Generate all perceptions for a crawler based on current game context.
 */
export function generatePerceptions(context: PerceptionContext): PerceptionResult {
  const { crawler, visibleEntities, cooldowns } = context;
  const traits: PerceptionTraits = crawler.traits ?? { bravery: 0, observant: 0 };

  const allPerceptions: Perception[] = [];
  let updatedCooldowns = cooldowns;

  // 1. Self health perception
  const selfHealthBand = getSelfHealthBand(crawler.hp, crawler.maxHp, traits);
  const selfPerception: Perception = { type: 'self_health', band: selfHealthBand };

  if (isInteresting(selfPerception) && shouldEmitPerception(selfPerception, updatedCooldowns)) {
    allPerceptions.push(selfPerception);
    updatedCooldowns = updateCooldowns(selfPerception, updatedCooldowns);
  }

  // 2. Enemy health perceptions
  for (const entity of visibleEntities) {
    if (entity.type !== 'monster') continue;

    const enemyHealthBand = getEnemyHealthBand(entity.hp, entity.maxHp, traits);
    const enemyPerception: Perception = {
      type: 'enemy_health',
      entityId: entity.id as EntityId,
      band: enemyHealthBand,
    };

    if (isInteresting(enemyPerception) && shouldEmitPerception(enemyPerception, updatedCooldowns)) {
      allPerceptions.push(enemyPerception);
      updatedCooldowns = updateCooldowns(enemyPerception, updatedCooldowns);
    }
  }

  // TODO: Add item quality/comparison perceptions when ground items are supported

  // Find highest priority perception
  const priority = allPerceptions
    .sort((a, b) => {
      const aIndex = PERCEPTION_PRIORITY.indexOf(a.type);
      const bIndex = PERCEPTION_PRIORITY.indexOf(b.type);
      return aIndex - bIndex;
    })[0] ?? null;

  return {
    perceptions: allPerceptions,
    priority,
    cooldowns: updatedCooldowns,
  };
}
