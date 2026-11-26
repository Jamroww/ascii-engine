import { TerrainGrid } from './TerrainGrid';
import type { Engine } from './Engine';
import { GroundLayer } from '../rendering/GroundLayer';
import { GrassLayer } from '../rendering/GrassLayer';
import type { GrassDarkSpot, GrassExclusion } from '../rendering/GrassLayer';
import { WaterLayer } from '../rendering/WaterLayer';
import type { WaterLight } from '../rendering/WaterLayer';
import { ForestLayer, generateRiversideForest } from '../rendering/ForestLayer';
import type { TreePlacement } from '../rendering/ForestLayer';
import { BuildingLayer } from '../rendering/BuildingLayer';
import type { BuildingPlacement } from '../rendering/BuildingLayer';
import { WorldModelsLayer } from '../rendering/WorldModelsLayer';
import type { WorldModelPlacement } from '../rendering/WorldModelsLayer';
import { AssetRegistry } from '../data/AssetRegistry';
import type { LevelData, PlacedEntity } from '../data/levelTypes';

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

  private announcedOpening = false;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  public static createDefaultVillageLevel(): LevelData {
    const terrain = TerrainGrid.bakeAct1Harbor();

    const entities: PlacedEntity[] = [
      // --- Zone 1: Harbor & lantern pier (south-center) ---
      { id: 'village_dock', kind: 'building', assetId: 'village_dock', x: 2, y: -13 },
      { id: 'fishing_boat', kind: 'prop', assetId: 'fishing_boat', x: 6, y: -14 },

      // --- Zone 2: Alleyway ambush (west & north bay arc) ---
      { id: 'cottage_fisher_1', kind: 'building', assetId: 'cottage_fisher', x: -18, y: -8 },
      { id: 'cottage_boathouse_1', kind: 'building', assetId: 'cottage_boathouse', x: -24, y: -2 },
      { id: 'cottage_fisher_2', kind: 'building', assetId: 'cottage_fisher', x: -14, y: 2 },
      { id: 'cottage_fisher_3', kind: 'building', assetId: 'cottage_fisher', x: -24, y: 8 },
      { id: 'cottage_boathouse_2', kind: 'building', assetId: 'cottage_boathouse', x: -12, y: 8 },
      { id: 'cottage_fisher_4', kind: 'building', assetId: 'cottage_fisher', x: -16, y: -14 },

      { id: 'barricade_alley_1', kind: 'prop', assetId: 'alley_barricade', x: -13, y: -2 },
      { id: 'barricade_alley_2', kind: 'prop', assetId: 'alley_barricade', x: -25, y: 3 },
      { id: 'fence_alley_1', kind: 'building', assetId: 'fence_stone_wall', x: -19, y: 1 },
      { id: 'fence_alley_2', kind: 'building', assetId: 'fence_stone_wall', x: -23, y: 6 },
      { id: 'prop_barrels_1', kind: 'prop', assetId: 'prop_barrels_crates', x: -16, y: -6 },
      { id: 'prop_fish_rack_1', kind: 'prop', assetId: 'prop_drying_fish_rack', x: -20, y: -5 },

      { id: 'enemy_alley_stalker_1', kind: 'enemy', assetId: 'blight_stalker', x: -15, y: 0, group: 'alley' },
      { id: 'enemy_alley_stalker_2', kind: 'enemy', assetId: 'blight_stalker', x: -18, y: 5, group: 'alley' },
      { id: 'enemy_alley_spitter_1', kind: 'enemy', assetId: 'spore_spitter', x: -12, y: 4, group: 'alley' },

      // --- Zone 3: Survivor clearing & pine woods (north-west) ---
      { id: 'cottage_survivors', kind: 'building', assetId: 'cottage_fisher', x: -31, y: 13 },
      { id: 'prop_campfire', kind: 'prop', assetId: 'prop_campfire_ring', x: -28, y: 10 },
      { id: 'npc_ferryman', kind: 'npc', assetId: 'npc_ferryman', x: -26, y: 9 },
      { id: 'npc_lantern_keeper', kind: 'npc', assetId: 'npc_lantern_keeper', x: -30, y: 11 },
      { id: 'npc_elder', kind: 'npc', assetId: 'npc_elder', x: -29, y: 13 },
      { id: 'npc_herbalist', kind: 'npc', assetId: 'npc_herbalist', x: -27, y: 14 },

      { id: 'tree_pine_1', kind: 'tree', assetId: 'tree_pine', x: -34, y: 4 },
      { id: 'tree_pine_2', kind: 'tree', assetId: 'tree_pine', x: -33, y: 8 },
      { id: 'tree_pine_3', kind: 'tree', assetId: 'tree_pine', x: -32, y: 16 },
      { id: 'tree_pine_4', kind: 'tree', assetId: 'tree_pine', x: -24, y: 16 },
      { id: 'tree_oak_1', kind: 'tree', assetId: 'tree_oak', x: -31, y: 6 },
      { id: 'tree_oak_2', kind: 'tree', assetId: 'tree_oak', x: -25, y: 14 },

      { id: 'light_shrine', kind: 'shrine', assetId: 'light_shrine', x: -28, y: 19 },
      { id: 'poison_node_trail', kind: 'node', assetId: 'poison_node', x: -16, y: 22 },

      // --- Zone 4: Blighted river, bridge & castle courtyard (north-east) ---
      { id: 'tree_wilted_1', kind: 'tree', assetId: 'tree_wilted', x: 6, y: 24 },
      { id: 'tree_wilted_2', kind: 'tree', assetId: 'tree_wilted', x: 10, y: 28 },
      { id: 'tree_wilted_3', kind: 'tree', assetId: 'tree_wilted', x: 14, y: 33 },
      { id: 'tree_wilted_4', kind: 'tree', assetId: 'tree_wilted', x: 18, y: 38 },
      { id: 'tree_wilted_5', kind: 'tree', assetId: 'tree_wilted', x: 24, y: 40 },
      { id: 'tree_wilted_6', kind: 'tree', assetId: 'tree_wilted', x: 30, y: 38 },

      { id: 'boulder_river_1', kind: 'boulder', assetId: 'rock_river_boulder', x: 8, y: 22 },
      { id: 'boulder_river_2', kind: 'boulder', assetId: 'rock_river_boulder', x: 13, y: 29 },
      { id: 'boulder_river_3', kind: 'boulder', assetId: 'rock_river_boulder', x: 17, y: 35 },

      { id: 'poison_node_river', kind: 'node', assetId: 'poison_node', x: 10, y: 26 },

      { id: 'enemy_patrol_stalker_1', kind: 'enemy', assetId: 'blight_stalker', x: 12, y: 30, group: 'patrol' },
      { id: 'enemy_patrol_spitter_1', kind: 'enemy', assetId: 'spore_spitter', x: 15, y: 34, group: 'patrol' },
      { id: 'enemy_patrol_stalker_2', kind: 'enemy', assetId: 'blight_stalker', x: 19, y: 40, group: 'patrol' },

      { id: 'stone_bridge', kind: 'building', assetId: 'stone_bridge', x: 28, y: 45 },
      { id: 'castle_watchtower', kind: 'building', assetId: 'castle_watchtower', x: 33, y: 45 },
      { id: 'castle_gatehouse', kind: 'building', assetId: 'castle_gatehouse', x: 24, y: 49 },

      { id: 'castle_warden', kind: 'enemy', assetId: 'castle_warden', x: 26, y: 47, group: 'boss' },
    ];

    return {
      id: 'act1_harbor',
      name: 'Act 1 — Harbor to Castle',
      worldSize: terrain.worldSize,
      gridResolution: terrain.resolution,
      terrainBase64: terrain.toBase64(),
      forestSeed: 42,
      spawn: { x: 2, y: -16 },
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

    if (!this.announcedOpening && data.id === 'act1_harbor') {
      this.announcedOpening = true;
      this.engine.showToast('Something followed the boat ashore — push through the alley to the village!');
    }
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
    // Keep water reflections and grass shadow footprints in sync with the move.
    this.water?.setLights(this.collectWaterLights());
    this.grass?.setDarkSpots(this.collectGrassDarkSpots());
    this.grass?.setBuildingExclusions(this.collectBuildingExclusions());
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
    this.water = new WaterLayer(this.terrain, this.terrain.worldSize);
    this.engine.addLayer(this.water);
    this.engine.waterObject = this.water.object3D;
    this.water.setLights(this.collectWaterLights());
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
    this.ground = new GroundLayer(this.terrain, this.terrain.worldSize);
    this.grass = new GrassLayer(this.terrain);
    this.engine.addLayer(this.ground);
    this.engine.addGrassLayer(this.grass);
    this.grass.setDarkSpots(this.collectGrassDarkSpots());
    this.grass.setBuildingExclusions(this.collectBuildingExclusions());
  }

  /** Warm light sources (cottages, dock, shrine, nodes) reflected on the water. */
  private collectWaterLights(): WaterLight[] {
    const lights: WaterLight[] = [];
    for (const e of this.data.entities) {
      if (e.kind === 'building' || e.kind === 'shrine' || e.kind === 'node') {
        lights.push({ x: e.x, y: e.y, radius: 3.6, intensity: e.kind === 'node' ? 0.7 : 1.0 });
      }
    }
    return lights;
  }

  /** Shadow footprints (trees, buildings, props) that darken the grass. */
  private collectGrassDarkSpots(): GrassDarkSpot[] {
    const spots: GrassDarkSpot[] = [];
    for (const e of this.data.entities) {
      switch (e.kind) {
        case 'tree':
          spots.push({ x: e.x, y: e.y, radius: 2.4, strength: 0.45 });
          break;
        case 'building':
          spots.push({ x: e.x, y: e.y, radius: 3.6, strength: 0.5, cull: true });
          break;
        case 'prop':
          spots.push({ x: e.x, y: e.y, radius: 1.6, strength: 0.35 });
          break;
        case 'shrine':
        case 'node':
          spots.push({ x: e.x, y: e.y, radius: 1.8, strength: 0.35 });
          break;
        default:
          break;
      }
    }
    return spots;
  }

  /** Building footprints whose grass blades + wildflowers are hidden entirely. */
  private collectBuildingExclusions(): GrassExclusion[] {
    const exclusions: GrassExclusion[] = [];
    for (const e of this.data.entities) {
      if (e.kind !== 'building') continue;
      exclusions.push({ x: e.x, y: e.y, radius: 3.6 });
    }
    return exclusions;
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
