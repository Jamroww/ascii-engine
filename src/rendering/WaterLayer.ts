import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { SDF_RANGE } from '../core/TerrainGrid';
import type { TerrainGrid } from '../core/TerrainGrid';

/** A warm light source reflected as a shimmering streak on the water. */
export interface WaterLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}

const MAX_WATER_LIGHTS = 8;

const WATER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(world.x, -world.z);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTerrainMap;
  uniform float uWorldSize;
  uniform float uSdfRange;
  uniform float uTime;
  uniform vec2 uPlayerPos;
  uniform vec2 uPlayerVel;
  uniform float uPlayerInRiver;
  uniform vec4 uLights[8];
  uniform float uLightCount;

  varying vec2 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      v += amp * noise(p);
      p *= 2.05;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = (vWorld + uWorldSize * 0.5) / uWorldSize;
    vec4 t = texture2D(uTerrainMap, uv);

    // R = river signed distance field (128 == shoreline).
    float edgeDist = (t.r * 255.0 - 128.0) / 128.0 * uSdfRange;
    if (edgeDist > 0.0) discard;

    float blight = t.g;

    // Deep obsidian mirror-black base (#020408).
    vec3 col = vec3(0.008, 0.016, 0.031);

    // Dark-slate surface shimmer.
    float shimmer = fbm(vWorld * 0.9 + vec2(uTime * 0.06, uTime * 0.03));
    col += vec3(0.02, 0.03, 0.05) * shimmer * 0.5;

    // Crisp pale-silver shoreline foam / contour right along sdf ~ 0.
    float foam = smoothstep(-0.5, -0.02, edgeDist);
    col += vec3(0.72, 0.80, 0.85) * foam * 0.4;

    // Smooth reflected moon, parallaxed against the player so it drifts in the
    // mirror as you walk. Large disc + FBM craters + horizontal wave distortion.
    vec2 parallax = vWorld + uPlayerPos * 0.28;
    vec2 moonCenter = vec2(8.0, 3.0);
    float moonDist = length(parallax - moonCenter);
    float moonDisc = 1.0 - smoothstep(2.0, 2.8, moonDist);
    float crater = fbm(parallax * 2.6 + vec2(0.6, -0.4));
    float moonVal = mix(0.25, 1.0, crater);
    float wave = 0.5 + 0.5 * sin(vWorld.x * 1.6 + uTime * 0.9);
    vec3 moonCol = vec3(0.52, 0.60, 0.72) * moonVal * (0.85 + 0.3 * wave);
    col += moonCol * moonDisc;

    // Drifting reflected clouds: slow soft FBM mist veiling parts of the moon.
    vec2 cloudUv = vWorld * 0.05 + vec2(uTime * 0.022, -uTime * 0.015);
    float cloud = fbm(cloudUv);
    float cloudMask = smoothstep(0.52, 0.85, cloud);
    vec3 cloudCol = mix(vec3(0.12, 0.14, 0.16), vec3(0.40, 0.42, 0.44), cloudMask);
    col += cloudCol * cloudMask * 0.3;

    // Warm amber reflections from cottage windows / dock + shrine lanterns,
    // squashed into horizontal shimmering streaks rather than solid blobs.
    for (int i = 0; i < 8; i++) {
      if (float(i) >= uLightCount) break;
      vec4 L = uLights[i];
      vec2 d = vWorld - L.xy;
      float streakDist = length(vec2(d.x * 1.9, d.y * 0.5));
      float radius = max(L.z, 0.001);
      float glow = exp(-streakDist * streakDist / (radius * radius * 0.9));
      float ripple = 0.55 + 0.45 * sin(vWorld.x * 6.0 + uTime * 2.0 + float(i) * 1.7);
      col += vec3(1.0, 0.62, 0.22) * glow * L.w * 0.55 * ripple;
    }

    // Muted foliage reflections hugging the riverbanks.
    float bankMask = smoothstep(-1.9, -0.3, edgeDist);
    float foliage = fbm(vWorld * 0.7 + vec2(1.7, 4.2));
    vec3 foliageCol = vec3(0.05, 0.09, 0.06) * (0.5 + foliage);
    col += foliageCol * bankMask * 0.5;

    // Swirling neon green / violet Blight distortion from the G channel.
    float swirl = 0.5 + 0.5 * sin(vWorld.x * 0.8 + uTime * 0.6);
    vec3 blightCol = mix(vec3(0.08, 0.32, 0.18), vec3(0.22, 0.08, 0.34), 0.5);
    col = mix(col, blightCol * (0.8 + 0.4 * swirl), blight * 0.5);

    // Player wading ripples + trailing wake.
    if (uPlayerInRiver > 0.5) {
      float playerDist = length(vWorld - uPlayerPos);

      float t1 = fract(uTime * 1.35);
      float ring = (1.0 - smoothstep(0.0, 0.14, abs(playerDist - t1 * 3.2))) * (1.0 - t1);
      float t2 = fract(uTime * 1.35 + 0.5);
      float ring2 = (1.0 - smoothstep(0.0, 0.14, abs(playerDist - t2 * 3.2))) * (1.0 - t2);

      vec2 velDir = length(uPlayerVel) > 0.01 ? normalize(uPlayerVel) : vec2(0.0, -1.0);
      vec2 toPlayer = vWorld - uPlayerPos;
      float along = dot(toPlayer, velDir);
      float perp = abs(dot(toPlayer, vec2(-velDir.y, velDir.x)));
      float wake = (1.0 - smoothstep(0.0, 0.7, perp)) * smoothstep(-2.6, 0.0, along);

      float rippleStrength = (ring + ring2) * 0.9 + wake * 0.7;
      col += vec3(0.80, 0.85, 0.90) * rippleStrength * 0.5;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class WaterLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly terrain: TerrainGrid;
  private prevX = 0;
  private prevY = 0;

  constructor(terrain: TerrainGrid, areaSize = 60) {
    this.terrain = terrain;

    // x, y, radius, intensity per light.
    const lightUniforms = new Float32Array(MAX_WATER_LIGHTS * 4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uSdfRange: { value: SDF_RANGE },
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uPlayerVel: { value: new THREE.Vector2(0, 0) },
        uPlayerInRiver: { value: 0 },
        uLights: { value: lightUniforms },
        uLightCount: { value: 0 },
      },
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(areaSize, areaSize);
    this.object3D = new THREE.Mesh(geometry, this.material);
    this.object3D.rotation.x = -Math.PI / 2;
    this.object3D.position.y = -0.05;
    this.object3D.receiveShadow = true;
  }

  /** Replace the warm light sources reflected on the water. */
  public setLights(lights: WaterLight[]): void {
    const value = this.material.uniforms.uLights.value as Float32Array;
    const count = Math.min(lights.length, MAX_WATER_LIGHTS);
    for (let i = 0; i < count; i++) {
      const l = lights[i];
      value[i * 4 + 0] = l.x;
      value[i * 4 + 1] = l.y;
      value[i * 4 + 2] = l.radius;
      value[i * 4 + 3] = l.intensity;
    }
    this.material.uniforms.uLightCount.value = count;
  }

  public update(ctx: FrameContext): void {
    const px = ctx.playerPos.x;
    const py = ctx.playerPos.y;

    // Reconstruct player velocity from successive frames for the wake.
    const dt = ctx.dt > 0 ? ctx.dt : 1 / 60;
    const vx = (px - this.prevX) / dt;
    const vy = (py - this.prevY) / dt;
    this.prevX = px;
    this.prevY = py;

    this.material.uniforms.uTime.value = ctx.elapsed;
    this.material.uniforms.uPlayerPos.value.set(px, py);
    this.material.uniforms.uPlayerVel.value.set(vx, vy);
    this.material.uniforms.uPlayerInRiver.value = this.terrain.isInRiver(px, py) ? 1 : 0;
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
