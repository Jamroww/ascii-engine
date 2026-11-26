import * as THREE from 'three';
import {
  CHARACTER_MODEL_FACTORIES,
} from '../rendering/Characters';
import {
  ENEMY_MODEL_FACTORIES,
} from '../rendering/Enemies';
import {
  BUILDING_MODEL_FACTORIES,
} from '../rendering/Buildings';
import {
  NATURE_PROP_MODEL_FACTORIES,
} from '../rendering/Nature';
import {
  PROGRESSION_MODEL_FACTORIES,
  setLightShrinePurified,
} from '../rendering/Progression';
import {
  createRiversideCottage,
  type BuildingAsset,
} from '../rendering/BuildingLayer';
import {
  createAncientPine,
  createGnarledOak,
  createWiltedTree,
  type TreeAsset,
} from '../rendering/ForestLayer';
import { LANDMARK_PROP_MODEL_FACTORIES } from '../rendering/Lvl1';
import { LVL2_MODEL_FACTORIES } from '../rendering/Lvl2';
import type { ColliderSpec, EntityKind } from './levelTypes';

type BuildingFactory = () => BuildingAsset;
type TreeFactory = () => TreeAsset;
type ModelFactory = () => THREE.Group;

export interface EnemyArchetype {
  id: string;
  maxHp: number;
  /** Movement speed in world units / second (0 for a stationary turret). */
  speed: number;
  /** Collider radius in world units. */
  radius: number;
  aggroRange: number;
  attackRange: number;
  /** Seconds of warning wind-up before the attack fires. */
  telegraphTime: number;
  /** Seconds between attacks (or between a lunge and the next chase). */
  attackCooldown: number;
  /** Damage dealt to the player per melee contact / projectile hit. */
  damage: number;
  kind: 'melee' | 'ranged';
}

interface ModelAssetEntry {
  kind: EntityKind;
  factory: ModelFactory;
  /** Default collider radius in world units (0 for walk-over items). */
  radius: number;
  /** Optional multi-circle footprint; falls back to a single centered circle when omitted. */
  colliders?: ColliderSpec[];
}

// ---------------------------------------------------------------------------
// Legacy flat ASCII asset registries (kept for the perimeter forest ring and
// the pngToAscii custom-building import).
// ---------------------------------------------------------------------------

const buildingFactories = new Map<string, BuildingFactory>([
  ['riverside_cottage', createRiversideCottage],
]);

const treeFactories = new Map<string, TreeFactory>([
  ['ancient_pine', createAncientPine],
  ['gnarled_oak', createGnarledOak],
  ['wilted_tree', createWiltedTree],
]);

// Boulders are rendered inside WaterLayer's shader; here we only carry the
// metadata needed to register their colliders.
const boulderAssets = new Map<string, { radius: number }>([
  ['river_boulder', { radius: 1.0 }],
]);

