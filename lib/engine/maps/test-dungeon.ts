/**
 * Test Dungeon Factory
 *
 * Creates a hand-crafted test dungeon for development and testing.
 * Two rooms connected by a corridor - supports solo or two-agent modes.
 */

import { parseAsciiMap, type DungeonMap, type Room, type Zone, type Area } from '../map';
import { createMessage, type Entity, type GameState, isCrawler, DEFAULT_AREA_ID } from '../state';
import { createBubble, bubbleId, type Bubble } from '../bubble';
import { entityId, advanceScheduler, completeCurrentTurn, type SchedulerState } from '../scheduler';
import type { Objective } from '../objective';
import { generateCharacterIdentity, formatCharacterTitle, generateTraits } from '../character';
import { createRNG, type RNG } from '../rng';
import type { ItemInstance } from '../items';
import { z } from 'zod';
import {
  type CharacterCreation,
  CrawlerCharacterSystem,
  calculateFinalStats,
  SAFE_NAME_PATTERN,
} from '../character-system';

/**
 * Zod schema for CharacterCreation validation at engine boundary.
 * Ensures data integrity even if UI validation is bypassed.
 */
const CharacterCreationSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(20, 'Name must be 20 characters or less')
    .regex(SAFE_NAME_PATTERN, 'Name contains invalid characters'),
  characterClass: z.enum(['warrior', 'rogue', 'mage', 'cleric']),
  bio: z.string().max(250, 'Bio must be 250 characters or less'),
  statAllocations: z.object({
    hp: z.number().int().min(0),
    attack: z.number().int().min(0),
    defense: z.number().int().min(0),
    speed: z.number().int().min(0),
  }).refine(
    (allocs) => allocs.hp + allocs.attack + allocs.defense + allocs.speed <= CrawlerCharacterSystem.allocationPoints,
    { message: `Total allocations cannot exceed ${CrawlerCharacterSystem.allocationPoints} points` }
  ),
});

export interface TestDungeonOptions {
  /** Number of crawlers to spawn (1 to rooms.length). Default: 1 */
  readonly crawlerCount?: number;
  /** Seed for deterministic character generation. Default: Date.now() */
  readonly seed?: number;
  /** Optional character creation data for the first crawler */
  readonly characterCreation?: CharacterCreation;
}

export const TEST_DUNGEON_WIDTH = 30;
export const TEST_DUNGEON_HEIGHT = 15;

// Two rooms connected by a horizontal corridor
// Left room: 8x8 interior (starting room with rats)
// Right room: 10x8 interior (challenge room with troll and goblin)
// Corridor connects them at y=7
const TEST_DUNGEON_ASCII = `
##############################
#........#########...........#
#........#########...........#
#........#########...........#
#........#########...........#
#........#########...........#
#........#########...........#
#............................#
#........#########...........#
#........#########...........#
#........#########...........#
#........#########...........#
#........#########...........#
#........#########...........#
##############################
`.trim();

const TEST_DUNGEON_ROOMS: ReadonlyArray<Room> = [
  { x: 1, y: 1, width: 8, height: 13, center: { x: 5, y: 7 }, tags: ['starting'] },
  { x: 19, y: 1, width: 10, height: 13, center: { x: 24, y: 7 }, tags: [] },
];

const POSITIONS = {
  player1: { x: 4, y: 4 },
  player2: { x: 24, y: 4 },
  rat1: { x: 3, y: 3 },
  rat2: { x: 6, y: 5 },
  troll: { x: 24, y: 10 },
  goblin: { x: 22, y: 3 },
  // Item positions
  sword: { x: 5, y: 4 },  // One tile east of player1 spawn
} as const;

/**
 * Color palette for crawlers. Colors are picked by index.
 * Exported for use by GameCanvas and ActionLog.
 */
export const CRAWLER_COLORS = [
  '#ff6b6b',  // red
  '#4dabf7',  // blue
  '#69db7c',  // green
  '#ffd43b',  // yellow
  '#cc5de8',  // purple
  '#20c997',  // teal
] as const;

/** Spawn positions for crawlers, one per room */
const CRAWLER_SPAWNS = [
  POSITIONS.player1,  // Left room
  POSITIONS.player2,  // Right room
] as const;

/** Monsters assigned to each room by index */
const ROOM_MONSTERS = [
  ['rat-1', 'rat-2'],      // Left room monsters
  ['troll', 'goblin'],     // Right room monsters
] as const;

