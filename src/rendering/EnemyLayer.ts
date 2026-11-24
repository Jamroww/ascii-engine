import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import type { EnemyManager } from '../core/EnemyManager';

type RGB = [number, number, number];

interface SpriteCell {
  x: number;
  y: number;
  char: string;
  r: number;
  g: number;
  b: number;
}

interface EnemySprite {
  width: number;
  height: number;
  cells: SpriteCell[];
}

function buildSprite(rows: string[], palette: Record<string, RGB>): EnemySprite {
  const height = rows.length;
  const width = rows[0].length;
  const cells: SpriteCell[] = [];
  for (let r = 0; r < height; r++) {
    const line = rows[r];
    const y = height - 1 - r;
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === ' ') continue;
      const c = palette[ch] ?? ([0.6, 0.6, 0.6] as RGB);
      cells.push({ x, y, char: ch, r: c[0], g: c[1], b: c[2] });
    }
  }
  return { width, height, cells };
}

// Hunched, low-slung rusher: violet antennae, toxic-green hide, a single magenta eye.
const STALKER_SPRITE = buildSprite(['^ ^', '<o>', 'v v'], {
  '^': [0.62, 0.3, 0.85],
  '<': [0.34, 0.7, 0.4],
  o: [0.85, 0.4, 0.8],
  '>': [0.34, 0.7, 0.4],
  v: [0.3, 0.62, 0.4],
});

// Bulbous stationary spitter: a glowing spore crown and a violet maw, rooted in green rot.
const SPITTER_SPRITE = buildSprite([' * ', '(@)', '~_~'], {
  '*': [0.5, 1.0, 0.45],
  '(': [0.34, 0.75, 0.4],
  '@': [0.8, 0.32, 0.9],
  ')': [0.34, 0.75, 0.4],
  '~': [0.3, 0.65, 0.35],
  _: [0.2, 0.5, 0.3],
});

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
    if (alpha < 0.15) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const MAX_ENEMIES = 128;
const MAX_CELLS_PER_SPRITE = 8;
const MAX_PROJECTILES = 256;
const CELL_SIZE = 0.3;
const HIT_FLASH_DURATION = 0.12;

// Warning tint per enemy archetype while telegraphing.
const STALKER_WARN: RGB = [1.0, 0.85, 0.25];
const SPITTER_WARN: RGB = [1.0, 0.35, 0.9];

interface InstancedBuffers {
  mesh: THREE.InstancedMesh;
  glyphs: Float32Array;
  colors: Float32Array;
  glyphAttr: THREE.InstancedBufferAttribute;
  colorAttr: THREE.InstancedBufferAttribute;
}

/**
 * Renders live enemies (small multi-cell ASCII sprites) and enemy projectiles
 * (glowing toxic glyphs). It reads state straight from `EnemyManager` each frame
 * and only re-writes the instance buffers, so the manager stays the single
 * source of truth for combat.
 */
