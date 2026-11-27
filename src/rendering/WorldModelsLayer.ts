import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { AssetRegistry } from '../data/AssetRegistry';
import type { ColliderSpec, EntityKind } from '../data/levelTypes';
import { setLightShrinePurified as applyShrinePurified } from './Progression';
import { disposeModelTree, setCastShadow, setReceiveShadow } from './modelUtils';

/** Fixed reusable pool of warm/toxic point lights shared by the whole world. */
const POOL_SIZE = 6;
/** Maximum emissive light points sampled per placed model. */
const MAX_SOURCES_PER_ENTRY = 6;

/** A single placed 3D model ready for the world layer. */
export interface WorldModelPlacement {
  id: string;
  kind: EntityKind;
  assetId: string;
  purified: boolean;
  x: number;
  y: number;
  radius: number;
  /** Y-axis rotation in radians (custom PNG assets; 0 for native models). */
  rotation?: number;
  colliders?: ColliderSpec[];
}

/** A world-space emissive light point sampled from a model's glowing parts. */
interface LightSource {
  x: number;
  y: number;
  /** Height above the ground plane. */
  h: number;
  color: THREE.Color;
  intensity: number;
  distance: number;
}

interface WorldModelEntry {
  placement: WorldModelPlacement;
  model: THREE.Group;
  sources: LightSource[];
  absorbed: boolean;
}

/**
 * Instantiates real 3D `THREE.Group` models (buildings, NPCs, poison nodes and
 * light shrines, plus curated hero props) directly in the world scene at
 * `(x, 0, -y)`. Instead of spawning a light per emissive part, a fixed pool of
 * 6 `THREE.PointLight`s is reassigned each frame to the 6 closest active light
 * sources to the player, so the lighting budget never scales with the map.
 */
