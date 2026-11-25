import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';

export interface BuildingCell {
  x: number;
  y: number;
  char: string;
  r: number;
  g: number;
  b: number;
  emissive: number; // 0.0 = normal surface, 1.0 = self-lit window / lantern
}

export interface BuildingAsset {
  name: string;
  width: number;
  height: number;
  cells: BuildingCell[];
  /** Local light spill points (in cell coordinates, y=0 at base) */
  lights: Array<{ x: number; y: number; radius: number; r: number; g: number; b: number }>;
}

export interface BuildingPlacement {
  asset: BuildingAsset;
  worldX: number; // Bottom-left world X
  worldY: number; // Bottom-left world Y
  cellSize?: number;
}

const BUILDING_VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;
  attribute float aEmissive;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying float vEmissive;
  varying vec2 vWorldPos;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;
    vEmissive = aEmissive;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = vec2(worldPosition.x, -worldPosition.z);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const BUILDING_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uPlayerPos;
  uniform float uTime;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying float vEmissive;
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

    float flicker = 0.94 + sin(uTime * 5.2 + vWorldPos.x * 0.7) * 0.04 + sin(uTime * 11.3) * 0.02;

    if (glyphAlpha < 0.15) {
      vec3 interiorBg = mix(vec3(0.03, 0.04, 0.05), vec3(0.28, 0.13, 0.02) * flicker, vEmissive);
      gl_FragColor = vec4(interiorBg, 0.92);
      return;
    }

    if (vEmissive > 0.5) {
      vec3 glowColor = vColor * (1.15 * flicker);
      gl_FragColor = vec4(glowColor, 1.0);
      return;
    }

    float dist = distance(vWorldPos, uPlayerPos);
    float lantern = smoothstep(10.5, 0.5, dist);
    lantern *= lantern;

    vec3 ambient = vColor * vec3(0.46, 0.51, 0.6);
    vec3 lanternTint = vec3(1.0, 0.66, 0.28);
    vec3 lit = vColor * mix(vec3(1.0), lanternTint, 0.55) * lantern * 1.5;

    gl_FragColor = vec4(ambient + lit, 1.0);
  }
`;

const LIGHT_SPILL_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LIGHT_SPILL_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPhase;

  varying vec2 vUv;

  void main() {
    vec2 centered = (vUv - 0.5) * 2.0;
    float dist = length(centered);
    if (dist > 1.0) discard;

    float flicker = 0.92 + sin(uTime * 4.8 + uPhase) * 0.05 + sin(uTime * 10.7 + uPhase) * 0.03;
    float falloff = smoothstep(1.0, 0.0, dist);
    falloff = falloff * falloff * 0.42 * flicker;

    gl_FragColor = vec4(uColor * falloff, falloff);
  }
`;

