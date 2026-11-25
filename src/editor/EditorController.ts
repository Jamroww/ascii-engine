import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { LevelManager } from '../core/LevelManager';
import type { TerrainChannel } from '../core/TerrainGrid';
import type { AsciiPropAsset } from '../core/types';
import { AssetRegistry } from '../data/AssetRegistry';
import type { EntityKind, LevelData, PlacedEntity } from '../data/levelTypes';
import type { BuildingAsset, BuildingCell } from '../rendering/BuildingLayer';
import { EditorPanel } from './EditorPanel';
import type { BrushKind, Tool } from './editorTypes';

interface BrushSpec {
  channel: TerrainChannel;
  /** Target byte as a normalized 0..1 value passed to `TerrainGrid.paintCircle`. */
  paint: number;
  erase: number;
}

// Channel conventions mirror TerrainGrid: R = river SDF (128 == shoreline),
// G = blight (0 clean / 255 full), B = path mask (0 wild / 128 cleared / 255 dirt).
const BRUSH_SPECS: Record<BrushKind, BrushSpec> = {
  river: { channel: 0, paint: 40 / 255, erase: 220 / 255 },
  blight: { channel: 1, paint: 1, erase: 0 },
  path: { channel: 2, paint: 1, erase: 0 },
  clearing: { channel: 2, paint: 128 / 255, erase: 0 },
};

const STORAGE_KEY = 'ascii-engine.level-editor';
const BUILDING_CELL_SIZE = 0.36;

export class EditorController {
  active = false;
  tool: Tool = 'brush';
  brushKind: BrushKind = 'river';
  brushRadius = 3;
  brushErase = false;
  selectedKind: EntityKind = 'building';
  selectedAssetId = 'riverside_cottage';
  selectedEntityId: string | null = null;
  showColliders = false;

  private readonly engine: Engine;
  private readonly levelManager: LevelManager;
  private readonly panel: EditorPanel;

  private readonly overlayGroup = new THREE.Group();
  private colliderLines: THREE.LineLoop[] = [];
  private pointerIsDown = false;
  private dragEntityId: string | null = null;
  private dragOffset = { x: 0, y: 0 };
  private idCounter = 0;

  constructor(engine: Engine, levelManager: LevelManager) {
    this.engine = engine;
    this.levelManager = levelManager;
    this.panel = new EditorPanel({
      onToolChange: (tool) => {
        this.tool = tool;
      },
      onBrushKindChange: (kind) => {
        this.brushKind = kind;
      },
      onBrushRadiusChange: (radius) => {
        this.brushRadius = radius;
      },
      onEraseChange: (erase) => {
        this.brushErase = erase;
      },
      onEntityKindChange: (kind) => {
        this.selectedKind = kind;
        this.selectedAssetId = AssetRegistry.listAssetIds(kind)[0] ?? '';
        this.refreshAssetList();
      },
      onAssetChange: (assetId) => {
        this.selectedAssetId = assetId;
      },
      onShowCollidersChange: (show) => {
        this.showColliders = show;
        this.refreshColliderOverlay();
      },
      onExport: () => this.exportJson(),
      onReset: () => this.resetDefault(),
    });
  }

  /** Attach the overlay + global listeners and honour `?editor=1`. */
  public initialize(): void {
    this.engine.overlayScene.add(this.overlayGroup);
    this.overlayGroup.visible = false;

    this.engine.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('keydown', this.onWindowKeyDown, true);
    window.addEventListener('dragover', this.onWindowDragOver);
    window.addEventListener('drop', this.onWindowDrop);

    this.refreshAssetList();
    this.panel.setStatus('Editor off — press F2 to enable');

    if (window.location.search.includes('editor=1')) {
      this.setActive(true);
    }
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.engine.setEditorMode(active);
    this.panel.setVisible(active);
    this.pointerIsDown = false;
    this.dragEntityId = null;
    this.refreshColliderOverlay();
    this.panel.setStatus(active ? 'Editor on — WASD to pan' : 'Editor off');
  }

  public dispose(): void {
    this.engine.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    window.removeEventListener('dragover', this.onWindowDragOver);
    window.removeEventListener('drop', this.onWindowDrop);
    this.clearColliderLines();
    this.engine.overlayScene.remove(this.overlayGroup);
    this.panel.dispose();
  }

  // --- Persistence -----------------------------------------------------------