export class WorldModelsLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private entries: WorldModelEntry[] = [];
  private highlightId: string | null = null;
  private structureTintHex: string | null = null;

  private readonly pool: THREE.PointLight[] = [];
  private readonly poolIntensity: number[] = [];

  constructor(placements: WorldModelPlacement[]) {
    this.object3D.userData.isWorldReflection = true;

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xff9900, 0, 5.5, 2);
      // Always visible so the WebGL point-light count (and therefore the shader
      // program) stays constant; unused slots simply fade to intensity 0.
      light.visible = true;
      this.pool.push(light);
      this.poolIntensity.push(0);
      this.object3D.add(light);
    }

    this.rebuild(placements);
  }

  /** Rebuild every model from a fresh placement list (entities changed). */
  public rebuild(placements: WorldModelPlacement[]): void {
    this.disposeEntries();
    this.object3D.clear();
    this.entries = [];
    this.highlightId = null;

    // Re-add the light pool (it was cleared above).
    for (const light of this.pool) this.object3D.add(light);

    for (const placement of placements) {
      const entry = this.buildEntry(placement);
      this.entries.push(entry);
      this.object3D.add(entry.model);
    }

    if (this.structureTintHex) this.applyStructureTint();
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
    // Re-sample the emissive points so the pooled light picks up the warm-gold
    // purified glow instead of the dormant cold-stone colour.
    entry.sources = collectEmissiveSources(entry.model, MAX_SOURCES_PER_ENTRY);
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
  }

  /** Brighten the glow of the nearest in-range interactable (or clear it). */
  public setInteractableHighlight(entityId: string | null): void {
    this.highlightId = entityId;
  }

  /** NPC model roots (isolated as characters by the ASCII post-process). */
  public getNpcModels(): THREE.Object3D[] {
    return this.entries.filter((e) => e.placement.kind === 'npc').map((e) => e.model);
  }

  /**
   * Palette Structure channel: multiply each non-emissive structural albedo by a
   * tint, always re-derived from the cached original so live edits never stack.
   * Emissive windows / lanterns / shrine glows and the pooled PointLights are
   * never touched.
   */
  public setStructureTint(hex: string): void {
    this.structureTintHex = hex;
    this.applyStructureTint();
  }

  public update(ctx: FrameContext): void {
    const px = ctx.playerPos.x;
    const py = ctx.playerPos.y;
    const dt = ctx.dt > 0 ? ctx.dt : 1 / 60;

    const candidates: Array<{
      source: LightSource;
      factor: number;
      distSq: number;
    }> = [];

    for (const entry of this.entries) {
      const p = entry.placement;
      let factor = 1;
      if (p.kind === 'node' && !entry.absorbed) {
        factor *= 0.8 + 0.2 * Math.sin(ctx.elapsed * 2.5 + p.x * 1.1);
      } else if (p.kind === 'shrine' && p.purified) {
        factor *= 0.92 + 0.08 * Math.sin(ctx.elapsed * 2.2);
      } else if (p.kind === 'npc') {
        factor *= 0.94 + 0.06 * Math.sin(ctx.elapsed * 3.1 + p.y * 0.7);
      }
      if (this.highlightId === p.id) factor *= 1.6;

      for (const source of entry.sources) {
        const dx = source.x - px;
        const dy = source.y - py;
        candidates.push({ source, factor, distSq: dx * dx + dy * dy });
      }
    }

    candidates.sort((a, b) => a.distSq - b.distSq);
    const top = candidates.slice(0, POOL_SIZE);

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = this.pool[i];
      const candidate = top[i];

      const target = candidate ? candidate.source.intensity * candidate.factor : 0;
      // Smoothly fade between reassignments so a light never pops on/off.
      const k = 1 - Math.exp(-8 * dt);
      this.poolIntensity[i] += (target - this.poolIntensity[i]) * k;

      if (candidate) {
        const s = candidate.source;
        light.color.copy(s.color);
        light.distance = s.distance;
        light.position.set(s.x, s.h, -s.y);
      }

      light.intensity = this.poolIntensity[i];
    }

    // Gentle wind sway for models exposing a `swayGroup` (the great tree).
    for (const entry of this.entries) {
      const sway = entry.model.userData.swayGroup as THREE.Group | undefined;
      if (!sway) continue;
      const amp = (entry.model.userData.swayAmp as number | undefined) ?? 0.03;
      const speed = (entry.model.userData.swaySpeed as number | undefined) ?? 0.7;
      sway.rotation.z = Math.sin(ctx.elapsed * speed) * amp;
      sway.rotation.x = Math.cos(ctx.elapsed * speed * 0.8) * amp * 0.5;
    }
  }

  public dispose(): void {
    this.disposeEntries();
    for (const light of this.pool) light.dispose();
    this.object3D.clear();
  }

  // --- Internal -------------------------------------------------------------

  private buildEntry(placement: WorldModelPlacement): WorldModelEntry {
    const model = AssetRegistry.getModel(placement.assetId, placement.purified);
    model.position.set(placement.x, 0, -placement.y);
    model.rotation.y = placement.rotation ?? 0;
    setCastShadow(model, true);
    setReceiveShadow(model, true);
    liftWorldModelMaterials(model, placement.kind);
    cacheStructuralBaseColors(model);

    return {
      placement,
      model,
      sources: collectEmissiveSources(model, MAX_SOURCES_PER_ENTRY),
      absorbed: false,
    };
  }

  private applyStructureTint(): void {
    if (!this.structureTintHex) return;
    const tint = new THREE.Color(this.structureTintHex);
    for (const entry of this.entries) {
      entry.model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const mat = node.material;
        if (!(mat instanceof THREE.MeshStandardMaterial)) return;
        if (isStructuralEmissive(mat, node)) return;
        const base = mat.userData.baseColor as THREE.Color | undefined;
        if (!base) return;
        mat.color.copy(base).multiply(tint);
      });
    }
  }

  private disposeEntries(): void {
    for (const entry of this.entries) {
      disposeModelTree(entry.model);
    }
    this.entries = [];
  }
}

