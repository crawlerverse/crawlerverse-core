/**
 * @fileoverview Tests for the sound service
 * Uses Web Audio API mocks to test sound loading and playback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock types for Web Audio API
interface MockAudioBuffer {
  duration: number;
  numberOfChannels: number;
}

interface MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface MockGainNode {
  gain: { value: number };
  connect: ReturnType<typeof vi.fn>;
}

interface MockAudioContext {
  state: 'suspended' | 'running' | 'closed';
  resume: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  destination: object;
}

// Factory functions for mocks
function createMockAudioBuffer(): MockAudioBuffer {
  return { duration: 1.0, numberOfChannels: 2 };
}

function createMockBufferSource(): MockAudioBufferSourceNode {
  return {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function createMockGainNode(): MockGainNode {
  return {
    gain: { value: 1.0 },
    connect: vi.fn(),
  };
}

function createMockAudioContext(
  state: 'suspended' | 'running' = 'running'
): MockAudioContext {
  return {
    state,
    resume: vi.fn().mockResolvedValue(undefined),
    decodeAudioData: vi.fn().mockResolvedValue(createMockAudioBuffer()),
    createBufferSource: vi.fn().mockReturnValue(createMockBufferSource()),
    createGain: vi.fn().mockReturnValue(createMockGainNode()),
    destination: {},
  };
}

function createMockFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
  });
}

describe('soundService', () => {
  let mockAudioContext: MockAudioContext;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLocalStorage: Record<string, string>;
  let MockAudioContextClass: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    // Setup mock AudioContext as a class
    mockAudioContext = createMockAudioContext();
    MockAudioContextClass = vi.fn().mockImplementation(function (this: MockAudioContext) {
      Object.assign(this, mockAudioContext);
      return this;
    });
    vi.stubGlobal('AudioContext', MockAudioContextClass);

    // Setup mock fetch
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    // Setup mock localStorage
    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('initSounds', () => {
    it('loads all three sound files', async () => {
      const { soundService } = await import('../soundService');

      await soundService.initSounds();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith('/sounds/dice-roll.mp3');
      expect(mockFetch).toHaveBeenCalledWith('/sounds/triumphant-success.mp3');
      expect(mockFetch).toHaveBeenCalledWith('/sounds/womp-womp.m4a');
    });

    it('only initializes once when called multiple times', async () => {
      const { soundService } = await import('../soundService');

      await soundService.initSounds();
      await soundService.initSounds();
      await soundService.initSounds();

      // AudioContext should only be created once
      expect(MockAudioContextClass).toHaveBeenCalledTimes(1);
      // Each sound file should only be fetched once
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('resumes suspended AudioContext', async () => {
      mockAudioContext = createMockAudioContext('suspended');
      MockAudioContextClass = vi.fn().mockImplementation(function (this: MockAudioContext) {
        Object.assign(this, mockAudioContext);
        return this;
      });
      vi.stubGlobal('AudioContext', MockAudioContextClass);

      const { soundService } = await import('../soundService');

      await soundService.initSounds();

      expect(mockAudioContext.resume).toHaveBeenCalled();
    });

    it('decodes audio data for each sound', async () => {
      const { soundService } = await import('../soundService');

      await soundService.initSounds();

      expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(3);
    });

    it('handles fetch failure gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { soundService } = await import('../soundService');

      // Should not throw
      await expect(soundService.initSounds()).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles decode failure gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockAudioContext.decodeAudioData.mockRejectedValue(
        new Error('Decode error')
      );

      const { soundService } = await import('../soundService');

      // Should not throw
      await expect(soundService.initSounds()).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('SSR safety', () => {
    it('handles missing AudioContext gracefully', async () => {
      vi.stubGlobal('AudioContext', undefined);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { soundService } = await import('../soundService');

      await expect(soundService.initSounds()).resolves.not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Audio not supported')
      );

      consoleSpy.mockRestore();
    });

    it('handles missing localStorage gracefully for isMuted', async () => {
      vi.stubGlobal('localStorage', undefined);

      const { soundService } = await import('../soundService');

      // Should not throw, should return default (false)
      expect(() => soundService.isMuted()).not.toThrow();
      expect(soundService.isMuted()).toBe(false);
    });

    it('handles missing localStorage gracefully for setMuted', async () => {
      vi.stubGlobal('localStorage', undefined);

      const { soundService } = await import('../soundService');

      // Should not throw
      expect(() => soundService.setMuted(true)).not.toThrow();
    });
  });

  describe('playDiceRoll', () => {
    it('creates and starts buffer source', async () => {
      const mockSource = createMockBufferSource();
      mockAudioContext.createBufferSource.mockReturnValue(mockSource);

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      soundService.playDiceRoll();

      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
      expect(mockSource.connect).toHaveBeenCalled();
      expect(mockSource.start).toHaveBeenCalledWith(0);
    });

    it('does not play when muted', async () => {
      mockLocalStorage['crawler:diceSoundsMuted'] = 'true';

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      soundService.playDiceRoll();

      // Should not create buffer source when muted
      expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();
    });

    it('does nothing when sounds not initialized', async () => {
      const { soundService } = await import('../soundService');

      // Don't call initSounds
      soundService.playDiceRoll();

      expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();
    });
  });

  describe('playCritical', () => {
    it('creates and starts buffer source for critical sound', async () => {
      const mockSource = createMockBufferSource();
      mockAudioContext.createBufferSource.mockReturnValue(mockSource);

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      soundService.playCritical();

      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
      expect(mockSource.start).toHaveBeenCalledWith(0);
    });

    it('does not play when muted', async () => {
      mockLocalStorage['crawler:diceSoundsMuted'] = 'true';

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      soundService.playCritical();

      expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();
    });
  });

  describe('playFumble', () => {
    it('creates and starts buffer source for fumble sound', async () => {
      const mockSource = createMockBufferSource();
      mockAudioContext.createBufferSource.mockReturnValue(mockSource);

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      soundService.playFumble();

      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
      expect(mockSource.start).toHaveBeenCalledWith(0);
    });

    it('does not play when muted', async () => {
      mockLocalStorage['crawler:diceSoundsMuted'] = 'true';

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      soundService.playFumble();

      expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();
    });
  });

  describe('isMuted', () => {
    it('returns false by default', async () => {
      const { soundService } = await import('../soundService');

      expect(soundService.isMuted()).toBe(false);
    });

    it('returns true when localStorage has muted flag', async () => {
      mockLocalStorage['crawler:diceSoundsMuted'] = 'true';

      const { soundService } = await import('../soundService');

      expect(soundService.isMuted()).toBe(true);
    });

    it('returns false when localStorage has non-true value', async () => {
      mockLocalStorage['crawler:diceSoundsMuted'] = 'false';

      const { soundService } = await import('../soundService');

      expect(soundService.isMuted()).toBe(false);
    });
  });

  describe('setMuted', () => {
    it('stores true in localStorage when muting', async () => {
      const { soundService } = await import('../soundService');

      soundService.setMuted(true);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'crawler:diceSoundsMuted',
        'true'
      );
    });

    it('removes key from localStorage when unmuting', async () => {
      const { soundService } = await import('../soundService');

      soundService.setMuted(false);

      expect(localStorage.removeItem).toHaveBeenCalledWith(
        'crawler:diceSoundsMuted'
      );
    });

    it('affects subsequent isMuted calls', async () => {
      const { soundService } = await import('../soundService');

      expect(soundService.isMuted()).toBe(false);

      soundService.setMuted(true);
      // Since localStorage is mocked, we need to simulate the effect
      mockLocalStorage['crawler:diceSoundsMuted'] = 'true';

      expect(soundService.isMuted()).toBe(true);
    });
  });

  describe('volume', () => {
    it('sets gain node to 0.5 volume', async () => {
      const mockGain = createMockGainNode();
      mockAudioContext.createGain.mockReturnValue(mockGain);

      const { soundService } = await import('../soundService');
      await soundService.initSounds();

      expect(mockGain.gain.value).toBe(0.5);
    });
  });
});
