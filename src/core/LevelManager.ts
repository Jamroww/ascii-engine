import { TerrainGrid } from './TerrainGrid';
import type { Engine } from './Engine';
import { GroundLayer } from '../rendering/GroundLayer';
import { GrassLayer } from '../rendering/GrassLayer';
import { WaterLayer } from '../rendering/WaterLayer';
import { ForestLayer, generateRiversideForest } from '../rendering/ForestLayer';
import type { TreePlacement } from '../rendering/ForestLayer';
import { BuildingLayer } from '../rendering/BuildingLayer';
import type { BuildingPlacement } from '../rendering/BuildingLayer';
import { WorldModelsLayer } from '../rendering/WorldModelsLayer';
import type { WorldModelPlacement } from '../rendering/WorldModelsLayer';
import { AssetRegistry } from '../data/AssetRegistry';
import type { LevelData, PlacedEntity } from '../data/levelTypes';
import { BOULDERS } from './world';

/**
 * Owns the active level: its `LevelData`, `TerrainGrid`, and the world layers
 * (3D ground, grass, water, perimeter forest, legacy ASCII buildings, and the
 * unified real-3D model layer). It builds layers from serialized data and keeps
 * the CollisionSystem in sync with every placed entity.
 */
export class LevelManager {
  private data!: LevelData;
  private terrain!: TerrainGrid;
  private readonly engine: Engine;

  private ground: GroundLayer | null = null;
  private grass: GrassLayer | null = null;
  private water: WaterLayer | null = null;
  private forest: ForestLayer | null = null;
  private building: BuildingLayer | null = null;
  private worldModels: WorldModelsLayer | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  public static createDefaultVillageLevel(): LevelData {
    const terrain = TerrainGrid.bakeFromLegacy();

    const boulders: PlacedEntity[] = BOULDERS.map((b, i) => ({
      id: `boulder_${i}`,
      kind: 'boulder',
      assetId: 'river_boulder',
      x: b.x,
      y: b.y,
      radius: b.r,
    }));

    const entities: PlacedEntity[] = [
      // West clearing: fisher cottage with the lantern-keeper nearby.
      { id: 'cottage_fisher', kind: 'building', assetId: 'cottage_fisher', x: -7, y: 1 },
      { id: 'npc_lantern_keeper', kind: 'npc', assetId: 'npc_lantern_keeper', x: -4, y: 3 },
      { id: 'prop_fish_rack', kind: 'prop', assetId: 'prop_drying_fish_rack', x: -5, y: 5 },
      { id: 'prop_barrels', kind: 'prop', assetId: 'prop_barrels_crates', x: -9, y: 4 },

      // Riverfront: boathouse + wooden dock with the ferryman at his post.
      { id: 'cottage_boathouse', kind: 'building', assetId: 'cottage_boathouse', x: 2, y: 5 },
      { id: 'village_dock', kind: 'building', assetId: 'village_dock', x: 6, y: 1 },
      { id: 'npc_ferryman', kind: 'npc', assetId: 'npc_ferryman', x: 5.4, y: 2.2 },

      // Southern clearing: a dormant Light Shrine awaiting purification.
      { id: 'light_shrine', kind: 'shrine', assetId: 'light_shrine', x: -3, y: -7 },

      // Northern upstream Blight: poison node alongside the starter enemies.
      { id: 'poison_node', kind: 'node', assetId: 'poison_node', x: 1, y: 19 },
      { id: 'enemy_stalker_1', kind: 'enemy', assetId: 'blight_stalker', x: 0, y: 15 },
      { id: 'enemy_stalker_2', kind: 'enemy', assetId: 'blight_stalker', x: 4.5, y: 18 },
      { id: 'enemy_spitter_1', kind: 'enemy', assetId: 'spore_spitter', x: 1.5, y: 17 },

      // Curated hero trees (3D) framed in the open clearing.
      { id: 'tree_pine_1', kind: 'tree', assetId: 'tree_pine', x: -8, y: 9 },
      { id: 'tree_oak_1', kind: 'tree', assetId: 'tree_oak', x: -14, y: -3 },
      { id: 'tree_wilted_1', kind: 'tree', assetId: 'tree_wilted', x: -3, y: 12 },

      ...boulders,
    ];

    return {
      id: 'riverside_village',
      name: 'Riverside Village',
      worldSize: terrain.worldSize,
      gridResolution: terrain.resolution,
      terrainBase64: terrain.toBase64(),
      forestSeed: 42,
      spawn: { x: 0, y: 0 },
      entities,
    };
  }