/** World-space emissive light points sampled from a model's `userData.isEmissive` meshes. */
function collectEmissiveSources(model: THREE.Group, maxCount: number): LightSource[] {
  model.updateMatrixWorld(true);
  const world = new THREE.Vector3();
  const out: LightSource[] = [];

  model.traverse((node) => {
    if (out.length >= maxCount) return;
    if (!(node instanceof THREE.Mesh) || !node.userData.isEmissive) return;
    const mat = node.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;

    node.getWorldPosition(world);
    const color = mat.emissive.getHex() !== 0x000000 ? mat.emissive : mat.color;
    out.push({
      x: world.x,
      y: -world.z,
      h: world.y,
      color: color.clone(),
      intensity: 1.4,
      distance: 5.5,
    });
  });

  return out;
}

/**
 * Give world-model surfaces clean directional contrast. Non-emissive materials
 * get no flat ambient lift; instead only the already-bright stone / plaster /
 * roof-trim albedos are lifted moderately so moonlit roofs read silver-slate
 * while shaded walls and dark timber stay deep charcoal. Emissive cottage
 * windows and doorway lanterns are boosted to warm amber so they glow out of
 * the dark walls. Pitched roofs and tree canopies stop receiving shadows so
 * they cast crisp ground shadows without self-shadowing themselves black.
 */
function liftWorldModelMaterials(model: THREE.Group, kind: EntityKind): void {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mat = node.material;

    if (mat instanceof THREE.MeshStandardMaterial) {
      if (node.userData.isEmissive) {
        // Warm amber windows / lanterns glow unmistakably out of dark walls.
        if (kind === 'building') {
          mat.emissive.setHex(0xffaa22);
          mat.emissiveIntensity = 3.2;
        }
      } else {
        // Lift only the bright stone / plaster / roof-trim albedos; leave the
        // dark walls, timber and roof slate in deep shadow.
        const hsl = { h: 0, s: 0, l: 0 };
        mat.color.getHSL(hsl);
        if (hsl.l > 0.4) {
          // Bright stone / plaster / roof-trim reads silver-slate: lift the
          // lightness and pull a touch of saturation out so lit masonry reads
          // crisp against the pitch-black shadow faces.
          mat.color.offsetHSL(0, -0.05, 0.1);
        }
      }
    }

    const geo = node.geometry;
    // Tree canopies (hero pine / oak / wilted foliage).
    const canopy =
      (geo instanceof THREE.ConeGeometry || geo instanceof THREE.DodecahedronGeometry) &&
      node.position.y > 1.0;
    // Pitched roof planes on cottages, boathouses and dock awnings.
    const pitchedRoof =
      geo instanceof THREE.BoxGeometry &&
      (Math.abs(node.rotation.x) > 0.25 || Math.abs(node.rotation.z) > 0.25);
    if (canopy || pitchedRoof) node.receiveShadow = false;
  });
}

/**
 * True for materials that read as emissive light (windows, lanterns, shrine
 * glows, braziers). The structure tint must never touch these so they stay
 * fully independent of the palette's Structure channel. Non-emissive materials
 * (black emissive) are always eligible, regardless of the default intensity 1.0.
 */
function isStructuralEmissive(mat: THREE.MeshStandardMaterial, node: THREE.Mesh): boolean {
  if (node.userData.isEmissive === true) return true;
  const e = mat.emissive;
  const emissiveBright = e.r > 0.01 || e.g > 0.01 || e.b > 0.01;
  if (!emissiveBright) return false;
  if (mat.emissiveIntensity > 0.5) return true;
  return e.r > 0.25 && e.g > 0.12 && e.r + e.g + e.b > 0.5;
}

/** Cache each non-emissive structural albedo so tints can be re-derived cleanly. */
function cacheStructuralBaseColors(model: THREE.Group): void {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mat = node.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;
    if (isStructuralEmissive(mat, node)) return;
    mat.userData.baseColor = mat.color.clone();
  });
}
