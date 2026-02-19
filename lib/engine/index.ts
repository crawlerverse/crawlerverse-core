/**
 * Game Engine
 *
 * Core game logic: state management, action processing, combat resolution.
 * This module is isomorphic - runs on both client and server.
 */

export * from './state';
export * from './actions';
export * from './scheduler';
export * from './bubble';
export * from './observation';
export * from './events';
export {
  TilePositionSchema,
  type AreaId,
  PortalConnectionSchema,
  type PortalConnection,
  AreaMetadataSchema,
  type AreaMetadata,
  AreaSchema,
  type Area,
  ZoneSchema,
  type Zone,
  DungeonConfigSchema,
  type DungeonConfig,
  DEFAULT_DUNGEON_CONFIG,
  TileSchema,
  type Tile,
  RoomSchema,
  type RoomTag,
  type Room,
  createRoom,
  DungeonMapSchema,
  type DungeonMap,
  validateDungeonMap,
  type TileAppearance,
  TILE_APPEARANCE,
  getTileAppearance,
  getTile,
  isPassable,
  parseAsciiMap,
  extractRooms,
  selectStartingRooms,
  validateConnectivity,
  SpawnPositionError,
  getPlayerSpawnPositions,
  DungeonGenerationError,
  generateDungeon,
  getMonsterSpawnPositions,
} from './map';
export * from './maps';
export * from './items';
export { getPendingCrawlers, getCrawlerColor, isCrawlerId, type CrawlerColor } from './helpers';
export {
  type CrawlerId,
  isCrawlerId as isValidCrawlerId,
  toCrawlerId,
  crawlerIdFromIndex,
  getCrawlerIndex,
  maybeCrawlerId,
} from './crawler-id';
export * from './monsters';
export * from './behavior';
export {
  type CharacterClass,
  CHARACTER_CLASSES,
  CLASS_PERSONALITIES,
  CLASS_TRAIT_DEFAULTS,
  getRandomCharacterClass,
  getRandomName,
  generateCharacterIdentity,
  getPersonalityDescription,
  formatCharacterTitle,
  generateTraits,
} from './character';
export {
  computeVisibleTiles,
  computeMonsterFOV,
  canMonsterSee,
  updateExploredTiles,
  isEntityVisible,
  tileKey,
  clearFOVCache,
  getFOVCacheStats,
  DEFAULT_VISION_RADIUS,
  MAX_VISION_RADIUS,
  TILE_KEY_PATTERN,
  type TileKey,
} from './fov';

// Callback types for observability integration
export {
  type GameCompleteData,
  type GameCallbacks,
  type ErrorContext,
  type PlayerType,
  type GameOutcome,
  generateSessionId,
} from './callbacks';

// Inventory module
export {
  processPickup,
  processDrop,
  processUse,
  processEquip,
  MAX_INVENTORY_SIZE,
  type InventoryActionResult,
  type InventoryErrorCode,
} from './inventory';

// Stats module (effective stat calculation)
export {
  getEffectiveAttack,
  getEffectiveDefense,
  getEffectiveSpeed,
  getEffectiveVisionRadius,
} from './stats';

// Effects system (CRA-133)
export {
  type ActiveEffect,
  type EffectMechanic,
  type EffectTemplateId,
  ActiveEffectSchema,
  EffectMechanicSchema,
  EFFECT_TEMPLATES,
  createActiveEffect,
  applyEffect,
  removeEffect,
  removeEffectsFromSource,
  hasEffect,
  hasEffectById,
  getEffectsByMechanic,
  tickEffects,
  resetEffectIdCounter,
} from './effects';

// Monster equipment spawning
export {
  rollMonsterEquipment,
  resetEquipmentCounter,
  type MonsterEquipmentConfig,
  type MonsterEquipmentResult,
} from './monster-equipment';

// Combat system (d20-based)
export {
  rollD20,
  calculateTargetDC,
  calculateDamage,
  resolveAttack,
  resolveCombatWithRoll,
  type CombatResult,
} from './combat';

// Seeded RNG
export { createRNG, pickRandom, type RNG } from './rng';

// Zone factory
export { createZone, generateProceduralZone, TEST_DUNGEON_CONFIG, type CreateZoneConfig, type ProceduralZoneConfig } from './zone';

// Exploration guidance
export {
  computeExplorationDepthLimit,
  computeExplorationValues,
  getExplorationRecommendation,
  type ExplorationRecommendation,
} from './exploration';

// Objective generation
export {
  generateObjectives,
  type GenerateObjectivesConfig,
  hasObjectiveTag,
  hasReachTag,
  hasClearTag,
  findNearestCrawler,
} from './objective-generator';

// Character persistence
export {
  type PlayStats,
  type SavedCharacter,
  createEmptyPlayStats,
  createSavedCharacter,
} from './character-system';

export {
  type CharacterRepository,
  type CharacterRepositoryConfig,
  DEFAULT_REPOSITORY_CONFIG,
  LocalStorageCharacterRepository,
  RosterFullError,
} from './character-repository';

// Perception system
export {
  HEALTH_BANDS,
  type HealthBand,
  QUALITY_BANDS,
  type QualityBand,
  COMPARISON_BANDS,
  type ComparisonBand,
  type PerceptionTraits,
  PerceptionTraitsSchema,
  type CombatPerception,
  type EquipmentPerception,
  type Perception,
  type PerceptionType,
  PERCEPTION_PRIORITY,
} from './perception-types';

export {
  getHealthBand,
  getSelfHealthBand,
  getEnemyHealthBand,
  getItemQualityBand,
  getItemComparisonBand,
  getPerceptionText,
  generatePerceptions,
  type PerceptionContext,
  type PerceptionResult,
} from './perception';

export {
  COOLDOWN_TURNS,
  type PerceptionCooldowns,
  createCooldowns,
  shouldEmitPerception,
  updateCooldowns,
  tickCooldowns,
  resetCombatCooldowns,
} from './perception-cooldowns';
