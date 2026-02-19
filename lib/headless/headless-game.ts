/**
 * Headless Game Runner
 *
 * Runs a complete game without UI, collecting traces for analysis.
 * Uses pluggable agents for AI decisions and trace writers for persistence.
 */

import type {
  HeadlessGameOptions,
  HeadlessGameResult,
  TurnRecord,
  ActionResult,
  CrawlerSummary,
  StateSnapshot,
} from './types';
import type { GameState, Action } from '../engine/state';
import { isCrawler, getCurrentArea } from '../engine/state';
import { simulate } from '../engine/simulation';
import { queueCommand } from '../engine/bubble';
import { createMultiFloorTestDungeon } from '../engine/maps';
import type { CrawlerId } from '../engine/crawler-id';
import { createLogger } from '../logging';
import { prepareAIDecision } from '../ai/decision-context';
import { renderMapSnapshot, buildStateSnapshot } from '../ai/trace-utils';
import { createCooldowns, type PerceptionCooldowns } from '../engine/perception-cooldowns';

const logger = createLogger({ module: 'headless-game' });

const DEFAULT_MAX_TURNS = 500;

/**
 * Run a complete headless game.
 *
 * @param options - Game configuration including agent and trace writer
 * @returns Result with trace ID, outcome, and statistics
 */
