'use client';

/**
 * useGame Hook
 *
 * Manages game state with support for mixed player/AI crawler control.
 * Handles simulation loop, player input dispatch, and automatic AI moves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { GameState, Action } from '../lib/engine/state';
import { createMultiFloorTestDungeon } from '../lib/engine/maps';
import type { CharacterCreation } from '../lib/engine/character-system';
import { simulate } from '../lib/engine/simulation';
import { queueCommand } from '../lib/engine/bubble';
import type { EntityId } from '../lib/engine/scheduler';
import { createLogger } from '../lib/logging';
import type { CrawlerId } from '../lib/engine/crawler-id';
import { prepareAIDecision, type AIDecisionContext } from '../lib/ai/decision-context';
import { createCooldowns, tickCooldowns, type PerceptionCooldowns } from '../lib/engine/perception-cooldowns';
import { getPerceptionText } from '../lib/engine/perception';
import { showToast } from '../components/ui/Toast';

const logger = createLogger({ module: 'useGame' });

/** How long thoughts remain visible (ms) */
const THOUGHT_DURATION_MS = 3000;

// --- Types ---

export type CrawlerControl = 'player' | 'ai';

export type StepMode = 'action' | 'round';

export interface CrawlerConfig {
  readonly id: CrawlerId;
  readonly control: CrawlerControl;
}

export type DispatchResult =
  | { readonly processed: true }
  | { readonly processed: false; readonly reason: string };

export type GameStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting_for_player'; readonly crawlerId: CrawlerId }
  | { readonly status: 'ai_thinking'; readonly crawlerIds: readonly CrawlerId[] }
  | { readonly status: 'simulating' }
  | { readonly status: 'warning'; readonly message: string }
  | { readonly status: 'error'; readonly message: string };

/** A thought bubble displayed above a crawler */
export interface Thought {
  readonly id: string;
  readonly crawlerId: CrawlerId;
  readonly text: string;
  readonly timestamp: number;
}

export interface UseGameOptions {
  /** Crawler configurations (id and control type). Must have at least one config. */
  readonly crawlerConfigs: readonly [CrawlerConfig, ...CrawlerConfig[]];
  /** Access code for AI API */
  readonly accessCode?: string;
  /** Seed for deterministic character generation (default: 0). Must be stable between server and client to avoid hydration errors. */
  readonly seed?: number;
  /** Delay between AI actions in ms (default: 300) */
  readonly aiDelayMs?: number;
  /** AI request timeout in ms (default: 30000) */
  readonly timeoutMs?: number;
  /** Maximum retry attempts for transient AI errors (default: 2) */
  readonly maxRetries?: number;
  /** Character creation data for the first crawler (optional, falls back to random) */
  readonly characterCreation?: CharacterCreation | null;
  /** Start with AI paused (default: false) */
  readonly startPaused?: boolean;
}

// --- Retry Logic ---

/** Errors that are likely transient and worth retrying */
function isTransientError(message: string): boolean {
  const transientPatterns = [
    'network',
    'timeout',
    'ECONNRESET',
    'ETIMEDOUT',
    '503',
    '502',
    '429',
    'rate limit',
    'temporarily unavailable',
    'fetch failed',
  ];
  const lowerMessage = message.toLowerCase();
  return transientPatterns.some((pattern) => lowerMessage.includes(pattern.toLowerCase()));
}

/** Calculate exponential backoff delay */
function getBackoffDelay(attempt: number): number {
  return Math.min(Math.pow(2, attempt) * 1000, 10000);
}

// --- AI Action Fetching ---

interface FetchAIActionOptions {
  state: GameState; // Still needed for crawlerId validation
  crawlerId: CrawlerId;
  prompt: string; // Pre-built prompt from prepareAIDecision
  accessCode?: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxRetries: number;
}

/** Result from AI action fetch, including reasoning and short thought for UI */
interface AIActionResult {
  action: Action;
  reasoning: string;
  shortThought: string;
  aiMetadata?: {
    durationMs: number;
    outputTokens?: number;
    modelId?: string;
  };
}

