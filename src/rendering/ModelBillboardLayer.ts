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
import type { ColliderSpec, EntityKind } from '../data/levelTypes';

const BILLBOARD_RESOLUTION = 256;

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
  /** Optional multi-circle footprint; falls back to the single `radius` circle. */
  colliders?: ColliderSpec[];
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
  haloMesh: THREE.Mesh | null;
  haloMaterial: THREE.ShaderMaterial | null;
  /** Poison nodes track absorption so their aura can fade once spent. */
  absorbed: boolean;
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

const HALO_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Radial ASCII gradient glow: quantizes into fine glyph cells, maps a smooth
// radial falloff to glyph density, and blends a three-stop colour gradient that
// fades to transparent at the outer edge.
const HALO_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uGlyphGrid;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uBoost;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uGlyphSparse;
  uniform float uGlyphMid;
  uniform float uGlyphDense;
  uniform float uGlyphBright;

  varying vec2 vUv;

  void main() {
    vec2 cellCoord = floor(vUv * uGlyphGrid);
    vec2 cellUv = fract(vUv * uGlyphGrid);

    // Soft radial falloff from centre to edge (no hard circular rim); the boost
    // gently widens the radius.
    float rScale = 1.0 + uBoost;
    float d = length(vUv - 0.5) * 2.0;
    float radial = 1.0 - smoothstep(0.0, rScale, d);

    // Gentle breathing pulse.
    float pulse = 0.82 + 0.18 * sin(uTime * 2.4);
    float brightness = radial * pulse * uIntensity * (1.0 + uBoost * 0.35);

    // Density ramp: sparse '.' -> ':' -> '+' -> bright '*'.
    float idx = uGlyphSparse;
    idx = mix(idx, uGlyphMid, step(0.28, brightness));
    idx = mix(idx, uGlyphDense, step(0.52, brightness));
    idx = mix(idx, uGlyphBright, step(0.76, brightness));

    // Warm / toxic three-stop gradient, transparent at the outer edge.
    vec3 glowColor = mix(uColorA, uColorB, smoothstep(0.0, 0.55, d));
    glowColor = mix(glowColor, uColorC, smoothstep(0.55, 1.0, d));

    float alpha = brightness;
    if (alpha < 0.02) discard;

    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);
    vec2 atlasUv = vec2(
      (col + cellUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
    );
    float glyphAlpha = texture2D(uAtlas, atlasUv).a;
    if (glyphAlpha < 0.15) discard;

    gl_FragColor = vec4(glowColor, alpha);
  }
