import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import type { EnemyManager } from '../core/EnemyManager';
import { yToZ } from '../core/world';

type RGB = [number, number, number];

interface SpriteCell {
  x: number;
  y: number;
  char: string;
  r: number;
  g: number;
  b: number;
  /** 1 for pulsing core / eye cells, else 0. */
  glow: number;
}

interface EnemySprite {
  width: number;
  height: number;
  cells: SpriteCell[];
}

function buildSprite(
  rows: string[],
  palette: Record<string, RGB>,
  glowChars?: ReadonlySet<string>
): EnemySprite {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells: SpriteCell[] = [];
  for (let r = 0; r < height; r++) {
    const line = rows[r];
    const y = height - 1 - r;
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === ' ') continue;
      const c = palette[ch] ?? ([0.6, 0.6, 0.6] as RGB);
      cells.push({ x, y, char: ch, r: c[0], g: c[1], b: c[2], glow: glowChars?.has(ch) ? 1 : 0 });
    }
  }
  return { width, height, cells };
}

// Hunched, angular quadruped predator: dark opaque core, bright acid-lime /
// sickly-teal outline rim, glowing eyes.
const STALKER_SPRITE = buildSprite(
  [
    '    ^   ^  ',
    '   < o o > ',
    '  <|#%#|>  ',
    ' <(#%#%#)> ',
    '<|#%%%#|>  ',
    '<##%#%##>  ',
    ' <##%##>   ',
    '  \\##/     ',
    '  v   v    ',
  ],
  {
    '#': [0.05, 0.08, 0.07],
    '%': [0.09, 0.14, 0.12],
    '<': [0.6, 0.95, 0.45],
    '>': [0.6, 0.95, 0.45],
    '^': [0.6, 0.95, 0.45],
    'v': [0.45, 0.8, 0.4],
    '(': [0.45, 0.85, 0.5],
    ')': [0.45, 0.85, 0.5],
    '/': [0.5, 0.9, 0.45],
    '\\': [0.5, 0.9, 0.45],
    '|': [0.5, 0.9, 0.45],
    o: [1.0, 1.0, 0.35],
    '*': [1.0, 0.95, 0.4],
  },
  new Set(['o', '*'])
);

// Bulbous, rooted fungal sac: pulsing violet/magenta core and a bright
// toxic-green spore crown.
const SPITTER_SPRITE = buildSprite(
  [
    '   * ^ *   ',
    '  * ^*^ *  ',
    '  (@%#%@)  ',
    ' (##%#%##) ',
    ' (##@%@##) ',
    '  (#####)  ',
    '   ~_~     ',
    '   ~~~     ',
    '    _      ',
  ],
  {
    '*': [0.55, 1.0, 0.3],
    '^': [0.7, 1.0, 0.4],
    '@': [0.75, 0.3, 0.9],
    '%': [0.6, 0.25, 0.85],
    '#': [0.06, 0.09, 0.08],
    '(': [0.4, 0.8, 0.5],
    ')': [0.4, 0.8, 0.5],
    '~': [0.3, 0.65, 0.4],
    _: [0.25, 0.55, 0.35],
  },
  new Set(['@', '%'])
);

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
      // Opaque dark silhouette backing for solid bodies so ground/grass never
      // bleeds through an enemy; additive projectiles fall through to discard.
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
const MAX_CELLS_PER_SPRITE = 110;
const MAX_HEALTH_CELLS = 5;
const MAX_PROJECTILES = 256;
const CELL_SIZE = 0.2;
const HIT_FLASH_DURATION = 0.12;

interface InstancedBuffers {
  mesh: THREE.InstancedMesh;
  glyphs: Float32Array;
  colors: Float32Array;
  glyphAttr: THREE.InstancedBufferAttribute;
  colorAttr: THREE.InstancedBufferAttribute;
}

/**
 * Renders live enemies as dense, multi-layered ASCII sprites with a grounding
 * shadow, idle/chase bob, telegraph rim-flash and a compact health bar. It
 * reads state straight from `EnemyManager` each frame and only re-writes the
 * instance buffers, so the manager stays the single source of truth.
 */
