import { describe, it, expect } from 'vitest';
import { ActionSchema, EntitySchema, MonsterTypeIdSchema } from '../types';

describe('ActionSchema', () => {
  it('accepts action with aiMetadata', () => {
    const result = ActionSchema.safeParse({
      action: 'move',
      direction: 'north',
      reasoning: 'Moving toward enemy',
      aiMetadata: {
        durationMs: 1500,
        outputTokens: 25,
        modelId: 'claude-3-haiku',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiMetadata?.durationMs).toBe(1500);
    }
  });

  it('accepts action without aiMetadata', () => {
    const result = ActionSchema.safeParse({
      action: 'wait',
      reasoning: 'No enemies nearby',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiMetadata).toBeUndefined();
    }
  });
});

describe('RangedAttackAction', () => {
  it('parses valid ranged_attack action', () => {
    const action = {
      action: 'ranged_attack',
      direction: 'north',
      distance: 3,
      reasoning: 'Shooting goblin',
    };
    const result = ActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it('parses ranged_attack with optional targetName', () => {
    const action = {
      action: 'ranged_attack',
      direction: 'northeast',
      distance: 5,
      targetName: 'Goblin',
      reasoning: 'Shooting the goblin',
    };
    const result = ActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it('parses ranged_attack with preRolledD20', () => {
    const action = {
      action: 'ranged_attack',
      direction: 'south',
      distance: 2,
      reasoning: 'Player shot',
      preRolledD20: 15,
    };
    const result = ActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it('rejects ranged_attack with invalid direction', () => {
    const action = {
      action: 'ranged_attack',
      direction: 'up',
      distance: 3,
      reasoning: 'Invalid',
    };
    const result = ActionSchema.safeParse(action);
    expect(result.success).toBe(false);
  });

  it('rejects ranged_attack with non-positive distance', () => {
    const action = {
      action: 'ranged_attack',
      direction: 'north',
      distance: 0,
      reasoning: 'Invalid',
    };
    const result = ActionSchema.safeParse(action);
    expect(result.success).toBe(false);
  });
});

describe('MonsterTypeIdSchema', () => {
  it('accepts goblin_archer as valid monster type', () => {
    const result = MonsterTypeIdSchema.safeParse('goblin_archer');
    expect(result.success).toBe(true);
  });
});

describe('Entity offhand slot', () => {
  it('allows equippedOffhand to be null', () => {
    const entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5, y: 5,
      areaId: 'area-1',
      hp: 10, maxHp: 10,
      name: 'Test',
      attack: 2, defense: 0, speed: 100,
      char: '@',
      equippedOffhand: null,
    };
    const result = EntitySchema.safeParse(entity);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.equippedOffhand).toBeNull();
    }
  });

  it('allows equippedOffhand with item instance', () => {
    const entity = {
      id: 'crawler-1',
      type: 'crawler',
      x: 5, y: 5,
      areaId: 'area-1',
      hp: 10, maxHp: 10,
      name: 'Test',
      attack: 2, defense: 0, speed: 100,
      char: '@',
      equippedOffhand: {
        id: 'quiver-1',
        templateId: 'leather_quiver',
        x: 0, y: 0,
        areaId: 'area-1',
      },
    };
    const result = EntitySchema.safeParse(entity);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.equippedOffhand).toEqual({
        id: 'quiver-1',
        templateId: 'leather_quiver',
        x: 0, y: 0,
        areaId: 'area-1',
      });
    }
  });
});