function createCrawlerEntity(
  index: number,
  rng: RNG,
  characterCreation?: CharacterCreation
): Entity {
  const pos = CRAWLER_SPAWNS[index];

  // Use character creation data if provided (only for first crawler)
  if (index === 0 && characterCreation) {
    const baseStats = CrawlerCharacterSystem.getBaseStats(characterCreation.characterClass);
    const finalStats = calculateFinalStats(baseStats, characterCreation.statAllocations);

    return {
      id: `crawler-${index + 1}`,
      type: 'crawler',
      x: pos.x,
      y: pos.y,
      areaId: 'area-1',  // Test dungeon uses single area
      hp: finalStats.hp,
      maxHp: finalStats.hp,
      name: characterCreation.name,
      characterClass: characterCreation.characterClass,
      bio: characterCreation.bio || undefined,
      char: '@',
      attack: finalStats.attack,
      defense: finalStats.defense,
      speed: finalStats.speed,
      traits: generateTraits(characterCreation.characterClass, rng),
    };
  }

  // Fall back to random generation with class-specific base stats
  const { characterClass, name } = generateCharacterIdentity(rng);
  const baseStats = CrawlerCharacterSystem.getBaseStats(characterClass);

  return {
    id: `crawler-${index + 1}`,
    type: 'crawler',
    x: pos.x,
    y: pos.y,
    areaId: 'area-1',  // Test dungeon uses single area
    hp: baseStats.hp,
    maxHp: baseStats.hp,
    name,
    characterClass,
    char: '@',
    attack: baseStats.attack,
    defense: baseStats.defense,
    speed: baseStats.speed,
    traits: generateTraits(characterClass, rng),
  };
}


/**
 * Creates a test dungeon game state.
 *
 * @param options - Configuration options for the test dungeon
 * @returns Initial GameState for the test dungeon
 */