async function fetchAIAction(options: FetchAIActionOptions): Promise<AIActionResult> {
  const { prompt: gameStatePrompt, crawlerId, accessCode, signal, timeoutMs, maxRetries } = options;

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortHandler = () => controller.abort();
    signal.addEventListener('abort', abortHandler);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      const response = await fetch('/api/ai', {
        method: 'POST',
        headers,
        body: JSON.stringify({ gameStatePrompt, accessCode, crawlerId }),
        signal: controller.signal,
      });

      let responseData;
      try {
        responseData = await response.json();
      } catch (parseError) {
        const errorDetail = parseError instanceof Error ? parseError.message : 'Unknown parse error';
        logger.error(
          { httpStatus: response.status, parseError: errorDetail, crawlerId },
          'Failed to parse AI response as JSON'
        );
        throw new Error(`Server returned invalid response (HTTP ${response.status}): ${errorDetail}`);
      }

      if (!response.ok) {
        const errorMessage = responseData?.error || `Request failed with HTTP ${response.status}`;

        logger.warn(
          { crawlerId, httpStatus: response.status, serverError: responseData?.error },
          'AI request failed with non-200 response'
        );
        throw new Error(errorMessage);
      }

      if (!responseData?.action) {
        throw new Error('Server response missing action data');
      }

      return {
        action: responseData.action as Action,
        reasoning: responseData.reasoning ?? 'No reasoning provided',
        shortThought: responseData.shortThought ?? '',
        aiMetadata: responseData.aiMetadata,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === 'AbortError') {
        throw lastError;
      }

      if (isTransientError(lastError.message) && attempt < maxRetries) {
        const backoffMs = getBackoffDelay(attempt);
        logger.warn(
          { crawlerId, attempt: attempt + 1, maxRetries, backoffMs, errorMessage: lastError.message },
          'AI request failed with transient error, retrying'
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abortHandler);
    }
  }

  throw lastError || new Error('Unknown error in fetchAIAction');
}

// --- Hook ---

