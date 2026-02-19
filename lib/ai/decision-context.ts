/**
 * AI Decision Context
 *
 * Single source of truth for preparing AI decision inputs.
 * Consolidates prompt construction, visibility computation, and perception generation.
 *
 * ## Cooldown Management
 *
 * This module is stateless - callers must manage perception cooldowns.
 *
 * ### Web UI (useGame.ts)
 * Store cooldowns in React state, keyed by crawlerId:
 * ```
 * const [cooldowns, setCooldowns] = useState<Map<CrawlerId, PerceptionCooldowns>>();
 * setCooldowns(prev => new Map(prev).set(crawlerId, result.updatedCooldowns));
 * ```
 *
 * ### Headless Mode (headless-game.ts)
 * Store cooldowns in a Map for the game's lifetime:
 * ```
 * const crawlerCooldowns = new Map<CrawlerId, PerceptionCooldowns>();
 * // Initialize with createCooldowns() on first use per crawler
 * // Reset map between games
 * ```
 */

import type { GameState, Entity } from '../engine/state';
import {
  getCurrentArea,
  getMonstersInArea,
  getCrawlers,
  isValidPosition,
} from '../engine/state';
import type { CrawlerId } from '../engine/crawler-id';
import type { ItemInstance, ItemTemplate } from '../engine/items';
import { getItemTemplate, getItemAtPosition, isEquipmentTemplate } from '../engine/items';
import {
  computeVisibleTiles,
  isEntityVisible,
  DEFAULT_VISION_RADIUS,
  tileKey,
  type TileKey,
} from '../engine/fov';
import { isMonster, type Direction, type CharacterClass } from '../engine/types';
import { isPassable } from '../engine/map';
import { computeExplorationValues, getExplorationRecommendation } from '../engine/exploration';
import { generatePerceptions, getPerceptionText, type PerceptionContext } from '../engine/perception';
import type { Perception } from '../engine/perception-types';
import type { PerceptionCooldowns } from '../engine/perception-cooldowns';
import { isObjectiveRelevantToCrawler, type Objective } from '../engine/objective';
import { getPersonalityDescription, formatCharacterTitle } from '../engine/character';
import { MAX_INVENTORY_SIZE } from '../engine/inventory';

// --- Visibility Context ---

export interface VisibilityContext {
  /** Tiles currently visible to the crawler */
  readonly visibleTiles: Set<TileKey>;
  /** Tiles the crawler has explored (including currently visible) */
  readonly exploredTiles: Set<TileKey>;
  /** Entities visible to the crawler (excludes self) */
  readonly visibleEntities: readonly Entity[];
  /** Items on visible tiles in the crawler's area */
  readonly visibleItems: readonly ItemInstance[];
}

/**
 * Compute what a crawler can see.
 *
 * Single source of truth for visibility - used internally by prepareAIDecision,
 * and exposed for trace construction and other consumers.
 */
export function computeVisibility(
  state: GameState,
  crawlerId: CrawlerId
): VisibilityContext {
  const crawler = state.entities[crawlerId];
  if (!crawler) {
    throw new Error(`Crawler not found: ${crawlerId}`);
  }

  const { map } = getCurrentArea(state);

  // Compute visible tiles using FOV
  const visibleTiles = computeVisibleTiles(
    map,
    crawler.x,
    crawler.y,
    crawler.visionRadius ?? DEFAULT_VISION_RADIUS
  );

  // Get explored tiles for current area, combine with visible
  const exploredArray = state.exploredTiles?.[state.currentAreaId] ?? [];
  const exploredTiles = new Set<TileKey>([
    ...exploredArray as TileKey[],
    ...visibleTiles,
  ]);

  // Filter entities to visible ones (excluding self)
  const visibleEntities = Object.values(state.entities).filter(
    (entity) => entity.id !== crawlerId && isEntityVisible(entity, visibleTiles)
  );

  // Filter items to visible ones in crawler's area
  const visibleItems = state.items.filter(
    (item) =>
      item.areaId === crawler.areaId &&
      visibleTiles.has(tileKey(item.x, item.y))
  );

  return {
    visibleTiles,
    exploredTiles,
    visibleEntities,
    visibleItems,
  };
}

// --- Prompt Helper Functions ---
// These functions are used to generate AI prompt sections

/**
 * Get the relative direction from a position delta using octants.
 * Returns the cardinal or intercardinal direction that best matches the delta.
 */
function getRelativeDirection(dx: number, dy: number): Direction | null {
  if (dx === 0 && dy === 0) return null;

  // Use octants: divide the circle into 8 sectors of 45° each
  // atan2 returns angle in radians from -π to π, with 0 pointing east
  const angle = Math.atan2(-dy, dx); // Negate dy because Y increases southward
  const octant = Math.round((angle / Math.PI) * 4); // -4 to 4

  // Map octant to direction
  switch (octant) {
    case 0: return 'east';
    case 1: return 'northeast';
    case 2: return 'north';
    case 3: return 'northwest';
    case 4:
    case -4: return 'west';
    case -3: return 'southwest';
    case -2: return 'south';
    case -1: return 'southeast';
    default: return 'east'; // Fallback
  }
}

