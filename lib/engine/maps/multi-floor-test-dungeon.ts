/**
 * Multi-Floor Test Dungeon Factory (CRA-22)
 *
 * Creates a 5-floor procedurally generated dungeon for testing
 * the multi-area zone system.
 */

import * as ROT from 'rot-js';
import { generateProceduralZone, TEST_DUNGEON_CONFIG } from '../zone';
import { getMonsterSpawnPositions } from '../map';
import { createMessage, type Entity, type GameState, isCrawler } from '../state';
import { createBubble, bubbleId } from '../bubble';
import { entityId, advanceScheduler, completeCurrentTurn } from '../scheduler';
import { createClearZoneObjective, type Objective } from '../objective';
import { crawlerIdFromIndex } from '../crawler-id';
import { generateCharacterIdentity, formatCharacterTitle, generateTraits } from '../character';
import { createRNG, type RNG } from '../rng';
import { selectRandomMonsterType, MONSTER_TYPES } from '../monsters';
import { type ItemInstance, spawnItems } from '../items';
import { rollMonsterEquipment, createGuaranteedEquipment } from '../monster-equipment';
import { z } from 'zod';
import {
  type CharacterCreation,
  CrawlerCharacterSystem,
  calculateFinalStats,
  createStartingEquipment,
  SAFE_NAME_PATTERN,
} from '../character-system';

/**
 * Zod schema for CharacterCreation validation at engine boundary.
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

export interface MultiFloorTestDungeonOptions {
  /** Number of crawlers to spawn (default: 1) */
  readonly crawlerCount?: number;
  /** Seed for deterministic generation (default: TEST_DUNGEON_CONFIG.seed) */
  readonly seed?: number;
  /** Optional character creation data for the first crawler */
  readonly characterCreation?: CharacterCreation;
}

/** Monsters to spawn per area based on danger level */
const MONSTERS_PER_AREA = 3;

