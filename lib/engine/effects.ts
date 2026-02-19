/**
 * Effect Types, Schemas, and Templates
 *
 * Implements duration-based effects (buffs, debuffs, status conditions) for
 * the Crawlerverse game engine. Effects use a mechanic-based data model where
 * each effect is defined by its mechanic type + parameters, making the system
 * extensible without hardcoding per-effect behavior.
 *
 * Effect mechanics:
 * - stat_modifier: Temporarily modifies attack, defense, speed, or visionRadius
 * - damage_over_time: Applies HP delta each tick (positive=damage, negative=heal)
 * - skip_turn: Forces the entity to waste their action
 * - forced_movement: Moves entity away from the effect source
 * - ai_override: Forces monster AI to target the source entity
 * - visibility: Hides entity from enemy FOV and targeting
 *
 * Duration model: per-action (decrements each time the affected entity acts).
 * Stacking: refresh (same name resets duration, no duplicates).
 *
 * @see docs/plans/2026-02-18-effects-system-design.md
 */

import { z } from 'zod';
import type { Entity } from './types';

// --- Effect Mechanic Schemas (Discriminated Union) ---

const StatModifierMechanicSchema = z.object({
  type: z.literal('stat_modifier'),
  stat: z.enum(['attack', 'defense', 'speed', 'visionRadius']),
  delta: z.number().int(),
});

const DamageOverTimeMechanicSchema = z.object({
  type: z.literal('damage_over_time'),
  damage: z.number().int(),
});

const SkipTurnMechanicSchema = z.object({
  type: z.literal('skip_turn'),
});

const ForcedMovementMechanicSchema = z.object({
  type: z.literal('forced_movement'),
  direction: z.enum(['away_from_source']),
});

const AiOverrideMechanicSchema = z.object({
  type: z.literal('ai_override'),
  behavior: z.enum(['target_source']),
});

const VisibilityMechanicSchema = z.object({
  type: z.literal('visibility'),
  hidden: z.literal(true),
});

/**
 * Discriminated union of all effect mechanic types.
 * The `type` field determines which parameters are required.
 *
 * @example
 * ```typescript
 * const mechanic: EffectMechanic = { type: 'stat_modifier', stat: 'attack', delta: 2 };
 * const dot: EffectMechanic = { type: 'damage_over_time', damage: 3 };
 * ```
 */
export const EffectMechanicSchema = z.discriminatedUnion('type', [
  StatModifierMechanicSchema,
  DamageOverTimeMechanicSchema,
  SkipTurnMechanicSchema,
  ForcedMovementMechanicSchema,
  AiOverrideMechanicSchema,
  VisibilityMechanicSchema,
]);
export type EffectMechanic = z.infer<typeof EffectMechanicSchema>;

// --- Active Effect Schema ---

/**
 * Source of an effect — tracks who/what applied it.
 * entityId is optional because environmental effects (traps, shrines) have no source entity.
 */
const EffectSourceSchema = z.object({
  entityId: z.string().min(1).optional(),
  label: z.string().min(1),
});

/**
 * An active effect on an entity.
 *
 * - id: Unique instance ID for targeted removal
 * - name: Display name and stacking key (same name = refresh, not stack)
 * - mechanic: Determines the effect's behavior
 * - duration: Actions remaining before expiry (decrements per-action)
 * - source: Who/what applied the effect
 *
 * @example
 * ```typescript
 * const effect: ActiveEffect = {
 *   id: 'eff-1',
 *   name: 'Poisoned',
 *   mechanic: { type: 'damage_over_time', damage: 3 },
 *   duration: 5,
 *   source: { entityId: 'spider-1', label: 'spider bite' },
 * };
 * ```
 */
export const ActiveEffectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mechanic: EffectMechanicSchema,
  duration: z.number().int().positive(),
  source: EffectSourceSchema,
});
export type ActiveEffect = Readonly<z.infer<typeof ActiveEffectSchema>>;

// --- Effect Template ---

/**
 * An effect template defines the default configuration for an effect.
 * Used by createActiveEffect() to instantiate effects with consistent parameters.
 */
