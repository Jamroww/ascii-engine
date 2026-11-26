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
  uniform sampler2D uPlayerReflectionTex;
  uniform vec2 uScreenResolution;
  uniform sampler2D uMoonTex;

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
    for (int i = 0; i < 4; i++) {
      v += amp * noise(p);
      p *= 2.05;
      amp *= 0.5;
    }
    return v;
  }

  // River boulder ripples + subtle downstream foam V-wake (physical linear space).
  void addBoulder(vec2 bPos, inout vec3 col) {
    vec2 bd = vWorld - bPos;
    float bDist = length(bd);
    float bFall = 1.0 - smoothstep(1.0, 3.2, bDist);

    float bRipple = max(0.0, sin(bDist * 5.2 - uTime * 3.0)) * bFall;
    col += vec3(0.045, 0.065, 0.095) * bRipple;

    float down = -bd.y;
    float lateral = abs(bd.x);
    float wakeBand = 1.0 - smoothstep(0.85, 1.65 + down * 0.18, lateral);
    float wakeLen = smoothstep(0.0, 0.5, down) * (1.0 - smoothstep(3.2, 6.2, down));
    col += vec3(0.08, 0.10, 0.13) * wakeBand * wakeLen;
  }

  void main() {
    vec2 uv = (vWorld + uWorldSize * 0.5) / uWorldSize;
    vec4 t = texture2D(uTerrainMap, uv);

    // R = river signed distance field (128 == shoreline, negative == inside water).
    float edgeDist = (t.r * 255.0 - 128.0) / 128.0 * uSdfRange;
    if (edgeDist > 0.0) discard;

    float blight = t.g;

    // --- True linear midnight-navy base + flowing downstream currents ---
    vec3 deepCol = vec3(0.004, 0.011, 0.022);
    vec3 litCol  = vec3(0.011, 0.028, 0.052);

    // Downstream is -y in gameplay coords (+Z in 3D).
    float flowA = vWorld.y + uTime * 0.65;
    float flowB = vWorld.y + uTime * 1.25;

    float streakA = fbm(vec2(vWorld.x * 1.15, flowA * 0.45));
    float streakB = fbm(vec2(vWorld.x * 2.1 + 4.7, flowB * 0.85) + vec2(2.9, 6.3));
    float current = streakA * 0.62 + streakB * 0.38;

    // Crisp horizontal flowing wave scanlines (constant along X with subtle wave).
    float hScan = 0.5 + 0.5 * sin(vWorld.y * 7.5 + uTime * 2.6 + sin(vWorld.x * 0.9) * 0.7);
    vec3 col = mix(deepCol, litCol, clamp(current * 1.1 + (hScan - 0.5) * 0.25, 0.0, 1.0));

    // --- Recessed bank overhang shadow (gives grassy banks real height/depth) ---
    float overhang = smoothstep(-0.95, -0.04, edgeDist);
    vec3 undercutCol = vec3(0.0004, 0.001, 0.002);
    col = mix(col, undercutCol, overhang * 0.92);

    // --- Shoreline lapping edge (fixed edge0 < edge1 smoothstep) ---
    float lapInner = smoothstep(-0.52, -0.26, edgeDist);
    float lapOuter = 1.0 - smoothstep(-0.24, -0.06, edgeDist);
    float lap = lapInner * lapOuter;
    float lapWave = 0.5 + 0.5 * sin(vWorld.y * 5.0 + vWorld.x * 3.0 + uTime * 2.4);
    col += vec3(0.055, 0.075, 0.105) * lap * lapWave;

    // --- River boulders ---
    addBoulder(vec2(6.8, -4.0), col);
    addBoulder(vec2(8.0, 11.0), col);

    // --- Warm bank / lantern reflections (capped linear output, no $$$ blobs) ---
    vec3 lightAccum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      if (float(i) >= uLightCount) break;
      vec4 L = uLights[i];
      vec2 d = vWorld - L.xy;
      float rx = clamp(L.z, 2.0, 2.8);
      float rz = rx * 0.65;
      float fallX = 1.0 - smoothstep(0.0, rx, abs(d.x));
      float fallZ = 1.0 - smoothstep(0.0, rz, abs(d.y));
      float fall = fallX * fallZ;
      float intensity = min(L.w, 0.85);
      float ripple = 0.55 + 0.45 * sin(vWorld.y * 8.5 + uTime * 3.0 + float(i) * 1.7);
      lightAccum += vec3(0.24, 0.11, 0.02) * fall * intensity * ripple;
    }
    col += min(lightAccum, vec3(0.28, 0.14, 0.03));

    // --- Reflected moon: high-detail raster texture (hero landmark) ---
    vec2 moonCenter = vec2(8.0, 2.5) + uPlayerPos * 0.12;
    vec2 moonD = vWorld - moonCenter;
    // Compensate for 3/4 camera pitch foreshortening so moon looks round on screen.
    vec2 moonEllip = vec2(moonD.x, moonD.y * 0.72);
    // Subtle horizontal water ripple distortion of the sampled lunar texture.
    moonEllip.x += sin(vWorld.y * 6.0 + uTime * 2.4) * 0.16;
    float moonRadius = 2.5;
    float moonDist = length(moonEllip);
    float moonDisc = 1.0 - smoothstep(moonRadius - 0.4, moonRadius, moonDist);

    // Sample the raster lunar texture (maria + crater rims + limb darkening).
    vec2 moonUv = clamp(moonEllip / (moonRadius * 2.0) + 0.5, 0.0, 1.0);
    vec3 moonCol = texture2D(uMoonTex, moonUv).rgb;

    // Horizontal water scanlines slicing subtly across the moon.
    moonCol *= 0.78 + 0.22 * sin(vWorld.y * 9.0 + uTime * 2.4);

    // Soft drifting mist wisps partially veiling the moon.
    vec2 mistUv = vWorld * 0.08 + vec2(uTime * 0.05, -uTime * 0.02);
    float mist = smoothstep(0.50, 0.78, fbm(mistUv));

    // Frame the moon cleanly inside the riverbanks & beneath overhang shadows.
    float moonClip = 1.0 - smoothstep(-0.65, -0.18, edgeDist);
    float moonUnderBank = 1.0 - overhang * 0.85;
    col = mix(col, max(col, moonCol), moonDisc * moonClip * moonUnderBank * (1.0 - mist * 0.55));
    col += vec3(0.035, 0.045, 0.06) * mist * moonClip * (1.0 - overhang);

    // --- Exact-height player reflection (screen-space planar RT) ---
    if (uScreenResolution.x > 2.0) {
      float worldZ = -vWorld.y;
      vec2 refUv = gl_FragCoord.xy / uScreenResolution;
      refUv.x += sin(worldZ * 10.0 + uTime * 3.5) * 0.005;
      vec4 ref = texture2D(uPlayerReflectionTex, refUv);
      // Reflections are clearest in the shadowed bank water; fade only at the
      // immediate bank lip so they never bleed a hard mirror line ashore.
      float refFade = 1.0 - smoothstep(-0.14, -0.02, edgeDist);
      float ripple = 0.78 + 0.22 * sin(vWorld.y * 14.0 + uTime * 3.2);
      col += min(ref.rgb * 0.95, vec3(0.75)) * ref.a * refFade * ripple;
    }

    // --- Player wading ripples + trailing downstream V-wake ---
    if (uPlayerInRiver > 0.5) {
      float playerDist = length(vWorld - uPlayerPos);

      float t1 = fract(uTime * 1.35);
      float ring1 = (1.0 - smoothstep(0.0, 0.16, abs(playerDist - t1 * 3.0))) * (1.0 - t1);
      float t2 = fract(uTime * 1.35 + 0.5);
      float ring2 = (1.0 - smoothstep(0.0, 0.16, abs(playerDist - t2 * 3.0))) * (1.0 - t2);

      vec2 velDir = length(uPlayerVel) > 0.05 ? normalize(uPlayerVel) : vec2(0.0, -1.0);
      vec2 toPlayer = vWorld - uPlayerPos;
      float along = dot(toPlayer, velDir);
      float perp = abs(dot(toPlayer, vec2(-velDir.y, velDir.x)));
      float wake = (1.0 - smoothstep(0.0, 0.65, perp)) * smoothstep(-2.4, -0.15, along) * (1.0 - smoothstep(-0.05, 0.25, along));

      float rippleStrength = (ring1 + ring2) * 0.85 + wake * 0.55;
      col += vec3(0.24, 0.30, 0.38) * rippleStrength;
    }

    // --- Sparse silver current glints ---
    float glintCell = hash(floor(vWorld * 1.6) + floor(uTime * 1.3) * 13.0);
    float glint = smoothstep(0.975, 1.0, glintCell);
    col += vec3(0.14, 0.18, 0.24) * glint * (1.0 - overhang);

    // Cap clean water before Blight mix so the river never clips to flat $$$.
    col = min(col, vec3(0.75));

    // --- Swirling toxic Blight (northern upstream zone, linear space) ---
    float swirl = 0.5 + 0.5 * sin(vWorld.x * 0.9 - vWorld.y * 0.35 + uTime * 1.1);
    vec3 blightCol = mix(vec3(0.025, 0.22, 0.045), vec3(0.18, 0.025, 0.34), swirl) * (0.75 + 0.5 * swirl);
    col = mix(col, blightCol, blight * 0.65);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Generate a crisp 256x256 lunar texture on an offscreen canvas: shaded maria,
 * sharp overlapping crater rims and limb darkening. Used as the fallback moon.
 */
function createMoonCanvasTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  if (!ctx) return texture;

  const half = size / 2;
  const radius = half * 0.97;
  let seed = 0x5eeda11;

  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  // Limb-darkened lunar sphere.
  const base = ctx.createRadialGradient(half, half, radius * 0.2, half, half, radius);
  base.addColorStop(0, '#eef1f6');
  base.addColorStop(0.5, '#c9d0db');
  base.addColorStop(0.82, '#98a1b2');
  base.addColorStop(1, '#525a6b');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(half, half, radius, 0, Math.PI * 2);
  ctx.fill();

  // Shaded maria (soft irregular dark seas).
  for (let i = 0; i < 7; i++) {
    const mx = (rand() * 2 - 1) * radius * 0.5;
    const my = (rand() * 2 - 1) * radius * 0.5;
    const mr = radius * (0.14 + rand() * 0.2);
    const g = ctx.createRadialGradient(half + mx, half + my, 0, half + mx, half + my, mr);
    g.addColorStop(0, 'rgba(64, 72, 88, 0.85)');
    g.addColorStop(0.7, 'rgba(90, 98, 114, 0.45)');
    g.addColorStop(1, 'rgba(140, 148, 166, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(half + mx, half + my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sharp overlapping crater rims.
  for (let i = 0; i < 14; i++) {
    const cx = (rand() * 2 - 1) * radius * 0.72;
    const cy = (rand() * 2 - 1) * radius * 0.72;
    const cr = radius * (0.05 + rand() * 0.12);
    ctx.fillStyle = 'rgba(40, 46, 58, 0.8)';
    ctx.beginPath();
    ctx.arc(half + cx, half + cy, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 232, 242, 0.9)';
    ctx.lineWidth = Math.max(1.5, cr * 0.22);
    ctx.beginPath();
    ctx.arc(half + cx, half + cy, cr * 0.96, -Math.PI * 0.75, -Math.PI * 0.15);
    ctx.stroke();
  }

  texture.needsUpdate = true;
  return texture;
}

/** Swap in a custom `public/textures/moon.png` if present, else keep the canvas. */
function loadMoonPng(uniform: { value: THREE.Texture | null }): void {
  new THREE.TextureLoader().load(
    '/textures/moon.png',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      uniform.value = tex;
    },
    undefined,
    () => {
      // Missing PNG: silently keep the procedural canvas moon.
    },
  );
}

