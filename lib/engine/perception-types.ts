/**
 * Perception Types
 *
 * Types and schemas for the character perception system.
 * Perceptions provide tactical hints through character observations.
 */

import { z } from 'zod';
import type { EntityId } from './scheduler';

// --- Health Bands ---

export const HEALTH_BANDS = [
  'healthy',
  'wounded',
  'badly_hurt',
  'nearly_dead',
  'deaths_door',
] as const;

export type HealthBand = (typeof HEALTH_BANDS)[number];

// --- Quality Bands ---

export const QUALITY_BANDS = [
  'masterwork',
  'good',
  'average',
  'crude',
  'junk',
] as const;

export type QualityBand = (typeof QUALITY_BANDS)[number];

// --- Comparison Bands ---

export const COMPARISON_BANDS = [
  'far_superior',
  'better',
  'similar',
  'worse',
  'much_worse',
] as const;

export type ComparisonBand = (typeof COMPARISON_BANDS)[number];

// --- Perception Traits ---

export interface PerceptionTraits {
  /** -2 to +2: affects health danger thresholds (brave notices danger later) */
  readonly bravery: number;
  /** -2 to +2: affects item/detail detection granularity */
  readonly observant: number;
}

export const PerceptionTraitsSchema = z.object({
  bravery: z.number().int().min(-2).max(2),
  observant: z.number().int().min(-2).max(2),
});

// --- Combat Perceptions ---

export type CombatPerception =
  | {
      readonly type: 'enemy_health';
      readonly entityId: EntityId;
      readonly band: HealthBand;
    }
  | {
      readonly type: 'self_health';
      readonly band: HealthBand;
    }
  | {
      readonly type: 'relative_danger';
      readonly assessment: 'outmatched' | 'even' | 'advantage';
    };

// --- Equipment Perceptions ---

export type EquipmentPerception =
  | {
      readonly type: 'item_quality';
      readonly itemId: string;
      readonly quality: QualityBand;
    }
  | {
      readonly type: 'item_comparison';
      readonly itemId: string;
      readonly comparison: ComparisonBand;
    };

// --- Combined Perception Type ---

export type Perception = CombatPerception | EquipmentPerception;

export type PerceptionType = Perception['type'];

// --- Perception Priority (for UI display) ---

export const PERCEPTION_PRIORITY: PerceptionType[] = [
  'self_health',
  'relative_danger',
  'enemy_health',
  'item_comparison',
  'item_quality',
];