interface EffectTemplate {
  readonly name: string;
  readonly mechanic: EffectMechanic;
  readonly duration: number;
}

// --- Effect Templates Registry ---

/**
 * Registry of all effect templates.
 * Templates define default mechanic parameters and durations.
 * Effects are organized by ID for O(1) lookup.
 *
 * Templates by category:
 * - 3 damage_over_time: poisoned, burning, regenerating
 * - 4 stat_modifier: slowed, weakened, blessed, blinded
 * - 1 skip_turn: stunned
 * - 1 forced_movement: feared
 * - 1 ai_override: taunted
 * - 1 visibility: invisible
 */
const _EFFECT_TEMPLATES = {
  poisoned: {
    name: 'Poisoned',
    mechanic: { type: 'damage_over_time', damage: 3 } as const,
    duration: 5,
  },
  burning: {
    name: 'Burning',
    mechanic: { type: 'damage_over_time', damage: 2 } as const,
    duration: 3,
  },
  regenerating: {
    name: 'Regenerating',
    mechanic: { type: 'damage_over_time', damage: -3 } as const,
    duration: 4,
  },
  slowed: {
    name: 'Slowed',
    mechanic: { type: 'stat_modifier', stat: 'speed', delta: -30 } as const,
    duration: 3,
  },
  weakened: {
    name: 'Weakened',
    mechanic: { type: 'stat_modifier', stat: 'attack', delta: -2 } as const,
    duration: 4,
  },
  blessed: {
    name: 'Blessed',
    mechanic: { type: 'stat_modifier', stat: 'attack', delta: 2 } as const,
    duration: 5,
  },
  blinded: {
    name: 'Blinded',
    mechanic: { type: 'stat_modifier', stat: 'visionRadius', delta: -4 } as const,
    duration: 3,
  },
  stunned: {
    name: 'Stunned',
    mechanic: { type: 'skip_turn' } as const,
    duration: 2,
  },
  feared: {
    name: 'Feared',
    mechanic: { type: 'forced_movement', direction: 'away_from_source' } as const,
    duration: 3,
  },
  taunted: {
    name: 'Taunted',
    mechanic: { type: 'ai_override', behavior: 'target_source' } as const,
    duration: 3,
  },
  invisible: {
    name: 'Invisible',
    mechanic: { type: 'visibility', hidden: true } as const,
    duration: 5,
  },
} as const satisfies Record<string, EffectTemplate>;

/**
 * Immutable effect template registry.
 * Frozen to prevent accidental mutation of template definitions.
 */
export const EFFECT_TEMPLATES: Readonly<typeof _EFFECT_TEMPLATES> = Object.freeze(_EFFECT_TEMPLATES);

/**
 * Valid effect template IDs.
 * Derived from EFFECT_TEMPLATES keys for type safety.
 */
export type EffectTemplateId = keyof typeof _EFFECT_TEMPLATES;

// --- Factory ---

/** Auto-incrementing counter for effect instance IDs. */
let _effectIdCounter = 0;

/**
 * Reset the effect ID counter to 0.
 * Call this in test setup (beforeEach) to ensure deterministic IDs across tests.
 */
export function resetEffectIdCounter(): void {
  _effectIdCounter = 0;
}

/**
 * Create an active effect instance from a template.
 *
 * @param templateId - ID of the effect template (e.g., 'poisoned', 'blessed')
 * @param source - Who/what applied the effect
 * @param durationOverride - Optional duration that overrides the template default
 * @returns A validated ActiveEffect instance
 * @throws Error if templateId is not a known template
 *
 * @example
 * ```typescript
 * // Basic usage
 * const poison = createActiveEffect('poisoned', { label: 'spider bite' });
 *
 * // With source entity (needed for feared/taunted)
 * const taunt = createActiveEffect('taunted', {
 *   entityId: 'player-1',
 *   label: 'war cry',
 * });
 *
 * // With custom duration
 * const longPoison = createActiveEffect('poisoned', { label: 'venom' }, 10);
 * ```
 */
