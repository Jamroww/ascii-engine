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
import type { EntityKind } from './levelTypes';

type BuildingFactory = () => BuildingAsset;
type TreeFactory = () => TreeAsset;

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

const buildingFactories = new Map<string, BuildingFactory>([
  ['riverside_cottage', createRiversideCottage],
]);

const treeFactories = new Map<string, TreeFactory>([
  ['ancient_pine', createAncientPine],
  ['gnarled_oak', createGnarledOak],
  ['wilted_tree', createWiltedTree],
]);

// Boulders are rendered inside WaterLayer's shader; here we only carry the
// metadata needed to register their colliders. The default radius is a fallback
// for entities that don't supply one.
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
      radius: 0.55,
      aggroRange: 7,
      attackRange: 1.3,
      telegraphTime: 0.35,
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
]);

export class AssetRegistry {
  private constructor() {
    // Namespace-style holder; all state is module-level maps above.
  }

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
    if (!meta) throw new Error(`Unknown boulder asset: "${assetId}"`);
    return meta;
  }

  public static getEnemyArchetype(assetId: string): EnemyArchetype {
    const meta = enemyAssets.get(assetId);
    if (!meta) throw new Error(`Unknown enemy asset: "${assetId}"`);
    return meta;
  }

  public static listAssetIds(kind: EntityKind): string[] {
    switch (kind) {
      case 'building':
        return [...buildingFactories.keys()];
      case 'tree':
        return [...treeFactories.keys()];
      case 'boulder':
        return [...boulderAssets.keys()];
      case 'enemy':
        return [...enemyAssets.keys()];
      default:
        return [];
    }
  }

  /** Register a custom building asset (e.g. a pngToAscii JSON import). */
  public static registerCustomBuilding(id: string, asset: BuildingAsset): void {
    buildingFactories.set(id, () => asset);
  }
}