export function createTestDungeon(options: TestDungeonOptions = {}): GameState {
  const crawlerCount = options.crawlerCount ?? 1;
  const seed = options.seed ?? Date.now();
  const maxCrawlers = TEST_DUNGEON_ROOMS.length;

  // Validate characterCreation if provided
  let characterCreation: CharacterCreation | undefined;
  if (options.characterCreation) {
    const result = CharacterCreationSchema.safeParse(options.characterCreation);
    if (!result.success) {
      throw new Error(`Invalid character creation data: ${result.error.issues.map(i => i.message).join(', ')}`);
    }
    characterCreation = result.data;
  }

  if (crawlerCount < 1) {
    throw new Error(`crawlerCount must be at least 1, got ${crawlerCount}`);
  }
  if (crawlerCount > maxCrawlers) {
    throw new Error(`crawlerCount cannot exceed room count (${maxCrawlers}), got ${crawlerCount}`);
  }

  // Create seeded RNG for deterministic character generation
  const rng = createRNG(seed);

  const { tiles, width, height } = parseAsciiMap(TEST_DUNGEON_ASCII);
  const map: DungeonMap = { width, height, tiles, rooms: [...TEST_DUNGEON_ROOMS], seed };

  // Create N crawlers
  const crawlers: Entity[] = [];
  for (let i = 0; i < crawlerCount; i++) {
    // Only apply characterCreation to the first crawler
    crawlers.push(createCrawlerEntity(i, rng, i === 0 ? characterCreation : undefined));
  }

  // Monster definitions: id -> stats
  const monsterStats = {
    'rat-1': { pos: POSITIONS.rat1, hp: 3, name: 'Rat', typeId: 'rat', attack: 1, defense: 0, speed: 120 },
    'rat-2': { pos: POSITIONS.rat2, hp: 3, name: 'Rat', typeId: 'rat', attack: 1, defense: 0, speed: 120 },
    troll: { pos: POSITIONS.troll, hp: 15, name: 'Troll', typeId: 'troll', attack: 4, defense: 2, speed: 80 },
    goblin: { pos: POSITIONS.goblin, hp: 5, name: 'Goblin', typeId: 'goblin', attack: 2, defense: 0, speed: 100 },
  } as const;

  // Goblin's equipped armor (will drop on death)
  const goblinArmor: ItemInstance = {
    id: 'goblin-armor',
    templateId: 'leather_armor',
    x: POSITIONS.goblin.x,
    y: POSITIONS.goblin.y,
    areaId: 'area-1',  // Test dungeon uses single area
  };

  const entities: Record<string, Entity> = {};

  // Add monsters
  for (const [id, stats] of Object.entries(monsterStats)) {
    const baseEntity: Entity = {
      id,
      type: 'monster',
      x: stats.pos.x,
      y: stats.pos.y,
      areaId: 'area-1',  // Test dungeon uses single area
      hp: stats.hp,
      maxHp: stats.hp,
      name: stats.name,
      monsterTypeId: stats.typeId,
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
    };

    // Special case: goblin has equipped armor
    if (id === 'goblin') {
      entities[id] = {
        ...baseEntity,
        equippedWeapon: null,
        equippedArmor: goblinArmor,
      };
    } else {
      entities[id] = baseEntity;
    }
  }

  // Add all crawlers to entities
  for (const crawler of crawlers) {
    entities[crawler.id] = crawler;
  }

  // Create one bubble per crawler (each in their own room)
  const bubbles: Bubble[] = [];
  const monstersInBubbles = new Set<string>();

  for (let i = 0; i < crawlerCount; i++) {
    const crawler = crawlers[i];
    const roomMonsterIds = ROOM_MONSTERS[i] ?? [];

    // Entity IDs for this bubble: crawler + room monsters
    const bubbleEntityIds = [
      entityId(crawler.id),
      ...roomMonsterIds.map(id => entityId(id)),
    ];

    // Track which monsters are assigned to bubbles
    for (const monsterId of roomMonsterIds) {
      monstersInBubbles.add(monsterId);
    }

    // Entity speeds for scheduler
    const bubbleEntities = bubbleEntityIds.map(eid => {
      const entity = entities[eid as string];
      return { id: eid, speed: entity?.speed ?? 100 };
    });

    const bubble = createBubble({
      id: bubbleId(`bubble-${i + 1}`),
      entityIds: bubbleEntityIds,
      entities: bubbleEntities,
      center: { x: crawler.x, y: crawler.y },
    });

    bubbles.push(bubble);
  }

  // Put monsters NOT in any bubble into hibernating list
  const hibernating = Object.keys(monsterStats)
    .filter((id) => !monstersInBubbles.has(id))
    .map((id) => entityId(id));

  // Advance each bubble's scheduler until a crawler can act
  const advancedBubbles: Bubble[] = bubbles.map(bubble => {
    const maxIterations = bubble.entityIds.length * 2;
    let iterations = 0;
    let scheduler: SchedulerState = advanceScheduler(bubble.scheduler);

    while (scheduler.currentActorId !== null && iterations < maxIterations) {
      iterations++;
      const currentActor = entities[scheduler.currentActorId];
      if (currentActor && isCrawler(currentActor)) {
        break;
      }
      scheduler = advanceScheduler(completeCurrentTurn(scheduler));
    }

    return { ...bubble, scheduler };
  });

  // Items on the ground
  const groundItems: ItemInstance[] = [
    {
      id: 'ground-sword',
      templateId: 'short_sword',
      x: POSITIONS.sword.x,
      y: POSITIONS.sword.y,
      areaId: 'area-1',  // Test dungeon uses single area
    },
  ];

  // Wrap map in Area
  const area: Area = {
    metadata: {
      id: DEFAULT_AREA_ID,
      name: 'Test Dungeon',
      dangerLevel: 1,
    },
    map,
  };

  // Wrap Area in Zone
  const zone: Zone = {
    id: 'test-zone',
    name: 'Test Dungeon',
    entryAreaId: DEFAULT_AREA_ID,
    victoryAreaIds: [DEFAULT_AREA_ID],
    areas: { [DEFAULT_AREA_ID]: area },
  };

  return {
    zone,
    currentAreaId: DEFAULT_AREA_ID,
    entities,
    items: groundItems,
    bubbles: advancedBubbles,
    hibernating,
    exploredTiles: {},
    objectives: [] as Objective[],  // Objectives are generated by createInitialState via generateObjectives
    turn: 0,
    messages: [createMessage(
      crawlerCount === 1
        ? `${formatCharacterTitle(crawlers[0].name, crawlers[0].characterClass!)} enters the dungeon. Kill all monsters to win.`
        : `${crawlers.map(c => formatCharacterTitle(c.name, c.characterClass!)).join(' and ')} enter the dungeon. Kill all monsters to win.`,
      0, 0
    )],
    gameStatus: { status: 'playing' },
  };
}