`;

// Interactable aura colours: warm lantern amber vs. brooding toxic violet/green.
const WARM_HALO = {
  core: { r: 1.0, g: 0.824, b: 0.478 }, // #ffd27a pale-gold
  mid: { r: 0.91, g: 0.541, b: 0.141 }, // #e88a24 warm amber
  edge: { r: 0.361, g: 0.157, b: 0.031 }, // #5c2808 deep ember
} as const;

const TOXIC_HALO = {
  core: { r: 0.545, g: 0.239, b: 1.0 }, // #8b3dff dark-violet
  mid: { r: 0.165, g: 0.561, b: 0.298 }, // #2a8f4c toxic-green
  edge: { r: 0.06, g: 0.03, b: 0.14 }, // deep violet (fades out)
} as const;

const TINT_WARM = { r: 1.0, g: 0.62, b: 0.22 } as const;
const TINT_TOXIC = { r: 0.45, g: 0.18, b: 0.62 } as const;

function tintColorFor(kind: EntityKind): { r: number; g: number; b: number } {
  return kind === 'node' ? TINT_TOXIC : TINT_WARM;
}

function isInteractable(kind: EntityKind): boolean {
  return kind === 'npc' || kind === 'shrine' || kind === 'node';
}

function haloSizeFor(kind: EntityKind, worldWidth: number): number {
  return kind === 'npc' ? Math.max(worldWidth * 1.6, 1.6) : Math.max(worldWidth * 1.4, 2.2);
}

/**
 * Renders placed 3D-baked entities (buildings, NPCs, nodes, shrines, props,
 * boulders and curated hero trees) as shaded ASCII billboards with a grounding
 * shadow oval, using a shared bake cache so every asset renders at most once.
 * Interactables (NPCs, shrines, poison nodes) also carry a pulsing radial ASCII
 * gradient glow and a soft rim tint so they read clearly as approachable.
 */
export class ModelBillboardLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private readonly baker: AsciiModelBaker;
  private readonly shadowMaterial: THREE.ShaderMaterial;
  private entries: BillboardEntry[] = [];
  private highlightId: string | null = null;

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
    this.highlightId = null;

    for (const placement of placements) {
      const entry = this.buildEntry(placement);
      this.entries.push(entry);
      this.object3D.add(entry.shadowMesh, entry.mesh);
      if (entry.haloMesh) this.object3D.add(entry.haloMesh);
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
    entry.absorbed = absorbed;
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

  /** Brighten the glow of the nearest in-range interactable (or clear it). */
  public setInteractableHighlight(entityId: string | null): void {
    this.highlightId = entityId;
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
        { npcRim: entry.placement.kind === 'npc' },
      );
      entry.material.uniforms.uBakedTex.value = sprite.texture;
      entry.baked = true;
      disposeModelTree(entry.model);
      entry.model = null;
    }
  }

  public update(ctx: FrameContext): void {
    for (const entry of this.entries) {
      if (!entry.haloMesh || !entry.haloMaterial) continue;
      const p = entry.placement;
      const kind = p.kind;
      const tint = tintColorFor(kind);
      const mat = entry.haloMaterial;

      mat.uniforms.uTime.value = ctx.elapsed;

      if (kind === 'node') {
        if (entry.absorbed) {
          // Spent: faint residual aura; the billboard keeps its desaturation tint.
          mat.uniforms.uIntensity.value = 0.22;
          mat.uniforms.uBoost.value = 0;
          continue;
        }
        mat.uniforms.uIntensity.value = 0.8;
        mat.uniforms.uBoost.value = this.highlightId === p.id ? 0.35 : 0;
        entry.material.uniforms.uTint.value.set(tint.r, tint.g, tint.b);
        entry.material.uniforms.uTintStrength.value = 0.16 + 0.06 * Math.sin(ctx.elapsed * 1.8);
        continue;
      }

      // NPC / shrine: warm lantern amber, brighter when purified or highlighted.
      let intensity = 0.85;
      if (kind === 'shrine' && p.purified) intensity += 0.35;
      mat.uniforms.uIntensity.value = intensity;
      mat.uniforms.uBoost.value = this.highlightId === p.id ? 0.35 : 0;
      entry.material.uniforms.uTint.value.set(tint.r, tint.g, tint.b);
      entry.material.uniforms.uTintStrength.value = 0.08 + 0.04 * Math.sin(ctx.elapsed * 2.6);
    }
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
    // Lift dark cloaks/coats and building walls so they stay legible outside
    // the lantern centre instead of crushing to black. NPCs also get a hard
    // luminance floor so their silhouettes never drop below a mid-tone glyph.
    if (placement.kind === 'npc') {
      material.uniforms.uLumLift.value = 0.22;
      material.uniforms.uMinLuminance.value = 0.34;
    } else if (placement.kind === 'building') {
      material.uniforms.uLumLift.value = 0.12;
    }

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
    // Anchor the quad's base at the entity's ground position.
    mesh.position.set(placement.x, placement.y + worldHeight / 2, yToZ(placement.y));

    // Subtle dark grounding shadow oval underneath, just above the grass/water.
    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMaterial);
    shadowMesh.scale.set(worldWidth * 0.9, Math.max(worldWidth * 0.4, 0.45), 1);
    shadowMesh.position.set(placement.x, placement.y + 0.05, 0.52);

    const halo = this.createHalo(placement, worldWidth);

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
      haloMesh: halo?.mesh ?? null,
      haloMaterial: halo?.material ?? null,
      absorbed: false,
    };
  }

  private createHalo(
    placement: ModelBillboardPlacement,
    worldWidth: number,
  ): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } | null {
    if (!isInteractable(placement.kind)) return null;
    const colors = placement.kind === 'node' ? TOXIC_HALO : WARM_HALO;
    const size = haloSizeFor(placement.kind, worldWidth);

    const material = new THREE.ShaderMaterial({
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(this.atlas.cols, this.atlas.rows) },
        uGlyphGrid: { value: glyphGridFor(size, size) },
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uBoost: { value: 0 },
        uColorA: { value: new THREE.Color(colors.core.r, colors.core.g, colors.core.b) },
        uColorB: { value: new THREE.Color(colors.mid.r, colors.mid.g, colors.mid.b) },
        uColorC: { value: new THREE.Color(colors.edge.r, colors.edge.g, colors.edge.b) },
        uGlyphSparse: { value: this.atlas.getIndex('.') },
        uGlyphMid: { value: this.atlas.getIndex(':') },
        uGlyphDense: { value: this.atlas.getIndex('+') },
        uGlyphBright: { value: this.atlas.getIndex('*') },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(placement.x, placement.y, 0.53);
    mesh.scale.set(size, size, 1);
    return { mesh, material };
  }

  private disposeEntries(): void {
    for (const entry of this.entries) {
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      entry.shadowMesh.geometry.dispose();
      if (entry.haloMesh) {
        entry.haloMesh.geometry.dispose();
        entry.haloMaterial?.dispose();
      }
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
