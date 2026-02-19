import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NarrativeDM, type PersonalityType } from '../narrative-dm';
import { GameEventEmitter, EventType, createEvent } from '../../engine/events';
import type { GameState } from '../../engine/state';

describe('NarrativeDM', () => {
  let eventEmitter: GameEventEmitter;
  let narrativeDM: NarrativeDM;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch globally
    mockFetch = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = mockFetch as any;

    // Default: successful response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ narration: 'The hero strikes true.' }),
    } as Response);

    eventEmitter = new GameEventEmitter();
  });

  describe('initialization', () => {
    it('should initialize with bardic personality by default', () => {
      narrativeDM = new NarrativeDM(eventEmitter);
      expect(narrativeDM.getPersonality()).toBe('bardic');
    });

    it('should initialize with specified personality', () => {
      narrativeDM = new NarrativeDM(eventEmitter, 'sardonic');
      expect(narrativeDM.getPersonality()).toBe('sardonic');
    });

    it('should start with empty narrations', () => {
      narrativeDM = new NarrativeDM(eventEmitter);
      expect(narrativeDM.getNarrations()).toEqual([]);
    });
  });

  describe('event handling', () => {
    it('should call API with correct structured data', async () => {
      narrativeDM = new NarrativeDM(eventEmitter, 'bardic');

      const mockState = {
        turn: 10,
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
        { damage: 18, isCritical: true }
      );

      eventEmitter.emit(event);

      // Wait for async generation
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockFetch).toHaveBeenCalledWith('/api/generate-narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"eventType":"combat.kill"'),
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toMatchObject({
        eventType: EventType.KILL,
        personality: 'bardic',
        turn: 10,
        entities: [
          { name: 'Throk', type: 'Crawler', hp: 45, maxHp: 60 },
          { name: 'Goblin', type: 'Monster', hp: 0, maxHp: 20 },
        ],
        metadata: { damage: 18, isCritical: true },
      });
    });

    it('should add narration to history on success', async () => {
      narrativeDM = new NarrativeDM(eventEmitter);

      const mockState = { turn: 5, entities: {}, eventEmitter } as unknown as GameState;
      const event = createEvent(EventType.AREA_ENTERED, mockState, [], { areaId: 'dungeon-1' });

      eventEmitter.emit(event);
      await new Promise(resolve => setTimeout(resolve, 100));

      const narrations = narrativeDM.getNarrations();
      expect(narrations).toHaveLength(1);
      expect(narrations[0]).toMatchObject({
        text: 'The hero strikes true.',
        eventType: EventType.AREA_ENTERED,
        turn: 5,
      });
      expect(narrations[0].id).toBeDefined();
      expect(narrations[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const onError = vi.fn();
      narrativeDM = new NarrativeDM(eventEmitter, 'bardic', { onError });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'AI generation failed' }),
      } as Response);

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;
      const event = createEvent(EventType.KILL, mockState, [], {});

      eventEmitter.emit(event);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Narration should NOT be added
      expect(narrativeDM.getNarrations()).toHaveLength(0);

      // Error callback should be called once
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith('Narration temporarily unavailable');
    });

    it('should not call error callback on subsequent errors', async () => {
      const onError = vi.fn();
      narrativeDM = new NarrativeDM(eventEmitter, 'bardic', { onError });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service unavailable', retryable: true }),
      } as Response);

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;

      // Emit multiple events
      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));

      await new Promise(resolve => setTimeout(resolve, 200));

      // Error callback should only be called once
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors', async () => {
      narrativeDM = new NarrativeDM(eventEmitter);

      mockFetch.mockRejectedValue(new Error('Network request failed'));

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;
      const event = createEvent(EventType.KILL, mockState, [], {});

      eventEmitter.emit(event);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Narration should NOT be added
      expect(narrativeDM.getNarrations()).toHaveLength(0);
    });

    it('should handle invalid API response format', async () => {
      const onError = vi.fn();
      narrativeDM = new NarrativeDM(eventEmitter, 'bardic', { onError });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ foo: 'bar' }), // Missing 'narration' field
      } as Response);

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;
      const event = createEvent(EventType.KILL, mockState, [], {});

      eventEmitter.emit(event);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Narration should NOT be added
      expect(narrativeDM.getNarrations()).toHaveLength(0);

      // Error callback should be called
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith('Narration temporarily unavailable');
    });

    it('should reset error state after successful narration', async () => {
      const onError = vi.fn();
      narrativeDM = new NarrativeDM(eventEmitter, 'bardic', { onError });

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;

      // First event fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      } as Response);

      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledTimes(1);

      // Second event succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ narration: 'Success!' }),
      } as Response);

      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Third event fails again - error should be shown again
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      } as Response);

      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Error callback should be called twice total (once for first error, once for third error)
      expect(onError).toHaveBeenCalledTimes(2);
    });
  });

  describe('FIFO eviction', () => {
    it('should evict oldest narrations when exceeding max capacity', async () => {
      narrativeDM = new NarrativeDM(eventEmitter);

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;

      // Emit 102 events (max is 100)
      for (let i = 0; i < 102; i++) {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ narration: `Narration ${i}` }),
        } as Response);

        eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      await new Promise(resolve => setTimeout(resolve, 1200)); // Increased from 200 to 1200

      const narrations = narrativeDM.getNarrations();
      expect(narrations).toHaveLength(100);

      // First narration should be "Narration 2" (0 and 1 evicted)
      expect(narrations[0].text).toBe('Narration 2');
      // Last narration should be "Narration 101"
      expect(narrations[99].text).toBe('Narration 101');
    });
  });

  describe('personality switching', () => {
    it('should use new personality for future narrations', async () => {
      narrativeDM = new NarrativeDM(eventEmitter, 'bardic');

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;

      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockFetch.mock.calls[0][1].body).toContain('"personality":"bardic"');

      // Switch personality
      narrativeDM.setPersonality('sardonic');

      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockFetch.mock.calls[1][1].body).toContain('"personality":"sardonic"');
    });
  });

  describe('clearNarrations', () => {
    it('should clear all narrations', async () => {
      narrativeDM = new NarrativeDM(eventEmitter);

      const mockState = { turn: 1, entities: {}, eventEmitter } as unknown as GameState;

      // Add some narrations
      eventEmitter.emit(createEvent(EventType.KILL, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));
      eventEmitter.emit(createEvent(EventType.AREA_ENTERED, mockState, [], {}));
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(narrativeDM.getNarrations()).toHaveLength(2);

      // Clear all narrations
      narrativeDM.clearNarrations();

      expect(narrativeDM.getNarrations()).toHaveLength(0);
    });
  });
});
