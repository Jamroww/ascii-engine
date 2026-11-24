import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';

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

    // Solid dark canopy/bark core so swaying grass never bleeds through trees
    if (glyphAlpha < 0.15) {
      gl_FragColor = vec4(0.014, 0.020, 0.024, 0.96);
      return;
    }

    float flicker = 1.0 + sin(uTime * 6.5) * 0.025 + sin(uTime * 13.7) * 0.015;
    float dist = distance(vWorldPos, uPlayerPos);
    float lantern = smoothstep(11.5 * flicker, 0.6, dist);
    lantern *= lantern;

    // Deep forest twilight ambient + warm #FF9900 lantern catch
    vec3 ambient = vColor * vec3(0.28, 0.34, 0.40);
    vec3 lanternTint = vec3(1.0, 0.66, 0.26);
    vec3 lit = vColor * mix(vec3(1.0), lanternTint, 0.50) * lantern * 1.45;

    gl_FragColor = vec4(ambient + lit, 1.0);
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
      // Directional crown shading: upper-left catches moonlight, lower-right falls into shadow
      const crownShade = 0.62 + heightNorm * 0.42 + (0.5 - x / width) * 0.18 - distFromCenter * 0.15;

      let cr: number;
      let cg: number;
      let cb: number;

      if (kind === 'wilted') {
        // Pale ash-slate deadwood with subtle sickly olive/violet undertones
        const s = 0.65 + heightNorm * 0.35;
        cr = (char === ':' || char === ',' ? 0.26 : 0.34) * s;
        cg = (char === ':' || char === ',' ? 0.38 : 0.33) * s;
        cb = (char === ':' || char === ',' ? 0.32 : 0.36) * s;
      } else if (isTrunk) {
        // Deep shadowed bark
        const barkShade = 0.72 + (1.0 - distFromCenter) * 0.28;
        cr = 0.28 * barkShade;
        cg = 0.21 * barkShade;
        cb = 0.16 * barkShade;
      } else if (kind === 'pine') {
        // Dark boreal pine/spruce
        cr = 0.09 * crownShade;
        cg = 0.29 * crownShade;
        cb = 0.21 * crownShade;
      } else {
        // Gnarled oak: deeper olive-moss canopy with hanging moss accents
        const isMoss = char === ':' || char === ',' || char === ';';
        cr = (isMoss ? 0.14 : 0.12) * crownShade;
        cg = (isMoss ? 0.32 : 0.27) * crownShade;
        cb = (isMoss ? 0.19 : 0.17) * crownShade;
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

function createAncientPine(): TreeAsset {
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

function createGnarledOak(): TreeAsset {
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

function createWiltedTree(): TreeAsset {
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

  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly shadowMaterial: THREE.ShaderMaterial;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly colliders: Array<{ x: number; y: number; radius: number }> = [];

  constructor(atlas: GlyphAtlas, placements: TreePlacement[], cellSize = 0.34) {
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
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
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
      const size = cellSize * scale;
      const halfW = (asset.width * size) / 2;
      const phase = (p.worldX * 0.37 + p.worldY * 0.71) % (Math.PI * 2);

      // Slight Y-based Z offset within [0.85..1.12] for crisp overlapping canopies
      const treeZ = 0.92 + Math.max(-0.07, Math.min(0.15, -p.worldY * 0.002));

      this.colliders.push({
        x: p.worldX,
        y: p.worldY + 0.35 * scale,
        radius: asset.trunkRadius * scale,
      });

      // Tree shadow disc right above grass
      dummy.position.set(p.worldX, p.worldY + 0.2 * scale, 0.51);
      dummy.scale.set(asset.width * size * 0.85, asset.width * size * 0.42, 1);
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

        glyphIndices[cellIdx] = atlas.getIndex(cell.char);
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

  public getColliders(): Array<{ x: number; y: number; radius: number }> {
    return this.colliders;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shadowMesh.geometry.dispose();
    this.shadowMaterial.dispose();
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

/** Matches WaterLayer's riverSDF so trees don't spawn inside the river */
function riverDistance(x: number, y: number): number {
  const curve = Math.sin(y * 0.14) * 3.2 + Math.cos(y * 0.07) * 1.5;
  const centerX = 6.5 + curve;
  const halfWidth = 3.8 + Math.sin(y * 0.22) * 0.6;
  return Math.abs(x - centerX) - halfWidth;
}

/** Generates a dense, looming forest framing a large Riverside Village clearing */
export function generateRiversideForest(seed = 42): TreePlacement[] {
  const rand = seededRand(seed);
  const placements: TreePlacement[] = [];

  const isBlocked = (x: number, y: number): boolean => {
    // Keep the river channel + banks clear
    if (riverDistance(x, y) < 2.2) return true;
    // Keep the central Riverside Village clearing & cottage yard open
    if (Math.hypot(x + 3, y - 1) < 13.5) return true;
    // Keep a winding northern trail open toward the upstream Blight
    if (x > -2.5 && x < 4.5 && y > 6 && y < 38) return true;
    // Avoid stacking trunks directly on top of each other
    for (const p of placements) {
      if (Math.hypot(x - p.worldX, y - p.worldY) < 3.6) return true;
    }
    return false;
  };

  // Scatter ~220 trees across a 110x110 world (heavier around the perimeter)
  for (let i = 0; i < 900 && placements.length < 220; i++) {
    const x = (rand() - 0.5) * 104;
    const y = (rand() - 0.5) * 104;

    if (isBlocked(x, y)) continue;

    // Near the northern upstream Blight zone, mix in more wilted deadwood
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
      scale: 0.85 + rand() * 0.35,
    });
  }

  return placements;
}