  public getTerrain(): TerrainGrid {
    return this.terrain;
  }

  /** NPCs, poison nodes and light shrines the player can interact with. */
  public getInteractableEntities(): PlacedEntity[] {
    return this.data.entities.filter(
      (e) => e.kind === 'npc' || e.kind === 'node' || e.kind === 'shrine',
    );
  }

  /** Mark a poison node visually spent (dimmed) after the player absorbs it. */
  public absorbPoisonNode(id: string): void {
    const entity = this.data.entities.find((e) => e.id === id);
    if (!entity || entity.kind !== 'node') return;
    this.worldModels?.setPoisonNodeAbsorbed(id, true);
  }

  /** Brighten the glow of the nearest in-range interactable (or clear it). */
  public setInteractableHighlight(entityId: string | null): void {
    this.worldModels?.setInteractableHighlight(entityId);
  }

  /** Ignite a light shrine in warm gold after the player purifies it. */
  public purifyShrine(id: string): void {
    this.setShrinePurified(id, true);
  }

  public loadLevel(data: LevelData): void {
    this.data = data;
    this.terrain = TerrainGrid.fromBase64(data.terrainBase64, data.gridResolution, data.worldSize);
    this.engine.setTerrain(this.terrain);
    this.engine.setSpawnPoint(data.spawn.x, data.spawn.y);
    this.engine.setPlayerPosition(data.spawn.x, data.spawn.y);
    this.engine.resetCombatState();
    this.engine.progression.reset();

    this.rebuildWater();
    this.rebuildGroundAndGrass();
    this.rebuildForest();
    this.rebuildBuilding();
    this.rebuildWorldModels();
    this.rebuildColliders();
    this.rebuildEnemies();
  }

  // --- Editor-ready mutations -------------------------------------------------

  public addEntity(entity: PlacedEntity): void {
    this.data.entities.push(entity);
    this.applyEntityChange(entity);
  }

  public removeEntity(id: string): void {
    const idx = this.data.entities.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const [removed] = this.data.entities.splice(idx, 1);
    this.applyEntityChange(removed);
  }

  public moveEntity(id: string, x: number, y: number): void {
    const entity = this.data.entities.find((e) => e.id === id);
    if (!entity) return;
    entity.x = x;
    entity.y = y;
    this.applyEntityChange(entity);
  }

  /** Swap a placed Light Shrine between dormant and purified states. */
  public setShrinePurified(id: string, purified: boolean): void {
    const entity = this.data.entities.find((e) => e.id === id);
    if (!entity || entity.kind !== 'shrine') return;
    entity.purified = purified;
    this.worldModels?.setLightShrinePurified(id, purified);
  }

  /** Rebuild the layers that bake terrain into their geometry after a brush stroke. */
  public rebuildTerrainDependents(): void {
    this.rebuildGroundAndGrass();
    this.rebuildForest();
    this.rebuildColliders();
  }

  public exportLevelData(): LevelData {
    return {
      ...this.data,
      worldSize: this.terrain.worldSize,
      gridResolution: this.terrain.resolution,
      terrainBase64: this.terrain.toBase64(),
      entities: this.data.entities.map((e) => ({ ...e })),
    };
  }

  // --- Internal rebuild helpers ----------------------------------------------

  private applyEntityChange(entity: PlacedEntity): void {
    if (entity.kind === 'enemy') {
      this.rebuildEnemies();
    } else {
      // Rebuild whichever layer owns this entity, then refresh colliders.
      this.rebuildWorldModels();
      this.rebuildForest();
      this.rebuildBuilding();
    }
    this.rebuildColliders();
  }

  /** Refresh live enemies from the placed `enemy` entities (add / move / remove). */
  private rebuildEnemies(): void {
    this.engine.enemies.spawnFromEntities(this.data.entities);
  }

