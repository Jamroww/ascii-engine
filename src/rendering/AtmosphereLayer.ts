import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import type { TerrainGrid } from '../core/TerrainGrid';

const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldPos;
  varying vec2 vNdc;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xy;
    vec4 clip = projectionMatrix * viewMatrix * wp;
    vNdc = clip.xy / clip.w;
    gl_Position = clip;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uPlayerPos;
  uniform vec2 uViewSize;
  uniform float uTime;
  uniform float uCorruption;
  uniform float uBurstGlow;
  uniform sampler2D uTerrainMap;
  uniform float uWorldSize;

  varying vec2 vWorldPos;
  varying vec2 vNdc;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    float dist = distance(vWorldPos, uPlayerPos);

    // Subtle warm hip-lantern accent hugging the traveler. This is a soft warm
    // colour tint only — the whole viewport stays moonlit and readable without it.
    float lanternRadius = clamp(uViewSize.y * 0.26, 3.5, 6.0);
    float lantern = 1.0 - smoothstep(0.0, lanternRadius, dist);
    float warmAccent = lantern * lantern;

    // Atmospheric haze tied strictly to the terrain's Blight field (sampled from
    // TerrainGrid) and high Corruption — never applied over the clean village.
    vec2 terrainUv = (vWorldPos + uWorldSize * 0.5) / uWorldSize;
    float blight = texture2D(uTerrainMap, terrainUv).g;
    float haze = clamp(blight * 0.48 + uCorruption * 0.26, 0.0, 0.52);

    // Very soft outer screen-edge vignette — never darker than ~18% even in the
    // extreme corners, so the whole viewport stays legible at all times.
    float edge = max(abs(vNdc.x), abs(vNdc.y));
    float vignette = smoothstep(0.58, 1.0, edge) * 0.18;

    float dark = clamp(vignette + haze, 0.0, 0.55);

    // Moonlit slate base; violet-cool under blight/corruption, warm near the
    // lantern, and lifted into a warm golden wash by a Radiant Burst.
    vec3 color = vec3(0.13, 0.16, 0.20);
    color = mix(color, vec3(0.22, 0.14, 0.28), clamp(blight * 0.85 + uCorruption * 0.55, 0.0, 1.0));
    color = mix(color, vec3(1.0, 0.55, 0.20), warmAccent * 0.30);
    color = mix(color, vec3(1.0, 0.62, 0.24), uBurstGlow * 0.55);

    float alpha = dark;
    alpha = max(alpha, warmAccent * 0.08);
    alpha = max(alpha, uBurstGlow * 0.16);

    float dither = hash(gl_FragCoord.xy) * 0.02 - 0.01;
    alpha = clamp(alpha + dither, 0.0, 0.6);

    gl_FragColor = vec4(color, alpha);
  }
`;

function makePlaceholderTerrain(): THREE.DataTexture {
  const data = new Uint8Array([0, 0, 0, 0]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

export class AtmosphereLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly placeholderTerrain: THREE.DataTexture;
  private burstTimer = 0;

  constructor(size = 160) {
    this.placeholderTerrain = makePlaceholderTerrain();
    this.material = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      uniforms: {
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uViewSize: { value: new THREE.Vector2(20, 20) },
        uTime: { value: 0 },
        uCorruption: { value: 0 },
        uBurstGlow: { value: 0 },
        uTerrainMap: { value: this.placeholderTerrain },
        uWorldSize: { value: 60 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.object3D = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.material);
    this.object3D.position.z = 5;
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = 1000;
  }

  public setViewport(worldWidth: number, worldHeight: number): void {
    this.material.uniforms.uViewSize.value.set(worldWidth, worldHeight);
  }

  /** Feed the shared terrain field so blight haze reads the same source of truth. */
  public setTerrain(terrain: TerrainGrid): void {
    this.material.uniforms.uTerrainMap.value = terrain.texture;
    this.material.uniforms.uWorldSize.value = terrain.worldSize;
  }

  /** Flare the warm golden wash for a short window (Radiant Burst). */
  public triggerBurst(): void {
    this.burstTimer = 2.5;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;

    this.burstTimer = Math.max(0, this.burstTimer - ctx.dt);
    const burst = this.burstTimer > 0 ? Math.pow(this.burstTimer / 2.5, 1.5) : 0;
    this.material.uniforms.uBurstGlow.value = burst;
    this.material.uniforms.uCorruption.value = ctx.corruption;
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.placeholderTerrain.dispose();
    this.material.dispose();
  }
}
