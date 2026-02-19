import { describe, it, expect } from 'vitest';
import { formatPerceptionsForPrompt } from '../../ai/decision-context';
import type { Perception } from '../perception-types';
import type { EntityId } from '../scheduler';

describe('formatPerceptionsForPrompt', () => {
  it('should format self health perception', () => {
    const perceptions: Perception[] = [
      { type: 'self_health', band: 'wounded' },
    ];

    const result = formatPerceptionsForPrompt(perceptions, 'warrior');

    expect(result).toContain("I've had worse");
  });

  it('should format enemy health perception', () => {
    const perceptions: Perception[] = [
      { type: 'enemy_health', entityId: 'rat-1' as EntityId, band: 'nearly_dead' },
    ];

    const result = formatPerceptionsForPrompt(perceptions, 'warrior');

    expect(result).toContain('One more blow');
  });

  it('should format multiple perceptions', () => {
    const perceptions: Perception[] = [
      { type: 'self_health', band: 'badly_hurt' },
      { type: 'enemy_health', entityId: 'rat-1' as EntityId, band: 'wounded' },
    ];

    const result = formatPerceptionsForPrompt(perceptions, 'rogue');

    expect(result).toContain('Getting rough');
    expect(result).toContain("It's feeling that");
  });

  it('should return empty string for no perceptions', () => {
    const result = formatPerceptionsForPrompt([], 'warrior');
    expect(result).toBe('');
  });

  it('should format perceptions with header', () => {
    const perceptions: Perception[] = [
      { type: 'self_health', band: 'wounded' },
    ];

    const result = formatPerceptionsForPrompt(perceptions, 'warrior');

    expect(result).toContain('PERCEPTIONS:');
  });

  it('should skip perceptions with no text', () => {
    const perceptions: Perception[] = [
      { type: 'self_health', band: 'healthy' }, // Returns null (not interesting)
      { type: 'self_health', band: 'wounded' }, // Has text
    ];

    const result = formatPerceptionsForPrompt(perceptions, 'warrior');

    expect(result).toContain("I've had worse");
    // Should only have one bullet point
    const bulletCount = (result.match(/^- /gm) || []).length;
    expect(bulletCount).toBe(1);
  });
});