export class WaterLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly terrain: TerrainGrid;
  private prevX = 0;
  private prevY = 0;

  constructor(terrain: TerrainGrid, areaSize = 60) {
    this.terrain = terrain;

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
        uPlayerReflectionTex: { value: null },
        uScreenResolution: { value: new THREE.Vector2(1, 1) },
        uMoonTex: { value: null },
      },
      depthWrite: false,
    });

    // Crisp 256x256 procedural lunar texture, swapped for a custom PNG if the
    // user drops one into public/textures/moon.png.
    this.material.uniforms.uMoonTex.value = createMoonCanvasTexture();
    loadMoonPng(this.material.uniforms.uMoonTex);

    const geometry = new THREE.PlaneGeometry(areaSize, areaSize);
    this.object3D = new THREE.Mesh(geometry, this.material);
    this.object3D.rotation.x = -Math.PI / 2;
    this.object3D.position.y = -0.05;
    this.object3D.receiveShadow = true;
  }

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

  public setPlayerReflection(
    texture: THREE.Texture | null,
    width: number,
    height: number,
  ): void {
    this.material.uniforms.uPlayerReflectionTex.value = texture;
    (this.material.uniforms.uScreenResolution.value as THREE.Vector2).set(width, height);
  }

  public update(ctx: FrameContext): void {
    const px = ctx.playerPos.x;
    const py = ctx.playerPos.y;

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