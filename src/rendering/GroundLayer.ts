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

    // Subtle torch flicker & radial light falloff around the player
    float flicker = 1.0 + sin(uTime * 7.0) * 0.03 + sin(uTime * 13.0) * 0.02;
    float dist = distance(vWorldPos, uPlayerPos);
    float torchLight = smoothstep(10.0 * flicker, 0.5, dist);

    // Dark moody ambient + warm orange torch tint near the player
    vec3 ambient = vColor * 0.22;
    vec3 torchTint = vec3(1.0, 0.72, 0.42);
    vec3 lit = vColor * mix(vec3(1.0), torchTint, 0.55) * torchLight * 1.4;

    gl_FragColor = vec4(ambient + lit, alpha);
  }
`;

export class GroundLayer implements IRenderLayer {
  public readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  public get object3D(): THREE.Object3D {
    return this.mesh;
  }

  constructor(atlas: GlyphAtlas, terrain: TerrainGrid, width = 100, height = 100, cellSize = 0.6) {
    const count = width * height;
    const geometry = new THREE.PlaneGeometry(cellSize, cellSize);

    const glyphIndices = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const dummy = new THREE.Object3D();

    const halfW = (width * cellSize) / 2;
    const halfH = (height * cellSize) / 2;

    let i = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Position each glyph cell in world space
        dummy.position.set(
          x * cellSize - halfW,
          y * cellSize - halfH,
          0
        );
        dummy.updateMatrix();

        // World-space centre of this glyph cell.
        const wx = x * cellSize - halfW + cellSize / 2;
        const wy = y * cellSize - halfH + cellSize / 2;

        // Deterministic pseudo-random scatter so the ground feels organic.
        const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const rand = hash - Math.floor(hash);

        // A winding dirt footpath leading from spawn toward the river.
        const onPath = terrain.getPathMask(wx, wy) > 0.6;

        let char: string;
        let r: number;
        let g: number;
        let b: number;

        if (onPath) {
          // Packed earth, subtly varying.
          const dirtChars = [':', '.', ',', ';', '.'];
          char = dirtChars[Math.floor(rand * dirtChars.length)];
          const shade = 0.6 + rand * 0.4;
          r = 0.3 * shade;
          g = 0.23 * shade;
          b = 0.14 * shade;
        } else if (rand < 0.022) {
          // Scattered fallen leaves in muted red / amber.
          const leafRand = Math.sin(x * 91.7 + y * 31.3) * 43758.5453;
          const leaf = leafRand - Math.floor(leafRand);
          char = leaf < 0.5 ? '.' : ',';
          const warm = 0.5 + leaf * 0.5;
          r = 0.34 + warm * 0.22;
          g = 0.2 + warm * 0.1;
          b = 0.12 + warm * 0.06;
        } else {
          // Muted dark moss / forest floor with coarse low-frequency patches.
          const mossChars = ['.', '.', ',', ':', ';', "'", '`', ' '];
          char = mossChars[Math.floor(rand * mossChars.length)];
          const coarse = 0.85 + Math.sin(wx * 1.7 + wy * 2.3) * 0.15;
          const shade = (0.6 + rand * 0.4) * coarse;
          r = 0.13 * shade;
          g = 0.35 * shade;
          b = 0.21 * shade;
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