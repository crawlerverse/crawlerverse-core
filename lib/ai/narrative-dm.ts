import type { GameEventEmitter, GameEvent } from '../engine/events';
import { EventType } from '../engine/events';
import { createLogger } from '../logging';

const logger = createLogger({ module: 'narrative-dm' });

// --- Constants ---

/** Maximum number of narrations to keep in history (FIFO eviction) */
const MAX_NARRATION_HISTORY = 100;

/**
 * Personality types for DM narration.
 * Determines tone, style, and prompt templates.
 */
export type PersonalityType = 'bardic' | 'sardonic';

/**
 * A single narration entry in the history.
 */
export interface NarrationEntry {
  /** Unique identifier for React keys */
  id: string;
  /** Generated narration text */
  text: string;
  /** Event type that triggered this narration */
  eventType: EventType;
  /** When the narration was generated */
  timestamp: number;
  /** Game turn when the event occurred */
  turn: number;
}

/**
 * Narrative DM - generates flavor text for game events.
 *
 * This is a read-only DM layer with zero game state authority.
 * It observes events and produces prose, never affecting mechanics.
 *
 * @example
 * ```typescript
 * const narrativeDM = new NarrativeDM(state.eventEmitter, 'bardic');
 *
 * // Later, poll for narrations
 * const narrations = narrativeDM.getNarrations();
 * ```
 */
export class NarrativeDM {
  private narrations: NarrationEntry[] = [];
  private personality: PersonalityType;
  private errorShown: boolean = false;
  private onError?: (message: string) => void;

  constructor(
    eventEmitter: GameEventEmitter,
    personality: PersonalityType = 'bardic',
    options?: { onError?: (message: string) => void }
  ) {
    this.personality = personality;
    this.onError = options?.onError;
    this.subscribe(eventEmitter);
  }

  /**
   * Get current personality type.
   */
  getPersonality(): PersonalityType {
    return this.personality;
  }

  /**
   * Get all narration entries.
   */
  getNarrations(): NarrationEntry[] {
    return this.narrations;
  }

  /**
   * Clear all narration history.
   */
  clearNarrations(): void {
    this.narrations = [];
  }

  /**
   * Change the personality (affects future narrations only).
   */
  setPersonality(personality: PersonalityType): void {
    this.personality = personality;
  }

  /**
   * Subscribe to all event types for narration.
   */
  private subscribe(eventEmitter: GameEventEmitter): void {
    // Subscribe to all event types
    eventEmitter.subscribe(
      Object.values(EventType),
      (event) => this.handleEvent(event)
    );
  }

  /**
   * Handle incoming game event (async, fire-and-forget).
   */
  private async handleEvent(event: GameEvent): Promise<void> {
    try {
      // Extract structured data from event
      const requestData = {
        eventType: event.type,
        personality: this.personality,
        entities: event.entities.map(e => ({
          name: e.name,
          type: e.type,
          hp: e.hp,
          maxHp: e.maxHp,
        })),
        turn: event.context.turn,
        metadata: event.metadata,
      };

      const narration = await this.generateNarration(requestData);

      this.narrations.push({
        id: crypto.randomUUID(),
        text: narration,
        eventType: event.type,
        timestamp: Date.now(),
        turn: event.context.turn,
      });

      // Enforce max capacity with FIFO eviction
      if (this.narrations.length > MAX_NARRATION_HISTORY) {
        this.narrations.shift();
      }

      // Clear error state on success
      this.errorShown = false;

    } catch (error) {
      logger.error({ error, eventType: event.type }, 'Narration generation failed');

      // Call error handler only on first error
      if (!this.errorShown && this.onError) {
        this.onError('Narration temporarily unavailable');
        this.errorShown = true;
      }

      // Don't throw - game continues regardless
    }
  }

  /**
   * Generate narration text via API.
   */
  private async generateNarration(requestData: {
    eventType: EventType;
    personality: PersonalityType;
    entities: Array<{ name: string; type: string; hp: number; maxHp: number }>;
    turn: number;
    metadata: Record<string, unknown>;
  }): Promise<string> {
    let response: Response;

    try {
      response = await fetch('/api/generate-narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });
    } catch (error) {
      // Network errors (offline, DNS failure, etc.)
      logger.error({
        error: error instanceof Error ? {
          message: error.message,
          name: error.name,
        } : String(error),
        eventType: requestData.eventType,
      }, 'Network error calling narration API');

      throw new Error('Network error: Unable to reach narration service');
    }

    if (!response.ok) {
      let errorData: { error?: string; retryable?: boolean } = { error: `HTTP ${response.status}` };
      try {
        const parsed = await response.json();
        if (parsed && typeof parsed === 'object') {
          errorData = parsed;
        }
      } catch {
        // Use default error message
      }

      // Structured client-side error logging
      logger.error({
        status: response.status,
        statusText: response.statusText,
        errorData,
        eventType: requestData.eventType,
        personality: requestData.personality,
        turn: requestData.turn,
      }, 'Narration API returned error');

      throw new Error(
        errorData.error || `Narration API failed: ${response.status}`
      );
    }

    const data = await response.json();
    if (!data.narration || typeof data.narration !== 'string') {
      logger.error({ responseData: data }, 'Invalid response from narration API');
      throw new Error('Invalid response format from narration API');
    }
    return data.narration;
  }
}
