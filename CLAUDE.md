# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@crawlerverse/core` — an AI-native roguelike game engine with multi-agent support. Built as a Next.js app (demo UI) that also publishes its `lib/` as an npm package. The engine is isomorphic (runs on client and server).

## Commands

```bash
pnpm install          # Install deps (runs postinstall to copy dice assets)
pnpm dev              # Start dev server on localhost:3001
pnpm build            # Production build (uses webpack, not turbopack)
pnpm test             # Run all tests once (vitest)
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report
pnpm type-check       # TypeScript strict mode check (tsc --noEmit)
pnpm lint             # ESLint
pnpm setup:ai         # Interactive wizard to configure AI provider in .env.local
pnpm headless         # Run headless game (AI-only simulation, no UI)
```

Run a single test file:
```bash
pnpm vitest run lib/engine/__tests__/combat.test.ts
```

CI runs: `type-check` → `lint` → `test` (all must pass).

## Architecture

### Engine (`lib/engine/`)

Pure, deterministic game logic. No side effects, no AI calls. All state is serializable JSON.

- **`state.ts`** — `GameState` type and `createGameState()` factory. Central data structure everything else operates on.
- **`types.ts`** — Shared types/schemas (Entity, Action, Position, Direction). Exists to break circular deps between state.ts and bubble.ts.
- **`simulation.ts`** — `simulate()` function: the main game loop. Processes entities in turn order within a bubble. Decoupled from scheduler implementation via the `Scheduler<TState>` interface.
- **`scheduler.ts`** — AP (Action Point) accumulation scheduler. Entities gain AP equal to their speed each tick; acting costs 100 AP. Branded `EntityId` type lives here.
- **`bubble.ts`** — Bubbles are localized simulation contexts. Groups of nearby entities share a bubble and scheduler. Bubbles merge when crawlers meet, split when they separate.
- **`actions.ts`** — `processAction()` resolves a single action against game state.
- **`combat.ts`** — D20-based combat resolution (attack rolls, damage calculation).
- **`map.ts`** — Dungeon generation, tile system, room extraction, spawn positions.
- **`fov.ts`** — Field of vision using rot-js. Cached per-entity visibility computation.
- **`behavior.ts`** — Monster AI state machine (patrol → alerted → chase → hunt → search → idle).
- **`perception.ts` / `perception-types.ts`** — Converts raw game state into natural-language observations for AI agents (health bands, equipment quality, etc).
- **`items.ts` / `inventory.ts` / `effects.ts`** — Item templates, inventory management, buff/debuff system.
- **`objective.ts` / `objective-generator.ts`** — Dynamic objective generation for AI crawlers.
- **`zone.ts`** — Multi-floor dungeon zones with procedural generation.
- **`character.ts` / `character-system.ts` / `character-repository.ts`** — Character classes, persistence, roster management.

### AI Layer (`lib/ai/`)

Bridges the engine with LLM providers. Uses Vercel AI SDK (`ai` package).

- **`providers.ts`** — `getAIModel()` returns a configured model instance. Supports gateway (Vercel AI Gateway), OpenRouter, and OpenAI-compatible (local LLMs like LMStudio/Ollama).
- **`schemas.ts`** — Zod schemas for AI structured output (action decisions).
- **`decision-context.ts`** — `prepareAIDecision()` builds the context object sent to AI agents (observations, available actions, inventory state).
- **`narrative-dm.ts`** — Narrative Dungeon Master: generates story narration from game events.

### Headless Mode (`lib/headless/`)

Run games without UI for benchmarking, trace collection, and ML training data.

- **`headless-game.ts`** — `runHeadlessGame()` orchestrates a complete game.
- **`agents/`** — Pluggable agent adapters: `AIAgent` (real LLM), `ScriptAgent` (deterministic), `ReplayAgent` (replay from trace).
- **`traces/`** — `FileTraceWriter` persists game traces as JSON for analysis.

### API Routes (`app/api/`, `lib/api/`)

Next.js route handlers for AI inference. The game client calls these to get AI decisions and narration.

- `app/api/ai/` — AI action decision endpoint
- `app/api/generate-bio/` — Character bio generation
- `app/api/generate-narration/` — Narrative text generation
- `lib/api/` — Handler implementations with Zod validation and structured error types.

### React Layer (`components/`, `hooks/`)

- **`hooks/useGame.ts`** — Core game hook. Manages state, dispatches player input, runs AI turns, handles simulation loop. Supports mixed player/AI crawler control.
- **`components/game/`** — Game UI components (map renderer, inventory, narration panel, observer mode).
- **`components/dice/`** — 3D dice rolling with `@3d-dice/dice-box`.
- **`components/ui/`** — Shared UI primitives (Toast).

### App Pages (`app/`)

- `/play` — Interactive game (player controls one or more crawlers)
- `/observe` — Observer mode (watch AI agents play autonomously)

## Key Patterns

- **Zod everywhere** — All data boundaries validated with Zod schemas. Entity, Action, GameState, AI responses all have schemas. Types are derived from schemas (`z.infer<typeof Schema>`).
- **Immutability** — Engine functions are pure. State is `Readonly<>`. No mutation of inputs.
- **Branded types** — `EntityId`, `CrawlerId`, `BubbleId` are branded strings to prevent misuse at type level.
- **`'use client'`** — Components and hooks that use React state/effects are marked as client components. Engine code is isomorphic.
- **Error handling** — Engine modules use "warn and continue" for non-fatal edge cases (logged via pino). Fatal errors (invalid schemas, empty IDs) throw exceptions.
- **Path alias** — `@/*` maps to project root (configured in tsconfig.json).

## Testing

- Vitest with jsdom environment. Tests live in `__tests__/` directories alongside source.
- Test pattern: `lib/**/__tests__/**/*.test.ts`, `components/**/__tests__/**/*.test.tsx`, `hooks/**/__tests__/**/*.test.{ts,tsx}`
- React Testing Library for component tests.
- Setup file: `vitest.setup.ts` (imports `@testing-library/jest-dom/vitest`).

## AI Provider Configuration

Configured via `.env.local` (not committed). Three providers:
1. **gateway** — Vercel AI Gateway (production, uses `AI_GATEWAY_API_KEY`)
2. **openrouter** — OpenRouter API (uses `OPENROUTER_API_KEY`)
3. **openai-compatible** — Local LLMs like LMStudio/Ollama (uses `OPENAI_COMPATIBLE_BASE_URL`)

Run `pnpm setup:ai` to configure interactively.

## Versioning

Uses [changesets](https://github.com/changesets/changesets) for version management. Package is published to npm as `@crawlerverse/core`.
