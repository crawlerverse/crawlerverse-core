/**
 * @fileoverview Sound service for dice roll sound effects
 * Uses Web Audio API for low-latency playback with preloaded buffers
 */

const STORAGE_KEY = 'crawler:diceSoundsMuted';
const VOLUME = 0.5;

const SOUND_PATHS = {
  diceRoll: '/sounds/dice-roll.mp3',
  critical: '/sounds/triumphant-success.mp3',
  fumble: '/sounds/womp-womp.m4a',
} as const;

type SoundKey = keyof typeof SOUND_PATHS;

// Module-level state
let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
const soundBuffers: Map<SoundKey, AudioBuffer> = new Map();
let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Check if AudioContext is available (SSR safety)
 */
function isAudioSupported(): boolean {
  return typeof AudioContext !== 'undefined';
}

/**
 * Check if localStorage is available (SSR safety)
 */
function isLocalStorageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * Load and decode a single audio file
 */
async function loadSound(
  ctx: AudioContext,
  key: SoundKey
): Promise<void> {
  const path = SOUND_PATHS[key];
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.warn(`[soundService] Failed to fetch ${path}: ${response.status}`);
      return;
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    soundBuffers.set(key, audioBuffer);
  } catch (error) {
    console.warn(`[soundService] Failed to load sound ${path}:`, error);
  }
}

/**
 * Play a sound by key
 */
function playSound(key: SoundKey): void {
  if (!audioContext || !gainNode) {
    return;
  }

  if (isMuted()) {
    return;
  }

  const buffer = soundBuffers.get(key);
  if (!buffer) {
    return;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(gainNode);
  source.start(0);
}

/**
 * Initialize the sound system
 * Lazy loads audio buffers on first call
 * Safe to call multiple times - subsequent calls are no-ops
 */
async function initSounds(): Promise<void> {
  // Return existing promise if init is in progress
  if (initPromise) {
    return initPromise;
  }

  // Return immediately if already initialized
  if (initialized) {
    return;
  }

  initPromise = (async () => {
    if (!isAudioSupported()) {
      console.warn('[soundService] Audio not supported in this environment');
      return;
    }

    try {
      // Create audio context
      audioContext = new AudioContext();

      // Resume if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Create gain node for volume control
      gainNode = audioContext.createGain();
      gainNode.gain.value = VOLUME;
      gainNode.connect(audioContext.destination);

      // Load all sounds in parallel
      await Promise.all([
        loadSound(audioContext, 'diceRoll'),
        loadSound(audioContext, 'critical'),
        loadSound(audioContext, 'fumble'),
      ]);

      initialized = true;
    } catch (error) {
      console.warn('[soundService] Failed to initialize audio:', error);
    }
  })();

  return initPromise;
}

/**
 * Play the dice roll sound
 */
function playDiceRoll(): void {
  playSound('diceRoll');
}

/**
 * Play the critical hit sound (nat 20)
 */
function playCritical(): void {
  playSound('critical');
}

/**
 * Play the fumble sound (nat 1)
 */
function playFumble(): void {
  playSound('fumble');
}

/**
 * Check if sounds are muted
 */
function isMuted(): boolean {
  if (!isLocalStorageAvailable()) {
    return false;
  }
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

/**
 * Set the muted state
 */
function setMuted(muted: boolean): void {
  if (!isLocalStorageAvailable()) {
    return;
  }
  if (muted) {
    localStorage.setItem(STORAGE_KEY, 'true');
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Named exports for direct imports
export { initSounds, playDiceRoll, playCritical, playFumble, isMuted, setMuted };

// Object export for namespace-style usage
export const soundService = {
  initSounds,
  playDiceRoll,
  playCritical,
  playFumble,
  isMuted,
  setMuted,
};
