import type { ActiveEffect } from '../../lib/engine/effects';

const EFFECT_ICONS: Record<string, string> = {
  Poisoned: '💀', Burning: '🔥', Regenerating: '💚', Slowed: '🐌',
  Weakened: '⬇️', Blessed: '✨', Blinded: '👁️', Stunned: '💫',
  Feared: '😨', Taunted: '😤', Invisible: '👻',
};

const EFFECT_CATEGORIES: Record<string, 'buff' | 'debuff' | 'dot' | 'control'> = {
  Blessed: 'buff', Regenerating: 'buff', Invisible: 'buff',
  Slowed: 'debuff', Weakened: 'debuff', Blinded: 'debuff',
  Poisoned: 'dot', Burning: 'dot',
  Stunned: 'control', Feared: 'control', Taunted: 'control',
};

const CATEGORY_COLORS = {
  buff: 'var(--success)',
  debuff: 'var(--danger)',
  dot: 'var(--danger)',
  control: 'var(--ai)',
} as const;

export function EffectPills({ effects }: { effects: ActiveEffect[] }) {
  if (effects.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {effects.map(effect => {
        const category = EFFECT_CATEGORIES[effect.name] ?? 'debuff';
        const color = CATEGORY_COLORS[category];
        const icon = EFFECT_ICONS[effect.name] ?? '⚡';
        return (
          <span
            key={effect.id}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[0.6rem] font-medium ${
              category === 'dot' ? 'animate-pulse' : ''
            }`}
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
              color,
            }}
            title={`${effect.name} (${effect.duration} turns remaining) — ${effect.source.label}`}
          >
            <span aria-hidden="true">{icon}</span>
            {effect.name} ({effect.duration})
          </span>
        );
      })}
    </div>
  );
}
