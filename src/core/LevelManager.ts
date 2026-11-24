import { TerrainGrid } from './TerrainGrid';
import type { Engine } from './Engine';
import { GroundLayer } from '../rendering/GroundLayer';
import { GrassLayer } from '../rendering/GrassLayer';
import { WaterLayer } from '../rendering/WaterLayer';
import { ForestLayer, generateRiversideForest } from '../rendering/ForestLayer';
import type { TreePlacement } from '../rendering/ForestLayer';
import { BuildingLayer } from '../rendering/BuildingLayer';
import type { BuildingPlacement } from '../rendering/BuildingLayer';
import { AssetRegistry } from '../data/AssetRegistry';
import type { LevelData, PlacedEntity } from '../data/levelTypes';
import { BOULDERS } from './world';

const WATER_AREA_SIZE = 140;

/**
 * Owns the active level: its `LevelData`, `TerrainGrid`, and the world layers
 * (ground, grass, water, forest, buildings). It builds layers from serialized
 * data and keeps the CollisionSystem in sync with every placed entity.
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
      { id: 'cottage', kind: 'building', assetId: 'riverside_cottage', x: -10, y: 2 },
      // Curated hero trees (one or two of each archetype) framed in the open
      // clearing so every tree type is showcased without cluttering gameplay.
      { id: 'tree_pine_1', kind: 'tree', assetId: 'ancient_pine', x: -8, y: 9 },
      { id: 'tree_pine_2', kind: 'tree', assetId: 'ancient_pine', x: -1, y: -9 },
      { id: 'tree_oak_1', kind: 'tree', assetId: 'gnarled_oak', x: -6, y: -7 },
      { id: 'tree_oak_2', kind: 'tree', assetId: 'gnarled_oak', x: -14, y: -3 },
      { id: 'tree_wilted_1', kind: 'tree', assetId: 'wilted_tree', x: -3, y: 12 },
      { id: 'tree_wilted_2', kind: 'tree', assetId: 'wilted_tree', x: -11, y: 11 },
      // Two fast melee rushers and a stationary spitter in the upstream Blight zone.
      { id: 'enemy_stalker_1', kind: 'enemy', assetId: 'blight_stalker', x: 0, y: 15 },
      { id: 'enemy_stalker_2', kind: 'enemy', assetId: 'blight_stalker', x: 4.5, y: 18 },
      { id: 'enemy_spitter_1', kind: 'enemy', assetId: 'spore_spitter', x: 1.5, y: 17 },
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

  public loadLevel(data: LevelData): void {
    this.data = data;
    this.terrain = TerrainGrid.fromBase64(data.terrainBase64, data.gridResolution, data.worldSize);
    this.engine.setTerrain(this.terrain);
    this.engine.setSpawnPoint(data.spawn.x, data.spawn.y);
    this.engine.setPlayerPosition(data.spawn.x, data.spawn.y);
    this.engine.resetCombatState();

    this.rebuildWater();
    this.rebuildGroundAndGrass();
    this.rebuildForest();
    this.rebuildBuilding();
    this.wireWaterLights();
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
    if (entity.kind === 'building') {
      this.rebuildBuilding();
      this.wireWaterLights();
    } else if (entity.kind === 'tree') {
      this.rebuildForest();
    } else if (entity.kind === 'enemy') {
      this.rebuildEnemies();
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
    this.water = new WaterLayer(this.engine.atlas, this.terrain, WATER_AREA_SIZE);
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
    this.ground = new GroundLayer(this.engine.atlas, this.terrain);
    this.grass = new GrassLayer(this.engine.atlas, this.terrain);
    this.engine.addLayer(this.ground);
    this.engine.addLayer(this.grass);
  }

  private rebuildForest(): void {
    const placements = this.buildTreePlacements();
    if (this.forest) {
      this.forest.rebuild(placements);
    } else {
      this.forest = new ForestLayer(this.engine.atlas, placements);
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

  private wireWaterLights(): void {
    if (this.water && this.building) {
      this.water.setLights(this.building.getWaterLights());
    }
  }

  private rebuildColliders(): void {
    this.engine.collision.clear();
    if (this.forest) this.engine.collision.addMany(this.forest.getColliders());
    if (this.building) this.engine.collision.addMany(this.building.getColliders());
    for (const e of this.data.entities) {
      if (e.kind !== 'boulder') continue;
      const radius = e.radius ?? AssetRegistry.getBoulderAsset(e.assetId).radius;
      this.engine.collision.add({ x: e.x, y: e.y, radius });
    }
  }

  private buildTreePlacements(): TreePlacement[] {
    const procedural = generateRiversideForest(this.terrain, this.data.forestSeed);
    const manual: TreePlacement[] = [];
    for (const e of this.data.entities) {
      if (e.kind !== 'tree') continue;
      const asset = AssetRegistry.getTreeAsset(e.assetId);
      manual.push({ kind: asset.kind, worldX: e.x, worldY: e.y, scale: 1.0 });
    }
    return [...procedural, ...manual];
  }

  private buildBuildingPlacements(): BuildingPlacement[] {
    const placements: BuildingPlacement[] = [];
    for (const e of this.data.entities) {
      if (e.kind !== 'building') continue;
      placements.push({
        asset: AssetRegistry.getBuildingAsset(e.assetId),
        worldX: e.x,
        worldY: e.y,
      });
    }
    return placements;
  }
}
