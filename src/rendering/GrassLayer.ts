import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import type { TerrainGrid } from '../core/TerrainGrid';

/** A shadow footprint (tree / building) that darkens the grass beneath it. */
export interface GrassDarkSpot {
  x: number;
  y: number;
  radius: number;
  strength: number;
  /** Kept for API compatibility; culling is now handled by building exclusions. */
  cull?: boolean;
}

/** A building footprint whose grass blades + wildflowers are fully hidden. */
export interface GrassExclusion {
  x: number;
  y: number;
  radius: number;
}

/** Theme values baked into a freshly-built GrassLayer for the active level. */
export interface GrassOptions {
  foliageBase?: THREE.Color;
  foliageTip?: THREE.Color;
  heightScale?: number;
  swayAmp?: number;
  clearingCenter?: { x: number; y: number };
  clearingRadius?: number;
  /** Level 2 swaps wildflowers to warm cream pollen heads / crimson poppies. */
  warmWildflowers?: boolean;
}

const MAX_DARK_SPOTS = 16;
const MAX_EXCLUSIONS = 16;
const GRASS_RING = 56;

const GRASS_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aBase;
  attribute vec3 aTip;
  attribute float aPhase;

  uniform float uTime;
  uniform vec2 uPlayerPos;
  uniform float uRing;
  uniform highp sampler2D uTerrainMap;
  uniform float uWorldSize;
  uniform vec4 uCull[16];
  uniform float uCullCount;
  uniform float uHeightScale;
  uniform float uSwayAmp;
  uniform vec2 uClearingCenter;
  uniform float uClearingRadius;

  varying vec3 vBase;
  varying vec3 vTip;
  varying float vTipT;
  varying vec2 vWorldPos;

  void main() {
    vBase = aBase;
    vTip = aTip;
    vTipT = uv.y;

    // Blade base (gameplay x, y) from the instance transform.
    vec4 baseLocal = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 baseWorld = modelMatrix * baseLocal;
    vec2 worldPos = vec2(baseWorld.x, -baseWorld.z);

    // Wrap/tile the blade into a ring centered on the player so it stays
    // anchored in world space without sliding, and the budget never scales
    // with map size.
    vec2 rel = mod(worldPos - uPlayerPos + uRing * 0.5, uRing) - uRing * 0.5;
    vec2 wrapped = uPlayerPos + rel;
    vWorldPos = wrapped;

    // Hide blades inside water, on the dirt footpath, and inside buildings.
    vec2 terrainUv = (wrapped + uWorldSize * 0.5) / uWorldSize;
    vec4 t = texture2D(uTerrainMap, terrainUv);
    float edgeDist = (t.r * 255.0 - 128.0) / 128.0 * 8.0; // world-unit SDF
    float underwater = edgeDist < 0.35 ? 1.0 : 0.0;
    float hide = underwater;

    // Grass Override Paint Mask (A channel): 128 == neutral, > 180 == force
    // grass ON (even across paths/clearings, but never underwater), < 75 ==
    // force grass OFF (carve clean grass-free courtyards/plazas/trails).
    if (underwater < 0.5) {
      float grassOff = t.a < 0.30 ? 1.0 : 0.0;
      float grassOn = t.a > 0.72 ? 1.0 : 0.0;
      if (grassOff > 0.5) {
        hide = 1.0;
      } else if (grassOn < 0.5 && t.b > 0.55) {
        hide = 1.0;
      }
    }

    for (int i = 0; i < 16; i++) {
      if (float(i) >= uCullCount) break;
      vec4 c = uCull[i];
      if (distance(wrapped, c.xy) < c.z) hide = 1.0;
    }
    // Smoothly clear wheat inside the dueling circle (disabled when radius = 0,
    // and ignored while grass is force-painted on).
    if (uClearingRadius > 0.01 && t.a <= 0.72) {
      float clear = 1.0 - smoothstep(uClearingRadius, uClearingRadius + 2.0, distance(wrapped, uClearingCenter));
      hide = max(hide, clear);
    }

    float tipWeight = uv.y;

    // Smooth wind sway, amplified for the tall golden wheat.
    float windWave = sin(uTime * 2.2 + wrapped.x * 0.35 - wrapped.y * 0.2 + aPhase);
    float windGust = 0.5 + 0.5 * sin(uTime * 0.9 + wrapped.x * 0.12);
    float swayX = windWave * (0.16 + windGust * 0.14) * uSwayAmp * tipWeight;
    float swayZ = cos(uTime * 1.7 + wrapped.y * 0.3 + aPhase) * 0.05 * uSwayAmp * tipWeight;

    // Part cleanly around the player's feet.
    vec2 toBlade = wrapped - uPlayerPos;
    float dist = length(toBlade);
    float pushStrength = 1.0 - smoothstep(0.2, 2.6, dist);
    vec2 pushDir = dist > 0.001 ? normalize(toBlade) : vec2(1.0, 0.0);
    vec2 playerBend = pushDir * pushStrength * 0.9 * tipWeight;

    vec3 displaced = position;
    displaced.y *= uHeightScale;
    displaced.x += swayX + playerBend.x;
    displaced.z += swayZ + playerBend.y * 0.6;
    displaced.y -= pushStrength * 0.22 * tipWeight;

    // Smooth radial fade toward the wrap seam (24..28 units) so the periodic
    // ring never pops into view even at maximum zoom-out.
    float rimFade = 1.0 - smoothstep(24.0, 28.0, dist);
    displaced *= rimFade;

    // Re-anchor the displaced blade at the wrapped world position.
    vec3 wrapDelta = vec3(wrapped.x - worldPos.x, 0.0, -(wrapped.y - worldPos.y));
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(displaced, 1.0);
    worldPosition.xyz += wrapDelta;
    worldPosition.xyz *= (1.0 - hide);

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const GRASS_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  uniform vec4 uDarkSpots[16];
  uniform float uDarkCount;

  varying vec3 vBase;
  varying vec3 vTip;
  varying float vTipT;
  varying vec2 vWorldPos;

  void main() {
    // Base -> tip gradient driven by the live theme colours; the per-instance
    // vBase / vTip hold a subtle brightness variation (grayscale ~0.85..1.2).
    vec3 col = mix(uBaseColor * vBase, uTipColor * vTip, vTipT);

    // Darken under tree / building footprints so the grass reads as shadowed
    // ground instead of a flat luminous carpet.
    float dark = 1.0;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uDarkCount) break;
      vec4 s = uDarkSpots[i];
      float d = distance(vWorldPos, s.xy);
      dark *= 1.0 - s.w * (1.0 - smoothstep(0.0, s.z, d));
    }
    col *= dark;

    // Soft tip lift so blade tops catch the light.
    col *= 0.88 + vTipT * 0.18;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const FLOWER_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;

  uniform vec2 uPlayerPos;
  uniform float uRing;
  uniform highp sampler2D uTerrainMap;
  uniform float uWorldSize;
  uniform vec4 uCull[16];
  uniform float uCullCount;
  uniform vec2 uClearingCenter;
  uniform float uClearingRadius;

  varying vec3 vColor;

  void main() {
    vColor = aColor;

    vec4 baseWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 worldPos = vec2(baseWorld.x, -baseWorld.z);
    vec2 rel = mod(worldPos - uPlayerPos + uRing * 0.5, uRing) - uRing * 0.5;
    vec2 wrapped = uPlayerPos + rel;

    // Fade the speck scale toward the wrap seam so no flower ever pops.
    float rimFade = 1.0 - smoothstep(24.0, 28.0, length(rel));

    vec2 terrainUv = (wrapped + uWorldSize * 0.5) / uWorldSize;
    vec4 t = texture2D(uTerrainMap, terrainUv);
    float edgeDist = (t.r * 255.0 - 128.0) / 128.0 * 8.0; // world-unit SDF
    float underwater = edgeDist < 0.35 ? 1.0 : 0.0;
    float hide = underwater;

    if (underwater < 0.5) {
      float grassOff = t.a < 0.30 ? 1.0 : 0.0;
      float grassOn = t.a > 0.72 ? 1.0 : 0.0;
      if (grassOff > 0.5) {
        hide = 1.0;
      } else if (grassOn < 0.5 && t.b > 0.55) {
        hide = 1.0;
      }
    }

    for (int i = 0; i < 16; i++) {
      if (float(i) >= uCullCount) break;
      vec4 c = uCull[i];
      if (distance(wrapped, c.xy) < c.z) hide = 1.0;
    }
    if (uClearingRadius > 0.01 && t.a <= 0.72) {
      float clear = 1.0 - smoothstep(uClearingRadius, uClearingRadius + 2.0, distance(wrapped, uClearingCenter));
      hide = max(hide, clear);
    }

    vec3 delta = vec3(wrapped.x - worldPos.x, 0.0, -(wrapped.y - worldPos.y));
    vec4 world = modelMatrix * instanceMatrix * vec4(position * rimFade, 1.0);
    world.xyz += delta;
    world.xyz *= (1.0 - hide);

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FLOWER_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

/** A single tapered grass blade quad, base at y=0, tip at y=height, facing +Z. */
function buildBladeGeometry(): THREE.BufferGeometry {
  const halfW = 0.035;
  const height = 0.45;
  const tipScale = 0.1;

  const positions = new Float32Array([
    -halfW, 0, 0,
    halfW, 0, 0,
    halfW * tipScale, height, 0,
    -halfW * tipScale, height, 0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = [0, 1, 2, 0, 2, 3];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** A tiny flat diamond speck quad (~0.1 units wide) for non-stretched wildflowers. */
function buildFlowerGeometry(): THREE.BufferGeometry {
  const s = 0.05;
  const positions = new Float32Array([
    0, 0, -s, // north tip
    -s, 0, 0, // west tip
    0, 0, s, // south tip
    s, 0, 0, // east tip
  ]);
  const indices = [0, 1, 2, 0, 2, 3];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Razor-sharp depth-tested 3D grass. Blades are crisp thin quads swaying in the
 * wind and parting around the player, with wildflowers rendered as a separate
 * mesh of tiny non-stretched flat speck quads. Base/tip colours are live
 * uniforms so the Settings palette studio can recolor the meadow/wheat in real
 * time without rebuilding geometry.
 */
export class GrassLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly flowerMaterial: THREE.ShaderMaterial;

  constructor(terrain: TerrainGrid, options: GrassOptions = {}, count = 87400, areaSize = 56) {
    const geometry = buildBladeGeometry();
    const flowerGeometry = buildFlowerGeometry();

    const baseColors = new Float32Array(count * 3);
    const tipColors = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    // x, y, radius, strength per shadow footprint.
    const darkSpotUniforms = new Float32Array(MAX_DARK_SPOTS * 4);
    // x, y, radius (w unused) per building exclusion.
    const cullUniforms = new Float32Array(MAX_EXCLUSIONS * 4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX_SHADER,
      fragmentShader: GRASS_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uRing: { value: GRASS_RING },
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uCull: { value: cullUniforms },
        uCullCount: { value: 0 },
        uDarkSpots: { value: darkSpotUniforms },
        uDarkCount: { value: 0 },
        uBaseColor: { value: options.foliageBase?.clone() ?? new THREE.Color('#071e15') },
        uTipColor: { value: options.foliageTip?.clone() ?? new THREE.Color('#194d38') },
        uHeightScale: { value: options.heightScale ?? 1.0 },
        uSwayAmp: { value: options.swayAmp ?? 1.0 },
        uClearingCenter: {
          value: new THREE.Vector2(options.clearingCenter?.x ?? 0, options.clearingCenter?.y ?? 0),
        },
        uClearingRadius: { value: options.clearingRadius ?? 0 },
      },
      depthTest: true,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    this.mesh.frustumCulled = false;
    this.object3D.add(this.mesh);

    // Wildflowers: a sparse second instanced mesh of crisp flat speck quads.
    const flowerCullUniforms = new Float32Array(MAX_EXCLUSIONS * 4);
    this.flowerMaterial = new THREE.ShaderMaterial({
      vertexShader: FLOWER_VERTEX_SHADER,
      fragmentShader: FLOWER_FRAGMENT_SHADER,
      uniforms: {
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uRing: { value: GRASS_RING },
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uCull: { value: flowerCullUniforms },
        uCullCount: { value: 0 },
        uClearingCenter: {
          value: new THREE.Vector2(options.clearingCenter?.x ?? 0, options.clearingCenter?.y ?? 0),
        },
        uClearingRadius: { value: options.clearingRadius ?? 0 },
      },
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flowerCount = Math.floor(count * 0.012);
    this.flowers = new THREE.InstancedMesh(flowerGeometry, this.flowerMaterial, flowerCount);
    this.flowers.frustumCulled = false;
    this.object3D.add(this.flowers);

    const dummy = new THREE.Object3D();

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 8) {
      attempts++;
      const x = (Math.random() - 0.5) * areaSize;
      const y = (Math.random() - 0.5) * areaSize;

      // Cleared only off the river channel/shoreline. Dirt paths keep their
      // packed-earth look via the shader's `t.b > 0.55` hide, but blades are
      // still placed there so the editor's "Paint Grass" force-ON override can
      // reveal them on demand.
      if (terrain.getRiverSDF(x, y) < 0.25) continue;

      const heightScale = 0.8 + Math.random() * 0.5;
      const widthScale = 0.7 + Math.random() * 0.6;

      dummy.position.set(x, 0.01, -y);
      dummy.rotation.set(0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3);
      dummy.scale.set(widthScale, heightScale, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);

      phases[placed] = Math.random() * Math.PI * 2;

      const shade = 0.85 + Math.random() * 0.35;
      baseColors[placed * 3 + 0] = shade;
      baseColors[placed * 3 + 1] = shade;
      baseColors[placed * 3 + 2] = shade;
      tipColors[placed * 3 + 0] = shade;
      tipColors[placed * 3 + 1] = shade;
      tipColors[placed * 3 + 2] = shade;

      placed++;
    }

    this.mesh.count = placed;
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(baseColors, 3));
    geometry.setAttribute('aTip', new THREE.InstancedBufferAttribute(tipColors, 3));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.mesh.instanceMatrix.needsUpdate = true;

    // Place sparse wildflowers: pale moon-white with rare muted ember-orange in
    // Level 1; warm golden-cream pollen heads / crimson poppies in Level 2.
    const flowerDummy = new THREE.Object3D();
    const flowerColors = new Float32Array(flowerCount * 3);
    const warm = options.warmWildflowers === true;
    let flowerPlaced = 0;
    let flowerAttempts = 0;
    while (flowerPlaced < flowerCount && flowerAttempts < flowerCount * 12) {
      flowerAttempts++;
      const x = (Math.random() - 0.5) * areaSize;
      const y = (Math.random() - 0.5) * areaSize;

      if (terrain.getRiverSDF(x, y) < 0.25) continue;

      flowerDummy.position.set(x, 0.02, -y);
      flowerDummy.rotation.set(0, Math.random() * Math.PI, 0);
      flowerDummy.scale.setScalar(0.8 + Math.random() * 0.4);
      flowerDummy.updateMatrix();
      this.flowers.setMatrixAt(flowerPlaced, flowerDummy.matrix);

      // Warm variant ratio: 12% ember in Level 1, 55% crimson poppy in Level 2.
      const isWarm = Math.random() < (warm ? 0.55 : 0.12);
      if (warm) {
        if (isWarm) {
          // Crimson poppy.
          flowerColors[flowerPlaced * 3 + 0] = 0xc0 / 255;
          flowerColors[flowerPlaced * 3 + 1] = 0x2e / 255;
          flowerColors[flowerPlaced * 3 + 2] = 0x2a / 255;
        } else {
          // Golden-cream pollen head.
          flowerColors[flowerPlaced * 3 + 0] = 0xf2 / 255;
          flowerColors[flowerPlaced * 3 + 1] = 0xd2 / 255;
          flowerColors[flowerPlaced * 3 + 2] = 0x7c / 255;
        }
      } else {
        flowerColors[flowerPlaced * 3 + 0] = isWarm ? 0xb0 / 255 : 0xee / 255;
        flowerColors[flowerPlaced * 3 + 1] = isWarm ? 0x6a / 255 : 0xf6 / 255;
        flowerColors[flowerPlaced * 3 + 2] = isWarm ? 0x3a / 255 : 0xff / 255;
      }

      flowerPlaced++;
    }
    this.flowers.count = flowerPlaced;
    flowerGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(flowerColors, 3));
    this.flowers.instanceMatrix.needsUpdate = true;
  }

  /** Shadow footprints that darken the grass (trees, buildings, props). */
  public setDarkSpots(spots: GrassDarkSpot[]): void {
    const value = this.material.uniforms.uDarkSpots.value as Float32Array;
    const count = Math.min(spots.length, MAX_DARK_SPOTS);
    for (let i = 0; i < count; i++) {
      const s = spots[i];
      value[i * 4 + 0] = s.x;
      value[i * 4 + 1] = s.y;
      value[i * 4 + 2] = s.radius;
      value[i * 4 + 3] = s.strength;
    }
    this.material.uniforms.uDarkCount.value = count;
  }

  /** Building footprints whose grass blades + wildflowers are hidden entirely. */
  public setBuildingExclusions(exclusions: GrassExclusion[]): void {
    this.writeExclusions(this.material, exclusions);
    this.writeExclusions(this.flowerMaterial, exclusions);
  }

  /** Live-update the blade base/tip colours (Palette Studio). */
  public setFoliageColors(base: THREE.Color, tip: THREE.Color): void {
    (this.material.uniforms.uBaseColor.value as THREE.Color).copy(base);
    (this.material.uniforms.uTipColor.value as THREE.Color).copy(tip);
  }

  private writeExclusions(material: THREE.ShaderMaterial, exclusions: GrassExclusion[]): void {
    const value = material.uniforms.uCull.value as Float32Array;
    const count = Math.min(exclusions.length, MAX_EXCLUSIONS);
    for (let i = 0; i < count; i++) {
      const e = exclusions[i];
      value[i * 4 + 0] = e.x;
      value[i * 4 + 1] = e.y;
      value[i * 4 + 2] = e.radius;
      value[i * 4 + 3] = 0;
    }
    material.uniforms.uCullCount.value = count;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
    this.flowerMaterial.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.flowers.geometry.dispose();
    this.flowerMaterial.dispose();
  }
}
