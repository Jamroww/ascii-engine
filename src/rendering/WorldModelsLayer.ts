import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { AssetRegistry } from '../data/AssetRegistry';
import type { ColliderSpec, EntityKind } from '../data/levelTypes';
import { setLightShrinePurified as applyShrinePurified } from './Progression';
import { disposeModelTree, setCastShadow, setReceiveShadow } from './modelUtils';

/** Maximum warm/toxic point lights spawned per placed entity. */
const MAX_ENTITY_LIGHTS = 6;

/** A single placed 3D model ready for the world layer. */
export interface WorldModelPlacement {
  id: string;
  kind: EntityKind;
  assetId: string;
  purified: boolean;
  x: number;
  y: number;
  radius: number;
  colliders?: ColliderSpec[];
}

interface EntityLight {
  light: THREE.PointLight;
  base: number;
}

interface WorldModelEntry {
  placement: WorldModelPlacement;
  model: THREE.Group;
  lights: EntityLight[];
  absorbed: boolean;
}

/**
 * Instantiates real 3D `THREE.Group` models (buildings, NPCs, poison nodes and
 * light shrines, plus curated hero props) directly in the world scene at
 * `(x, 0, -y)`. Small warm/toxic point lights ride the emissive parts of each
 * model so the screen-space ASCII pass naturally produces soft gradient glows.
 */
export class WorldModelsLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private entries: WorldModelEntry[] = [];
  private highlightId: string | null = null;

  constructor(placements: WorldModelPlacement[]) {
    this.rebuild(placements);
  }

  /** Rebuild every model from a fresh placement list (entities changed). */
  public rebuild(placements: WorldModelPlacement[]): void {
    this.disposeEntries();
    this.object3D.clear();
    this.entries = [];
    this.highlightId = null;

    for (const placement of placements) {
      const entry = this.buildEntry(placement);
      this.entries.push(entry);
      this.object3D.add(entry.model);
    }
  }

  /** Colliders for every placed entity with a positive radius / footprint. */
  public getColliders(): Array<{ x: number; y: number; radius: number }> {
    const colliders: Array<{ x: number; y: number; radius: number }> = [];
    for (const entry of this.entries) {
      const p = entry.placement;
      if (p.colliders && p.colliders.length > 0) {
        for (const c of p.colliders) {
          colliders.push({ x: p.x + c.offsetX, y: p.y + c.offsetY, radius: c.radius });
        }
      } else if (p.radius > 0) {
        colliders.push({ x: p.x, y: p.y, radius: p.radius });
      }
    }
    return colliders;
  }

  /** Swap a shrine between dormant cold stone and purified warm gold. */
  public setLightShrinePurified(id: string, purified: boolean): void {
    const entry = this.entries.find((e) => e.placement.id === id);
    if (!entry || entry.placement.purified === purified) return;

    entry.placement.purified = purified;
    applyShrinePurified(entry.model, purified);
    this.rebuildEntryLights(entry);
  }

  /** Dim + desaturate a poison node so it clearly reads as spent/absorbed. */
  public setPoisonNodeAbsorbed(id: string, absorbed: boolean): void {
    const entry = this.entries.find((e) => e.placement.id === id);
    if (!entry) return;
    entry.absorbed = absorbed;

    entry.model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const mat = node.material;
      if (mat instanceof THREE.MeshStandardMaterial && node.userData.isEmissive) {
        mat.emissiveIntensity = absorbed ? 0.15 : 1.5;
      }
    });

    for (const l of entry.lights) {
      l.light.intensity = absorbed ? 0 : l.base;
    }
  }

  /** Brighten the glow of the nearest in-range interactable (or clear it). */
  public setInteractableHighlight(entityId: string | null): void {
    this.highlightId = entityId;
  }

  public update(ctx: FrameContext): void {
    for (const entry of this.entries) {
      const p = entry.placement;
      const highlighted = this.highlightId === p.id;

      for (const l of entry.lights) {
        let intensity = l.base;
        if (p.kind === 'node' && !entry.absorbed) {
          intensity *= 0.8 + 0.2 * Math.sin(ctx.elapsed * 2.5 + p.x * 1.1);
        } else if (p.kind === 'shrine' && p.purified) {
          intensity *= 0.92 + 0.08 * Math.sin(ctx.elapsed * 2.2);
        } else if (p.kind === 'npc') {
          intensity *= 0.94 + 0.06 * Math.sin(ctx.elapsed * 3.1 + p.y * 0.7);
        }
        if (highlighted) intensity *= 1.6;
        l.light.intensity = intensity;
      }
    }
  }

  public dispose(): void {
    this.disposeEntries();
    this.object3D.clear();
  }

  // --- Internal -------------------------------------------------------------

  private buildEntry(placement: WorldModelPlacement): WorldModelEntry {
    const model = AssetRegistry.getModel(placement.assetId, placement.purified);
    model.position.set(placement.x, 0, -placement.y);
    setCastShadow(model, true);
    setReceiveShadow(model, true);

    const entry: WorldModelEntry = {
      placement,
      model,
      lights: [],
      absorbed: false,
    };
    this.rebuildEntryLights(entry);
    return entry;
  }

  private rebuildEntryLights(entry: WorldModelEntry): void {
    for (const l of entry.lights) entry.model.remove(l.light);
    entry.lights = [];

    const emissives = collectEmissiveLights(entry.model, MAX_ENTITY_LIGHTS);
    for (const e of emissives) {
      const light = new THREE.PointLight(e.color.getHex(), e.intensity, e.distance, 2);
      light.position.copy(e.position);
      entry.model.add(light);
      entry.lights.push({ light, base: e.intensity });
    }
  }

  private disposeEntries(): void {
    for (const entry of this.entries) {
      disposeModelTree(entry.model);
    }
    this.entries = [];
  }
}

/** Local emissive light points sampled from a model's `userData.isEmissive` meshes. */
function collectEmissiveLights(
  model: THREE.Group,
  maxCount: number,
): Array<{ position: THREE.Vector3; color: THREE.Color; intensity: number; distance: number }> {
  model.updateMatrixWorld(true);
  const world = new THREE.Vector3();
  const local = new THREE.Vector3();
  const out: Array<{
    position: THREE.Vector3;
    color: THREE.Color;
    intensity: number;
    distance: number;
  }> = [];

  model.traverse((node) => {
    if (out.length >= maxCount) return;
    if (!(node instanceof THREE.Mesh) || !node.userData.isEmissive) return;
    const mat = node.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;

    // Lights are parented to the model, so resolve world -> model-local coords.
    node.getWorldPosition(world);
    model.worldToLocal(local.copy(world));
    const color = mat.emissive.getHex() !== 0x000000 ? mat.emissive : mat.color;
    out.push({
      position: local.clone(),
      color: color.clone(),
      intensity: 1.4,
      distance: 5.5,
    });
  });

  return out;
}