export class EnemyLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private readonly manager: EnemyManager;
  private readonly dummy = new THREE.Object3D();

  private readonly enemyBuffers: InstancedBuffers;
  private readonly projectileBuffers: InstancedBuffers;
  private readonly projectileGlyphs: number[];

  constructor(atlas: GlyphAtlas, manager: EnemyManager) {
    this.atlas = atlas;
    this.manager = manager;

    this.enemyBuffers = this.createBuffers(MAX_ENEMIES * MAX_CELLS_PER_SPRITE, 1.15, THREE.NormalBlending);
    this.projectileBuffers = this.createBuffers(MAX_PROJECTILES, 1.25, THREE.AdditiveBlending);
    this.projectileGlyphs = [atlas.getIndex('*'), atlas.getIndex('%'), atlas.getIndex('@')];

    this.object3D.add(this.enemyBuffers.mesh, this.projectileBuffers.mesh);
  }

  public update(ctx: FrameContext): void {
    this.updateEnemies(ctx);
    this.updateProjectiles(ctx);
  }

  public dispose(): void {
    this.disposeBuffers(this.enemyBuffers);
    this.disposeBuffers(this.projectileBuffers);
  }

  // --- Per-frame instance writes ---------------------------------------------

  private updateEnemies(ctx: FrameContext): void {
    const { mesh, glyphs, colors, glyphAttr, colorAttr } = this.enemyBuffers;
    const enemies = this.manager.getEnemies();
    const capacity = glyphs.length;

    let i = 0;
    for (const enemy of enemies) {
      if (i >= capacity) break;

      const sprite = enemy.assetId === 'spore_spitter' ? SPITTER_SPRITE : STALKER_SPRITE;
      const warn = enemy.assetId === 'spore_spitter' ? SPITTER_WARN : STALKER_WARN;
      const halfW = (sprite.width * CELL_SIZE) / 2;
      const halfH = (sprite.height * CELL_SIZE) / 2;
      const flash = enemy.hitFlashTimer > 0 ? Math.min(1, enemy.hitFlashTimer / HIT_FLASH_DURATION) : 0;
      const telegraph = enemy.state === 'telegraph';
      const pulse = 0.5 + 0.5 * Math.sin(ctx.elapsed * 26);
      const warnAmount = 0.35 + 0.55 * pulse;

      for (const cell of sprite.cells) {
        if (i >= capacity) break;
        let r = cell.r;
        let g = cell.g;
        let b = cell.b;

        if (flash > 0) {
          // Bright white flash on hit.
          r += (1 - r) * flash;
          g += (1 - g) * flash;
          b += (1 - b) * flash;
        } else if (telegraph) {
          // Warning yellow / magenta pulse before the attack lands.
          r += (warn[0] - r) * warnAmount;
          g += (warn[1] - g) * warnAmount;
          b += (warn[2] - b) * warnAmount;
        }

        this.dummy.position.set(
          enemy.x + (cell.x + 0.5) * CELL_SIZE - halfW,
          enemy.y + (cell.y + 0.5) * CELL_SIZE - halfH,
          0
        );
        this.dummy.scale.set(CELL_SIZE, CELL_SIZE, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);

        glyphs[i] = this.atlas.getIndex(cell.char);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
        i++;
      }
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    glyphAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private updateProjectiles(ctx: FrameContext): void {
    const { mesh, glyphs, colors, glyphAttr, colorAttr } = this.projectileBuffers;
    const projectiles = this.manager.getProjectiles();

    let i = 0;
    for (let p = 0; p < projectiles.length && i < glyphs.length; p++) {
      const proj = projectiles[p];
      const size = 0.4 + Math.sin(ctx.elapsed * 20 + p * 1.3) * 0.08;

      this.dummy.position.set(proj.x, proj.y, 0);
      this.dummy.scale.set(size, size, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);

      glyphs[i] = this.projectileGlyphs[p % this.projectileGlyphs.length];

      // Alternate toxic green / violet with a slow pulse.
      const violet = p % 2 === 0;
      const pulse = 0.75 + 0.25 * Math.sin(ctx.elapsed * 18 + p * 1.7);
      colors[i * 3 + 0] = (violet ? 0.7 : 0.4) * pulse;
      colors[i * 3 + 1] = (violet ? 0.4 : 0.95) * pulse;
      colors[i * 3 + 2] = (violet ? 0.95 : 0.45) * pulse;
      i++;
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    glyphAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  // --- Helpers ---------------------------------------------------------------

  private createBuffers(
    capacity: number,
    z: number,
    blending: THREE.Blending
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
      },
      transparent: true,
      depthWrite: false,
      blending,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.position.z = z;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    return { mesh, glyphs, colors, glyphAttr, colorAttr };
  }

  private disposeBuffers(buffers: InstancedBuffers): void {
    buffers.mesh.geometry.dispose();
    (buffers.mesh.material as THREE.Material).dispose();
  }
}
