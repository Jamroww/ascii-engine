import * as THREE from 'three';
import { GlyphAtlas } from './GlyphAtlas';
import type { TerrainGrid } from '../core/TerrainGrid';
import type { FrameContext, IRenderLayer } from '../core/types';

const GROUND_VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xy;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const GROUND_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uPlayerPos;
  uniform float uTime;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;

  void main() {
    // Snap index to nearest integer to prevent float precision artifacts
    float idx = floor(vGlyphIndex + 0.5);
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    // Map quad UV (0..1) into the glyph's cell in the CanvasTexture (flipY = true)
    vec2 atlasUv = vec2(
      (col + vUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - vUv.y) / uAtlasGrid.y)
    );

    float alpha = texture2D(uAtlas, atlasUv).a;
    if (alpha < 0.1) discard;

    // Readable mossy-slate ambient with a warm lantern pool near the player.
    float flicker = 1.0 + sin(uTime * 7.0) * 0.03 + sin(uTime * 13.0) * 0.02;
    float dist = distance(vWorldPos, uPlayerPos);
    float torchLight = smoothstep(11.0 * flicker, 1.0, dist);

    vec3 ambient = vColor * 0.36;
    vec3 torchTint = vec3(1.0, 0.70, 0.40);
    vec3 lit = vColor * mix(vec3(1.0), torchTint, 0.42) * torchLight * 0.85;

    gl_FragColor = vec4(ambient + lit, alpha);
  }
`;

// --- Procedural value-noise helpers for topographic contour shading ----------

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const hash2 = (px: number, py: number): number => {
    const n = Math.sin(px * 127.1 + py * 311.7 + seed * 74.3) * 43758.5453123;
    return n - Math.floor(n);
  };

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * valueNoise(x * freq, y * freq, seed + o * 17.31);
    freq *= 2.0;
    amp *= 0.5;
  }
  return v;
}

export class GroundLayer implements IRenderLayer {
  public readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  public get object3D(): THREE.Object3D {
    return this.mesh;
  }

  constructor(atlas: GlyphAtlas, terrain: TerrainGrid, width = 172, height = 172, cellSize = 0.35) {
    const count = width * height;
    const geometry = new THREE.PlaneGeometry(cellSize, cellSize);

    const glyphIndices = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const dummy = new THREE.Object3D();

    const halfW = (width * cellSize) / 2;
    const halfH = (height * cellSize) / 2;

    // Contour glyphs: topographic bands (no middle-dot, which is outside the atlas).
    const contourChars = ['-', '~', ':', '.', ','];
    const mossChars = ['.', '.', ',', ':', "'", '`'];
    const dirtChars = [':', '.', ',', ';', '.', '.'];
    const rimChars = ['.', '.', ':', ',', "'"];
    const bankChars = ['~', ':', '.', ':', ','];

    let i = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // World-space centre of this glyph cell.
        const wx = x * cellSize - halfW + cellSize / 2;
        const wy = y * cellSize - halfH + cellSize / 2;

        // Deterministic pseudo-random scatter so the ground feels organic.
        const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const rand = hash - Math.floor(hash);

        const pathMask = terrain.getPathMask(wx, wy);
        const riverSdf = terrain.getRiverSDF(wx, wy);
        const elevation = fbm(wx * 0.38 + 5.2, wy * 0.38 - 3.7, 13);

        let char: string;
        let r: number;
        let g: number;
        let b: number;

        if (riverSdf > 0 && riverSdf < 1.7) {
          // Muted silty shoreline foam/contour rim right at the water's edge.
          char = bankChars[Math.floor(rand * bankChars.length)];
          const shade = 0.6 + rand * 0.25;
          r = 0.38 * shade;
          g = 0.44 * shade;
          b = 0.46 * shade;
        } else if (pathMask > 0.9) {
          // Warm damp packed earth on the footpath.
          char = dirtChars[Math.floor(rand * dirtChars.length)];
          const shade = 0.62 + rand * 0.38;
          r = 0.44 * shade;
          g = 0.3 * shade;
          b = 0.17 * shade;
        } else if (pathMask > 0.6) {
          // Drier, lighter highlight rim along the footpath edge.
          char = rimChars[Math.floor(rand * rimChars.length)];
          const shade = 0.64 + rand * 0.36;
          r = 0.52 * shade;
          g = 0.38 * shade;
          b = 0.22 * shade;
        } else {
          // Dark mossy slate forest floor with layered topographic contour bands.
          const bands = 5;
          const bandPos = elevation * bands;
          const band = Math.floor(bandPos);
          const frac = bandPos - band;
          const isContour = frac < 0.12;

          if (isContour) {
            char = contourChars[band % contourChars.length];
          } else {
            char = mossChars[Math.floor(rand * mossChars.length)];
          }

          // Brighter on ridges, deeper in hollows, subtle rim on contour lines.
          const shade = 0.66 + elevation * 0.5 + (isContour ? 0.16 : 0.0);
          r = 0.16 * shade;
          g = 0.32 * shade;
          b = 0.27 * shade;
        }

        glyphIndices[i] = atlas.getIndex(char);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;

        i++;
      }
    }

    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));

    this.material = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERTEX_SHADER,
      fragmentShader: GROUND_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);

    // Apply transforms to the InstancedMesh
    i = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dummy.position.set(x * cellSize - halfW, y * cellSize - halfH, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
