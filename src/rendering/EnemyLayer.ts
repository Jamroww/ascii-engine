import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import type { EnemyManager } from '../core/EnemyManager';
import { yToZ } from '../core/world';
import {
  AsciiModelBaker,
  disposeModelTree,
  type BakedAsciiSprite,
} from './AsciiModelBaker';
import { createBillboardMaterial, glyphGridFor } from './AsciiBillboardMaterial';
import { ENEMY_MODEL_FACTORIES, type EnemyAssetId } from './Enemies';

const VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform float uOpaque;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;

  void main() {
    float idx = floor(vGlyphIndex + 0.5);
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + vUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - vUv.y) / uAtlasGrid.y)
    );

    float alpha = texture2D(uAtlas, atlasUv).a;
    if (alpha < 0.15) {
      // Opaque dark silhouette backing for solid bodies; additive projectiles
      // fall through to discard.
      if (uOpaque > 0.5) {
        gl_FragColor = vec4(0.03, 0.04, 0.05, 0.92);
        return;
      }
      discard;
    }
    gl_FragColor = vec4(vColor, uOpaque > 0.5 ? 1.0 : alpha);
  }
`;

const SHADOW_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const SHADOW_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    float d = length(c);
    if (d > 1.0) discard;
    float a = smoothstep(1.0, 0.1, d) * 0.55;
    gl_FragColor = vec4(0.01, 0.015, 0.02, a);
  }
`;

const MAX_ENEMIES = 128;
const MAX_HEALTH_CELLS = 5;
const MAX_PROJECTILES = 256;
const HIT_FLASH_DURATION = 0.12;
const BILLBOARD_RESOLUTION = 128;

/**
 * Multi-cell glyph cluster drawn for each Spore Spitter projectile: a bright
 * centre orb surrounded by smaller neon motes, giving a large readable toxic
 * orb while the actual hitbox stays fair.
 */
const PROJECTILE_CLUSTER = [
  { dx: 0, dy: 0, scale: 1.0, glyph: '@' },
  { dx: -0.44, dy: 0, scale: 0.6, glyph: '%' },
  { dx: 0.44, dy: 0, scale: 0.6, glyph: '%' },
  { dx: 0, dy: 0.44, scale: 0.6, glyph: '*' },
  { dx: 0, dy: -0.44, scale: 0.6, glyph: '*' },
] as const;

interface InstancedBuffers {
  mesh: THREE.InstancedMesh;
  glyphs: Float32Array;
  colors: Float32Array;
  glyphAttr: THREE.InstancedBufferAttribute;
  colorAttr: THREE.InstancedBufferAttribute;
}

/**
 * Renders live enemies as baked 3D ASCII billboards with a grounding shadow,
 * idle/chase bob, telegraph rim-tint, white hit-flash and a compact health bar.
 * It reads state straight from `EnemyManager` each frame; the manager stays the
 * single source of truth.
 */