/**
 * Get Chebyshev distance (king's move distance) for 8-directional movement.
 */
function getChebyshevDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * Format a relative position as human-readable text.
 * Examples: "3 tiles east", "adjacent north", "2 tiles southwest"
 */
export function formatRelativePosition(dx: number, dy: number): string {
  const distance = getChebyshevDistance(dx, dy);
  const direction = getRelativeDirection(dx, dy);

  if (!direction) return 'here';
  if (distance === 1) return `adjacent ${direction}`;
  return `${distance} tiles ${direction}`;
}

// --- Action Analysis for AI Prompts ---

/** All 8 movement directions */
const DIRECTIONS: Direction[] = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest'
];

/** Direction to coordinate delta mapping (local copy for use in stateToPrompt) */
const DIRECTION_DELTAS: Record<Direction, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};

/** Analysis of a tile in a specific direction from an entity */
export interface TileAnalysis {
  direction: Direction;
  x: number;
  y: number;
  blocked: boolean;
  blockedBy: string | null;  // 'wall', 'Goblin', etc.
  hasMonster: Entity | null;
  hasItem: boolean;
}

/**
 * Analyze a tile in a specific direction from a position.
 * Returns information about what's there and whether movement is blocked.
 */
export function analyzeTile(
  state: GameState,
  fromX: number,
  fromY: number,
  direction: Direction
): TileAnalysis {
  const [dx, dy] = DIRECTION_DELTAS[direction];
  const x = fromX + dx;
  const y = fromY + dy;

  const { map } = getCurrentArea(state);

  // Check bounds
  if (!isValidPosition(x, y, map.width, map.height)) {
    return { direction, x, y, blocked: true, blockedBy: 'edge', hasMonster: null, hasItem: false };
  }

  // Check tile type
  const tile = map.tiles[y][x];
  if (tile.type === 'wall') {
    return { direction, x, y, blocked: true, blockedBy: 'wall', hasMonster: null, hasItem: false };
  }
  if (tile.type === 'door' && !tile.open) {
    return { direction, x, y, blocked: true, blockedBy: 'closed door', hasMonster: null, hasItem: false };
  }

  // Check diagonal blocking (corner-cutting prevention)
  // A diagonal move is blocked only if BOTH adjacent cardinal tiles are impassable
  // This follows the "moderate" roguelike convention - you can squeeze past one wall corner
  if (dx !== 0 && dy !== 0) {
    const cardinalXBlocked = !isPassable(map, fromX + dx, fromY);
    const cardinalYBlocked = !isPassable(map, fromX, fromY + dy);
    if (cardinalXBlocked && cardinalYBlocked) {
      return { direction, x, y, blocked: true, blockedBy: 'diagonal blocked', hasMonster: null, hasItem: false };
    }
  }

  // Check for monsters (only in current area)
  const monsters = getMonstersInArea(state, state.currentAreaId);
  const monsterAtTile = monsters.find(m => m.x === x && m.y === y);
  if (monsterAtTile) {
    return {
      direction, x, y,
      blocked: true,
      blockedBy: monsterAtTile.name,
      hasMonster: monsterAtTile,
      hasItem: false
    };
  }

  // Check for items (only in current area)
  const hasItem = state.items.some(item => item.areaId === state.currentAreaId && item.x === x && item.y === y);

  return { direction, x, y, blocked: false, blockedBy: null, hasMonster: null, hasItem };
}

/**
 * Analyze all 8 directions from an entity's position.
 */
function analyzeAllDirections(state: GameState, entity: Entity): TileAnalysis[] {
  return DIRECTIONS.map(dir => analyzeTile(state, entity.x, entity.y, dir));
}

/**
 * Estimate combat outcome between two entities.
 */
export function estimateCombat(attacker: Entity, defender: Entity): {
  damageDealt: number;
  hitsToKill: number;
  damageReceived: number;
  hitsToSurvive: number;
} {
  // Damage = attack - defense (minimum 1)
  const damageDealt = Math.max(1, attacker.attack - defender.defense);
  const damageReceived = Math.max(1, defender.attack - attacker.defense);

  const hitsToKill = Math.ceil(defender.hp / damageDealt);
  const hitsToSurvive = Math.ceil(attacker.hp / damageReceived);

  return { damageDealt, hitsToKill, damageReceived, hitsToSurvive };
}

// --- Pickup Conflict Detection ---

/**
 * Describes a conflict when picking up an item that the entity already has.
 */