function createCrawlerEntity(
  index: number,
  areaId: string,
  x: number,
  y: number,
  rng: RNG,
  characterCreation?: CharacterCreation
): Entity {
  const crawlerId = crawlerIdFromIndex(index + 1);

  // Use character creation data if provided (only for first crawler)
  if (index === 0 && characterCreation) {
    const baseStats = CrawlerCharacterSystem.getBaseStats(characterCreation.characterClass);
    const finalStats = calculateFinalStats(baseStats, characterCreation.statAllocations);

    // Create starting equipment for the character class
    const equipment = createStartingEquipment(characterCreation.characterClass, crawlerId, areaId);

    return {
      id: crawlerId,
      type: 'crawler',
      x,
      y,
      areaId,
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
      equippedWeapon: equipment.weapon ?? undefined,
      equippedArmor: equipment.armor ?? undefined,
      equippedOffhand: equipment.offhand ?? undefined,
    };
  }

  // Fall back to random generation
  const { characterClass, name } = generateCharacterIdentity(rng);
  const baseStats = CrawlerCharacterSystem.getBaseStats(characterClass);

  return {
    id: crawlerId,
    type: 'crawler',
    x,
    y,
    areaId,
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

function createMonsterEntity(
  id: string,
  areaId: string,
  x: number,
  y: number,
  dangerLevel: number,
  rotRng: typeof ROT.RNG
): Entity {
  // selectRandomMonsterType uses dangerLevel for tier-based filtering
  const typeId = selectRandomMonsterType(rotRng, dangerLevel);
  const template = MONSTER_TYPES[typeId];

  // Get guaranteed equipment for this monster type (e.g., goblin_archer gets shortbow + quiver)
  const guaranteedEquipment = createGuaranteedEquipment(typeId, id, areaId);

  // Roll for additional equipment based on floor depth (dangerLevel maps to floor)
  const rolledEquipment = rollMonsterEquipment(typeId, id, {
    floor: dangerLevel,
    rng: { getUniform: () => rotRng.getUniform() },
    areaId,
  });

  // Guaranteed equipment takes priority over rolled equipment
  const equippedWeapon = guaranteedEquipment.weapon ?? rolledEquipment.weapon;
  const equippedOffhand = guaranteedEquipment.offhand ?? null;
  const equippedArmor = rolledEquipment.armor;

  // Map defaultBehavior to initial behaviorState
  const initialBehaviorState = template.defaultBehavior === 'patrol' ? 'patrol' : 'chase';

  return {
    id,
    type: 'monster',
    x,
    y,
    areaId,
    hp: template.baseStats.hp,
    maxHp: template.baseStats.hp,
    name: template.name,
    monsterTypeId: typeId,
    attack: template.baseStats.attack,
    defense: template.baseStats.defense,
    speed: template.baseStats.speed,
    behaviorState: initialBehaviorState,
    equippedWeapon,
    equippedArmor,
    equippedOffhand,
  };
}

/**
 * Creates a 5-floor test dungeon game state.
 *
 * Uses TEST_DUNGEON_CONFIG to generate a procedural zone,
 * then populates it with crawlers and monsters.
 */
export function createMultiFloorTestDungeon(
  options: MultiFloorTestDungeonOptions = {}
): GameState {
  const crawlerCount = options.crawlerCount ?? 1;
  const seed = options.seed ?? TEST_DUNGEON_CONFIG.seed;

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

  // Generate the zone
  const zone = generateProceduralZone({
    ...TEST_DUNGEON_CONFIG,
    seed,
  });

  // Create RNGs - one for character generation (simple RNG), one for rot.js functions
  const characterRng = createRNG(seed);

  // Seed rot.js RNG and clone for monster spawning
  const savedState = ROT.RNG.getState();
  ROT.RNG.setSeed(seed + 1000); // Offset to avoid overlap with zone generation
  const rotRng = ROT.RNG;

  try {
    const entities: Record<string, Entity> = {};
    const items: ItemInstance[] = [];

    // Get entry area for crawler spawning
    const entryArea = zone.areas[zone.entryAreaId];
    const startingRoom = entryArea.map.rooms.find(r => r.tags.includes('starting')) ?? entryArea.map.rooms[0];

    // Create crawlers in entry area
    const crawlers: Entity[] = [];
    for (let i = 0; i < crawlerCount; i++) {
      // Offset each crawler slightly from room center
      const offsetX = i % 2 === 0 ? 0 : 1;
      const offsetY = Math.floor(i / 2);
      const crawler = createCrawlerEntity(
        i,
        zone.entryAreaId,
        startingRoom.center.x + offsetX,
        startingRoom.center.y + offsetY,
        characterRng,
        i === 0 ? characterCreation : undefined
      );
      crawlers.push(crawler);
      entities[crawler.id] = crawler;
    }

    // Spawn monsters and items in each area
    let monsterIndex = 0;
    const entryAreaMonsterIds: string[] = [];
    const hibernatingMonsterIds: string[] = [];

    for (const [areaId, area] of Object.entries(zone.areas)) {
      const dangerLevel = area.metadata.dangerLevel;

      // Exclude crawler positions only for entry area
      const excludePositions = areaId === zone.entryAreaId
        ? crawlers.map(c => ({ x: c.x, y: c.y }))
        : [];

      // Spawn monsters
      const spawnPositions = getMonsterSpawnPositions(
        area.map,
        MONSTERS_PER_AREA,
        excludePositions,
        rotRng
      );

      for (const pos of spawnPositions) {
        const monsterId = `monster-${++monsterIndex}`;
        const monster = createMonsterEntity(
          monsterId,
          areaId,
          pos.x,
          pos.y,
          dangerLevel,
          rotRng
        );
        entities[monsterId] = monster;

        if (areaId === zone.entryAreaId) {
          entryAreaMonsterIds.push(monsterId);
        } else {
          hibernatingMonsterIds.push(monsterId);
        }
      }

      // Spawn floor items (2-4 per area, based on floor depth)
      const monsterPositions = spawnPositions.map(p => ({ x: p.x, y: p.y }));
      const allExcluded = [...excludePositions, ...monsterPositions];
      const floorItems = spawnItems(
        area.map,
        { minItems: 2, maxItems: 4, floor: dangerLevel },
        allExcluded,
        { getUniform: () => rotRng.getUniform() },
        areaId
      );
      items.push(...floorItems);
    }

    // Create bubble for entry area (crawlers + entry area monsters)
    const bubbleEntityIds = [
      ...crawlers.map(c => entityId(c.id)),
      ...entryAreaMonsterIds.map(id => entityId(id)),
    ];

    const bubbleEntities = bubbleEntityIds.map(eid => {
      const entity = entities[eid as string];
      return { id: eid, speed: entity?.speed ?? 100 };
    });

    let bubble = createBubble({
      id: bubbleId('bubble-1'),
      entityIds: bubbleEntityIds,
      entities: bubbleEntities,
      center: startingRoom.center,
    });

    // Advance scheduler until a crawler can act
    const maxIterations = bubbleEntityIds.length * 2;
    let iterations = 0;
    let scheduler = advanceScheduler(bubble.scheduler);

    while (scheduler.currentActorId !== null && iterations < maxIterations) {
      iterations++;
      const currentActor = entities[scheduler.currentActorId];
      if (currentActor && isCrawler(currentActor)) {
        break;
      }
      scheduler = advanceScheduler(completeCurrentTurn(scheduler));
    }

    bubble = { ...bubble, scheduler };

    // Create objectives
    // TODO(tech-debt): clear_zone objective workaround - uses large coordinate bounds (0-9999)
    // to effectively check all monsters across all floors. This works because getMonsters()
    // returns all monsters regardless of area, but it's fragile (assumes coordinates < 9999).
    // Consider adding a dedicated `clear_all_monsters` objective type instead.
    const objectives: Objective[] = [
      createClearZoneObjective({
        id: 'obj-clear-dungeon',
        description: 'Descend through all 5 floors and slay every monster',
        target: { x1: 0, y1: 0, x2: 9999, y2: 9999 },
        assignee: null,
        priority: 'primary',
      }),
    ];

    // Build initial message
    const crawlerNames = crawlers
      .map(c => formatCharacterTitle(c.name, c.characterClass!))
      .join(' and ');

    return {
      zone,
      currentAreaId: zone.entryAreaId,
      entities,
      items,
      bubbles: [bubble],
      hibernating: hibernatingMonsterIds.map(id => entityId(id)),
      exploredTiles: {},
      objectives,
      turn: 0,
      messages: [
        createMessage(
          `${crawlerNames} ${crawlerCount === 1 ? 'enters' : 'enter'} The Depths. Descend through all 5 floors and defeat every monster to escape.`,
          0,
          0
        ),
      ],
      gameStatus: { status: 'playing' },
    };
  } finally {
    // Restore ROT.RNG state to avoid side effects
    ROT.RNG.setState(savedState);
  }
}