// Blighted enemy archetypes. Stats are tuned so the two starter enemies are a
// fair early fight: a stalker dies to two sword hits, a spitter to three.
const enemyAssets = new Map<string, EnemyArchetype>([
  [
    'blight_stalker',
    {
      id: 'blight_stalker',
      maxHp: 40,
      speed: 6.5,
      radius: 0.7,
      aggroRange: 7,
      attackRange: 1.3,
      telegraphTime: 0.38,
      attackCooldown: 0.9,
      damage: 12,
      kind: 'melee',
    },
  ],
  [
    'spore_spitter',
    {
      id: 'spore_spitter',
      maxHp: 50,
      speed: 2.2,
      radius: 0.6,
      aggroRange: 9,
      attackRange: 6.5,
      telegraphTime: 0.6,
      attackCooldown: 1.4,
      damage: 8,
      kind: 'ranged',
    },
  ],
  [
    'blight_sentinel',
    {
      id: 'blight_sentinel',
      maxHp: 140,
      speed: 3.0,
      radius: 0.95,
      aggroRange: 9,
      attackRange: 1.7,
      telegraphTime: 0.55,
      attackCooldown: 1.6,
      damage: 20,
      kind: 'melee',
    },
  ],
  [
    'castle_warden',
    {
      id: 'castle_warden',
      maxHp: 260,
      speed: 2.8,
      radius: 1.1,
      aggroRange: 10,
      attackRange: 2.0,
      telegraphTime: 0.38,
      attackCooldown: 1.5,
      damage: 24,
      kind: 'melee',
    },
  ],
  [
    'the_ronin',
    {
      id: 'the_ronin',
      maxHp: 320,
      speed: 2.6,
      radius: 0.85,
      aggroRange: 14,
      attackRange: 3.3,
      telegraphTime: 0.5,
      attackCooldown: 1.4,
      damage: 26,
      kind: 'melee',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Unified procedural 3D model registry (baked into ASCII billboards).
// ---------------------------------------------------------------------------

const modelAssets = new Map<string, ModelAssetEntry>([
  // Characters
  ['player_traveler', { kind: 'npc', factory: CHARACTER_MODEL_FACTORIES.player_traveler, radius: 0.5 }],
  ['npc_sibling', { kind: 'npc', factory: CHARACTER_MODEL_FACTORIES.npc_sibling, radius: 0.5 }],
  ['npc_ferryman', { kind: 'npc', factory: CHARACTER_MODEL_FACTORIES.npc_ferryman, radius: 0.5 }],
  ['npc_lantern_keeper', { kind: 'npc', factory: CHARACTER_MODEL_FACTORIES.npc_lantern_keeper, radius: 0.5 }],
  ['npc_herbalist', { kind: 'npc', factory: CHARACTER_MODEL_FACTORIES.npc_herbalist, radius: 0.5 }],
  ['npc_elder', { kind: 'npc', factory: CHARACTER_MODEL_FACTORIES.npc_elder, radius: 0.5 }],
  // Enemies
  ['blight_stalker', { kind: 'enemy', factory: ENEMY_MODEL_FACTORIES.blight_stalker, radius: 0.7 }],
  ['spore_spitter', { kind: 'enemy', factory: ENEMY_MODEL_FACTORIES.spore_spitter, radius: 0.6 }],
  ['blight_sentinel', { kind: 'enemy', factory: ENEMY_MODEL_FACTORIES.blight_sentinel, radius: 0.95 }],
  // Buildings
  [
    'cottage_fisher',
    {
      kind: 'building',
      factory: BUILDING_MODEL_FACTORIES.cottage_fisher,
      radius: 2.4,
      colliders: [
        { offsetX: -1.0, offsetY: 1.4, radius: 1.2 },
        { offsetX: 1.0, offsetY: 1.4, radius: 1.2 },
      ],
    },
  ],
  [
    'cottage_boathouse',
    {
      kind: 'building',
      factory: BUILDING_MODEL_FACTORIES.cottage_boathouse,
      radius: 2.4,
      colliders: [
        { offsetX: -1.0, offsetY: 1.5, radius: 1.25 },
        { offsetX: 1.0, offsetY: 1.5, radius: 1.25 },
      ],
    },
  ],
  ['village_dock', { kind: 'building', factory: BUILDING_MODEL_FACTORIES.village_dock, radius: 0 }],
  ['stone_bridge', { kind: 'building', factory: BUILDING_MODEL_FACTORIES.stone_bridge, radius: 0 }],
  ['fence_stone_wall', { kind: 'building', factory: BUILDING_MODEL_FACTORIES.fence_stone_wall, radius: 0.8 }],
  // Nature: trees
  ['tree_pine', { kind: 'tree', factory: NATURE_PROP_MODEL_FACTORIES.tree_pine, radius: 0.7 }],
  ['tree_oak', { kind: 'tree', factory: NATURE_PROP_MODEL_FACTORIES.tree_oak, radius: 0.9 }],
  ['tree_wilted', { kind: 'tree', factory: NATURE_PROP_MODEL_FACTORIES.tree_wilted, radius: 0.65 }],
  // Nature: boulders
  ['rock_river_boulder', { kind: 'boulder', factory: NATURE_PROP_MODEL_FACTORIES.rock_river_boulder, radius: 1.1 }],
  ['rock_shoreline_ledge', { kind: 'boulder', factory: NATURE_PROP_MODEL_FACTORIES.rock_shoreline_ledge, radius: 1.3 }],
  ['rock_stepping_stones', { kind: 'boulder', factory: NATURE_PROP_MODEL_FACTORIES.rock_stepping_stones, radius: 0 }],
  // Nature: village clutter
  ['prop_drying_fish_rack', { kind: 'prop', factory: NATURE_PROP_MODEL_FACTORIES.prop_drying_fish_rack, radius: 0.6 }],
  ['prop_barrels_crates', { kind: 'prop', factory: NATURE_PROP_MODEL_FACTORIES.prop_barrels_crates, radius: 0.6 }],
  ['prop_campfire_ring', { kind: 'prop', factory: NATURE_PROP_MODEL_FACTORIES.prop_campfire_ring, radius: 0.4 }],
  ['prop_corrupted_reeds', { kind: 'prop', factory: NATURE_PROP_MODEL_FACTORIES.prop_corrupted_reeds, radius: 0 }],
  // Progression
  ['poison_node', { kind: 'node', factory: PROGRESSION_MODEL_FACTORIES.poison_node, radius: 1.0 }],
  ['light_shrine', { kind: 'shrine', factory: PROGRESSION_MODEL_FACTORIES.light_shrine, radius: 1.0 }],
  // Act 1 landmark props (Lvl1.ts)
  [
    'castle_gatehouse',
    {
      kind: 'building',
      factory: LANDMARK_PROP_MODEL_FACTORIES.castle_gatehouse,
      radius: 0,
      colliders: [
        { offsetX: -3.15, offsetY: 0, radius: 1.6 },
        { offsetX: 3.15, offsetY: 0, radius: 1.6 },
      ],
    },
  ],
  [
    'castle_watchtower',
    {
      kind: 'building',
      factory: LANDMARK_PROP_MODEL_FACTORIES.castle_watchtower,
      radius: 1.6,
    },
  ],
  [
    'fishing_boat',
    {
      kind: 'prop',
      factory: LANDMARK_PROP_MODEL_FACTORIES.fishing_boat,
      radius: 2.1,
    },
  ],
  [
    'alley_barricade',
    {
      kind: 'prop',
      factory: LANDMARK_PROP_MODEL_FACTORIES.alley_barricade,
      radius: 1.4,
    },
  ],
  // Act 2 sunset wheatfield (Lvl2.ts)
  [
    'great_sunset_tree',
    {
      kind: 'building',
      factory: LVL2_MODEL_FACTORIES.great_sunset_tree,
      radius: 1.7,
    },
  ],
  [
    'boss_ronin',
    {
      kind: 'enemy',
      factory: LVL2_MODEL_FACTORIES.boss_ronin,
      radius: 0.85,
    },
  ],
  [
    'stone_lantern',
    {
      kind: 'prop',
      factory: LVL2_MODEL_FACTORIES.stone_lantern,
      radius: 0.4,
    },
  ],
]);

export class AssetRegistry {
  private constructor() {
    // Namespace-style holder; all state is module-level maps above.
  }

  // --- Legacy ASCII assets ---------------------------------------------------

  public static getBuildingAsset(assetId: string): BuildingAsset {
    const factory = buildingFactories.get(assetId);
    if (!factory) throw new Error(`Unknown building asset: "${assetId}"`);
    return factory();
  }

  public static getTreeAsset(assetId: string): TreeAsset {
    const factory = treeFactories.get(assetId);
    if (!factory) throw new Error(`Unknown tree asset: "${assetId}"`);
    return factory();
  }

  public static getBoulderAsset(assetId: string): { radius: number } {
    const meta = boulderAssets.get(assetId);
    if (meta) return meta;
    const model = modelAssets.get(assetId);
    if (model) return { radius: model.radius };
    throw new Error(`Unknown boulder asset: "${assetId}"`);
  }

  public static getEnemyArchetype(assetId: string): EnemyArchetype {
    const meta = enemyAssets.get(assetId);
    if (!meta) throw new Error(`Unknown enemy asset: "${assetId}"`);
    return meta;
  }

  /** Register a custom building asset (e.g. a pngToAscii JSON import). */
  public static registerCustomBuilding(id: string, asset: BuildingAsset): void {
    buildingFactories.set(id, () => asset);
  }

  // --- Unified 3D model registry ---------------------------------------------

  public static isModelAsset(assetId: string): boolean {
    return modelAssets.has(assetId);
  }

  /** Build a fresh model, applying the shrine purified state when requested. */
  public static getModel(assetId: string, purified = false): THREE.Group {
    const entry = modelAssets.get(assetId);
    if (!entry) throw new Error(`Unknown model asset: "${assetId}"`);
    const model = entry.factory();
    if (assetId === 'light_shrine' && purified) {
      setLightShrinePurified(model, true);
    }
    return model;
  }

  /** Default collider radius for an entity, falling back to a safe value. */
  public static getModelRadius(assetId: string): number {
    const entry = modelAssets.get(assetId);
    if (entry) return entry.radius;
    const boulder = boulderAssets.get(assetId);
    if (boulder) return boulder.radius;
    return 0.6;
  }

  /** Optional multi-circle footprint for an asset, or null to use a single circle. */
  public static getModelColliders(assetId: string): ColliderSpec[] | null {
    const entry = modelAssets.get(assetId);
    if (entry?.colliders && entry.colliders.length > 0) return entry.colliders;
    return null;
  }

  public static listAssetIds(kind: EntityKind): string[] {
    const ids: string[] = [];
    for (const [id, entry] of modelAssets) {
      if (entry.kind === kind) ids.push(id);
    }
    // Keep legacy ASCII assets placeable through their existing layers.
    if (kind === 'building') {
      for (const id of buildingFactories.keys()) if (!ids.includes(id)) ids.push(id);
    } else if (kind === 'tree') {
      for (const id of treeFactories.keys()) if (!ids.includes(id)) ids.push(id);
    } else if (kind === 'boulder') {
      for (const id of boulderAssets.keys()) if (!ids.includes(id)) ids.push(id);
    } else if (kind === 'enemy') {
      for (const id of enemyAssets.keys()) if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }
}