  public exportJson(): void {
    const data = this.levelManager.exportLevelData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${data.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.panel.setStatus(`Exported ${data.id}.json`);
  }

  public saveToLocalStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.levelManager.exportLevelData()));
      this.panel.setStatus('Saved to localStorage');
    } catch {
      this.panel.setStatus('Save failed');
    }
  }

  public loadFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.panel.setStatus('No saved level found');
        return;
      }
      this.levelManager.loadLevel(JSON.parse(raw) as LevelData);
      this.refreshColliderOverlay();
      this.panel.setStatus('Loaded from localStorage');
    } catch {
      this.panel.setStatus('Load failed');
    }
  }

  public resetDefault(): void {
    this.levelManager.loadLevel(LevelManager.createDefaultVillageLevel());
    this.selectedEntityId = null;
    this.refreshColliderOverlay();
    this.panel.setStatus('Reset to default level');
  }

  // --- Pointer input ---------------------------------------------------------

  private readonly onCanvasPointerDown = (event: PointerEvent): void => {
    if (!this.active) return;
    const world = this.engine.screenToWorld(event.clientX, event.clientY);

    if (this.tool === 'brush') {
      this.pointerIsDown = true;
      this.paintBrush(world.x, world.y, event.shiftKey);
    } else if (this.tool === 'place') {
      this.placeEntity(world.x, world.y);
    } else if (this.tool === 'select') {
      this.selectAt(world.x, world.y);
    }
  };

  private readonly onWindowPointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.pointerIsDown) return;
    const world = this.engine.screenToWorld(event.clientX, event.clientY);

    if (this.tool === 'brush') {
      this.paintBrush(world.x, world.y, event.shiftKey);
    } else if (this.tool === 'select' && this.dragEntityId !== null) {
      this.levelManager.moveEntity(
        this.dragEntityId,
        world.x + this.dragOffset.x,
        world.y + this.dragOffset.y
      );
      this.refreshColliderOverlay();
    }
  };

  private readonly onWindowPointerUp = (): void => {
    if (!this.active) return;
    if (this.pointerIsDown && this.tool === 'brush') {
      // Defer the grass/ground/forest rebuild to stroke end so it doesn't lag mid-drag.
      this.levelManager.rebuildTerrainDependents();
      this.refreshColliderOverlay();
    }
    this.pointerIsDown = false;
    this.dragEntityId = null;
  };

  // --- Keyboard --------------------------------------------------------------

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F2') {
      event.preventDefault();
      this.setActive(!this.active);
      return;
    }
    if (!this.active || this.selectedEntityId === null) return;
    if (event.code === 'Delete' || event.code === 'Backspace') {
      // Don't delete while the user is interacting with a panel control.
      if (this.panel.containsTarget(event.target)) return;
      event.preventDefault();
      this.levelManager.removeEntity(this.selectedEntityId);
      this.selectedEntityId = null;
      this.refreshColliderOverlay();
      this.panel.setStatus('Removed entity');
    }
  };

  // --- Drag-and-drop ---------------------------------------------------------

  private readonly onWindowDragOver = (event: DragEvent): void => {
    event.preventDefault();
  };

  private readonly onWindowDrop = (event: DragEvent): void => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.json')) return;
    file
      .text()
      .then((text) => this.importJson(text, file.name))
      .catch(() => this.panel.setStatus('Drop failed: could not read file'));
  };

  private importJson(text: string, filename: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.panel.setStatus('Drop failed: invalid JSON');
      return;
    }

    if (this.isLevelData(parsed)) {
      this.levelManager.loadLevel(parsed);
      this.selectedEntityId = null;
      this.refreshColliderOverlay();
      this.panel.setStatus(`Loaded level "${parsed.id}"`);
      return;
    }

    if (this.isAsciiPropAsset(parsed)) {
      const asset = this.adaptPropToBuilding(parsed);
      const id =
        this.sanitizeId(filename.replace(/\.json$/i, '')) || this.sanitizeId(parsed.name) || 'imported';
      AssetRegistry.registerCustomBuilding(id, asset);
      this.selectedKind = 'building';
      this.selectedAssetId = id;
      this.panel.setEntityKind('building');
      this.refreshAssetList();
      this.panel.setStatus(`Registered building "${id}" — switch to Place`);
      return;
    }

    this.panel.setStatus('Drop failed: unrecognized JSON');
  }

  private isLevelData(value: unknown): value is LevelData {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.terrainBase64 === 'string' && Array.isArray(obj.entities);
  }

  private isAsciiPropAsset(value: unknown): value is AsciiPropAsset {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return Array.isArray(obj.cells) && typeof obj.width === 'number' && typeof obj.height === 'number';
  }

  private adaptPropToBuilding(prop: AsciiPropAsset): BuildingAsset {
    const cells: BuildingCell[] = prop.cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      char: cell.char,
      r: cell.r,
      g: cell.g,
      b: cell.b,
      emissive: 0,
    }));
    return {
      name: prop.name,
      width: prop.width,
      height: prop.height,
      cells,
      lights: [],
    };
  }

  private sanitizeId(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // --- Tools -----------------------------------------------------------------

  private paintBrush(x: number, y: number, shiftHeld: boolean): void {
    const terrain = this.levelManager.getTerrain();
    const spec = BRUSH_SPECS[this.brushKind];
    const erase = shiftHeld ? !this.brushErase : this.brushErase;
    const value = erase ? spec.erase : spec.paint;
    terrain.paintCircle(x, y, this.brushRadius, spec.channel, value, this.brushRadius * 0.3);
  }

  private placeEntity(x: number, y: number): void {
    const entity: PlacedEntity = {
      id: this.makeId(),
      kind: this.selectedKind,
      assetId: this.selectedAssetId,
      x,
      y,
    };
    this.levelManager.addEntity(entity);
    this.refreshColliderOverlay();
    this.panel.setStatus(`Placed ${this.selectedKind} "${this.selectedAssetId}"`);
  }

  private selectAt(x: number, y: number): void {
    const hit = this.hitTestEntity(x, y);
    if (hit) {
      this.selectedEntityId = hit.id;
      this.dragEntityId = hit.id;
      this.dragOffset = { x: hit.x - x, y: hit.y - y };
      this.pointerIsDown = true;
      this.panel.setStatus(`Selected "${hit.id}" — drag to move`);
    } else {
      this.selectedEntityId = null;
      this.panel.setStatus('No entity at cursor');
    }
  }

  private hitTestEntity(x: number, y: number): PlacedEntity | null {
    let best: PlacedEntity | null = null;
    let bestDist = Infinity;

    for (const entity of this.levelManager.exportLevelData().entities) {
      const info = this.entityInfo(entity);
      const dist = Math.hypot(x - info.cx, y - info.cy);
      if (dist < info.radius && dist < bestDist) {
        bestDist = dist;
        best = entity;
      }
    }
    return best;
  }

  private entityInfo(entity: PlacedEntity): { cx: number; cy: number; radius: number } {
    switch (entity.kind) {
      case 'building': {
        if (AssetRegistry.isModelAsset(entity.assetId)) {
          const radius = AssetRegistry.getModelRadius(entity.assetId);
          return { cx: entity.x, cy: entity.y + radius, radius: Math.max(radius, 0.8) + 0.4 };
        }
        const asset = AssetRegistry.getBuildingAsset(entity.assetId);
        const w = asset.width * BUILDING_CELL_SIZE;
        const h = asset.height * BUILDING_CELL_SIZE;
        return { cx: entity.x + w / 2, cy: entity.y + h / 2, radius: Math.max(w, h) / 2 + 0.6 };
      }
      case 'tree':
        if (AssetRegistry.isModelAsset(entity.assetId)) {
          const radius = AssetRegistry.getModelRadius(entity.assetId);
          return { cx: entity.x, cy: entity.y + 0.5, radius: Math.max(radius, 0.8) + 0.4 };
        }
        return { cx: entity.x, cy: entity.y + 0.5, radius: 1.3 };
      case 'boulder': {
        const radius = entity.radius ?? AssetRegistry.getModelRadius(entity.assetId);
        return { cx: entity.x, cy: entity.y, radius: Math.max(radius, 0.8) + 0.4 };
      }
      case 'enemy': {
        const radius = AssetRegistry.getEnemyArchetype(entity.assetId).radius;
        return { cx: entity.x, cy: entity.y, radius: Math.max(radius, 0.8) + 0.4 };
      }
      case 'npc':
      case 'node':
      case 'shrine':
      case 'prop': {
        const radius = AssetRegistry.getModelRadius(entity.assetId);
        return { cx: entity.x, cy: entity.y + radius * 0.5, radius: Math.max(radius, 0.8) + 0.4 };
      }
      default:
        return { cx: entity.x, cy: entity.y, radius: 1.0 };
    }
  }

  private makeId(): string {
    this.idCounter += 1;
    return `entity_${Date.now().toString(36)}_${this.idCounter.toString(36)}`;
  }

  private refreshAssetList(): void {
    const ids = AssetRegistry.listAssetIds(this.selectedKind);
    this.panel.updateAssetList(this.selectedKind, ids, this.selectedAssetId);
  }

  // --- Collider debug overlay ------------------------------------------------

  private refreshColliderOverlay(): void {
    this.clearColliderLines();
    if (!this.showColliders) {
      this.overlayGroup.visible = false;
      return;
    }
    for (const collider of this.engine.collision.getAll()) {
      this.colliderLines.push(this.makeCircleLine(collider.x, collider.y, collider.radius));
    }
    this.overlayGroup.visible = this.active;
  }

  private makeCircleLine(x: number, y: number, radius: number): THREE.LineLoop {
    const segments = 32;
    const positions = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      positions[i * 3] = x + Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.08; // just above the 3D ground plane
      positions[i * 3 + 2] = -(y + Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x22ff88, depthTest: false });
    const line = new THREE.LineLoop(geometry, material);
    this.overlayGroup.add(line);
    return line;
  }

  private clearColliderLines(): void {
    for (const line of this.colliderLines) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.overlayGroup.remove(line);
    }
    this.colliderLines = [];
  }
}
