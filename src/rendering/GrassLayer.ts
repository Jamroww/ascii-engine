import * as THREE from 'three';
import { GlyphAtlas } from './GlyphAtlas';
import type { TerrainGrid } from '../core/TerrainGrid';
import type { FrameContext, IRenderLayer } from '../core/types';

const GRASS_VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;
  attribute float aPhase;

  uniform float uTime;
  uniform vec2 uPlayerPos;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;
  varying float vBend;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;

    // Extract blade base position from the instance matrix
    vec4 baseWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vWorldPos = baseWorld.xy;

    // Only bend the top of the glyph (uv.y = 0 at roots, 1 at tips)
    float tipWeight = uv.y;

    // 1. Rolling wind wave across the field
    float windWave = sin(uTime * 2.2 + baseWorld.x * 0.35 + baseWorld.y * 0.2 + aPhase);
    float windGust = sin(uTime * 0.9 + baseWorld.x * 0.12) * 0.5 + 0.5;
    float swayX = windWave * (0.14 + windGust * 0.12) * tipWeight;

    // 2. Radial push away from the player's feet
    vec2 toBlade = baseWorld.xy - uPlayerPos;
    float dist = length(toBlade);
    float pushRadius = 2.6;
    float pushStrength = smoothstep(pushRadius, 0.2, dist);
    vec2 pushDir = dist > 0.001 ? normalize(toBlade) : vec2(1.0, 0.0);

    vec2 playerBend = pushDir * pushStrength * 0.85 * tipWeight;
    vBend = pushStrength;

    // Apply local vertex position + wind + player push
    vec3 displaced = position;
    displaced.x += swayX + playerBend.x;
    displaced.y += playerBend.y * 0.5 - pushStrength * 0.18 * tipWeight;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const GRASS_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uPlayerPos;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;
  varying float vBend;

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

    // Gentle tip highlight so dense grass reads with depth (not bright streaks).
    float tipGlow = mix(0.86, 1.04, vUv.y);

    // Even moonlit visibility across the whole carpet; the lantern is only a
    // subtle warm accent hugging the traveler, never the sole light source.
    vec3 base = vColor * tipGlow;
    float dist = distance(vWorldPos, uPlayerPos);
    float warm = smoothstep(6.0, 0.4, dist);
    base += vec3(0.16, 0.10, 0.03) * warm * 0.5;

    // Dark radial depression under the player's feet so the traveler pops.
    float footDist = distance(vWorldPos, uPlayerPos);
    float depression = smoothstep(1.7, 0.15, footDist) * 0.28;
    float shadow = (1.0 - vBend * 0.22) * (1.0 - depression);

    gl_FragColor = vec4(base * shadow, alpha);
  }
`;

export class GrassLayer implements IRenderLayer {
  public readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  public get object3D(): THREE.Object3D {
    return this.mesh;
  }

  constructor(atlas: GlyphAtlas, terrain: TerrainGrid, count = 26000, areaSize = 55) {
    const geometry = new THREE.PlaneGeometry(0.46, 0.55);

    const glyphIndices = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    const bladeChars = ['/', '|', '\\', '|', '/'];

    const dummy = new THREE.Object3D();
    this.material = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX_SHADER,
      fragmentShader: GRASS_FRAGMENT_SHADER,
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

    // Scatter blades organically across the field. Blades that fall on the
    // dirt footpath are mostly rerolled elsewhere so the path stays clear.
    let i = 0;
    while (i < count) {
      const x = (Math.random() - 0.5) * areaSize;
      const y = (Math.random() - 0.5) * areaSize;

      const onPath = terrain.getPathMask(x, y) > 0.6;
      if (onPath && Math.random() < 0.8) continue;

      // Slight Z jitter so overlapping blades don't z-fight (0.2..0.45)
      const z = 0.2 + Math.random() * 0.25;

      const scale = 0.8 + Math.random() * 0.5;
      dummy.position.set(x, y, z);
      dummy.scale.set(scale, scale, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      phases[i] = Math.random() * Math.PI * 2;

      const roll = Math.random();
      if (roll < 0.012) {
        // Sparse warm-cream wildflower pinpoint.
        glyphIndices[i] = atlas.getIndex(Math.random() < 0.5 ? '*' : 'o');
        colors[i * 3 + 0] = 0.94;
        colors[i * 3 + 1] = 0.82;
        colors[i * 3 + 2] = 0.58;
      } else if (roll < 0.025) {
        // Sparse pale-white dewdrop glint.
        glyphIndices[i] = atlas.getIndex('.');
        colors[i * 3 + 0] = 0.86;
        colors[i * 3 + 1] = 0.92;
        colors[i * 3 + 2] = 0.98;
      } else {
        // Lush, evenly readable deep pine / emerald-teal blades.
        const char = bladeChars[Math.floor(Math.random() * bladeChars.length)];
        glyphIndices[i] = atlas.getIndex(char);
        const shade = 0.75 + Math.random() * 0.5;
        colors[i * 3 + 0] = 0.13 * shade;
        colors[i * 3 + 1] = 0.34 * shade;
        colors[i * 3 + 2] = 0.22 * shade;
      }

      i++;
    }

    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
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
