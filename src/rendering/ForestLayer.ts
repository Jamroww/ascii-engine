import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import type { TerrainGrid } from '../core/TerrainGrid';
import { yToZ } from '../core/world';

export type TreeKind = 'pine' | 'oak' | 'wilted';

export interface TreeCell {
  x: number;
  y: number;
  char: string;
  r: number;
  g: number;
  b: number;
  swayWeight: number; // 0 for trunk/roots, 0.2..1.0 for canopy
}

export interface TreeAsset {
  kind: TreeKind;
  width: number;
  height: number;
  cells: TreeCell[];
  trunkRadius: number;
}

export interface TreePlacement {
  kind: TreeKind;
  worldX: number; // Center base X
  worldY: number; // Base Y
  scale?: number;
}

const TREE_VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;
  attribute float aSwayWeight;
  attribute float aPhase;

  uniform float uTime;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);

    // Subtle wind breathing in upper boughs; trunks stay anchored
    float wind = sin(uTime * 1.45 + worldPosition.x * 0.18 + aPhase) * 0.12;
    float gust = sin(uTime * 0.65 + worldPosition.y * 0.11) * 0.06;
    worldPosition.x += (wind + gust) * aSwayWeight;

    vWorldPos = worldPosition.xy;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const TREE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uPlayerPos;
  uniform float uTime;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;

  void main() {
    float idx = floor(vGlyphIndex + 0.5);
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + vUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - vUv.y) / uAtlasGrid.y)
    );

    float glyphAlpha = texture2D(uAtlas, atlasUv).a;

    // Cool dark canopy/bark backing so swaying grass never bleeds through trees
    if (glyphAlpha < 0.15) {
      gl_FragColor = vec4(0.05, 0.06, 0.07, 0.92);
      return;
    }

    // Even moonlit visibility; a subtle warm lantern accent near the traveler.
    float dist = distance(vWorldPos, uPlayerPos);
    float warm = smoothstep(7.0, 0.5, dist);
    vec3 color = vColor + vec3(0.15, 0.09, 0.03) * warm * 0.5;

    gl_FragColor = vec4(color, 1.0);
  }
`;

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
    float a = smoothstep(1.0, 0.15, d) * 0.58;
    gl_FragColor = vec4(0.01, 0.015, 0.02, a);
  }
`;

function buildTreeAsset(kind: TreeKind, rows: string[], trunkHeight: number): TreeAsset {
  const height = rows.length;
  const width = rows[0].length;
  const cells: TreeCell[] = [];

  for (let r = 0; r < height; r++) {
    const line = rows[r];
    const y = height - 1 - r;
    const heightNorm = y / Math.max(height - 1, 1);

    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char === ' ') continue;

      const isTrunk = y < trunkHeight;
      const distFromCenter = Math.abs(x - (width - 1) / 2) / (width / 2);

      // 3/4 top-down light: brighter upper canopy + silhouette rim, darker base.
      const bodyShade = 0.58 + heightNorm * 0.5;
      const rim = Math.max(heightNorm * heightNorm, distFromCenter * 0.85);

      let cr: number;
      let cg: number;
      let cb: number;

      if (kind === 'wilted') {
        // Pale ash-slate deadwood with a cool moonlight rim.
        cr = 0.32 * bodyShade + rim * 0.18;
        cg = 0.34 * bodyShade + rim * 0.20;
        cb = 0.36 * bodyShade + rim * 0.24;
      } else if (isTrunk) {
        // Warm dark russet / burnt-umber bark (#7a311e), lit rim fading to shadow.
        const barkShade = 0.55 + (1.0 - distFromCenter) * 0.35;
        cr = 0.44 * barkShade + rim * 0.12;
        cg = 0.18 * barkShade + rim * 0.06;
        cb = 0.10 * barkShade + rim * 0.03;
      } else if (kind === 'pine') {
        // Deep-sage canopy (#4e6b58) with autumn-rust lit rims.
        cr = 0.22 * bodyShade + rim * 0.28;
        cg = 0.32 * bodyShade + rim * 0.16;
        cb = 0.24 * bodyShade + rim * 0.10;
      } else {
        // Gnarled oak: deep-sage canopy with autumn-rust / mossy accents.
        const isMoss = char === ':' || char === ',' || char === ';';
        cr = (isMoss ? 0.32 : 0.24) * bodyShade + rim * 0.30;
        cg = (isMoss ? 0.32 : 0.28) * bodyShade + rim * 0.14;
        cb = (isMoss ? 0.20 : 0.18) * bodyShade + rim * 0.08;
      }

      const swayWeight = isTrunk ? 0.0 : Math.max(0.15, (y - trunkHeight + 1) / (height - trunkHeight));
      cells.push({ x, y, char, r: cr, g: cg, b: cb, swayWeight });
    }
  }

  return {
    kind,
    width,
    height,
    cells,
    trunkRadius: kind === 'oak' ? 0.95 : 0.65,
  };
}