export class EnemyLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private readonly manager: EnemyManager;
  private readonly baker: AsciiModelBaker;
  private readonly dummy = new THREE.Object3D();

  private readonly typeSprites = new Map<string, BakedAsciiSprite>();
  private readonly bakedTypes = new Set<string>();

  private readonly enemyMeshes: THREE.Mesh[] = [];
  private readonly enemyMaterials: THREE.ShaderMaterial[] = [];
  private readonly enemyTypes: string[] = [];

  private readonly healthBuffers: InstancedBuffers;
  private readonly projectileBuffers: InstancedBuffers;

  private readonly shadowMaterial: THREE.ShaderMaterial;
  private readonly shadowMesh: THREE.InstancedMesh;

  constructor(atlas: GlyphAtlas, manager: EnemyManager, baker: AsciiModelBaker) {
    this.atlas = atlas;
    this.manager = manager;
    this.baker = baker;

    this.healthBuffers = this.createBuffers(
      MAX_ENEMIES * MAX_HEALTH_CELLS,
      THREE.NormalBlending,
      true
    );
    this.projectileBuffers = this.createBuffers(
      MAX_PROJECTILES * PROJECTILE_CLUSTER.length,
      THREE.AdditiveBlending,
      false
    );

    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERTEX_SHADER,
      fragmentShader: SHADOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      this.shadowMaterial,
      MAX_ENEMIES
    );
    this.shadowMesh.position.z = 0.51;
    this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadowMesh.frustumCulled = false;

    this.object3D.add(this.healthBuffers.mesh, this.projectileBuffers.mesh, this.shadowMesh);
  }

  /** Bake any newly-seen enemy model types into the shared cache. */
  public preRender(renderer: THREE.WebGLRenderer): void {
    const types = new Set<string>();
    for (const enemy of this.manager.getEnemies()) types.add(enemy.assetId);

    for (const type of types) {
      if (this.bakedTypes.has(type)) continue;
      const factory = ENEMY_MODEL_FACTORIES[type as EnemyAssetId];
      if (!factory) continue;
      const model = factory();
      const sprite = this.baker.bake(renderer, type, model, BILLBOARD_RESOLUTION);
      this.typeSprites.set(type, sprite);
      this.bakedTypes.add(type);
      disposeModelTree(model);
    }
  }

  public update(ctx: FrameContext): void {
    this.updateEnemies(ctx);
    this.updateProjectiles(ctx);
  }

  public dispose(): void {
    this.disposeBuffers(this.healthBuffers);
    this.disposeBuffers(this.projectileBuffers);
    this.shadowMesh.geometry.dispose();
    this.shadowMaterial.dispose();
    for (let i = 0; i < this.enemyMeshes.length; i++) {
      this.enemyMeshes[i].geometry.dispose();
      this.enemyMaterials[i].dispose();
    }
  }

  // --- Per-frame instance writes ---------------------------------------------

  private updateEnemies(ctx: FrameContext): void {
    const enemies = this.manager.getEnemies();

    while (this.enemyMeshes.length < enemies.length) {
      this.createEnemyBillboard();
    }
    for (let i = enemies.length; i < this.enemyMeshes.length; i++) {
      this.enemyMeshes[i].visible = false;
    }

    const {
      mesh: healthMesh,
      glyphs: healthGlyphs,
      colors: healthColors,
      glyphAttr: healthGlyphAttr,
      colorAttr: healthColorAttr,
    } = this.healthBuffers;

    let hi = 0;
    let si = 0;

    for (let e = 0; e < enemies.length; e++) {
      const enemy = enemies[e];
      const mesh = this.enemyMeshes[e];
      const material = this.enemyMaterials[e];
      const sprite = this.typeSprites.get(enemy.assetId);

      if (!sprite) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;

      if (this.enemyTypes[e] !== enemy.assetId) {
        this.enemyTypes[e] = enemy.assetId;
        material.uniforms.uBakedTex.value = sprite.texture;
        material.uniforms.uGlyphGrid.value = glyphGridFor(sprite.worldWidth, sprite.worldHeight);
        // Give the Blight Stalker a bright toxic/pale-bone rim floor so its
        // enlarged silhouette stays unmistakable during fast chases.
        material.uniforms.uMinLuminance.value = enemy.assetId === 'blight_stalker' ? 0.28 : 0;
      }

      const flash =
        enemy.hitFlashTimer > 0 ? Math.min(1, enemy.hitFlashTimer / HIT_FLASH_DURATION) : 0;
      const stunned = enemy.stunTimer > 0;
      const stunPulse = 0.6 + 0.4 * Math.sin(ctx.elapsed * 22);
      const telegraph = enemy.state === 'telegraph';
      const telegraphPulse = 0.5 + 0.5 * Math.sin(ctx.elapsed * 26);

      const bob =
        enemy.state === 'idle' || enemy.state === 'chase'
          ? Math.sin(ctx.elapsed * 4 + enemy.x * 1.3 + enemy.y * 0.7) * 0.06
          : 0;

      const baseScale = enemy.assetId === 'blight_stalker' ? 1.7 : 1.0;
      const scale = baseScale * (telegraph ? 1.0 + telegraphPulse * 0.2 : 1.0);
      const w = sprite.worldWidth * scale;
      const h = sprite.worldHeight * scale;
      const baseY = enemy.y + bob - 0.02;
      const ez = yToZ(enemy.y);

      mesh.position.set(enemy.x, baseY + h / 2, ez);
      mesh.scale.set(w, h, 1);

      material.uniforms.uFlash.value = flash;
      material.uniforms.uAlpha.value = 1;
      if (stunned) {
        material.uniforms.uTint.value.set(1.0, 0.8, 0.3);
        material.uniforms.uTintStrength.value = stunPulse;
      } else if (telegraph) {
        material.uniforms.uTint.value.set(1.0, 0.95, 0.55);
        material.uniforms.uTintStrength.value = telegraphPulse * 0.85;
      } else {
        material.uniforms.uTintStrength.value = 0;
      }

      // Grounding shadow ellipse beneath the sprite.
      if (si < MAX_ENEMIES) {
        this.dummy.position.set(enemy.x, baseY, 0);
        this.dummy.scale.set(w * 0.85, Math.max(w * 0.4, 0.5), 1);
        this.dummy.updateMatrix();
        this.shadowMesh.setMatrixAt(si, this.dummy.matrix);
        si++;
      }

      // Compact health bar above any damaged enemy.
      if (enemy.hp < enemy.maxHp && hi + MAX_HEALTH_CELLS <= healthGlyphs.length) {
        const hpFrac = enemy.hp / enemy.maxHp;
        const barCells = MAX_HEALTH_CELLS;
        const barW = barCells * 0.14;
        const barTop = baseY + h + 0.28;
        const filled = Math.round(hpFrac * barCells);

        let cr = 0.4;
        let cg = 0.95;
        let cb = 0.35;
        if (hpFrac <= 0.25) {
          cr = 0.95;
          cg = 0.25;
          cb = 0.2;
        } else if (hpFrac <= 0.55) {
          cr = 0.95;
          cg = 0.8;
          cb = 0.25;
        }

        for (let b = 0; b < barCells; b++) {
          const isFilled = b < filled;
          this.dummy.position.set(enemy.x - barW / 2 + (b + 0.5) * 0.14, barTop, ez);
          this.dummy.scale.set(0.14, 0.14, 1);
          this.dummy.updateMatrix();
          healthMesh.setMatrixAt(hi, this.dummy.matrix);

          healthGlyphs[hi] = this.atlas.getIndex(isFilled ? '=' : '-');
          healthColors[hi * 3 + 0] = isFilled ? cr : 0.25;
          healthColors[hi * 3 + 1] = isFilled ? cg : 0.12;
          healthColors[hi * 3 + 2] = isFilled ? cb : 0.1;
          hi++;
        }
      }
    }

    this.shadowMesh.count = si;
    this.shadowMesh.instanceMatrix.needsUpdate = true;

    healthMesh.count = hi;
    healthMesh.instanceMatrix.needsUpdate = true;
    healthGlyphAttr.needsUpdate = true;
    healthColorAttr.needsUpdate = true;
  }

  private updateProjectiles(ctx: FrameContext): void {
    const { mesh, glyphs, colors, glyphAttr, colorAttr } = this.projectileBuffers;
    const projectiles = this.manager.getProjectiles();

    const cellCount = PROJECTILE_CLUSTER.length;
    let i = 0;
    for (let p = 0; p < projectiles.length && i + cellCount <= glyphs.length; p++) {
      const proj = projectiles[p];
      // ~1.9x the old single-glyph projectile, now a pulsing multi-cell orb.
      const baseSize = 0.72 + Math.sin(ctx.elapsed * 20 + p * 1.3) * 0.14;
      const ez = yToZ(proj.y) + 0.05;

      for (let c = 0; c < cellCount; c++) {
        const cell = PROJECTILE_CLUSTER[c];
        this.dummy.position.set(
          proj.x + cell.dx * baseSize,
          proj.y + cell.dy * baseSize,
          ez
        );
        const cellSize = baseSize * cell.scale;
        this.dummy.scale.set(cellSize, cellSize, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);

        glyphs[i] = this.atlas.getIndex(cell.glyph);

        // Alternate toxic green / violet with a slow pulse across the cluster.
        const violet = (p + c) % 2 === 0;
        const pulse = 0.75 + 0.25 * Math.sin(ctx.elapsed * 18 + p * 1.7 + c * 0.6);
        colors[i * 3 + 0] = (violet ? 0.7 : 0.35) * pulse;
        colors[i * 3 + 1] = (violet ? 0.4 : 0.95) * pulse;
        colors[i * 3 + 2] = (violet ? 0.95 : 0.5) * pulse;
        i++;
      }
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    glyphAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  // --- Helpers ---------------------------------------------------------------

  private createEnemyBillboard(): void {
    const material = createBillboardMaterial(this.atlas);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.frustumCulled = false;
    this.enemyMeshes.push(mesh);
    this.enemyMaterials.push(material);
    this.enemyTypes.push('');
    this.object3D.add(mesh);
  }

  private createBuffers(
    capacity: number,
    blending: THREE.Blending,
    solid: boolean
  ): InstancedBuffers {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const glyphs = new Float32Array(capacity);
    const colors = new Float32Array(capacity * 3);
    const glyphAttr = new THREE.InstancedBufferAttribute(glyphs, 1);
    const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    geometry.setAttribute('aGlyphIndex', glyphAttr);
    geometry.setAttribute('aColor', colorAttr);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(this.atlas.cols, this.atlas.rows) },
        uOpaque: { value: solid ? 1 : 0 },
      },
      transparent: true,
      depthWrite: solid,
      blending,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    return { mesh, glyphs, colors, glyphAttr, colorAttr };
  }

  private disposeBuffers(buffers: InstancedBuffers): void {
    buffers.mesh.geometry.dispose();
    (buffers.mesh.material as THREE.Material).dispose();
  }
}
