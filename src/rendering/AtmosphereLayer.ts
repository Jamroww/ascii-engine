import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';

const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xy;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uPlayerPos;
  uniform vec2 uViewSize;
  uniform float uTime;
  uniform float uLanternRadius;
  uniform float uVirtue;
  uniform float uCorruption;
  uniform float uBurstGlow;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec2 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    float dist = distance(vWorldPos, uPlayerPos);

    // Warm radial lantern pool centred on the player, breathing gently.
    // Virtue widens/warms it, corruption tightens it, a burst briefly flares it.
    float radius = uLanternRadius + sin(uTime * 1.3) * 0.8
      + uVirtue * 2.5 - uCorruption * 1.6 + uBurstGlow * 6.0;
    radius = max(radius, 2.0);
    // Soft falloff with a broad bright core and zero hard ring edge.
    float lantern = 1.0 - smoothstep(radius * 0.25, radius, dist);
    float warmGlow = lantern * lantern * 0.5 + lantern * 0.5;

    // Outer fog: moody cool-slate darkness creeping in past the lantern pool.
    float fog = smoothstep(uFogNear, uFogFar, dist);

    // Softened screen-space vignette for the viewport corners.
    vec2 rel = (vWorldPos - uPlayerPos) / uViewSize;
    float edge = max(abs(rel.x), abs(rel.y));
    float corner = smoothstep(0.42, 0.68, edge);

    // The lantern clears darkness near the player; the outer fade never crushes
    // the village to pure black (moody dark-slate floor ~30% visibility).
    float dark = clamp(max(fog, corner) * (1.0 - lantern * 0.7), 0.0, 0.66);

    // Dark slate base, warmed by the lantern; corruption edges it cold.
    vec3 color = vec3(0.11, 0.14, 0.17);
    color += vec3(1.0, 0.52, 0.20) * warmGlow * (0.34 + uVirtue * 0.20 + uBurstGlow * 0.5);
    color += vec3(0.24, 0.16, 0.30) * uCorruption * 0.06;

    float dither = hash(gl_FragCoord.xy) * 0.03 - 0.015;
    float alpha = clamp(dark + dither + warmGlow * 0.04, 0.0, 0.72);

    gl_FragColor = vec4(color, alpha);
  }
`;

export class AtmosphereLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private burstTimer = 0;

  constructor(size = 160) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      uniforms: {
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uViewSize: { value: new THREE.Vector2(20, 20) },
        uTime: { value: 0 },
        uLanternRadius: { value: 14.0 },
        uVirtue: { value: 0 },
        uCorruption: { value: 0 },
        uBurstGlow: { value: 0 },
        uFogNear: { value: 14.0 },
        uFogFar: { value: 40.0 },
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
    // Keep the lantern pool a stable 12.5–15 world units so the clearing stays
    // open and legible at any zoom instead of a cramped or oversized circle.
    this.material.uniforms.uLanternRadius.value = Math.min(Math.max(worldHeight * 0.5, 12.5), 15.0);
    this.material.uniforms.uFogNear.value = worldHeight * 0.55;
    this.material.uniforms.uFogFar.value = worldHeight * 1.5;
  }

  /** Flare the warm lantern pool for a short window (Radiant Burst). */
  public triggerBurst(): void {
    this.burstTimer = 2.5;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;

    this.burstTimer = Math.max(0, this.burstTimer - ctx.dt);
    const burst = this.burstTimer > 0 ? Math.pow(this.burstTimer / 2.5, 1.5) : 0;
    this.material.uniforms.uBurstGlow.value = burst;
    this.material.uniforms.uVirtue.value = ctx.virtue;
    this.material.uniforms.uCorruption.value = ctx.corruption;
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