/** Legacy flat-ASCII building layer: vertical billboards standing on the 3D ground. */
export class BuildingLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly atlas: GlyphAtlas;
  private mesh!: THREE.InstancedMesh;
  private material!: THREE.ShaderMaterial;
  private spillMaterials: THREE.ShaderMaterial[] = [];
  private spillMeshes: THREE.Mesh[] = [];
  private colliders: Array<{ x: number; y: number; radius: number }> = [];

  constructor(atlas: GlyphAtlas, placements: BuildingPlacement[]) {
    this.atlas = atlas;
    this.build(placements);
  }

  /** Rebuild every mesh from a fresh placement list (entities changed). */
  public rebuild(placements: BuildingPlacement[]): void {
    this.disposeResources();
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

    for (const mat of this.spillMaterials) {
      mat.uniforms.uTime.value = ctx.elapsed;
    }
  }

  public dispose(): void {
    this.disposeResources();
  }

  private disposeResources(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    for (const m of this.spillMeshes) m.geometry.dispose();
    for (const mat of this.spillMaterials) mat.dispose();
    this.spillMeshes = [];
    this.spillMaterials = [];
  }

  private build(placements: BuildingPlacement[]): void {
    const totalCells = placements.reduce((sum, p) => sum + p.asset.cells.length, 0);
    const geometry = new THREE.PlaneGeometry(1.02, 1.02);

    const glyphIndices = new Float32Array(totalCells);
    const colors = new Float32Array(totalCells * 3);
    const emissives = new Float32Array(totalCells);

    this.material = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERTEX_SHADER,
      fragmentShader: BUILDING_FRAGMENT_SHADER,
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
    const dummy = new THREE.Object3D();

    let i = 0;
    let lightIdx = 0;

    for (const p of placements) {
      const size = p.cellSize ?? 0.24;

      const worldW = p.asset.width * size;
      const worldH = p.asset.height * size;
      const footprintRadius = Math.min(worldW, worldH) * 0.42;
      this.colliders.push(
        { x: p.worldX + worldW * 0.32, y: p.worldY + worldH * 0.35, radius: footprintRadius },
        { x: p.worldX + worldW * 0.68, y: p.worldY + worldH * 0.35, radius: footprintRadius },
      );

      for (const cell of p.asset.cells) {
        // Vertical billboard: cell.x runs east/west, cell.y climbs upward.
        dummy.position.set(
          p.worldX + (cell.x + 0.5) * size,
          (cell.y + 0.5) * size,
          -p.worldY,
        );
        dummy.scale.set(size, size, 1);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);

        glyphIndices[i] = this.atlas.getIndex(cell.char);
        colors[i * 3 + 0] = cell.r;
        colors[i * 3 + 1] = cell.g;
        colors[i * 3 + 2] = cell.b;
        emissives[i] = cell.emissive;
        i++;
      }

      for (const l of p.asset.lights) {
        const spillMat = new THREE.ShaderMaterial({
          vertexShader: LIGHT_SPILL_VERTEX_SHADER,
          fragmentShader: LIGHT_SPILL_FRAGMENT_SHADER,
          uniforms: {
            uColor: { value: new THREE.Vector3(l.r, l.g, l.b) },
            uTime: { value: 0 },
            uPhase: { value: lightIdx * 1.7 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

        const spillMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(l.radius * 2, l.radius * 1.75),
          spillMat,
        );
        // Warm light pool flat on the ground below the window/lantern.
        spillMesh.rotation.x = -Math.PI / 2;
        spillMesh.position.set(
          p.worldX + l.x * size,
          0.02,
          -(p.worldY + (l.y - 1.2) * size),
        );

        this.spillMaterials.push(spillMat);
        this.spillMeshes.push(spillMesh);
        this.object3D.add(spillMesh);
        lightIdx++;
      }
    }

    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aEmissive', new THREE.InstancedBufferAttribute(emissives, 1));
    this.mesh.instanceMatrix.needsUpdate = true;

    this.object3D.add(this.mesh);
  }
}

/** Act 1 Riverside Village Cottage: pitched slate roof, timber/stone walls, glowing #FF9900 windows */
export function createRiversideCottage(): BuildingAsset {
  const layout = [
    '               [:]    ',
    '     /=========[:]\\   ',
    '    /#############:\\  ',
    '   /===============\\  ',
    '  /#################\\ ',
    ' /===================\\',
    ' |-------------------|',
    ' |  [wW]  |d|  [wW]  |',
    ' |  [ww]  |d|* [ww]  |',
    ' |  ____  |d|  ____  |',
    ' |..,,,,..|_|..,,,,..|',
    ' +===================+',
  ];

  const height = layout.length;
  const width = Math.max(...layout.map((l) => l.length));
  const cells: BuildingCell[] = [];

  for (let r = 0; r < height; r++) {
    const line = layout[r];
    const y = height - 1 - r;
    for (let x = 0; x < line.length; x++) {
      const raw = line[x];
      if (raw === ' ') continue;

      let char = raw;
      let cr = 0.34;
      let cg = 0.37;
      let cb = 0.42;
      let emissive = 0.0;

      if (raw === 'w' || raw === 'W') {
        char = raw === 'W' ? '+' : '#';
        cr = 1.0;
        cg = raw === 'W' ? 0.8 : 0.58;
        cb = raw === 'W' ? 0.32 : 0.1;
        emissive = 1.0;
      } else if (raw === '*') {
        char = '*';
        cr = 1.0;
        cg = 0.72;
        cb = 0.22;
        emissive = 1.0;
      } else if (raw === 'd') {
        char = '|';
        cr = 0.36;
        cg = 0.24;
        cb = 0.16;
      } else if (y >= 6) {
        const ridgeT = (y - 6) / 6;
        const roofShade = 0.7 + ridgeT * 0.5;
        cr = 0.26 * roofShade + ridgeT * 0.1;
        cg = 0.31 * roofShade + ridgeT * 0.12;
        cb = 0.38 * roofShade + ridgeT * 0.18;
      } else if (raw === '.' || raw === ',') {
        cr = 0.26;
        cg = 0.29;
        cb = 0.28;
      } else {
        const wallShade = 0.85 + (y / 6) * 0.3;
        cr = 0.42 * wallShade;
        cg = 0.35 * wallShade;
        cb = 0.27 * wallShade;
      }

      cells.push({ x, y, char, r: cr, g: cg, b: cb, emissive });
    }
  }

  return {
    name: 'riverside_cottage',
    width,
    height,
    cells,
    lights: [
      { x: 5.5, y: 3.5, radius: 3.4, r: 1.0, g: 0.56, b: 0.14 },
      { x: 14.5, y: 3.5, radius: 4.0, r: 1.0, g: 0.6, b: 0.16 },
    ],
  };
}