export class EnemyLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private readonly manager: EnemyManager;
  private readonly dummy = new THREE.Object3D();

  private readonly enemyBuffers: InstancedBuffers;
  private readonly projectileBuffers: InstancedBuffers;
  private readonly projectileGlyphs: number[];

  private readonly shadowMaterial: THREE.ShaderMaterial;
  private readonly shadowMesh: THREE.InstancedMesh;

  constructor(atlas: GlyphAtlas, manager: EnemyManager) {
    this.atlas = atlas;
    this.manager = manager;

    this.enemyBuffers = this.createBuffers(
      MAX_ENEMIES * (MAX_CELLS_PER_SPRITE + MAX_HEALTH_CELLS),
      THREE.NormalBlending,
      true
    );
    this.projectileBuffers = this.createBuffers(MAX_PROJECTILES, THREE.AdditiveBlending, false);
    this.projectileGlyphs = [atlas.getIndex('*'), atlas.getIndex('%'), atlas.getIndex('@')];

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

    this.object3D.add(this.enemyBuffers.mesh, this.projectileBuffers.mesh, this.shadowMesh);
  }

  public update(ctx: FrameContext): void {
    this.updateEnemies(ctx);
    this.updateProjectiles(ctx);
  }

  public dispose(): void {
    this.disposeBuffers(this.enemyBuffers);
    this.disposeBuffers(this.projectileBuffers);
    this.shadowMesh.geometry.dispose();
    this.shadowMaterial.dispose();
  }

  // --- Per-frame instance writes ---------------------------------------------

  private updateEnemies(ctx: FrameContext): void {
    const { mesh, glyphs, colors, glyphAttr, colorAttr } = this.enemyBuffers;
    const enemies = this.manager.getEnemies();
    const capacity = glyphs.length;

    let i = 0;
    let s = 0;
    for (const enemy of enemies) {
      if (i >= capacity) break;

      const sprite = enemy.assetId === 'spore_spitter' ? SPITTER_SPRITE : STALKER_SPRITE;
      const flash = enemy.hitFlashTimer > 0 ? Math.min(1, enemy.hitFlashTimer / HIT_FLASH_DURATION) : 0;
      const telegraph = enemy.state === 'telegraph';
      const telegraphPulse = 0.5 + 0.5 * Math.sin(ctx.elapsed * 26);

      // Idle / chase bob, stilled while telegraphing so the warning reads clean.
      const bob = enemy.state === 'idle' || enemy.state === 'chase'
        ? Math.sin(ctx.elapsed * 4 + enemy.x * 1.3 + enemy.y * 0.7) * 0.06
        : 0;

      const scale = CELL_SIZE * (telegraph ? 1.0 + telegraphPulse * 0.2 : 1.0);
      const halfW = (sprite.width * scale) / 2;
      const baseY = enemy.y + bob - 0.45;
      const ez = yToZ(enemy.y);

      for (const cell of sprite.cells) {
        if (i >= capacity) break;

        let r = cell.r;
        let g = cell.g;
        let b = cell.b;

        // Pulsing core / eye cells breathe gently.
        if (cell.glow > 0) {
          const glowPulse = 0.72 + 0.38 * Math.sin(ctx.elapsed * 5 + cell.x * 0.9 + cell.y * 1.1);
          r *= glowPulse;
          g *= glowPulse;
          b *= glowPulse;
        }

        if (flash > 0) {
          // Bright white flash on hit.
          r += (1 - r) * flash;
          g += (1 - g) * flash;
          b += (1 - b) * flash;
        } else if (telegraph) {
          // Crisp gold/white rim expansion before the attack fires.
          const w = telegraphPulse;
          r += (1.0 - r) * w * 0.75;
          g += (0.95 - g) * w * 0.75;
          b += (0.55 - b) * w * 0.75;
        }

        this.dummy.position.set(
          enemy.x + (cell.x + 0.5) * scale - halfW,
          baseY + (cell.y + 0.5) * scale,
          ez
        );
        this.dummy.scale.set(scale, scale, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);

        glyphs[i] = this.atlas.getIndex(cell.char);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
        i++;
      }

      // Grounding shadow ellipse beneath the sprite.
      if (s < MAX_ENEMIES) {
        this.dummy.position.set(enemy.x, enemy.y - 0.45, 0);
        this.dummy.scale.set(sprite.width * scale * 0.85, scale * 2.4, 1);
        this.dummy.updateMatrix();
        this.shadowMesh.setMatrixAt(s, this.dummy.matrix);
        s++;
      }

      // Compact health bar above any damaged enemy.
      if (enemy.hp < enemy.maxHp && i < capacity) {
        const hpFrac = enemy.hp / enemy.maxHp;
        const barCells = MAX_HEALTH_CELLS;
        const barW = barCells * 0.14;
        const barTop = baseY + sprite.height * scale + 0.28;
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

        for (let b = 0; b < barCells && i < capacity; b++) {
          const isFilled = b < filled;
          this.dummy.position.set(enemy.x - barW / 2 + (b + 0.5) * 0.14, barTop, ez);
          this.dummy.scale.set(0.14, 0.14, 1);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);

          glyphs[i] = this.atlas.getIndex(isFilled ? '=' : '-');
          colors[i * 3 + 0] = isFilled ? cr : 0.25;
          colors[i * 3 + 1] = isFilled ? cg : 0.12;
          colors[i * 3 + 2] = isFilled ? cb : 0.1;
          i++;
        }
      }
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    glyphAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    this.shadowMesh.count = s;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  private updateProjectiles(ctx: FrameContext): void {
    const { mesh, glyphs, colors, glyphAttr, colorAttr } = this.projectileBuffers;
    const projectiles = this.manager.getProjectiles();

    let i = 0;
    for (let p = 0; p < projectiles.length && i < glyphs.length; p++) {
      const proj = projectiles[p];
      const size = 0.4 + Math.sin(ctx.elapsed * 20 + p * 1.3) * 0.08;

      this.dummy.position.set(proj.x, proj.y, yToZ(proj.y) + 0.05);
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
