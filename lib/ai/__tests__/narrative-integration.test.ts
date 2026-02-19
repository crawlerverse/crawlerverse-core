import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEventEmitter, EventType, createEvent } from '../../engine/events';
import type { GameState } from '../../engine/state';

// Mock AI SDK - must be hoisted before imports
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'The hero strikes true.',
    usage: { totalTokens: 10 },
  }),
}));

// Mock providers module
vi.mock('../providers', () => ({
  getProviderConfig: vi.fn().mockReturnValue({
    provider: 'gateway',
    model: 'anthropic/claude-3-haiku',
  }),
  getAIModel: vi.fn().mockReturnValue('mock-model'),
}));

// Import after mocks
import { NarrativeDM } from '../narrative-dm';

describe('Narrative Integration (Full API Flow)', () => {
  let eventEmitter: GameEventEmitter;
  let narrativeDM: NarrativeDM;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch to simulate API response
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ narration: 'The hero strikes true.' }),
    } as Response);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = mockFetch as any;

    eventEmitter = new GameEventEmitter();
    narrativeDM = new NarrativeDM(eventEmitter);
  });

  it('should generate narration for KILL event via API', async () => {
    const mockState = {
      turn: 1,
      floor: 1,
      entities: {},
      eventEmitter,
    } as unknown as GameState;

    const event = createEvent(
      EventType.KILL,
      mockState,
      [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'Throk', type: 'Crawler', hp: 45, maxHp: 60 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'Goblin', type: 'Monster', hp: 0, maxHp: 20 } as any,
      ],
      { damage: 15 }
    );

    eventEmitter.emit(event);

    // Wait for async generation
    await new Promise(resolve => setTimeout(resolve, 200));

    const narrations = narrativeDM.getNarrations();
    expect(narrations).toHaveLength(1);
    expect(narrations[0].eventType).toBe(EventType.KILL);
    expect(narrations[0].turn).toBe(1);
    expect(narrations[0].text).toBe('The hero strikes true.');
  });

  it('should generate narrations for multiple events', async () => {
    const mockState = {
      turn: 1,
      floor: 1,
      entities: {},
      eventEmitter,
    } as unknown as GameState;

    const killEvent = createEvent(EventType.KILL, mockState, [], {});
    const areaEvent = createEvent(EventType.AREA_ENTERED, mockState, [], { areaId: 'dark-chamber' });

    eventEmitter.emit(killEvent);
    eventEmitter.emit(areaEvent);

    await new Promise(resolve => setTimeout(resolve, 200));

    const narrations = narrativeDM.getNarrations();
    expect(narrations).toHaveLength(2);
    expect(narrations[0].eventType).toBe(EventType.KILL);
    expect(narrations[1].eventType).toBe(EventType.AREA_ENTERED);
  });

  it('should initialize with correct personality', async () => {
    const bardicDM = new NarrativeDM(eventEmitter, 'bardic');
    const sardonicDM = new NarrativeDM(eventEmitter, 'sardonic');

    expect(bardicDM.getPersonality()).toBe('bardic');
    expect(sardonicDM.getPersonality()).toBe('sardonic');
  });
});