export function createActiveEffect(
  templateId: EffectTemplateId,
  source: { entityId?: string; label: string },
  durationOverride?: number,
): ActiveEffect {
  const template = _EFFECT_TEMPLATES[templateId];
  if (!template) {
    throw new Error(
      `Unknown effect template: '${templateId}'. ` +
      `Available templates: ${Object.keys(_EFFECT_TEMPLATES).join(', ')}`
    );
  }

  _effectIdCounter += 1;
  const id = `eff-${_effectIdCounter}`;

  const effect: ActiveEffect = {
    id,
    name: template.name,
    mechanic: { ...template.mechanic },
    duration: durationOverride ?? template.duration,
    source: {
      ...(source.entityId !== undefined ? { entityId: source.entityId } : {}),
      label: source.label,
    },
  };

  return ActiveEffectSchema.parse(effect);
}

// --- Application, Removal, and Query Helpers ---

/**
 * Entity augmented with the activeEffects field.
 * Used internally by effect helpers to access the optional activeEffects array
 * on entities in a type-safe way.
 */
type EntityWithEffects = Entity & { activeEffects?: readonly ActiveEffect[] };

/**
 * Apply an effect to an entity from a template.
 *
 * Stacking rule: **refresh**. If the entity already has an active effect with
 * the same `name`, the existing effect's duration and source are updated
 * (no duplicate). Otherwise a new effect is appended.
 *
 * @param entity - The entity to apply the effect to
 * @param templateId - Effect template ID (e.g., 'poisoned', 'blessed')
 * @param source - Who/what applied the effect
 * @param durationOverride - Optional duration that overrides the template default
 * @returns A **new** entity object with updated activeEffects (immutable)
 *
 * @example
 * ```typescript
 * const poisoned = applyEffect(crawler, 'poisoned', {
 *   entityId: 'spider-1',
 *   label: 'spider bite',
 * });
 * ```
 */
export function applyEffect(
  entity: Entity,
  templateId: EffectTemplateId,
  source: { entityId?: string; label: string },
  durationOverride?: number,
): Entity {
  const ent = entity as EntityWithEffects;
  const existing = ent.activeEffects ?? [];
  const template = EFFECT_TEMPLATES[templateId];

  const matchIdx = existing.findIndex((e) => e.name === template.name);

  let updated: ActiveEffect[];

  if (matchIdx >= 0) {
    // Refresh: update duration and source on the existing effect
    const old = existing[matchIdx];
    const refreshed: ActiveEffect = {
      ...old,
      duration: durationOverride ?? template.duration,
      source: {
        ...(source.entityId !== undefined ? { entityId: source.entityId } : {}),
        label: source.label,
      },
    };
    updated = [...existing.slice(0, matchIdx), refreshed, ...existing.slice(matchIdx + 1)];
  } else {
    // New effect
    const newEffect = createActiveEffect(templateId, source, durationOverride);
    updated = [...existing, newEffect];
  }

  return { ...ent, activeEffects: updated } as Entity;
}

/**
 * Remove a specific effect from an entity by its unique instance ID.
 * No-op if the effect is not found.
 *
 * @param entity - The entity to remove the effect from
 * @param effectId - The unique `id` of the ActiveEffect instance
 * @returns A **new** entity object with the effect removed (immutable)
 */
export function removeEffect(entity: Entity, effectId: string): Entity {
  const ent = entity as EntityWithEffects;
  const existing = ent.activeEffects ?? [];
  const filtered = existing.filter((e) => e.id !== effectId);
  return { ...ent, activeEffects: filtered } as Entity;
}

/**
 * Remove ALL effects whose `source.entityId` matches the given ID.
 * Used for cleaning up when a source entity dies (e.g., feared monster dies,
 * so the fear effect is removed from all affected entities).
 *
 * @param entity - The entity to clean up
 * @param sourceEntityId - The entity ID of the source to remove effects from
 * @returns A **new** entity object with matching effects removed (immutable)
 */