export function createAncientPine(): TreeAsset {
  return buildTreeAsset(
    'pine',
    [
      '       ^       ',
      '      /^\\      ',
      '     /#*#\\     ',
      '    /##%##\\    ',
      '     /#@#\\     ',
      '   /##%*%##\\   ',
      '  /##%@#@%##\\  ',
      '    /##%##\\    ',
      '  /##%@*@%##\\  ',
      ' /##%@###@%##\\ ',
      '/##%@##%##@%##\\',
      '  /##%@#@%##\\  ',
      ' /##%@###@%##\\ ',
      '   ~~~|#|~~~   ',
      '      |#|      ',
      '      |#|      ',
      '     /|#|\\     ',
    ],
    4
  );
}

export function createGnarledOak(): TreeAsset {
  return buildTreeAsset(
    'oak',
    [
      '     .~~~~~.     ',
      '   .~#%@%@%#~.   ',
      '  /#%@#####@%#\\  ',
      ' /#%@##*#*##@%#\\ ',
      '(#%@##%@#@%##@%#)',
      '(#%@#########%@#)',
      ' \\#%@##%@%##@%#/ ',
      '  \\:#%#####%#:/  ',
      '   :,~\\|#|/~,:   ',
      '    :  |#|  ,    ',
      '       |#|       ',
      '      /|#|\\      ',
      '     //|#|\\\\     ',
    ],
    5
  );
}

export function createWiltedTree(): TreeAsset {
  return buildTreeAsset(
    'wilted',
    [
      '   \\       /   ',
      '    \\  |  /    ',
      '  \\  \\ | /  /  ',
      '   \\__\\|/__/   ',
      '     : | :     ',
      '   \\  \\|/  /   ',
      '    \\__|__/    ',
      '      ,|       ',
      '       |       ',
      '      /|\\      ',
      '     / | \\     ',
    ],
    4
  );
}

