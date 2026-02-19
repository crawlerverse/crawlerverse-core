'use client';

/**
 * PlayGame Component
 *
 * Complete game UI with support for mixed player/AI crawler control.
 * Supports 1-2 crawlers with configurable control types.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameCanvas } from './GameCanvas';
import { ThoughtBubbles } from './ThoughtBubbles';
import { ErrorBoundary } from './ErrorBoundary';
import { SaveCharacterPrompt } from './SaveCharacterPrompt';
import { useGame, type CrawlerConfig, type CrawlerControl } from '../../hooks/useGame';
import { AIPauseControls } from './AIPauseControls';
import { useCharacterRoster, CharacterRosterProvider } from '../../hooks/useCharacterRoster';
import { DIRECTION_DELTAS } from '../../lib/engine/actions';
import type { Direction } from '../../lib/engine/state';
import { crawlerIdFromIndex, toCrawlerId } from '../../lib/engine/crawler-id';
import { getCrawlers, getMonsters, getMonstersInArea, getCurrentArea, getEntity } from '../../lib/engine/state';
import {
  enterTargetingMode,
  cycleTargetNext,
  cycleTargetPrev,
  getCurrentTargetId,
  INACTIVE_TARGETING,
  type TargetingState,
} from '../../lib/engine/targeting';
import { getTile } from '../../lib/engine/map';
import { formatCharacterTitle } from '../../lib/engine/character';
import { InventoryPanel } from './InventoryPanel';
import { EffectPills } from './EffectPills';
import { ObjectivesPanel } from './ObjectivesPanel';
import { CharacterCreationModal } from './CharacterCreationModal';
import { InventoryModal } from './InventoryModal';
import { getItemAtPosition, getItemTemplate, type ItemInstance } from '../../lib/engine/items';
import { getEffectiveAttack, getEffectiveDefense } from '../../lib/engine/stats';
import { getNextEquipment } from '../../lib/engine/equipment-cycling';
import type { PlayerType, GameCompleteData, ErrorContext } from '../../lib/engine/callbacks';
import { generateSessionId } from '../../lib/engine/callbacks';
// Removed pino logger - using console for browser-side logging
import type { CharacterCreation } from '../../lib/engine/character-system';
import { LocalStorageCharacterRepository } from '../../lib/engine/character-repository';
import { DiceRollOverlay } from '../dice';
import { NarrationPanel } from './NarrationPanel';
import { NarrativeDM, type NarrationEntry } from '../../lib/ai/narrative-dm';
import { Toast, showToast } from '../ui/Toast';

/** Tile size in pixels for canvas rendering */
const TILE_SIZE = 32;

/** Modal backdrop shared classes */
const MODAL_BACKDROP_CLASSES = 'fixed inset-0 bg-black/75 flex items-center justify-center z-50';
const MODAL_FADE_STYLE = { animation: 'fadeIn 200ms ease-out' };

/** Get HP color based on ratio threshold */
function getHpColorFromRatio(ratio: number): string {
  if (ratio > 0.6) return 'var(--success)';
  if (ratio > 0.3) return 'var(--player)';
  return 'var(--danger)';
}

/** Convert delta coordinates to a Direction */
function getDirectionFromDelta(dx: number, dy: number): Direction {
  const ndx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const ndy = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  const dirMap: Record<string, Direction> = {
    '0,-1': 'north', '0,1': 'south', '1,0': 'east', '-1,0': 'west',
    '1,-1': 'northeast', '-1,-1': 'northwest', '1,1': 'southeast', '-1,1': 'southwest',
  };
  return dirMap[`${ndx},${ndy}`] ?? 'north';
}

const KEY_TO_DIRECTION: Record<string, Direction> = {
  // Arrow keys (cardinal only)
  ArrowUp: 'north',
  ArrowDown: 'south',
  ArrowLeft: 'west',
  ArrowRight: 'east',

  // WASD (cardinal only)
  w: 'north',
  s: 'south',
  a: 'west',
  d: 'east',

  // Vi keys (full 8-way)
  h: 'west',
  j: 'south',
  k: 'north',
  l: 'east',
  y: 'northwest',
  u: 'northeast',
  b: 'southwest',
  n: 'southeast',

  // Numpad (full 8-way)
  '7': 'northwest',
  '8': 'north',
  '9': 'northeast',
  '4': 'west',
  '6': 'east',
  '1': 'southwest',
  '2': 'south',
  '3': 'southeast',
};

/**
 * Format model ID for display (strip provider prefix and common suffixes)
 *
 * Examples:
 * - "mistralai/devstral-2512:free" -> "devstral-2512"
 * - "meta-llama/llama-3.3-70b-instruct:free" -> "llama-3.3-70b"
 * - "google/gemma-3-12b-it:free" -> "gemma-3-12b"
 */