export interface PickupConflict {
  /** Type of conflict */
  type: 'already_equipped' | 'duplicate_in_bag';
  /** Human-readable warning message */
  warning: string;
}

/**
 * Detect if picking up an item would be redundant.
 * Returns conflict info if the item is already equipped or a duplicate exists in inventory.
 *
 * @param entity - The entity that would pick up the item
 * @param itemTemplate - The template of the item on the ground
 * @returns PickupConflict if redundant, null otherwise
 */
export function detectPickupConflict(
  entity: Entity,
  itemTemplate: ItemTemplate
): PickupConflict | null {
  const inventory = entity.inventory ?? [];

  if (isEquipmentTemplate(itemTemplate)) {
    // Check if same item is already equipped in the matching slot
    const equippedItem = itemTemplate.slot === 'weapon'
      ? entity.equippedWeapon
      : entity.equippedArmor;

    if (equippedItem?.templateId === itemTemplate.id) {
      const bonus = itemTemplate.effect.modifiers[0];
      const bonusStr = bonus ? ` +${bonus.delta}` : '';
      return {
        type: 'already_equipped',
        warning: `⚠️ ALREADY EQUIPPED: ${itemTemplate.name}${bonusStr}`,
      };
    }
  }

  // Check for duplicate equipment in bag (consumables can stack - that's valid strategy)
  if (isEquipmentTemplate(itemTemplate)) {
    const duplicateCount = inventory.filter(
      item => item.templateId === itemTemplate.id
    ).length;

    if (duplicateCount > 0) {
      return {
        type: 'duplicate_in_bag',
        warning: `⚠️ DUPLICATE: already have ${duplicateCount} in bag`,
      };
    }
  }

  return null;
}

/**
 * Generate the AVAILABLE ACTIONS section for AI prompt.
 */
function generateAvailableActions(
  state: GameState,
  entity: Entity,
  analyses: TileAnalysis[],
  explorationValues?: Map<Direction, number>
): string {
  const lines: string[] = [];

  // Get exploration recommendation if we have exploration values
  const recommendation = explorationValues
    ? getExplorationRecommendation(explorationValues)
    : null;

  // Movement actions
  for (const analysis of analyses) {
    if (analysis.blocked) {
      lines.push(`- move ${analysis.direction}: BLOCKED (${analysis.blockedBy})`);
    } else {
      const extras: string[] = [];
      if (analysis.hasItem) {
        // Find the actual item to give a specific hint
        const item = state.items.find(i => i.x === analysis.x && i.y === analysis.y);
        if (item) {
          const template = getItemTemplate(item.templateId);
          extras.push(`has ${template?.name ?? 'item'} - move here to pick it up`);
        } else {
          extras.push('has item - move here to pick it up');
        }
      }

      // Build exploration info string if we have exploration values
      let explorationStr = '';
      if (explorationValues) {
        const explorationValue = explorationValues.get(analysis.direction) ?? 0;
        const isBest = recommendation?.type === 'explore' &&
                       recommendation.bestDirection === analysis.direction;

        if (explorationValue === 0) {
          explorationStr = 'exploration: 0 - fully explored';
        } else if (isBest) {
          explorationStr = `exploration: ${explorationValue} - best`;
        } else {
          explorationStr = `exploration: ${explorationValue}`;
        }
      }

      // Build the final line
      let suffix = '';
      if (extras.length > 0 && explorationStr) {
        suffix = ` - ${extras.join(', ')} (${explorationStr})`;
      } else if (extras.length > 0) {
        suffix = ` - ${extras.join(', ')}`;
      } else if (explorationStr) {
        suffix = ` (${explorationStr})`;
      }
      lines.push(`- move ${analysis.direction}: clear${suffix}`);
    }
  }

  // Attack actions (only adjacent monsters)
  const adjacentMonsters = analyses.filter(a => a.hasMonster);
  for (const analysis of adjacentMonsters) {
    const monster = analysis.hasMonster!;
    const combat = estimateCombat(entity, monster);
    lines.push(
      `- attack ${analysis.direction}: ${monster.name} (${monster.hp} HP) - ` +
      `you deal ~${combat.damageDealt} damage, kill in ${combat.hitsToKill} hit${combat.hitsToKill !== 1 ? 's' : ''}`
    );
  }

  // Pickup action - check if there's an item at entity's position
  const itemHere = getItemAtPosition(state.items, entity.x, entity.y, entity.areaId);
  if (itemHere) {
    const template = getItemTemplate(itemHere.templateId);
    const itemName = template?.name ?? 'Unknown Item';
    let itemInfo = '';
    if (template?.type === 'equipment') {
      const modifier = template.effect.modifiers[0];
      if (modifier) {
        itemInfo = ` (${template.slot}, +${modifier.delta} ${modifier.stat})`;
      }
    }

    // Check for pickup conflicts (already equipped or duplicate in bag)
    let conflictWarning = '';
    if (template) {
      const conflict = detectPickupConflict(entity, template);
      if (conflict) {
        conflictWarning = ` ${conflict.warning}`;
      }
    }

    lines.push(`- pickup: ${itemName}${itemInfo}${conflictWarning}`);
  }

  // Equip actions - show unequipped equipment in inventory
  const inventory = entity.inventory ?? [];
  for (const item of inventory) {
    const template = getItemTemplate(item.templateId);
    if (template?.type === 'equipment') {
      const currentlyEquipped = template.slot === 'weapon' ? entity.equippedWeapon : entity.equippedArmor;
      const currentName = currentlyEquipped
        ? getItemTemplate(currentlyEquipped.templateId)?.name ?? 'Unknown'
        : 'nothing';
      const bonus = template.effect.modifiers[0];
      const bonusStr = bonus ? `+${bonus.delta} ${bonus.stat}` : '';
      lines.push(`- equip ${item.templateId}: ${template.name} (${bonusStr}) - replaces ${currentName}`);
    }
  }

  // Enter portal action - check if standing on a portal tile
  const { map } = getCurrentArea(state);
  const tile = map.tiles[entity.y]?.[entity.x];
  if (tile?.type === 'portal' && tile.connection) {
    const directionHint = tile.direction === 'up' ? 'up' : tile.direction === 'down' ? 'down' : '';
    const targetArea = state.zone.areas[tile.connection.targetAreaId];
    const areaName = targetArea?.metadata.name ?? tile.connection.targetAreaId;
    lines.push(`- enter_portal: Use portal leading ${directionHint} to ${areaName}`);
  }

  lines.push('- wait: skip turn');

  return lines.join('\n');
}

