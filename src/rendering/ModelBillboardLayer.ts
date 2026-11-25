import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import type { WaterLight } from './WaterLayer';
import { yToZ } from '../core/world';
import {
  AsciiModelBaker,
  measureModel,
  disposeModelTree,
} from './AsciiModelBaker';
import { createBillboardMaterial, glyphGridFor } from './AsciiBillboardMaterial';
import type { EntityKind } from '../data/levelTypes';

const BILLBOARD_RESOLUTION = 128;

/** A single placed 3D-baked entity ready for the billboard layer. */
export interface ModelBillboardPlacement {
  id: string;
  kind: EntityKind;
  /** Baker cache key (e.g. `cottage_fisher`, or `light_shrine:purified`). */
  bakeKey: string;
  /** Builds a fresh model in the requested state. */
  createModel: (purified?: boolean) => THREE.Object3D;
  purified: boolean;
  x: number;
  y: number;
  /** Collider radius in world units (0 for walk-over items like docks/bridges). */
  radius: number;
}

interface BillboardEntry {
  placement: ModelBillboardPlacement;
  model: THREE.Object3D | null;
  baked: boolean;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  shadowMesh: THREE.Mesh;
  worldWidth: number;
  worldHeight: number;
  lights: WaterLight[];
}

const SHADOW_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHADOW_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    float d = length(c);
    if (d > 1.0) discard;
    float a = smoothstep(1.0, 0.15, d) * 0.55;
    gl_FragColor = vec4(0.01, 0.015, 0.02, a);
  }
`;

/**
 * Renders placed 3D-baked entities (buildings, NPCs, nodes, shrines, props,
 * boulders and curated hero trees) as shaded ASCII billboards with a grounding
 * shadow oval, using a shared bake cache so every asset renders at most once.
 */
export class ModelBillboardLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private readonly baker: AsciiModelBaker;
  private readonly shadowMaterial: THREE.ShaderMaterial;
  private entries: BillboardEntry[] = [];

  constructor(atlas: GlyphAtlas, baker: AsciiModelBaker, placements: ModelBillboardPlacement[]) {
    this.atlas = atlas;
    this.baker = baker;
    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERTEX_SHADER,
      fragmentShader: SHADOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.rebuild(placements);
  }

  /** Rebuild every billboard from a fresh placement list (entities changed). */
  public rebuild(placements: ModelBillboardPlacement[]): void {
    this.disposeEntries();
    this.object3D.clear();
    this.entries = [];

    for (const placement of placements) {
      const entry = this.buildEntry(placement);
      this.entries.push(entry);
      this.object3D.add(entry.shadowMesh, entry.mesh);
    }
  }

  /** Colliders for every placed entity with a positive radius. */
  public getColliders(): Array<{ x: number; y: number; radius: number }> {
    const colliders: Array<{ x: number; y: number; radius: number }> = [];
    for (const entry of this.entries) {
      if (entry.placement.radius > 0) {
        colliders.push({
          x: entry.placement.x,
          y: entry.placement.y,
          radius: entry.placement.radius,
        });
      }
    }
    return colliders;
  }

  /** World-space emissive light points (windows / lanterns / veins) for reflections. */
  public getWaterLights(): WaterLight[] {
    const lights: WaterLight[] = [];
    for (const entry of this.entries) lights.push(...entry.lights);
    return lights;
  }

  /** Swap a shrine between dormant cold stone and purified warm gold. */
  public setLightShrinePurified(id: string, purified: boolean): void {
    const entry = this.entries.find((e) => e.placement.id === id);
    if (!entry || entry.placement.purified === purified) return;

    entry.placement.purified = purified;
    entry.placement.bakeKey = purified ? 'light_shrine:purified' : 'light_shrine';

    if (entry.model) disposeModelTree(entry.model);
    entry.model = entry.placement.createModel(purified);
    entry.baked = false;
    entry.lights = collectEmissiveLights(entry.model, entry.placement.x, entry.placement.y);
  }

  /** Dim + desaturate a poison node so it clearly reads as spent/absorbed. */
  public setPoisonNodeAbsorbed(id: string, absorbed: boolean): void {
    const entry = this.entries.find((e) => e.placement.id === id);
    if (!entry) return;
    const mat = entry.material;
    if (absorbed) {
      mat.uniforms.uAlpha.value = 0.55;
      mat.uniforms.uTint.value.set(0.12, 0.1, 0.16);
      mat.uniforms.uTintStrength.value = 0.72;
    } else {
      mat.uniforms.uAlpha.value = 1;
      mat.uniforms.uTintStrength.value = 0;
    }
  }

  /** Bake any un-baked models into their shared cache (first frame only). */
  public preRender(renderer: THREE.WebGLRenderer): void {
    for (const entry of this.entries) {
      if (entry.baked || !entry.model) continue;

      const sprite = this.baker.bake(
        renderer,
        entry.placement.bakeKey,
        entry.model,
        BILLBOARD_RESOLUTION,
      );
      entry.material.uniforms.uBakedTex.value = sprite.texture;
      entry.baked = true;
      disposeModelTree(entry.model);
      entry.model = null;
    }
  }

  public update(_ctx: FrameContext): void {
    // Static billboards; per-frame animation is handled by EnemyLayer/AsciiCharPass.
  }

  public dispose(): void {
    this.disposeEntries();
    this.shadowMaterial.dispose();
  }

  // --- Internal -------------------------------------------------------------

  private buildEntry(placement: ModelBillboardPlacement): BillboardEntry {
    const model = placement.createModel(placement.purified);
    const { worldWidth, worldHeight } = measureModel(model);

    const material = createBillboardMaterial(this.atlas);
    material.uniforms.uGlyphGrid.value = glyphGridFor(worldWidth, worldHeight);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
    // Anchor the quad's base at the entity's ground position.
    mesh.position.set(placement.x, placement.y + worldHeight / 2, yToZ(placement.y));

    // Subtle dark grounding shadow oval underneath, just above the grass/water.
    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMaterial);
    shadowMesh.scale.set(worldWidth * 0.9, Math.max(worldWidth * 0.4, 0.45), 1);
    shadowMesh.position.set(placement.x, placement.y + 0.05, 0.52);

    return {
      placement,
      model,
      baked: false,
      material,
      mesh,
      shadowMesh,
      worldWidth,
      worldHeight,
      lights: collectEmissiveLights(model, placement.x, placement.y),
    };
  }

  private disposeEntries(): void {
    for (const entry of this.entries) {
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      entry.shadowMesh.geometry.dispose();
      if (entry.model) disposeModelTree(entry.model);
    }
    this.entries = [];
  }
}

/** Collect warm emissive light points from a model's `userData.isEmissive` meshes. */
function collectEmissiveLights(model: THREE.Object3D, worldX: number, worldY: number): WaterLight[] {
  const lights: WaterLight[] = [];
  model.updateWorldMatrix(true, false);
  const world = new THREE.Vector3();
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.userData.isEmissive) return;
    node.getWorldPosition(world);
    const emissive = (node.material as THREE.MeshStandardMaterial).emissive;
    lights.push({
      x: worldX + world.x,
      y: worldY + world.y,
      radius: 2.6,
      r: emissive.r,
      g: emissive.g,
      b: emissive.b,
    });
  });
  return lights;
}