function formatModelName(modelId: string | null): string {
  if (!modelId) return '';
  return modelId
    .replace(/^[^/]+\//, '')                  // Remove provider prefix
    .replace(/(:free|-instruct|-it)$/, '');   // Remove common suffixes
}

/** Format duration in milliseconds to human-readable string */
function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Calculate and format tokens per second from AI metadata */
function formatTokensPerSec(metadata: { durationMs: number; outputTokens?: number }): string | null {
  if (!metadata.outputTokens || metadata.durationMs === 0) return null;
  const tokPerSec = (metadata.outputTokens / metadata.durationMs) * 1000;
  return `${tokPerSec.toFixed(1)} tok/s`;
}

export interface PlayGameProps {
  /** Title displayed at the top of the game */
  title?: string;
  /** Seed for deterministic character generation. Should be generated server-side and passed down to avoid hydration mismatch. */
  seed?: number;
  /** Delay between AI actions in milliseconds */
  aiDelayMs?: number;
  /** Called when the game resets */
  onReset?: () => void;
  // Observability callbacks (optional)
  /** Called when a new game starts */
  onGameStart?: (sessionId: string, playerType: PlayerType) => void;
  /** Called when a game ends */
  onGameComplete?: (data: GameCompleteData) => void;
  /** Called when AI returns an action (valid or invalid) */
  onAIAction?: (valid: boolean, actionType: string, sessionId: string) => void;
  /** Called when an error occurs */
  onError?: (error: Error, context: ErrorContext) => void;
}

interface GameInnerProps extends PlayGameProps {
  crawlerConfigs: readonly [CrawlerConfig, ...CrawlerConfig[]];
  characterCreation?: CharacterCreation | null;
  onConfigChange: (index: number, control: CrawlerControl) => void;
  onAddCrawler: () => void;
  onRemoveCrawler: (index: number) => void;
  /** Callback to update play stats when game ends (if playing with a saved character) */
  onGameEndStats?: (stats: { floorReached: number; died: boolean; monstersKilled: number }) => void;
}

function GameInner({
  title = 'Crawler Demo',
  seed,
  aiDelayMs = 300,
  onReset,
  onGameStart,
  onGameComplete,
  onError,
  crawlerConfigs,
  characterCreation,
  onConfigChange,
  onAddCrawler,
  onRemoveCrawler,
  onGameEndStats,
}: GameInnerProps) {
  const {
    state,
    gameStatus,
    dispatch,
    reset,
    isWaitingForPlayer,
    waitingPlayerId,
    isEnded,
    thoughts,
    isPaused,
    togglePause,
    stepMode,
    setStepMode,
    step,
    modelId,
    aiTransitioningIds,
  } = useGame({
    crawlerConfigs,
    seed,
    aiDelayMs,
    characterCreation,
  });

  const gameCompletedRef = useRef<boolean>(false);
  const playStatsUpdatedRef = useRef<boolean>(false);
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [startTime, setStartTime] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [narrations, setNarrations] = useState<NarrationEntry[]>([]);
  const narrativeDMRef = useRef<NarrativeDM | null>(null);

// Track initial monster count for stats calculation
  // NOTE: Intentionally uses getMonsters (all floors) to track total kills across the entire run
  const initialMonsterCountRef = useRef<number>(getMonsters(state).length);

  // Pending attack state for dice roll animation
  const [pendingAttack, setPendingAttack] = useState<{
    attackerId: string;
    direction: Direction;
  } | null>(null);

  // Targeting mode state for ranged attacks
  const [targetingState, setTargetingState] = useState<TargetingState>(INACTIVE_TARGETING);

  // Targeting feedback message (shown when targeting mode fails to activate)
  const [targetingFeedback, setTargetingFeedback] = useState<string | null>(null);

  // Pending ranged attack state for dice roll animation
  // Store targetId instead of pre-computed direction/distance so we can
  // recalculate at dispatch time (in case target moved during dice animation)
  const [pendingRangedAttack, setPendingRangedAttack] = useState<{
    attackerId: string;
    targetId: string;
    targetName: string;
  } | null>(null);

  const toggleExpanded = useCallback((msgId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }, []);

  // Track recently completed objectives for animation
  const prevCompletedIdsRef = useRef<Set<string>>(new Set());
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<Set<string>>(new Set());

  // Detect newly completed objectives
  useEffect(() => {
    const currentCompleted = new Set(
      state.objectives.filter((o) => o.status === 'completed').map((o) => o.id)
    );

    // Find objectives that just became completed
    const newlyCompleted = new Set<string>();
    for (const id of currentCompleted) {
      if (!prevCompletedIdsRef.current.has(id)) {
        newlyCompleted.add(id);
      }
    }

    if (newlyCompleted.size > 0) {
      setRecentlyCompletedIds(newlyCompleted);
      // Clear animation after it plays
      const timer = setTimeout(() => {
        setRecentlyCompletedIds(new Set());
      }, 800);
      return () => clearTimeout(timer);
    }

    prevCompletedIdsRef.current = currentCompleted;
  }, [state.objectives]);

  // Memoize control type checks to avoid recalculating in multiple places
  const hasAI = useMemo(() => crawlerConfigs.some(c => c.control === 'ai'), [crawlerConfigs]);
  const hasPlayer = useMemo(() => crawlerConfigs.some(c => c.control === 'player'), [crawlerConfigs]);

  // Warn in development when no observability callbacks are provided
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      if (!onGameStart && !onGameComplete && !onError) {
        console.warn(
          '[PlayGame] No observability callbacks provided. ' +
          'Analytics and error reporting will be disabled. ' +
          'If this is intentional (e.g., in core demo app), you can ignore this warning.'
        );
      }
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track game start
  useEffect(() => {
    onGameStart?.(sessionId, hasAI ? 'ai' : 'human');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Track newest message ID for animation targeting
  const newestMessageId = state.messages.at(-1)?.id ?? null;

  // Memoize reversed messages to avoid array copy on every render
  const reversedMessages = useMemo(
    () => [...state.messages].reverse(),
    [state.messages]
  );

  // Track game completion
  useEffect(() => {
    if (state.gameStatus.status === 'ended' && !gameCompletedRef.current) {
      gameCompletedRef.current = true;
      onGameComplete?.({
        outcome: state.gameStatus.victory ? 'win' : 'loss',
        turns: state.turn,
        playerType: hasAI ? 'ai' : 'human',
        validActionRate: undefined,
        durationMs: Date.now() - startTime,
        sessionId,
      });
    }
  }, [state.gameStatus, state.turn, hasAI, startTime, sessionId, onGameComplete]);

  // Update play stats when game ends (if playing with a saved character)
  useEffect(() => {
    if (state.gameStatus.status === 'ended' && !playStatsUpdatedRef.current && onGameEndStats) {
      playStatsUpdatedRef.current = true;

      const currentArea = getCurrentArea(state);
      // dangerLevel equals floor number for dungeon areas
      const floorReached = currentArea.metadata.dangerLevel;
      const died = !state.gameStatus.victory;

      // Calculate monsters killed by comparing initial count to remaining
      // NOTE: Intentionally uses getMonsters (all floors) to track total kills across the entire run
      const remainingMonsters = getMonsters(state).length;
      const monstersKilled = initialMonsterCountRef.current - remainingMonsters;

      onGameEndStats({
        floorReached,
        died,
        monstersKilled,
      });
    }
  }, [state, onGameEndStats]);

  // Initialize NarrativeDM when eventEmitter is available
  useEffect(() => {
    if (state.eventEmitter) {
      narrativeDMRef.current = new NarrativeDM(
        state.eventEmitter,
        'bardic', // Default personality
        { onError: showToast }
      );

      // Poll for new narrations every 100ms
      // Only update state if narration count changed to avoid unnecessary re-renders
      let lastNarrationCount = 0;
      const interval = setInterval(() => {
        if (narrativeDMRef.current) {
          const currentNarrations = narrativeDMRef.current.getNarrations();
          if (currentNarrations.length !== lastNarrationCount) {
            lastNarrationCount = currentNarrations.length;
            setNarrations([...currentNarrations]);
          }
        }
      }, 100);

      return () => {
        clearInterval(interval);
        narrativeDMRef.current = null;
      };
    }
  }, [state.eventEmitter]);

  // Helper to find first item of a type in inventory
  const findInventoryItem = useCallback((
    inventory: readonly ItemInstance[],
    predicate: (item: ItemInstance) => boolean
  ): ItemInstance | undefined => {
    return inventory.find(predicate);
  }, []);

  // Keyboard input handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore keyboard events from input elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // Block game input when inventory modal is open
      if (showInventory) {
        return;
      }

      // Help toggle works even when not player's turn
      if (e.key === '?' || e.key === '/') {
        e.preventDefault();
        setShowHelp(prev => !prev);
        return;
      }

      // Close help on Escape
      if (e.key === 'Escape' && showHelp) {
        e.preventDefault();
        setShowHelp(false);
        return;
      }

      // Inventory modal (i)
      if (e.key === 'i') {
        e.preventDefault();
        setShowInventory((prev) => !prev);
        return;
      }

      // AI pause controls (work when AI is active, regardless of turn)
      if (hasAI) {
        // Shift+Space or M: toggle step mode (BG3 easter egg)
        if ((e.code === 'Space' && e.shiftKey) || e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          setStepMode(mode => mode === 'action' ? 'round' : 'action');
          return;
        }
        // Space: toggle pause (only when not waiting for player)
        if (e.code === 'Space' && !e.shiftKey && !isWaitingForPlayer) {
          e.preventDefault();
          togglePause();
          return;
        }
        // Tab: step forward (only when paused)
        if (e.key === 'Tab' && isPaused) {
          e.preventDefault();
          step();
          return;
        }
      }

      // Only process game actions if we're waiting for player input
      if (!isWaitingForPlayer || !waitingPlayerId || isEnded) return;

      const crawlers = getCrawlers(state);
      const player = crawlers.find(c => c.id === waitingPlayerId);
      const monsters = getMonstersInArea(state, state.currentAreaId);

      if (!player) {
        console.warn('[PlayGame] Waiting player not found', { turn: state.turn, waitingPlayerId });
        return;
      }

      // --- Targeting Mode Controls ---
      if (targetingState.active) {
        // Cancel targeting
        if (e.key === 'Escape') {
          e.preventDefault();
          setTargetingState(INACTIVE_TARGETING);
          return;
        }
        // Cycle targets (up/left = prev, down/right = next)
        if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'ArrowLeft' || e.key === 'h') {
          e.preventDefault();
          setTargetingState(cycleTargetPrev);
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowRight' || e.key === 'l') {
          e.preventDefault();
          setTargetingState(cycleTargetNext);
          return;
        }
        // Fire at target
        if (e.key === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          const targetId = getCurrentTargetId(targetingState);
          if (targetId && waitingPlayerId) {
            const target = getEntity(state, targetId as string);
            if (target && player) {
              // Store targetId - we'll recalculate direction/distance at dispatch time
              // in case the target moves during the dice animation
              setPendingRangedAttack({
                attackerId: waitingPlayerId,
                targetId: targetId as string,
                targetName: target.name,
              });
            }
          }
          setTargetingState(INACTIVE_TARGETING);
          return;
        }
        // Block other keys while targeting
        e.preventDefault();
        return;
      }

      // Enter targeting mode (f or r)
      if (e.key === 'f' || e.key === 'r') {
        e.preventDefault();
        if (player) {
          const currentArea = getCurrentArea(state);
          const result = enterTargetingMode(player, monsters, currentArea.map);
          if (result.failureReason) {
            // Show feedback about why targeting mode failed
            const feedbackMessages = {
              no_ranged_weapon: 'No ranged weapon equipped',
              no_ammo: 'No ammo available',
              no_targets: 'No valid targets in range',
            };
            setTargetingFeedback(feedbackMessages[result.failureReason]);
            // Auto-dismiss after 2 seconds
            setTimeout(() => setTargetingFeedback(null), 2000);
          } else {
            setTargetingState(result.state);
          }
        }
        return;
      }

      // Movement and attack
      const direction = KEY_TO_DIRECTION[e.key];
      if (direction) {
        e.preventDefault();
        const [dx, dy] = DIRECTION_DELTAS[direction];
        const targetX = player.x + dx;
        const targetY = player.y + dy;
        const hasMonster = monsters.some((m) => m.x === targetX && m.y === targetY);

        if (hasMonster) {
          // Show dice roll button before attacking
          setPendingAttack({ attackerId: waitingPlayerId, direction });
        } else {
          dispatch(waitingPlayerId, {
            action: 'move',
            direction,
            reasoning: 'Player keyboard input',
          });
        }
        return;
      }

      // Wait
      if (e.key === ' ' || e.key === '.') {
        e.preventDefault();
        dispatch(waitingPlayerId, { action: 'wait', reasoning: 'Player chose to wait' });
        return;
      }

      // Pickup item (g or ,)
      if (e.key === 'g' || e.key === ',') {
        e.preventDefault();
        const itemAtFeet = getItemAtPosition(state.items, player.x, player.y, player.areaId);
        if (itemAtFeet) {
          dispatch(waitingPlayerId, { action: 'pickup', reasoning: 'Player picks up item' });
        }
        return;
      }

      const inventory = player.inventory ?? [];

      // Equip weapon (e) - cycles through weapons in inventory
      if (e.key === 'e') {
        e.preventDefault();
        const nextWeapon = getNextEquipment(inventory, 'weapon', player.equippedWeapon);
        if (nextWeapon) {
          dispatch(waitingPlayerId, {
            action: 'equip',
            itemType: nextWeapon.templateId,
            reasoning: 'Player cycles to next weapon',
          });
        }
        return;
      }

      // Equip armor (Shift+E) - cycles through armor in inventory
      if (e.key === 'E' && e.shiftKey) {
        e.preventDefault();
        const nextArmor = getNextEquipment(inventory, 'armor', player.equippedArmor);
        if (nextArmor) {
          dispatch(waitingPlayerId, {
            action: 'equip',
            itemType: nextArmor.templateId,
            reasoning: 'Player cycles to next armor',
          });
        }
        return;
      }

      // Use item (Shift+U) - uses first consumable from inventory
      // Note: lowercase 'u' conflicts with vi-key northeast movement
      if (e.key === 'U') {
        e.preventDefault();
        const useItem = findInventoryItem(inventory, (item) => {
          const template = getItemTemplate(item.templateId);
          return template?.type === 'consumable';
        });
        if (useItem) {
          dispatch(waitingPlayerId, {
            action: 'use',
            itemType: useItem.templateId,
            reasoning: 'Player uses item',
          });
        }
        return;
      }

      // Drop item (D) - drops first item from inventory (use Shift+D to avoid conflicts)
      if (e.key === 'D') {
        e.preventDefault();
        if (inventory.length > 0) {
          dispatch(waitingPlayerId, {
            action: 'drop',
            itemType: inventory[0].templateId,
            reasoning: 'Player drops item',
          });
        }
        return;
      }

      // Enter portal (> or <) - traditional roguelike keys for stairs
      if (e.key === '>' || e.key === '<') {
        e.preventDefault();
        const currentArea = getCurrentArea(state);
        if (currentArea) {
          const tile = getTile(currentArea.map, player.x, player.y);
          if (tile?.type === 'portal') {
            dispatch(waitingPlayerId, {
              action: 'enter_portal',
              reasoning: 'Player enters portal',
            });
          }
        }
        return;
      }
    },
    [state, isEnded, isWaitingForPlayer, waitingPlayerId, dispatch, showHelp, showInventory, findInventoryItem, hasAI, isPaused, togglePause, setStepMode, step, targetingState]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle dice roll completion for player attacks
  const handleDiceRollComplete = useCallback((diceResult: { total: number; rolls: number[] }) => {
    if (!pendingAttack) return;

    // Dispatch the attack action with the pre-rolled d20 value
    dispatch(pendingAttack.attackerId as Parameters<typeof dispatch>[0], {
      action: 'attack',
      direction: pendingAttack.direction,
      reasoning: 'Player attack',
      preRolledD20: diceResult.rolls[0], // Use the first roll (1d20)
    });

    setPendingAttack(null);
  }, [pendingAttack, dispatch]);

  // Handle dice roll completion for ranged attacks
  const handleRangedAttackRoll = useCallback((roll: number) => {
    if (!pendingRangedAttack) return;

    // Get attacker and target to verify they still exist and calculate distance
    const attacker = getEntity(state, pendingRangedAttack.attackerId);
    const target = getEntity(state, pendingRangedAttack.targetId);

    if (!attacker || !target) {
      // Target died or attacker is gone - cancel the attack
      setPendingRangedAttack(null);
      return;
    }

    // Calculate direction/distance for display purposes (action uses targetId for precision)
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const direction = getDirectionFromDelta(dx, dy);

    // Dispatch with targetId for precise targeting (direction/distance only for AI fallback)
    dispatch(pendingRangedAttack.attackerId as Parameters<typeof dispatch>[0], {
      action: 'ranged_attack',
      direction,
      distance,
      targetId: pendingRangedAttack.targetId, // Precise targeting - simulation uses this
      targetName: pendingRangedAttack.targetName,
      reasoning: 'Player ranged attack',
      preRolledD20: roll,
    });
    setPendingRangedAttack(null);
  }, [pendingRangedAttack, dispatch, state]);

  const handleReset = useCallback(() => {
    gameCompletedRef.current = false;
    playStatsUpdatedRef.current = false;
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setStartTime(Date.now());
    setExpandedMessages(new Set());
    setPendingAttack(null);
    setPendingRangedAttack(null);
    setTargetingState(INACTIVE_TARGETING);
    setTargetingFeedback(null);
    onGameStart?.(newSessionId, hasAI ? 'ai' : 'human');
    // Note: initialMonsterCountRef will be stale after reset, but the game component
    // is re-created with a new key when reset is called, so this callback won't be used
    reset();
    onReset?.();
  }, [reset, onReset, onGameStart, hasAI]);

  const isVictory = state.gameStatus.status === 'ended' && state.gameStatus.victory;
  // Use viewport height (20 tiles) to fit on screen with header/footer
  const VIEWPORT_HEIGHT = 20;
  const canvasHeight = VIEWPORT_HEIGHT * TILE_SIZE;

  const crawlers = getCrawlers(state);
  const monsters = getMonstersInArea(state, state.currentAreaId);

  // Get the first player-controlled crawler for inventory modal
  const playerConfigIndex = crawlerConfigs.findIndex(c => c.control === 'player');
  const player = playerConfigIndex >= 0 ? crawlers[playerConfigIndex] : undefined;

  const isAIThinking = gameStatus.status === 'ai_thinking';

  function getStatusText(): string {
    if (isEnded) return 'Ended';
    if (isAIThinking) return 'AI Thinking...';
    if (isWaitingForPlayer) return 'Your Turn';
    return 'Processing...';
  }

  function getControlsHint(): string {
    if (isWaitingForPlayer) return 'Arrow/WASD to move · g to pickup · e to equip · ? for help';
    if (hasAI) return hasPlayer ? 'AI is playing (waiting for your turn)' : 'AI is playing';
    return 'Waiting...';
  }

  return (
    <>
      <Toast />
      <main className="min-h-screen p-4">
        <div className="max-w-[900px] mx-auto">
        <h1
          className="text-[1.75rem] font-bold text-center mb-4 tracking-wide"
          style={{ color: 'var(--player)', textShadow: '0 0 20px var(--glow-player)' }}
        >
          {title}
        </h1>

        {/* Crawler Controls */}
        <div className="flex items-center justify-center gap-4 mb-4 px-2">
          {/* Crawler 1 control */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-muted)]">Crawler 1:</span>
            <select
              value={crawlerConfigs[0]?.control ?? 'player'}
              onChange={(e) => onConfigChange(0, e.target.value as CrawlerControl)}
              disabled={isEnded || (crawlers[0] != null && crawlers[0].hp <= 0)}
              className="px-3 py-1.5 rounded text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] cursor-pointer hover:border-[var(--text-muted)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="player">Player</option>
              <option value="ai">AI</option>
            </select>
          </div>

          {/* Crawler 2 control or Add button */}
          {crawlerConfigs.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-muted)]">Crawler 2: AI</span>
              <button
                onClick={() => onRemoveCrawler(1)}
                disabled={isEnded}
                className="px-2 py-1 text-xs rounded bg-transparent text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--danger)] hover:text-[var(--danger)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={onAddCrawler}
              disabled={isEnded}
              className="px-3 py-1.5 rounded text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] cursor-pointer hover:border-[var(--ai)] hover:text-[var(--ai)] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Add Crawler 2
            </button>
          )}

        </div>

        {/* Error display */}
        {gameStatus.status === 'error' && (
          <div className="mb-4 p-3 rounded bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-center">
            <span className="text-[var(--danger)] text-sm">{gameStatus.message}</span>
          </div>
        )}

        {/* Main game area */}
        <div className="flex gap-4 justify-center items-start">
          {/* Left column: HUD + Canvas */}
          <div className="flex flex-col">
            {/* HUD Bar */}
            <div className="bg-[var(--bg-surface)] border-b border-[var(--border)] rounded-t px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-[var(--text-muted)] uppercase text-xs tracking-wider">Turn</span>{' '}
                  <span className="text-[var(--text)] font-medium">{state.turn}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] uppercase text-xs tracking-wider">Floor</span>{' '}
                  <span className="text-[var(--text)] font-medium">{getCurrentArea(state).metadata.name}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] uppercase text-xs tracking-wider">Monsters</span>{' '}
                  <span className="text-[var(--text)] font-medium">{monsters.length}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={isAIThinking ? 'animate-[pulse_1.5s_ease-in-out_infinite]' : ''}
                  style={{ color: hasAI ? 'var(--ai)' : 'var(--text-muted)' }}
                >
                  {hasAI ? '\u25C6' : '\u25C7'}
                </span>
                <span className="text-[var(--text-muted)]">
                  {getStatusText()}
                </span>
                {hasAI && modelId && (
                  <span className="text-[var(--text-muted)]/60 text-xs">
                    · {formatModelName(modelId)}
                  </span>
                )}
              </div>
            </div>

            {/* Game canvas */}
            <div className="relative border border-[var(--border)] border-t-0 rounded-b overflow-hidden">
              <GameCanvas state={state} tileSize={TILE_SIZE} targetingState={targetingState} />
              <ThoughtBubbles thoughts={thoughts} crawlers={crawlers} tileSize={TILE_SIZE} />
              {/* Targeting Mode Indicator */}
              {targetingState.active && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-900/90 text-red-100 rounded-lg border border-red-500 text-sm font-bold z-10">
                  TARGETING - {(() => {
                    const targetId = getCurrentTargetId(targetingState);
                    const target = targetId ? getEntity(state, targetId as string) : null;
                    return target ? `${target.name} (${targetingState.currentIndex + 1}/${targetingState.validTargets.length})` : 'No target';
                  })()}
                </div>
              )}
              {/* Targeting Feedback Message */}
              {targetingFeedback && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 px-4 py-2 bg-yellow-900/90 text-yellow-100 rounded-lg border border-yellow-500 text-sm font-medium z-10">
                  {targetingFeedback}
                </div>
              )}
              {hasAI && (
                <AIPauseControls
                  isPaused={isPaused}
                  stepMode={stepMode}
                  onTogglePause={togglePause}
                  onStep={step}
                  onStepModeChange={setStepMode}
                />
              )}
            </div>
          </div>

          {/* Middle column: Crawler Status + Objectives */}
          <div
            className="w-[280px] flex flex-col gap-3"
            style={{ maxHeight: `${canvasHeight + 48}px` }}
          >
            {/* Crawler Cards */}
            <div>
              <div className="text-[0.7rem] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-widest">
                Crawlers ({crawlers.length})
              </div>
              <div className="space-y-2">
                {crawlers.map((crawler, i) => {
                  const ratio = crawler.hp / crawler.maxHp;
                  const hpColor = getHpColorFromRatio(ratio);
                  const config = crawlerConfigs[i];
                  const isPlayerControlled = config?.control === 'player';
                  const isThisPlayerWaiting = isWaitingForPlayer && waitingPlayerId === crawler.id;

                  return (
                    <div
                      key={crawler.id}
                      className={`p-2 rounded bg-[var(--bg-elevated)] border-l-2 ${
                        isThisPlayerWaiting ? 'ring-1 ring-[var(--player)]' : ''
                      }`}
                      style={{ borderLeftColor: hpColor }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-[var(--text)]">
                            {crawler.characterClass
                              ? formatCharacterTitle(crawler.name, crawler.characterClass)
                              : crawler.name}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.6rem] font-semibold transition-all duration-300 ${
                              isPlayerControlled
                                ? 'bg-[var(--player)]/20 text-[var(--player)]'
                                : 'bg-[var(--ai)]/20 text-[var(--ai)]'
                            }`}
                          >
                            <span className="transition-transform duration-300" aria-hidden="true">
                              {isPlayerControlled ? '🎮' : '🤖'}
                            </span>
                            {isPlayerControlled ? 'YOU' : 'AI'}
                          </span>
                          {aiTransitioningIds.has(toCrawlerId(crawler.id)) && (
                            <span className="text-[0.6rem] text-[var(--text-muted)] italic animate-pulse">
                              AI finishing turn…
                            </span>
                          )}
                        </div>
                        <span style={{ color: hpColor }} className="text-xs font-medium">
                          {crawler.hp}/{crawler.maxHp} HP
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 h-1 bg-[var(--bg-deep)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300 ease-out"
                            style={{
                              width: `${ratio * 100}%`,
                              backgroundColor: hpColor,
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        ({crawler.x}, {crawler.y}) · ATK {getEffectiveAttack(crawler)} · DEF {getEffectiveDefense(crawler)}
                      </div>

                      {/* Active effects display */}
                      {(crawler.activeEffects ?? []).length > 0 && (
                        <EffectPills effects={crawler.activeEffects!} />
                      )}

                      {/* Inventory display for player-controlled crawlers */}
                      {isPlayerControlled && (
                        <div className="mt-2 pt-2 border-t border-[var(--border)]">
                          <ErrorBoundary
                            onError={(error, context) => {
                              console.error('[InventoryPanel] Error:', error, context);
                            }}
                          >
                            <InventoryPanel crawler={crawler} />
                          </ErrorBoundary>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Objectives Panel */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <ObjectivesPanel
                objectives={state.objectives}
                crawlers={crawlers}
                recentlyCompletedIds={recentlyCompletedIds}
              />
            </div>
          </div>

          {/* Right column: Narration + Event Log */}
          <div
            className="w-[340px] flex flex-col gap-3"
            style={{ maxHeight: `${canvasHeight + 48}px` }}
          >
            {/* Narration Panel */}
            <div>
              <div className="text-[0.7rem] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-widest">
                Narration
              </div>
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded max-h-64 overflow-y-auto">
                <NarrationPanel narrations={narrations} />
              </div>
            </div>

            {/* Event Log */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="text-[0.7rem] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-widest">
                Event Log
              </div>
              <div
                className="flex-1 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border)] rounded"
                style={{
                  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3)',
                }}
              >
                <div className="p-2 bg-[var(--bg-deep)] min-h-full">
                  {state.messages.length === 0 ? (
                    <p className="text-[var(--text-muted)] italic text-xs">No events yet...</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {reversedMessages.map((msg) => {
                        const isExpanded = expandedMessages.has(msg.id);
                        const tokPerSec = msg.aiMetadata ? formatTokensPerSec(msg.aiMetadata) : null;
                        const isExpandable = msg.reasoning || msg.combatDetails;
                        return (
                          <div
                            key={msg.id}
                            role={isExpandable ? 'button' : undefined}
                            tabIndex={isExpandable ? 0 : undefined}
                            aria-expanded={isExpandable ? isExpanded : undefined}
                            className={`p-1.5 rounded text-xs bg-[var(--bg-elevated)] border-l-2 border-l-[var(--border)] ${
                              msg.id === newestMessageId ? 'event-log-new' : ''
                            } ${isExpandable ? 'cursor-pointer hover:bg-[var(--bg-surface)]' : ''}`}
                            onClick={() => isExpandable && toggleExpanded(msg.id)}
                            onKeyDown={(e) => {
                              if (isExpandable && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                toggleExpanded(msg.id);
                              }
                            }}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[var(--text-muted)] text-[0.65rem]">T{msg.turn}</span>
                              {(msg.reasoning || msg.combatDetails) && (
                                <span className="text-[var(--text-muted)] text-[0.6rem] transition-transform" aria-hidden="true">
                                  {isExpanded ? '\u25BC' : '\u25B6'}
                                </span>
                              )}
                            </div>
                            <p className="text-[var(--text)]/90 text-[0.7rem] leading-snug">
                              {msg.text}
                            </p>
                            {msg.reasoning && isExpanded && (
                              <div className="mt-1.5 pl-3 border-l border-[var(--border)]">
                                <p className="text-[var(--text-muted)] text-[0.65rem] italic leading-snug">
                                  {msg.reasoning}
                                </p>
                                {msg.aiMetadata && (
                                  <p className="text-[var(--text-muted)]/60 text-[0.6rem] mt-1">
                                    {formatDuration(msg.aiMetadata.durationMs)}
                                    {tokPerSec && ` \u00B7 ${tokPerSec}`}
                                    {msg.aiMetadata.modelId && ` \u00B7 ${msg.aiMetadata.modelId}`}
                                  </p>
                                )}
                              </div>
                            )}
                            {msg.combatDetails && isExpanded && (
                              <div className="mt-1.5 pl-3 border-l border-[var(--border)]">
                                <p className="text-[var(--text-muted)] text-[0.65rem] leading-snug">
                                  Roll: {msg.combatDetails.roll}
                                  {msg.combatDetails.isCritical && ' (Critical!)'}
                                  {msg.combatDetails.isFumble && ' (Fumble)'}
                                  {' + ATK('}{msg.combatDetails.attackerAtk}{') = '}
                                  {msg.combatDetails.roll + msg.combatDetails.attackerAtk}
                                  {' vs DC '}{msg.combatDetails.targetDC}
                                  {' (7+DEF '}{msg.combatDetails.defenderDef}{')'}
                                  {' \u2192 '}{msg.combatDetails.hit ? 'Hit' : 'Miss'}
                                </p>
                                {msg.combatDetails.hit && (
                                  <p className="text-[var(--text-muted)] text-[0.65rem] leading-snug">
                                    Damage: ATK({msg.combatDetails.attackerAtk})
                                    {' - DEF('}{msg.combatDetails.defenderDef}{')/2 = '}
                                    {msg.combatDetails.baseDamage}
                                    {msg.combatDetails.isCritical && ` \u00D7 2 = ${msg.combatDetails.damage}`}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls hint */}
        <div className="text-xs text-[var(--text-muted)] text-center mt-4">
          <p>{getControlsHint()}</p>
        </div>

        {/* Help Modal */}
        {showHelp && (
          <div
            className={MODAL_BACKDROP_CLASSES}
            style={MODAL_FADE_STYLE}
            onClick={() => setShowHelp(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <div
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-6 max-w-md w-full shadow-2xl max-h-[80vh] overflow-y-auto"
              style={{ animation: 'scaleIn 200ms ease-out' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 id="help-title" className="text-lg font-semibold text-[var(--text)]">
                  Controls
                </h2>
                <button
                  onClick={() => setShowHelp(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
                  aria-label="Close help"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4 text-sm">
                {/* Movement */}
                <div>
                  <h3 className="text-[var(--player)] font-medium mb-2">Movement</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                    <span>Arrow keys</span><span className="text-[var(--text)]">Cardinal movement</span>
                    <span>WASD</span><span className="text-[var(--text)]">Cardinal movement</span>
                    <span>yuhjklbn</span><span className="text-[var(--text)]">8-way movement (vi keys)</span>
                    <span>Numpad 1-9</span><span className="text-[var(--text)]">8-way movement</span>
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <h3 className="text-[var(--player)] font-medium mb-2">Actions</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                    <span>Space or .</span><span className="text-[var(--text)]">Wait one turn</span>
                    <span>Move into enemy</span><span className="text-[var(--text)]">Melee attack</span>
                  </div>
                </div>

                {/* Ranged Combat */}
                <div>
                  <h3 className="text-[var(--player)] font-medium mb-2">Ranged Combat</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                    <span>f or r</span><span className="text-[var(--text)]">Enter targeting mode</span>
                    <span>Arrow keys / hjkl</span><span className="text-[var(--text)]">Cycle targets</span>
                    <span>Enter or Space</span><span className="text-[var(--text)]">Fire at target</span>
                    <span>Escape</span><span className="text-[var(--text)]">Cancel targeting</span>
                  </div>
                </div>

                {/* Inventory */}
                <div>
                  <h3 className="text-[var(--player)] font-medium mb-2">Inventory</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                    <span>i</span><span className="text-[var(--text)]">Open inventory</span>
                    <span>g or ,</span><span className="text-[var(--text)]">Pick up item</span>
                    <span>e</span><span className="text-[var(--text)]">Cycle weapons</span>
                    <span>Shift+E</span><span className="text-[var(--text)]">Cycle armor</span>
                    <span>Shift+U</span><span className="text-[var(--text)]">Use consumable</span>
                    <span>Shift+D</span><span className="text-[var(--text)]">Drop item</span>
                  </div>
                </div>

                {/* Navigation */}
                <div>
                  <h3 className="text-[var(--player)] font-medium mb-2">Navigation</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                    <span>&gt; or &lt;</span><span className="text-[var(--text)]">Use stairs/portal</span>
                  </div>
                </div>

                {/* Other */}
                <div>
                  <h3 className="text-[var(--player)] font-medium mb-2">Other</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                    <span>? or /</span><span className="text-[var(--text)]">Toggle this help</span>
                    <span>Escape</span><span className="text-[var(--text)]">Close dialogs</span>
                  </div>
                </div>

                {/* AI Playback (only when AI is enabled) */}
                {hasAI && (
                  <div>
                    <h3 className="text-[var(--ai)] font-medium mb-2">AI Playback</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                      <span>Space</span><span className="text-[var(--text)]">Pause / Resume</span>
                      <span>Tab</span><span className="text-[var(--text)]">Step forward (when paused)</span>
                      <span>M</span><span className="text-[var(--text)]">Toggle step mode</span>
                      <span>Shift+Space</span><span className="text-[var(--text)]">Toggle step mode</span>
                    </div>
                  </div>
                )}

                {/* System (only when AI is enabled and model is known) */}
                {hasAI && modelId && (
                  <div>
                    <h3 className="text-[var(--ai)] font-medium mb-2">System</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
                      <span>Model</span>
                      <span className="text-[var(--text)]">
                        {formatModelName(modelId)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
                <p>Tip: Attacks happen automatically when you move into an enemy.</p>
              </div>
            </div>
          </div>
        )}

        {/* Dice Roll overlay for player attacks */}
        {pendingAttack && (
          <DiceRollOverlay
            title="Roll to Hit!"
            titleId="dice-roll-title"
            onRollComplete={handleDiceRollComplete}
          />
        )}

        {/* Dice Roll overlay for ranged attacks */}
        {pendingRangedAttack && (() => {
          // Calculate current distance (may change as target moves)
          const attacker = getEntity(state, pendingRangedAttack.attackerId);
          const target = getEntity(state, pendingRangedAttack.targetId);
          const distance = attacker && target
            ? Math.max(Math.abs(target.x - attacker.x), Math.abs(target.y - attacker.y))
            : '?';
          return (
            <DiceRollOverlay
              title="Ranged Attack!"
              subtitle={`Target: ${pendingRangedAttack.targetName} (${distance} tiles)`}
              titleId="ranged-dice-roll-title"
              onRollComplete={(result) => handleRangedAttackRoll(result.rolls[0])}
            />
          );
        })()}

        {/* Inventory Modal */}
        {player && (
          <InventoryModal
            isOpen={showInventory}
            crawler={player}
            onClose={() => setShowInventory(false)}
            onEquip={(itemType) => {
              dispatch(toCrawlerId(player.id), {
                action: 'equip',
                itemType,
                reasoning: 'Player equips item from inventory',
              });
            }}
            onUse={(itemType) => {
              dispatch(toCrawlerId(player.id), {
                action: 'use',
                itemType,
                reasoning: 'Player uses item from inventory',
              });
            }}
            onDrop={(itemType) => {
              dispatch(toCrawlerId(player.id), {
                action: 'drop',
                itemType,
                reasoning: 'Player drops item from inventory',
              });
            }}
          />
        )}

        {/* Victory/Defeat overlay */}
        {isEnded && (
          <div
            className={MODAL_BACKDROP_CLASSES}
            style={MODAL_FADE_STYLE}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-result-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Enter') handleReset();
            }}
          >
            <div className="text-center">
              <p
                id="game-result-title"
                className={`text-4xl font-bold mb-4 ${isVictory ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
                style={{ animation: 'scaleIn 200ms ease-out' }}
              >
                {isVictory ? 'Victory!' : 'Game Over'}
              </p>
              <button
                onClick={handleReset}
                autoFocus
                className="px-6 py-2 bg-[var(--player)] text-white rounded font-medium hover:brightness-110 transition-all duration-150"
                style={{ animation: 'fadeIn 200ms ease-out 100ms both' }}
              >
                Play Again
              </button>
            </div>
          </div>
        )}
        </div>
      </main>
    </>
  );
}

/**
 * Inner component that uses the CharacterRosterContext.
 * Separated from PlayGame to allow using the useCharacterRoster hook.
 */
function PlayGameContent(props: PlayGameProps) {
  const roster = useCharacterRoster();

  const [crawlerConfigs, setCrawlerConfigs] = useState<[CrawlerConfig, ...CrawlerConfig[]]>([
    { id: crawlerIdFromIndex(1), control: 'player' },
  ]);

  // Character creation state
  const [showCharacterCreation, setShowCharacterCreation] = useState(true);
  const [characterCreation, setCharacterCreation] = useState<CharacterCreation | null>(null);

  // Save prompt state
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [pendingCharacter, setPendingCharacter] = useState<CharacterCreation | null>(null);

  // Track if playing with a saved character (for updating play stats later)
  const [savedCharacterId, setSavedCharacterId] = useState<string | null>(null);

  const handleCharacterSubmit = useCallback((character: CharacterCreation, savedId?: string) => {
    if (savedId) {
      // Character was loaded from roster - start game directly
      setCharacterCreation(character);
      setSavedCharacterId(savedId);
      setShowCharacterCreation(false);
    } else {
      // New character - show save prompt
      setPendingCharacter(character);
      setShowCharacterCreation(false);
      setShowSavePrompt(true);
    }
  }, []);

  const handleSavePromptSave = useCallback(async (replaceId?: string) => {
    if (!pendingCharacter) return;

    try {
      // If replacing, delete the old character first
      if (replaceId) {
        await roster.deleteCharacter(replaceId);
      }

      // Save the new character
      const saved = await roster.saveCharacter(pendingCharacter);
      setSavedCharacterId(saved.id);
    } catch (error) {
      console.error('[PlayGame] Failed to save character', error);
    }

    // Start the game regardless of save success
    setCharacterCreation(pendingCharacter);
    setPendingCharacter(null);
    setShowSavePrompt(false);
  }, [pendingCharacter, roster]);

  const handleSavePromptSkip = useCallback(() => {
    if (!pendingCharacter) return;

    // Start game without saving
    setCharacterCreation(pendingCharacter);
    setSavedCharacterId(null);
    setPendingCharacter(null);
    setShowSavePrompt(false);
  }, [pendingCharacter]);

  const handleQuickStart = useCallback(() => {
    // null means use random generation
    setCharacterCreation(null);
    setSavedCharacterId(null);
    setShowCharacterCreation(false);
  }, []);

  const handleConfigChange = useCallback((index: number, control: CrawlerControl) => {
    setCrawlerConfigs((prev) =>
      prev.map((c, i) => (i === index ? { ...c, control } : c)) as [CrawlerConfig, ...CrawlerConfig[]]
    );
  }, []);

  const handleAddCrawler = useCallback(() => {
    setCrawlerConfigs((prev) => [
      ...prev,
      { id: crawlerIdFromIndex(prev.length + 1), control: 'ai' as const },
    ] as [CrawlerConfig, ...CrawlerConfig[]]);
  }, []);

  const handleRemoveCrawler = useCallback((index: number) => {
    setCrawlerConfigs((prev) => {
      if (prev.length <= 1) return prev; // Never remove the last crawler
      return prev.filter((_, i) => i !== index) as [CrawlerConfig, ...CrawlerConfig[]];
    });
  }, []);

  const handleReset = () => {
    window.location.reload();
  };

  // Update play stats when game ends (only for saved characters)
  const handleGameEndStats = useCallback(
    async (stats: { floorReached: number; died: boolean; monstersKilled: number }) => {
      if (!savedCharacterId) return;

      // Find the saved character to get current stats
      const savedChar = roster.characters.find((c) => c.id === savedCharacterId);
      if (!savedChar) {
        console.warn('[PlayGame] Could not find saved character to update play stats', { savedCharacterId });
        return;
      }

      try {
        await roster.updatePlayStats(savedCharacterId, {
          gamesPlayed: savedChar.playStats.gamesPlayed + 1,
          deaths: savedChar.playStats.deaths + (stats.died ? 1 : 0),
          maxFloorReached: Math.max(savedChar.playStats.maxFloorReached, stats.floorReached),
          monstersKilled: savedChar.playStats.monstersKilled + stats.monstersKilled,
        });
        console.log('[PlayGame] Updated play stats for saved character', {
          savedCharacterId,
          newStats: {
            gamesPlayed: savedChar.playStats.gamesPlayed + 1,
            deaths: savedChar.playStats.deaths + (stats.died ? 1 : 0),
            maxFloorReached: Math.max(savedChar.playStats.maxFloorReached, stats.floorReached),
            monstersKilled: savedChar.playStats.monstersKilled + stats.monstersKilled,
          },
        });
      } catch (error) {
        console.error('[PlayGame] Failed to update play stats', { error, savedCharacterId });
      }
    },
    [savedCharacterId, roster]
  );

  return (
    <ErrorBoundary onReset={handleReset} onError={props.onError}>
      {/* Character Creation Modal */}
      {showCharacterCreation && (
        <CharacterCreationModal
          isOpen={showCharacterCreation}
          onClose={() => setShowCharacterCreation(false)}
          onSubmit={handleCharacterSubmit}
          onQuickStart={handleQuickStart}
          seed={props.seed}
        />
      )}

      {/* Save Character Prompt */}
      {showSavePrompt && pendingCharacter && (
        <SaveCharacterPrompt
          isOpen={showSavePrompt}
          character={pendingCharacter}
          onSave={handleSavePromptSave}
          onSkip={handleSavePromptSkip}
          isFull={roster.isFull}
          savedCharacters={roster.characters}
        />
      )}

      {/* Main Game */}
      {!showCharacterCreation && !showSavePrompt && (
        <GameInner
          key={crawlerConfigs.map((c) => c.id).join(',') + (characterCreation?.name ?? 'random')}
          crawlerConfigs={crawlerConfigs}
          characterCreation={characterCreation}
          onConfigChange={handleConfigChange}
          onAddCrawler={handleAddCrawler}
          onRemoveCrawler={handleRemoveCrawler}
          onGameEndStats={handleGameEndStats}
          {...props}
        />
      )}

    </ErrorBoundary>
  );
}

/**
 * Main PlayGame component.
 * Wraps content in CharacterRosterProvider to enable character persistence.
 */
export function PlayGame(props: PlayGameProps) {
  // Create repository instance once
  const characterRepository = useMemo(() => new LocalStorageCharacterRepository(), []);

  return (
    <CharacterRosterProvider repository={characterRepository}>
      <PlayGameContent {...props} />
    </CharacterRosterProvider>
  );
}