export function useGame(options: UseGameOptions) {
  const {
    crawlerConfigs,
    accessCode,
    seed = 0,
    aiDelayMs = 300,
    timeoutMs = 30000,
    maxRetries = 2,
    characterCreation,
    startPaused = false,
  } = options;

  const crawlerCount = crawlerConfigs.length;

  const [state, setState] = useState<GameState>(() =>
    createMultiFloorTestDungeon({ crawlerCount, seed, characterCreation: characterCreation ?? undefined })
  );
  const [gameStatus, setGameStatus] = useState<GameStatus>({ status: 'idle' });
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [resetKey, setResetKey] = useState(0);

  // Track crawlers transitioning from AI→Player while AI request is in-flight
  const [aiTransitioningIds, setAITransitioningIds] = useState<ReadonlySet<CrawlerId>>(() => new Set());

  // Perception cooldowns - track per-crawler to prevent perception spam
  const [perceptionCooldowns, setPerceptionCooldowns] = useState<Map<CrawlerId, PerceptionCooldowns>>(
    () => new Map()
  );
  const perceptionCooldownsRef = useRef(perceptionCooldowns);
  perceptionCooldownsRef.current = perceptionCooldowns;

  // Pause controls
  const [isPaused, setIsPaused] = useState(startPaused);
  const [stepMode, setStepMode] = useState<StepMode>('action');

  // Track the AI model being used (populated from AI response metadata)
  const [modelId, setModelId] = useState<string | null>(null);
  const pendingStepRef = useRef(false);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const stepModeRef = useRef(stepMode);
  stepModeRef.current = stepMode;

  const abortControllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const controlMap = useMemo(() => {
    const map = new Map<string, CrawlerControl>();
    for (const config of crawlerConfigs) {
      map.set(config.id, config.control);
    }
    return map;
  }, [crawlerConfigs]);
  const controlMapRef = useRef(controlMap);
  controlMapRef.current = controlMap;

  /** Add a thought bubble that auto-removes after THOUGHT_DURATION_MS */
  const addThought = useCallback((crawlerId: CrawlerId, text: string) => {
    if (!text) return;

    const thought: Thought = {
      id: `${crawlerId}-${Date.now()}`,
      crawlerId,
      text,
      timestamp: Date.now(),
    };

    setThoughts((prev) => {
      // Remove any existing thought for this crawler
      const filtered = prev.filter((t) => t.crawlerId !== crawlerId);
      return [...filtered, thought];
    });

    // Auto-remove after duration
    setTimeout(() => {
      setThoughts((prev) => prev.filter((t) => t.id !== thought.id));
    }, THOUGHT_DURATION_MS);
  }, []);

  const dispatch = useCallback(
    (crawlerId: CrawlerId, action: Action): DispatchResult => {
      let result: DispatchResult = { processed: false, reason: 'Unknown error' };

      try {
        flushSync(() => {
          setState((current) => {
            if (current.gameStatus.status === 'ended') {
              result = { processed: false, reason: 'Game is over' };
              return current;
            }

            const bubble = current.bubbles.find((b) =>
              b.entityIds.some((id) => (id as string) === crawlerId)
            );

            if (!bubble) {
              logger.warn(
                { crawlerId, bubbleCount: current.bubbles.length },
                'Crawler not found in any bubble during dispatch'
              );
              result = { processed: false, reason: 'Crawler not found in any bubble' };
              return current;
            }

            const queueResult = queueCommand(bubble, crawlerId as unknown as EntityId, action);

            if (!queueResult.success) {
              logger.warn(
                { crawlerId, action: action.action, error: queueResult.error },
                'Failed to queue command during dispatch'
              );
              result = { processed: false, reason: queueResult.error ?? 'Failed to queue command' };
              return current;
            }

            const updatedBubbles = current.bubbles.map((b) =>
              b.id === bubble.id ? queueResult.bubble : b
            );

            const simResult = simulate({ ...current, bubbles: updatedBubbles });

            result = { processed: true };
            return simResult.state;
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, crawlerId, action: action.action }, 'Action dispatch failed');
        result = { processed: false, reason: `Internal error: ${message}` };
      }

      return result;
    },
    []
  );

  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    let isMounted = true;

    async function runGameLoop() {
      let unchangedStateCount = 0;
      const MAX_UNCHANGED_ITERATIONS = 10;

      while (isMounted && !signal.aborted) {
        const current = stateRef.current;

        if (current.gameStatus.status === 'ended') {
          setGameStatus({ status: 'idle' });
          return;
        }

        const simResult = simulate(current);
        if (simResult.state !== current) {
          setState(simResult.state);
          stateRef.current = simResult.state;
          unchangedStateCount = 0;
        } else {
          unchangedStateCount++;
        }

        const waitingFor = simResult.waitingFor;

        if (waitingFor.length === 0) {
          if (unchangedStateCount >= MAX_UNCHANGED_ITERATIONS) {
            logger.warn(
              { turn: current.turn, unchangedCount: unchangedStateCount },
              'Game loop stuck with no waiting crawlers - breaking to prevent infinite loop'
            );
            setGameStatus({ status: 'idle' });
            return;
          }

          setGameStatus({ status: 'simulating' });
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }

        unchangedStateCount = 0;

        const waitingPlayers: CrawlerId[] = [];
        const waitingAI: CrawlerId[] = [];

        for (const entityId of waitingFor) {
          const crawlerId = entityId as unknown as CrawlerId;
          const control = controlMapRef.current.get(crawlerId) ?? 'player';
          if (control === 'player') {
            waitingPlayers.push(crawlerId);
          } else {
            waitingAI.push(crawlerId);
          }
        }

        if (waitingPlayers.length > 0) {
          // Re-check control map — player may have switched to AI since classification
          const stillPlayer = waitingPlayers.filter(
            (id) => (controlMapRef.current.get(id) ?? 'player') === 'player'
          );
          const switchedToAI = waitingPlayers.filter(
            (id) => controlMapRef.current.get(id) === 'ai'
          );

          if (switchedToAI.length > 0) {
            waitingAI.push(...switchedToAI);
          }

          if (stillPlayer.length > 0) {
            setGameStatus({ status: 'waiting_for_player', crawlerId: stillPlayer[0] });
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
          // Fall through to AI processing if all switched
        }

        if (waitingAI.length > 0) {
          // Check if paused and no pending step
          if (isPausedRef.current && !pendingStepRef.current) {
            setGameStatus({ status: 'ai_thinking', crawlerIds: waitingAI });
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }

          // In action step mode, only process one AI at a time
          const isStepping = isPausedRef.current && pendingStepRef.current;
          const aiToProcess = isStepping && stepModeRef.current === 'action'
            ? [waitingAI[0]]
            : waitingAI;

          setGameStatus({ status: 'ai_thinking', crawlerIds: aiToProcess });

          const stateForAI = stateRef.current;

          // Prepare AI decision context for each crawler (handles perceptions internally)
          const aiContexts = new Map<CrawlerId, AIDecisionContext>();
          for (const crawlerId of aiToProcess) {
            const currentCooldowns = perceptionCooldownsRef.current.get(crawlerId) ?? createCooldowns();
            const context = prepareAIDecision(stateForAI, crawlerId, currentCooldowns, { isYourTurn: true });
            aiContexts.set(crawlerId, context);

            // Update cooldowns immediately
            setPerceptionCooldowns((prev) => {
              const next = new Map(prev);
              next.set(crawlerId, context.updatedCooldowns);
              return next;
            });
          }

          try {
            const aiPromises = aiToProcess.map((crawlerId) => {
              const context = aiContexts.get(crawlerId)!;
              return fetchAIAction({
                state: stateForAI,
                crawlerId,
                prompt: context.prompt,
                accessCode,
                signal,
                timeoutMs,
                maxRetries,
              })
                .then((result) => ({ crawlerId, action: result.action, reasoning: result.reasoning, shortThought: result.shortThought, aiMetadata: result.aiMetadata, error: null }))
                .catch((error) => ({
                  crawlerId,
                  action: null,
                  reasoning: null,
                  shortThought: null,
                  aiMetadata: null,
                  error: error instanceof Error ? error : new Error(String(error)),
                }));
            });

            const results = await Promise.all(aiPromises);

            if (signal.aborted) return;

            // Check if any AI crawlers switched to player while request was in-flight
            const switchedDuringFetch = aiToProcess.filter(
              (id) => controlMapRef.current.get(id) === 'player'
            );
            if (switchedDuringFetch.length > 0) {
              showToast('AI finishing its turn…', 'info');
              setAITransitioningIds((prev) => {
                const next = new Set(prev);
                for (const id of switchedDuringFetch) next.add(id);
                return next;
              });
            }

            results.sort((a, b) => a.crawlerId.localeCompare(b.crawlerId));

            let hasErrors = false;
            let lastErrorMessage = '';
            const failedCrawlerIds: CrawlerId[] = [];
            let updatedState = stateRef.current;

            for (const result of results) {
              if (result.error) {
                logger.error(
                  { crawlerId: result.crawlerId, errorMessage: result.error.message },
                  'AI request failed'
                );
                hasErrors = true;
                lastErrorMessage = result.error.message;
                failedCrawlerIds.push(result.crawlerId);
                continue;
              }

              if (result.action) {
                const bubble = updatedState.bubbles.find((b) =>
                  b.entityIds.some((id) => (id as string) === result.crawlerId)
                );

                if (!bubble) {
                  logger.error(
                    {
                      crawlerId: result.crawlerId,
                      action: result.action.action,
                      bubbleCount: updatedState.bubbles.length,
                      entityIds: updatedState.bubbles.flatMap((b) => b.entityIds),
                    },
                    'Crawler bubble not found when queuing AI action'
                  );
                  hasErrors = true;
                  lastErrorMessage = `Crawler ${result.crawlerId} not found in any bubble`;
                  failedCrawlerIds.push(result.crawlerId);
                  continue;
                }

                // Merge reasoning and aiMetadata onto the action
                const actionWithMetadata = {
                  ...result.action,
                  reasoning: result.reasoning,
                  aiMetadata: result.aiMetadata,
                };
                const queueResult = queueCommand(
                  bubble,
                  result.crawlerId as unknown as EntityId,
                  actionWithMetadata
                );

                if (queueResult.success) {
                  updatedState = {
                    ...updatedState,
                    bubbles: updatedState.bubbles.map((b) =>
                      b.id === bubble.id ? queueResult.bubble : b
                    ),
                  };
                  // Track the model being used
                  if (result.aiMetadata?.modelId) {
                    setModelId(result.aiMetadata.modelId);
                  }
                  logger.info(
                    {
                      crawlerId: result.crawlerId,
                      action: result.action.action,
                      direction: 'direction' in result.action ? result.action.direction : undefined,
                      reasoning: result.reasoning,
                      shortThought: result.shortThought,
                    },
                    'AI action queued'
                  );
                  // Display thought bubble - prefer perception text over shortThought
                  const aiContext = aiContexts.get(result.crawlerId);
                  const crawler = updatedState.entities[result.crawlerId];
                  const characterClass = crawler?.characterClass ?? 'warrior';
                  const perceptionText = aiContext?.priorityPerception
                    ? getPerceptionText(aiContext.priorityPerception, characterClass)
                    : null;
                  const thoughtText = perceptionText ?? result.shortThought;
                  if (thoughtText) {
                    addThought(result.crawlerId, thoughtText);
                  }
                } else {
                  logger.error(
                    {
                      crawlerId: result.crawlerId,
                      action: result.action.action,
                      error: queueResult.error,
                      bubbleId: bubble.id,
                      bubbleStatus: bubble.executionState.status,
                    },
                    'Failed to queue AI action after successful fetch'
                  );
                  hasErrors = true;
                  lastErrorMessage = queueResult.error ?? 'Failed to queue command';
                  failedCrawlerIds.push(result.crawlerId);
                }
              }
            }

            if (hasErrors && results.every((r) => r.error)) {
              setGameStatus({ status: 'error', message: lastErrorMessage || 'All AI requests failed' });
              return;
            }

            if (hasErrors && !results.every((r) => r.error)) {
              logger.warn(
                {
                  failedCrawlerIds,
                  totalCrawlers: results.length,
                  successfulCrawlers: results.length - failedCrawlerIds.length,
                },
                'Partial AI failure - some crawlers did not receive actions'
              );
              setGameStatus({
                status: 'warning',
                message: `Some AI requests failed: ${failedCrawlerIds.join(', ')}`,
              });
            }

            const simResult2 = simulate(updatedState);
            setState(simResult2.state);
            stateRef.current = simResult2.state;

            // Clear AI transitioning state for crawlers whose actions completed
            setAITransitioningIds((prev) => {
              if (prev.size === 0) return prev;
              const next = new Set(prev);
              for (const result of results) {
                if (!result.error) next.delete(result.crawlerId);
              }
              return next.size === prev.size ? prev : next;
            });

            // Tick perception cooldowns for all AI crawlers after their actions
            setPerceptionCooldowns((prev) => {
              const next = new Map(prev);
              for (const crawlerId of aiToProcess) {
                const currentCooldowns = next.get(crawlerId);
                if (currentCooldowns) {
                  next.set(crawlerId, tickCooldowns(currentCooldowns));
                }
              }
              return next;
            });

            // Consume the step if we were stepping
            if (isStepping) {
              pendingStepRef.current = false;
            }

            if (aiDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, aiDelayMs));
            }
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              return;
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error: message }, 'Game loop error');
            setGameStatus({ status: 'error', message });
            return;
          }
        }
      }
    }

    runGameLoop();

    return () => {
      isMounted = false;
      abortControllerRef.current?.abort();
    };
  }, [accessCode, aiDelayMs, timeoutMs, maxRetries, addThought, resetKey]);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setState(createMultiFloorTestDungeon({ crawlerCount, seed, characterCreation: characterCreation ?? undefined }));
    setGameStatus({ status: 'idle' });
    setThoughts([]);
    setPerceptionCooldowns(new Map());
    setAITransitioningIds(new Set());
    setResetKey((k) => k + 1);
  }, [crawlerCount, seed, characterCreation]);

  // Pause control callbacks
  const pause = useCallback(() => setIsPaused(true), []);
  const resume = useCallback(() => setIsPaused(false), []);
  const togglePause = useCallback(() => setIsPaused((p) => !p), []);
  const step = useCallback(() => {
    pendingStepRef.current = true;
  }, []);

  const isWaitingForPlayer = gameStatus.status === 'waiting_for_player';
  const waitingPlayerId = gameStatus.status === 'waiting_for_player' ? gameStatus.crawlerId : null;
  const isEnded = state.gameStatus.status === 'ended';
  const isAIThinking = gameStatus.status === 'ai_thinking';

  return {
    state,
    gameStatus,
    dispatch,
    reset,
    isWaitingForPlayer,
    waitingPlayerId,
    isEnded,
    thoughts,

    // Pause controls
    isPaused,
    pause,
    resume,
    togglePause,
    stepMode,
    setStepMode,
    step,
    isAIThinking,

    // AI model info
    modelId,

    // AI→Player transition tracking
    aiTransitioningIds,
  };
}