export class ForestLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private readonly cellSize: number;
  private mesh!: THREE.InstancedMesh;
  private material!: THREE.ShaderMaterial;
  private shadowMaterial!: THREE.ShaderMaterial;
  private shadowMesh!: THREE.InstancedMesh;
  private colliders: Array<{ x: number; y: number; radius: number }> = [];

  constructor(atlas: GlyphAtlas, placements: TreePlacement[], cellSize = 0.22) {
    this.atlas = atlas;
    this.cellSize = cellSize;
    this.build(placements);
  }

  /** Rebuild the instanced mesh from a fresh placement list (terrain or entities changed). */
  public rebuild(placements: TreePlacement[]): void {
    this.disposeMeshes();
    this.object3D.clear();
    this.colliders = [];
    this.build(placements);
  }

  public getColliders(): Array<{ x: number; y: number; radius: number }> {
    return this.colliders;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.disposeMeshes();
  }

  private disposeMeshes(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shadowMesh.geometry.dispose();
    this.shadowMaterial.dispose();
  }

  private build(placements: TreePlacement[]): void {
    const assets: Record<TreeKind, TreeAsset> = {
      pine: createAncientPine(),
      oak: createGnarledOak(),
      wilted: createWiltedTree(),
    };

    const totalCells = placements.reduce((sum, p) => sum + assets[p.kind].cells.length, 0);
    const geometry = new THREE.PlaneGeometry(1.04, 1.04);

    const glyphIndices = new Float32Array(totalCells);
    const colors = new Float32Array(totalCells * 3);
    const swayWeights = new Float32Array(totalCells);
    const phases = new Float32Array(totalCells);

    this.material = new THREE.ShaderMaterial({
      vertexShader: TREE_VERTEX_SHADER,
      fragmentShader: TREE_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(this.atlas.cols, this.atlas.rows) },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: true,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, totalCells);

    // Soft dark ground shadow beneath each tree
    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERTEX_SHADER,
      fragmentShader: SHADOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      this.shadowMaterial,
      placements.length
    );

    const dummy = new THREE.Object3D();
    let cellIdx = 0;

    // Sort back-to-front by worldY so southern trees cleanly overlap northern ones
    const sorted = [...placements].sort((a, b) => b.worldY - a.worldY);

    for (let t = 0; t < sorted.length; t++) {
      const p = sorted[t];
      const asset = assets[p.kind];
      const scale = p.scale ?? 1.0;
      const size = this.cellSize * scale;
      const halfW = (asset.width * size) / 2;
      const phase = (p.worldX * 0.37 + p.worldY * 0.71) % (Math.PI * 2);

      // Unified Y-based depth: the whole tree sorts at its trunk base so the
      // player walking north of it is occluded and walking south sits in front.
      const treeZ = yToZ(p.worldY);

      this.colliders.push({
        x: p.worldX,
        y: p.worldY + 0.35 * scale,
        radius: asset.trunkRadius * scale,
      });

      // Soft elongated grounding shadow, offset down-right (south-east) from the
      // object so it reads as cast by a moon high to the north-west.
      dummy.position.set(p.worldX + 0.32 * scale, p.worldY - 0.42 * scale, 0.51);
      dummy.scale.set(asset.width * size * 0.88, asset.width * size * 0.40, 1);
      dummy.updateMatrix();
      this.shadowMesh.setMatrixAt(t, dummy.matrix);

      for (const cell of asset.cells) {
        dummy.position.set(
          p.worldX + (cell.x + 0.5) * size - halfW,
          p.worldY + (cell.y + 0.5) * size,
          treeZ
        );
        dummy.scale.set(size, size, 1);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(cellIdx, dummy.matrix);

        glyphIndices[cellIdx] = this.atlas.getIndex(cell.char);
        colors[cellIdx * 3 + 0] = cell.r;
        colors[cellIdx * 3 + 1] = cell.g;
        colors[cellIdx * 3 + 2] = cell.b;
        swayWeights[cellIdx] = cell.swayWeight;
        phases[cellIdx] = phase;
        cellIdx++;
      }
    }

    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aSwayWeight', new THREE.InstancedBufferAttribute(swayWeights, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;

    this.object3D.add(this.shadowMesh, this.mesh);
  }
}

/** Deterministic pseudo-random helper so the forest layout stays consistent across reloads */
function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generates a sparse perimeter forest ring framing a wide-open Riverside Village clearing */
export function generateRiversideForest(terrain: TerrainGrid, seed = 42): TreePlacement[] {
  const rand = seededRand(seed);
  const placements: TreePlacement[] = [];

  const isBlocked = (x: number, y: number): boolean => {
    // Keep the river channel + banks clear
    if (terrain.getRiverSDF(x, y) < 2.4) return true;
    // Keep the footpath, village clearing and northern trail clear
    if (terrain.getPathMask(x, y) > 0.15) return true;
    // Avoid stacking trunks directly on top of each other
    for (const p of placements) {
      if (Math.hypot(x - p.worldX, y - p.worldY) < 3.0) return true;
    }
    return false;
  };

  // Confine procedural trees to an annulus around the playable area so the
  // central village clearing, footpath and riverbank stay open. The ring sits
  // just inside the ground's ±30 boundary, framing the scene as a natural wall.
  const PERIMETER_MIN = 17;
  const PERIMETER_MAX = 29;

  for (let i = 0; i < 2000 && placements.length < 90; i++) {
    // Uniform sampling over the annulus area (sqrt keeps it area-uniform).
    const r = Math.sqrt(rand()) * (PERIMETER_MAX - PERIMETER_MIN) + PERIMETER_MIN;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;

    if (isBlocked(x, y)) continue;

    // Near the northern upstream Blight zone, mix in more wilted deadwood.
    const roll = rand();
    let kind: TreeKind;
    if (y > 14 && roll < 0.45) {
      kind = 'wilted';
    } else if (roll < 0.62) {
      kind = 'pine';
    } else if (roll < 0.90) {
      kind = 'oak';
    } else {
      kind = 'wilted';
    }

    placements.push({
      kind,
      worldX: x,
      worldY: y,
      scale: 1.25 + rand() * 0.5,
    });
  }

  return placements;
}