export async function runHeadlessGame(
  options: HeadlessGameOptions
): Promise<HeadlessGameResult> {
  const {
    seed = Math.floor(Math.random() * 1_000_000),
    agent,
    traceWriter,
    maxTurns = DEFAULT_MAX_TURNS,
    onTurnComplete,
    includeSnapshots = false,
    zoneConfig,
  } = options;

  const startTime = performance.now();

  // Initialize game state using existing factory
  // Note: zoneConfig.floorCount is reserved for future use when the dungeon
  // factory supports configurable floor counts
  let state = createMultiFloorTestDungeon({ seed, ...zoneConfig });

  // Extract initial crawler summaries
  const crawlerSummaries = extractCrawlerSummaries(state);

  // Start trace
  const traceId = await traceWriter.startGame({
    seed,
    zoneConfig: { seed, ...zoneConfig },
    crawlers: crawlerSummaries,
  });

  logger.info({ traceId, seed }, 'Starting headless game');

  // Track stats for trace
  const crawlerStats = new Map<string, {
    monstersKilled: number;
    damageDealt: number;
    damageTaken: number;
  }>();

  for (const crawler of Object.values(state.entities).filter(isCrawler)) {
    crawlerStats.set(crawler.id, { monstersKilled: 0, damageDealt: 0, damageTaken: 0 });
  }

  // Track perception cooldowns per crawler
  const crawlerCooldowns = new Map<string, PerceptionCooldowns>();
  for (const crawler of Object.values(state.entities).filter(isCrawler)) {
    crawlerCooldowns.set(crawler.id, createCooldowns());
  }

  // Game loop
  let turnCount = 0;
  let outcome: 'win' | 'loss' | 'timeout' = 'timeout';

  while (turnCount < maxTurns && state.gameStatus.status === 'playing') {
    // Run simulation until waiting for input
    const simResult = simulate(state);
    state = simResult.state;

    // Check for game end
    if (state.gameStatus.status === 'ended') {
      outcome = state.gameStatus.victory ? 'win' : 'loss';
      break;
    }

    // Process each waiting crawler
    for (const waitingId of simResult.waitingFor) {
      const crawlerId = waitingId as unknown as CrawlerId;
      const crawler = state.entities[crawlerId];

      if (!crawler || !isCrawler(crawler)) {
        logger.warn({ crawlerId }, 'Waiting entity is not a crawler');
        continue;
      }

      // Capture state before action
      const hpBefore = crawler.hp;
      const positionBefore = { x: crawler.x, y: crawler.y };

      // Get current floor from area metadata (dangerLevel equals floor number for dungeon areas)
      const currentArea = getCurrentArea(state);
      const floor = currentArea.metadata.dangerLevel;

      // Generate prompt and get AI action
      const cooldowns = crawlerCooldowns.get(crawlerId) ?? createCooldowns();
      const aiContext = prepareAIDecision(state, crawlerId as CrawlerId, cooldowns, { isYourTurn: true });
      const { prompt } = aiContext;
      crawlerCooldowns.set(crawlerId, aiContext.updatedCooldowns);

      // For debug logging
      const mapSnapshot = renderMapSnapshot(state, crawlerId as CrawlerId);

      // Log map snapshot for debugging/RL training
      if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace') {
        // Trim empty rows for compact display
        const lines = mapSnapshot.split('\n');
        const nonEmptyLines = lines.filter(line => line.trim().length > 0);

        // Find column bounds (trim leading/trailing empty columns)
        let minCol = Infinity, maxCol = 0;
        for (const line of nonEmptyLines) {
          const firstNonSpace = line.search(/\S/);
          const lastNonSpace = line.search(/\S\s*$/);
          if (firstNonSpace >= 0) minCol = Math.min(minCol, firstNonSpace);
          if (lastNonSpace >= 0) maxCol = Math.max(maxCol, lastNonSpace + 1);
        }

        // Trim columns and format with border
        const trimmedLines = nonEmptyLines.map(line => line.slice(Math.max(0, minCol - 1), maxCol + 1));
        const width = Math.max(...trimmedLines.map(l => l.length), 20);
        const border = '─'.repeat(width + 2);

        console.log(`┌─ MAP (Turn ${state.turn}) ${border.slice(Math.min(15, border.length))}┐`);
        trimmedLines.forEach(line => console.log(`│ ${line.padEnd(width)} │`));
        console.log(`└${border}┘`);
      }
      // Also log as structured data for programmatic access (RL training, etc.)
      logger.trace({ crawlerId, turn: state.turn, mapSnapshot }, 'Map snapshot data');

      let response;
      try {
        response = await agent.getAction(crawlerId, prompt, state);
      } catch (error) {
        logger.error({ crawlerId, error }, 'Agent failed to provide action');
        // Use wait as fallback - cast needed because ActionSchema is union
        response = {
          action: { action: 'wait' } as Action,
          reasoning: 'Agent error - defaulting to wait',
          shortThought: 'Error',
        };
      }

      // Queue the action
      const bubble = state.bubbles.find(b => b.entityIds.includes(waitingId));
      if (bubble) {
        const queueResult = queueCommand(bubble, waitingId, {
          ...response.action,
          reasoning: response.reasoning,
          aiMetadata: response.modelId ? {
            durationMs: response.durationMs ?? 0,
            outputTokens: response.outputTokens,
            modelId: response.modelId,
          } : undefined,
        });

        state = {
          ...state,
          bubbles: state.bubbles.map(b => b.id === bubble.id ? queueResult.bubble : b),
        };
      }

      // Capture message count before action
      const messageCountBefore = state.messages.length;

      // Simulate to process the action
      const afterAction = simulate(state);
      state = afterAction.state;

      // Extract new messages (what actually happened)
      const newMessages = state.messages.slice(messageCountBefore);
      const outcomes = newMessages.map(m => m.text);
      if (outcomes.length > 0) {
        logger.debug({ crawlerId, outcomes: outcomes.join(' | ') }, 'Action outcome');
      }

      // Capture state after action
      const crawlerAfter = state.entities[crawlerId];
      const hpAfter = crawlerAfter?.hp ?? 0;
      const positionAfter = crawlerAfter
        ? { x: crawlerAfter.x, y: crawlerAfter.y }
        : positionBefore;

      // Build action result
      const actionResult: ActionResult = {
        success: true,
        hpBefore,
        hpAfter,
        positionBefore,
        positionAfter,
        monstersKilled: [],
        monsterReactions: [],
        outcomes: outcomes.length > 0 ? outcomes : undefined,
      };

      // Build optional state snapshot
      let stateSnapshot: StateSnapshot | undefined;
      if (includeSnapshots && crawlerAfter) {
        stateSnapshot = buildStateSnapshot(state, crawlerId as CrawlerId);
      }

      // Write turn record
      const turnRecord: TurnRecord = {
        turn: state.turn,
        crawlerId,
        floor,
        prompt,
        response,
        actionResult,
        stateSnapshot,
      };

      await traceWriter.writeTurn(traceId, turnRecord);

      // Update stats
      const stats = crawlerStats.get(crawlerId);
      if (stats) {
        stats.damageTaken += Math.max(0, hpBefore - hpAfter);
      }

      turnCount++;

      // Callback for progress
      onTurnComplete?.(turnCount, state);

      // Check for game end after each action
      if (state.gameStatus.status === 'ended') {
        outcome = state.gameStatus.victory ? 'win' : 'loss';
        break;
      }
    }

    if (state.gameStatus.status === 'ended') {
      break;
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  // Get final floor (dangerLevel equals floor number for dungeon areas)
  const finalArea = getCurrentArea(state);
  const finalFloor = finalArea.metadata.dangerLevel;

  // Build final crawler summaries with stats
  const finalCrawlers = extractCrawlerSummaries(state, crawlerStats);

  // End trace
  await traceWriter.endGame(traceId, {
    outcome,
    finalFloor,
    totalTurns: turnCount,
    durationMs,
    crawlers: finalCrawlers,
  });

  // Notify agent
  if (agent.onGameEnd) {
    const trace = {
      id: traceId,
      version: 1 as const,
      seed,
      zoneConfig: { seed, ...zoneConfig },
      startedAt: new Date(startTime).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs,
      outcome,
      finalFloor,
      totalTurns: turnCount,
      crawlers: finalCrawlers,
      turns: [],
    };
    await agent.onGameEnd(trace);
  }

  logger.info({
    traceId,
    outcome,
    finalFloor,
    totalTurns: turnCount,
    durationMs,
  }, 'Headless game completed');

  return {
    traceId,
    outcome,
    finalFloor,
    totalTurns: turnCount,
    durationMs,
  };
}

/**
 * Extract crawler summaries from game state.
 */
function extractCrawlerSummaries(
  state: GameState,
  stats?: Map<string, { monstersKilled: number; damageDealt: number; damageTaken: number }>
): CrawlerSummary[] {
  return Object.values(state.entities)
    .filter(isCrawler)
    .map(crawler => {
      const crawlerStats = stats?.get(crawler.id);
      return {
        id: crawler.id,
        name: crawler.name,
        characterClass: crawler.characterClass ?? 'unknown',
        bio: crawler.bio,
        finalHp: crawler.hp,
        maxHp: crawler.maxHp,
        monstersKilled: crawlerStats?.monstersKilled ?? 0,
        damageDealt: crawlerStats?.damageDealt ?? 0,
        damageTaken: crawlerStats?.damageTaken ?? 0,
      };
    });
}