export function removeEffectsFromSource(entity: Entity, sourceEntityId: string): Entity {
  const ent = entity as EntityWithEffects;
  const existing = ent.activeEffects ?? [];
  const filtered = existing.filter((e) => e.source.entityId !== sourceEntityId);
  return { ...ent, activeEffects: filtered } as Entity;
}

/**
 * Check whether an entity currently has an active effect with the given name.
 *
 * @param entity - The entity to check
 * @param effectName - The display name of the effect (e.g., 'Poisoned', 'Stunned')
 * @returns true if the entity has an active effect with that name
 */
export function hasEffect(entity: Entity, effectName: string): boolean {
  const ent = entity as EntityWithEffects;
  const existing = ent.activeEffects ?? [];
  return existing.some((e) => e.name === effectName);
}

/**
 * Check if an entity has an active effect by template ID.
 * Safer than hasEffect() since template IDs are lowercase keys
 * while effect names are Title Case — prevents casing mismatches.
 */
export function hasEffectById(entity: Entity, templateId: EffectTemplateId): boolean {
  const template = EFFECT_TEMPLATES[templateId];
  return hasEffect(entity, template.name);
}

/**
 * Get all active effects on an entity that match a given mechanic type.
 *
 * @param entity - The entity to query
 * @param mechanicType - The mechanic type to filter by (e.g., 'damage_over_time', 'stat_modifier')
 * @returns Array of matching ActiveEffect instances (empty array if none)
 *
 * @example
 * ```typescript
 * const dots = getEffectsByMechanic(crawler, 'damage_over_time');
 * const totalDamage = dots.reduce((sum, e) => {
 *   return e.mechanic.type === 'damage_over_time' ? sum + e.mechanic.damage : sum;
 * }, 0);
 * ```
 */
export function getEffectsByMechanic(
  entity: Entity,
  mechanicType: EffectMechanic['type'],
): ActiveEffect[] {
  const ent = entity as EntityWithEffects;
  const existing = ent.activeEffects ?? [];
  return existing.filter((e) => e.mechanic.type === mechanicType);
}

// --- Tick Processing ---

interface TickEffectsResult {
  entity: Entity;
  messages: { text: string }[];
  died: boolean;
}

/**
 * Process post-action effect ticking for an entity.
 *
 * Phase 1: Apply damage_over_time effects (positive = damage, negative = heal).
 * Phase 2: Decrement all durations by 1, remove expired effects.
 *
 * @returns Updated entity, messages generated, and whether entity died from DoT.
 */
export function tickEffects(entity: Entity): TickEffectsResult {
  const effects = [...((entity as EntityWithEffects).activeEffects ?? [])];
  const messages: { text: string }[] = [];
  let hp = entity.hp;
  let died = false;

  // Phase 1: Apply DoT effects
  for (const effect of effects) {
    if (effect.mechanic.type === 'damage_over_time') {
      const { damage } = effect.mechanic;
      if (damage > 0) {
        hp = Math.max(0, hp - damage);
        messages.push({ text: `${entity.name} takes ${damage} ${effect.name} damage.` });
        if (hp <= 0 && !died) {
          died = true;
          messages.push({ text: `${entity.name} succumbed to ${effect.name}.` });
        }
      } else if (damage < 0) {
        const heal = Math.abs(damage);
        const oldHp = hp;
        hp = Math.min(entity.maxHp, hp + heal);
        const actualHeal = hp - oldHp;
        if (actualHeal > 0) {
          messages.push({ text: `${entity.name} regenerates ${actualHeal} HP.` });
        }
      }
    }
  }

  // Phase 2: Decrement durations and remove expired
  const remaining: ActiveEffect[] = [];
  for (const effect of effects) {
    const newDuration = effect.duration - 1;
    if (newDuration <= 0) {
      messages.push({ text: `${effect.name} wears off ${entity.name}.` });
    } else {
      remaining.push({ ...effect, duration: newDuration });
    }
  }

  return {
    entity: { ...entity, hp, activeEffects: remaining } as Entity,
    messages,
    died,
  };
}