/**
 * Generate the CURRENT TILE section for AI prompt.
 * Describes what's on the player's current tile (items, portals, etc.)
 */
function generateCurrentTile(
  state: GameState,
  entity: Entity
): string {
  const contents: string[] = [];

  // Check for item at current position
  const itemHere = getItemAtPosition(state.items, entity.x, entity.y, entity.areaId);
  if (itemHere) {
    const template = getItemTemplate(itemHere.templateId);
    if (template) {
      let itemDesc = template.name;
      if (template.type === 'equipment') {
        const modifier = template.effect.modifiers[0];
        if (modifier) {
          itemDesc += ` (${template.slot}, +${modifier.delta} ${modifier.stat})`;
        }
      } else if (template.type === 'consumable') {
        const modifier = template.effect.modifiers[0];
        if (modifier) {
          itemDesc += ` (restores ${modifier.delta} ${modifier.stat})`;
        }
      }
      contents.push(`Item: ${itemDesc} - use "pickup" to collect`);
    }
  }

  // Check for portal at current position
  const { map } = getCurrentArea(state);
  const tile = map.tiles[entity.y]?.[entity.x];
  if (tile?.type === 'portal' && tile.connection) {
    const directionHint = tile.direction === 'up' ? 'up' : tile.direction === 'down' ? 'down' : '';
    const targetArea = state.zone.areas[tile.connection.targetAreaId];
    const areaName = targetArea?.metadata.name ?? 'unknown area';
    contents.push(`Portal: leads ${directionHint} to ${areaName} - use "enter_portal" to travel`);
  }

  if (contents.length === 0) {
    return 'Empty (no item or portal here)';
  }

  return contents.join('\n');
}

/**
 * Generate the TACTICAL SITUATION section for AI prompt.
 */