  private rebuildWater(): void {
    if (this.water) {
      this.engine.removeLayer(this.water);
      this.water.dispose();
    }
    this.water = new WaterLayer(this.terrain);
    this.engine.addLayer(this.water);
  }

  private rebuildGroundAndGrass(): void {
    if (this.ground) {
      this.engine.removeLayer(this.ground);
      this.ground.dispose();
    }
    if (this.grass) {
      this.engine.removeLayer(this.grass);
      this.grass.dispose();
    }
    this.ground = new GroundLayer(this.terrain);
    this.grass = new GrassLayer(this.engine.atlas, this.terrain);
    this.engine.addLayer(this.ground);
    this.engine.addLayer(this.grass);
  }

  private rebuildForest(): void {
    const placements = this.buildTreePlacements();
    if (this.forest) {
      this.forest.rebuild(placements);
    } else {
      this.forest = new ForestLayer(placements);
      this.engine.addLayer(this.forest);
    }
  }

  private rebuildBuilding(): void {
    const placements = this.buildBuildingPlacements();
    if (this.building) {
      this.building.rebuild(placements);
    } else {
      this.building = new BuildingLayer(this.engine.atlas, placements);
      this.engine.addLayer(this.building);
    }
  }

  private rebuildWorldModels(): void {
    const placements = this.buildWorldModelPlacements();
    if (this.worldModels) {
      this.worldModels.rebuild(placements);
    } else {
      this.worldModels = new WorldModelsLayer(placements);
      this.engine.addLayer(this.worldModels);
    }
  }

  private rebuildColliders(): void {
    this.engine.collision.clear();
    if (this.forest) this.engine.collision.addMany(this.forest.getColliders());
    if (this.building) this.engine.collision.addMany(this.building.getColliders());
    if (this.worldModels) this.engine.collision.addMany(this.worldModels.getColliders());
    // Legacy WaterLayer-rendered boulders (river_boulder) still need colliders.
    for (const e of this.data.entities) {
      if (e.kind !== 'boulder') continue;
      if (AssetRegistry.isModelAsset(e.assetId)) continue;
      const radius = e.radius ?? AssetRegistry.getBoulderAsset(e.assetId).radius;
      this.engine.collision.add({ x: e.x, y: e.y, radius });
    }
  }

  private buildTreePlacements(): TreePlacement[] {
    const procedural = generateRiversideForest(this.terrain, this.data.forestSeed);
    const manual: TreePlacement[] = [];
    for (const e of this.data.entities) {
      if (e.kind !== 'tree') continue;
      if (AssetRegistry.isModelAsset(e.assetId)) continue; // 3D hero trees -> world models
      const asset = AssetRegistry.getTreeAsset(e.assetId);
      manual.push({ kind: asset.kind, worldX: e.x, worldY: e.y, scale: 1.0 });
    }
    return [...procedural, ...manual];
  }

  private buildBuildingPlacements(): BuildingPlacement[] {
    const placements: BuildingPlacement[] = [];
    for (const e of this.data.entities) {
      if (e.kind !== 'building') continue;
      if (AssetRegistry.isModelAsset(e.assetId)) continue; // 3D buildings -> world models
      placements.push({
        asset: AssetRegistry.getBuildingAsset(e.assetId),
        worldX: e.x,
        worldY: e.y,
      });
    }
    return placements;
  }

  private buildWorldModelPlacements(): WorldModelPlacement[] {
    const placements: WorldModelPlacement[] = [];
    for (const e of this.data.entities) {
      if (e.kind === 'enemy') continue; // enemies are owned by EnemyManager
      if (!AssetRegistry.isModelAsset(e.assetId)) continue;
      placements.push({
        id: e.id,
        kind: e.kind,
        assetId: e.assetId,
        purified: e.purified ?? false,
        x: e.x,
        y: e.y,
        radius: e.radius ?? AssetRegistry.getModelRadius(e.assetId),
        colliders:
          e.radius === undefined
            ? (AssetRegistry.getModelColliders(e.assetId) ?? undefined)
            : undefined,
      });
    }
    return placements;
  }
}