function generateTacticalSituation(
  state: GameState,
  entity: Entity,
  analyses: TileAnalysis[],
  visibleTiles: Set<TileKey>,
  explorationValues?: Map<Direction, number>
): string {
  const lines: string[] = [];

  // Adjacent threats
  const adjacentMonsters = analyses.filter(a => a.hasMonster);
  if (adjacentMonsters.length > 0) {
    const threats = adjacentMonsters.map(a => {
      const monster = a.hasMonster!;
      const combat = estimateCombat(monster, entity);
      return `${monster.name} (${a.direction}) - ~${combat.damageDealt} damage/hit`;
    });
    lines.push(`- Adjacent threats: ${threats.join('; ')}`);
  } else {
    lines.push('- Adjacent threats: none');
  }

  // Escape routes
  const clearDirections = analyses.filter(a => !a.blocked).length;
  lines.push(`- Escape routes: ${clearDirections} direction${clearDirections !== 1 ? 's' : ''} clear`);

  // Health status
  const healthPercent = (entity.hp / entity.maxHp) * 100;
  if (healthPercent <= 30) {
    lines.push('- Health: CRITICAL - consider retreating');
  } else if (healthPercent <= 50) {
    lines.push('- Health: LOW - fight carefully');
  }

  // Adjacent items - items you can pick up in one move (filtered for usefulness)
  const adjacentItems = analyses.filter(a => a.hasItem && !a.blocked);
  const usefulAdjacentItems = adjacentItems.filter(a => {
    const item = state.items.find(i => i.areaId === entity.areaId && i.x === a.x && i.y === a.y);
    if (!item) return true; // Keep unknown items
    const template = getItemTemplate(item.templateId);
    if (!template) return true;
    return !detectPickupConflict(entity, template);
  });
  if (usefulAdjacentItems.length > 0) {
    const itemDescs = usefulAdjacentItems.map(a => {
      const item = state.items.find(i => i.areaId === entity.areaId && i.x === a.x && i.y === a.y);
      if (item) {
        const template = getItemTemplate(item.templateId);
        return `${template?.name ?? 'Item'} (${a.direction})`;
      }
      return `Item (${a.direction})`;
    });
    lines.push(`- Adjacent items: ${itemDescs.join('; ')} - move there to pick up`);
  }

  // Nearby items - visible items not adjacent (in same area), filtered for usefulness
  const nearbyItems = state.items.filter(item => {
    // Must be in same area and visible
    if (item.areaId !== entity.areaId) return false;
    if (!visibleTiles.has(tileKey(item.x, item.y))) return false;
    const dx = item.x - entity.x;
    const dy = item.y - entity.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance
    // Not adjacent (distance > 1) but within visible range
    if (distance <= 1) return false;
    // Filter out useless items
    const template = getItemTemplate(item.templateId);
    if (!template) return true;
    return !detectPickupConflict(entity, template);
  });
  if (nearbyItems.length > 0 && adjacentMonsters.length === 0) {
    const itemDescs = nearbyItems.slice(0, 3).map(item => {
      const template = getItemTemplate(item.templateId);
      const dx = item.x - entity.x;
      const dy = item.y - entity.y;
      const relPos = formatRelativePosition(dx, dy);
      return `${template?.name ?? 'Item'} (${relPos})`;
    });
    lines.push(`- Nearby items: ${itemDescs.join('; ')}`);
  }

  // Simple recommendation
  if (adjacentMonsters.length > 0 && healthPercent > 30) {
    // Check for kill shot opportunity
    const killShot = adjacentMonsters.find(a => {
      const monster = a.hasMonster!;
      const combat = estimateCombat(entity, monster);
      return monster.hp <= combat.damageDealt;
    });
    if (killShot) {
      lines.push(`- Recommendation: Kill ${killShot.hasMonster!.name} (${killShot.direction}) - one hit kill`);
    } else {
      lines.push('- Recommendation: Attack adjacent enemy');
    }
  } else if (adjacentMonsters.length > 0 && healthPercent <= 30) {
    lines.push('- Recommendation: Retreat to safety if possible');
  } else if (usefulAdjacentItems.length > 0) {
    // No enemies adjacent but useful items are - prioritize picking them up
    const firstItem = usefulAdjacentItems[0];
    const item = state.items.find(i => i.areaId === entity.areaId && i.x === firstItem.x && i.y === firstItem.y);
    const template = item ? getItemTemplate(item.templateId) : null;
    lines.push(`- Recommendation: Move ${firstItem.direction} to pick up ${template?.name ?? 'item'}`);
  } else if (nearbyItems.length > 0 && adjacentMonsters.length === 0) {
    // No enemies adjacent, but there are nearby useful items worth getting
    const nearestItem = nearbyItems[0];
    const template = getItemTemplate(nearestItem.templateId);
    const dx = nearestItem.x - entity.x;
    const dy = nearestItem.y - entity.y;
    const relPos = formatRelativePosition(dx, dy);
    lines.push(`- Recommendation: Move toward ${template?.name ?? 'item'} (${relPos})`);
  } else {
    // Only recommend moving toward enemies the AI can actually see (in same area)
    const visibleMonsters = getMonstersInArea(state, entity.areaId).filter(m => isEntityVisible(m, visibleTiles));
    if (visibleMonsters.length > 0) {
      lines.push('- Recommendation: Move toward nearest visible enemy');
    } else {
      lines.push('- Recommendation: Explore to find enemies or items');
    }
  }

  // Exploration guidance (when no adjacent enemies)
  if (adjacentMonsters.length === 0 && explorationValues) {
    const recommendation = getExplorationRecommendation(explorationValues);

    if (recommendation.type === 'fully_explored') {
      lines.push('- Exploration: All areas explored');
    } else {
      lines.push(
        `- Exploration: ${recommendation.bestDirection} has most unexplored territory ` +
        `(${recommendation.bestValue} tiles reachable)`
      );

      if (recommendation.fullyExploredDirections.length > 0) {
        lines.push(
          `- Dead ends: ${recommendation.fullyExploredDirections.join(', ')} (fully explored)`
        );
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format objectives section for AI prompt.
 * Shows only active objectives relevant to the specified crawler.
 *
 * When no active objectives exist, provides fallback exploration guidance.
 * When only primary objectives remain, suggests exploration as implicit secondary goal.
 *
 * @param objectives - All objectives in the game state
 * @param crawlerId - The crawler to filter objectives for
 * @returns Formatted OBJECTIVES section for AI prompt
 */
// --- Status Section Generation ---

/** HP threshold for low health warning (30%) */
const LOW_HP_THRESHOLD = 0.3;

interface StatusDetails {
  hp: number;
  maxHp: number;
  hpWarning: string;
  attack: number;
  attackBreakdown: string;
  defense: number;
  defenseBreakdown: string;
  speed: number;
  healingPotions: string;
}

/**
 * Compute enhanced status details for the AI prompt.
 * Shows equipment contributions and available healing.
 */
export function computeStatusDetails(entity: Entity): StatusDetails {
  const { hp, maxHp, attack, defense, speed, equippedWeapon, equippedArmor, inventory = [] } = entity;

  // HP warning
  const hpRatio = hp / maxHp;
  const hpWarning = hpRatio <= LOW_HP_THRESHOLD ? ' ⚠️ CRITICAL' : hpRatio <= 0.5 ? ' ⚠️ LOW' : '';

  // Attack breakdown
  let weaponBonus = 0;
  let weaponName = '';
  if (equippedWeapon) {
    const template = getItemTemplate(equippedWeapon.templateId);
    if (template) {
      weaponBonus = template.effect.modifiers[0]?.delta ?? 0;
      weaponName = template.name;
    }
  }
  const baseAttack = attack - weaponBonus;
  const attackBreakdown = weaponBonus > 0
    ? `${attack} (base ${baseAttack} + ${weaponName} +${weaponBonus})`
    : `${attack}`;

  // Defense breakdown
  let armorBonus = 0;
  let armorName = '';
  if (equippedArmor) {
    const template = getItemTemplate(equippedArmor.templateId);
    if (template) {
      armorBonus = template.effect.modifiers[0]?.delta ?? 0;
      armorName = template.name;
    }
  }
  const baseDefense = defense - armorBonus;
  const defenseBreakdown = armorBonus > 0
    ? `${defense} (base ${baseDefense} + ${armorName} +${armorBonus})`
    : `${defense}`;

  // Healing potions summary
  const healingItems: { name: string; hpDelta: number; count: number }[] = [];
  for (const item of inventory) {
    const template = getItemTemplate(item.templateId);
    if (template?.type === 'consumable') {
      const hpModifier = template.effect.modifiers.find(m => m.stat === 'hp');
      if (hpModifier && hpModifier.delta > 0) {
        const existing = healingItems.find(h => h.name === template.name);
        if (existing) {
          existing.count++;
        } else {
          healingItems.push({ name: template.name, hpDelta: hpModifier.delta, count: 1 });
        }
      }
    }
  }

  let healingPotions = '';
  if (healingItems.length > 0) {
    const parts = healingItems.map(h =>
      h.count === 1
        ? `${h.name} (+${h.hpDelta} HP)`
        : `${h.count}x ${h.name} (+${h.hpDelta} HP each)`
    );
    healingPotions = parts.join(', ');
  }

  return {
    hp,
    maxHp,
    hpWarning,
    attack,
    attackBreakdown,
    defense,
    defenseBreakdown,
    speed,
    healingPotions,
  };
}

/**
 * Generate the YOUR STATUS section for the AI prompt.
 */
export function generateStatusSection(entity: Entity): string {
  const status = computeStatusDetails(entity);

  const lines = [
    `- HP: ${status.hp}/${status.maxHp}${status.hpWarning}`,
    `- Attack: ${status.attackBreakdown}`,
    `- Defense: ${status.defenseBreakdown}`,
    `- Speed: ${status.speed}`,
  ];

  if (status.healingPotions) {
    lines.push(`- Healing: ${status.healingPotions}`);
  }

  return lines.join('\n');
}

function formatObjectivesForPrompt(
  objectives: readonly Objective[],
  crawlerId: CrawlerId
): string {
  const relevant = objectives.filter(
    (o) => o.status === 'active' && isObjectiveRelevantToCrawler(o, crawlerId)
  );

  if (relevant.length === 0) {
    return 'OBJECTIVES:\n\nNo active objectives. Explore unexplored areas or assist other crawlers.';
  }

  const primary = relevant.filter((o) => o.priority === 'primary');
  const secondary = relevant.filter((o) => o.priority === 'secondary');

  const lines = [
    'OBJECTIVES:',
    '',
    ...primary.map((o) => `- [PRIMARY] ${o.description}`),
    ...secondary.map((o) => `- [SECONDARY] ${o.description}`),
  ];

  if (secondary.length === 0 && primary.length > 0) {
    lines.push('', 'No secondary objectives. Explore unexplored areas or assist other crawlers.');
  }

  return lines.join('\n');
}

/**
 * Format perceptions for inclusion in AI prompt.
 */
export function formatPerceptionsForPrompt(
  perceptions: readonly Perception[],
  characterClass: CharacterClass
): string {
  if (perceptions.length === 0) return '';

  const lines: string[] = [];

  for (const perception of perceptions) {
    const text = getPerceptionText(perception, characterClass);
    if (text) {
      lines.push(`- ${text}`);
    }
  }

  if (lines.length === 0) return '';

  return `\nPERCEPTIONS:\n${lines.join('\n')}`;
}

// --- AI Decision Context ---

export interface AIDecisionContext {
  /** The formatted prompt string for the AI */
  readonly prompt: string;
  /** Generated perceptions for this turn */
  readonly perceptions: readonly Perception[];
  /** Highest priority perception (for UI thought bubble) */
  readonly priorityPerception: Perception | null;
  /** Updated cooldowns (caller stores for next turn) */
  readonly updatedCooldowns: PerceptionCooldowns;
}

/**
 * Build the prompt string for AI decision-making.
 * Adapts the logic from stateToPrompt but uses pre-computed visibility context.
 */
function buildPrompt(
  state: GameState,
  crawlerId: CrawlerId,
  visibility: VisibilityContext,
  perceptions: readonly Perception[],
  options?: { isYourTurn?: boolean }
): string {
  const crawler = state.entities[crawlerId];
  if (!crawler) {
    throw new Error(`Crawler not found: ${crawlerId}`);
  }

  const { map } = getCurrentArea(state);

  // Filter monsters to visible ones only (from visibility context)
  const visibleMonsters = visibility.visibleEntities.filter(isMonster);

  // Monster list
  const monstersStr = visibleMonsters
    .map((m) => {
      const dx = m.x - crawler.x;
      const dy = m.y - crawler.y;
      const relPos = formatRelativePosition(dx, dy);
      return `- ${m.name} (${relPos}), HP: ${m.hp}/${m.maxHp}, ATK: ${m.attack}, DEF: ${m.defense}, SPD: ${m.speed}`;
    })
    .join('\n');

  // Item list (only visible items)
  const itemsStr = visibility.visibleItems
    .map((item) => {
      const template = getItemTemplate(item.templateId);
      const dx = item.x - crawler.x;
      const dy = item.y - crawler.y;
      const relPos = formatRelativePosition(dx, dy);
      return template
        ? `- ${template.name} (${relPos})`
        : `- Unknown item (${relPos})`;
    })
    .join('\n');

  // Recent log entries (last 5 messages)
  const recentLog = state.messages
    .slice(-5)
    .map((m) => m.text)
    .join('\n- ');

  // Game status
  let statusStr: string;
  if (state.gameStatus.status === 'playing') {
    statusStr = 'In Progress';
  } else if (state.gameStatus.victory) {
    statusStr = 'Victory';
  } else {
    statusStr = 'Defeat';
  }

  // Turn info
  let turnInfo = '';
  if (state.bubbles.length > 0) {
    const viewerBubble = state.bubbles.find((b) =>
      b.entityIds.some((id) => id === (crawlerId as string))
    );
    if (viewerBubble) {
      const isYourTurn =
        options?.isYourTurn ?? viewerBubble.scheduler.currentActorId === (crawlerId as string);
      turnInfo = `
TURN INFO:
- Your turn: ${isYourTurn ? 'Yes' : 'No'}
`;
    }
  }

  // Character section
  let characterSection = '';
  if (crawler.characterClass) {
    const personality = getPersonalityDescription(crawler.characterClass);
    const title = formatCharacterTitle(crawler.name, crawler.characterClass);
    const bioLine = crawler.bio ? `\n- Backstory: ${crawler.bio}` : '';
    characterSection = `
YOUR CHARACTER:
- Name: ${title}
- Class: ${crawler.characterClass}
- Personality: ${personality}${bioLine}
`;
  }

  // Other crawlers section
  let otherCrawlersSection = '';
  const allCrawlers = getCrawlers(state);
  const otherCrawlers = allCrawlers.filter((c) => c.id !== crawler.id);
  if (otherCrawlers.length > 0) {
    const crawlerList = otherCrawlers
      .map((c) => {
        const dx = c.x - crawler.x;
        const dy = c.y - crawler.y;
        const relPos = formatRelativePosition(dx, dy);
        return `- ${c.name} (${c.id}, ${relPos}), HP: ${c.hp}/${c.maxHp}`;
      })
      .join('\n');
    otherCrawlersSection = `
OTHER CRAWLERS:
${crawlerList}
`;
  }

  // Analyze available actions
  const analyses = analyzeAllDirections(state, crawler);

  // Compute exploration values
  const explorationValues = computeExplorationValues(
    map,
    { x: crawler.x, y: crawler.y },
    visibility.visibleTiles,
    visibility.exploredTiles,
    { lastMoveDirection: crawler.lastMoveDirection }
  );

  const availableActionsStr = generateAvailableActions(
    state,
    crawler,
    analyses,
    explorationValues
  );
  const tacticalStr = generateTacticalSituation(
    state,
    crawler,
    analyses,
    visibility.visibleTiles,
    explorationValues
  );
  const currentTileStr = generateCurrentTile(state, crawler);

  // Objectives section
  const objectivesSection = `
${formatObjectivesForPrompt(state.objectives, crawlerId)}
`;

  // Perceptions section
  let perceptionsSection = '';
  if (perceptions.length > 0) {
    const characterClass = crawler.characterClass ?? 'warrior';
    perceptionsSection = formatPerceptionsForPrompt(perceptions, characterClass);
  }

  // Inventory section
  const inventoryLines: string[] = [];
  const inventory = crawler.inventory ?? [];

  if (inventory.length === 0 && !crawler.equippedWeapon && !crawler.equippedArmor) {
    inventoryLines.push('Empty');
  } else {
    if (crawler.equippedWeapon) {
      const template = getItemTemplate(crawler.equippedWeapon.templateId);
      const bonus = template?.effect.modifiers[0];
      inventoryLines.push(
        `Weapon: ${template?.name ?? 'Unknown'} (+${bonus?.delta ?? 0} ${bonus?.stat ?? 'attack'})`
      );
    } else {
      inventoryLines.push('Weapon: none');
    }

    if (crawler.equippedArmor) {
      const template = getItemTemplate(crawler.equippedArmor.templateId);
      const bonus = template?.effect.modifiers[0];
      inventoryLines.push(
        `Armor: ${template?.name ?? 'Unknown'} (+${bonus?.delta ?? 0} ${bonus?.stat ?? 'defense'})`
      );
    } else {
      inventoryLines.push('Armor: none');
    }

    if (inventory.length > 0) {
      inventoryLines.push(`Bag (${inventory.length}/${MAX_INVENTORY_SIZE}):`);
      for (const item of inventory) {
        const template = getItemTemplate(item.templateId);
        inventoryLines.push(`  - ${template?.name ?? 'Unknown'} (${item.templateId})`);
      }
    }
  }

  const inventorySection = inventoryLines.join('\n');

  // Build the final prompt
  const prompt = `GAME STATE (Turn ${state.turn}):
${turnInfo}${characterSection}
YOUR STATUS:
${generateStatusSection(crawler)}

CURRENT TILE:
${currentTileStr}

MONSTERS:
${monstersStr || 'None visible'}

ITEMS:
${itemsStr || 'None visible'}

AVAILABLE ACTIONS:
${availableActionsStr}

TACTICAL SITUATION:
${tacticalStr}
${perceptionsSection}
INVENTORY:
${inventorySection}
${objectivesSection}${otherCrawlersSection}
GAME STATUS: ${statusStr}

RECENT LOG:
${recentLog ? `- ${recentLog}` : '(none yet)'}`;

  return prompt;
}

/**
 * Single source of truth for "what does the AI see?"
 *
 * This function:
 * 1. Computes visibility once using computeVisibility
 * 2. Generates perceptions automatically (the main improvement over stateToPrompt)
 * 3. Builds the prompt using helper functions
 * 4. Returns everything the AI needs for a decision
 */
export function prepareAIDecision(
  state: GameState,
  crawlerId: CrawlerId,
  cooldowns: PerceptionCooldowns,
  options?: { isYourTurn?: boolean }
): AIDecisionContext {
  const crawler = state.entities[crawlerId];
  if (!crawler) {
    throw new Error(`Crawler not found: ${crawlerId}`);
  }

  // Compute visibility once, reuse for everything
  const visibility = computeVisibility(state, crawlerId);

  // Generate perceptions
  const perceptionContext: PerceptionContext = {
    crawler,
    visibleEntities: visibility.visibleEntities,
    groundItems: [], // Not implemented yet
    cooldowns,
  };
  const perceptionResult = generatePerceptions(perceptionContext);

  // Build the prompt
  const prompt = buildPrompt(
    state,
    crawlerId,
    visibility,
    perceptionResult.perceptions,
    options
  );

  return {
    prompt,
    perceptions: perceptionResult.perceptions,
    priorityPerception: perceptionResult.priority,
    updatedCooldowns: perceptionResult.cooldowns,
  };
}
