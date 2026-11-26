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
    float hide = 0.0;
    if (edgeDist < 0.35) hide = 1.0;
    if (t.b > 0.55) hide = 1.0;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uCullCount) break;
      vec4 c = uCull[i];
      if (distance(wrapped, c.xy) < c.z) hide = 1.0;
    }

    float tipWeight = uv.y;

    // Smooth wind sway.
    float windWave = sin(uTime * 2.2 + wrapped.x * 0.35 - wrapped.y * 0.2 + aPhase);
    float windGust = 0.5 + 0.5 * sin(uTime * 0.9 + wrapped.x * 0.12);
    float swayX = windWave * (0.16 + windGust * 0.14) * tipWeight;
    float swayZ = cos(uTime * 1.7 + wrapped.y * 0.3 + aPhase) * 0.05 * tipWeight;

    // Part cleanly around the player's feet.
    vec2 toBlade = wrapped - uPlayerPos;
    float dist = length(toBlade);
    float pushStrength = 1.0 - smoothstep(0.2, 2.6, dist);
    vec2 pushDir = dist > 0.001 ? normalize(toBlade) : vec2(1.0, 0.0);
    vec2 playerBend = pushDir * pushStrength * 0.9 * tipWeight;

    vec3 displaced = position;
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
  uniform vec4 uDarkSpots[16];
  uniform float uDarkCount;

  varying vec3 vBase;
  varying vec3 vTip;
  varying float vTipT;
  varying vec2 vWorldPos;

  void main() {
    // Base -> tip pine/blue-green gradient.
    vec3 col = mix(vBase, vTip, vTipT);

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

    // Soft tip lift so blade tops catch the moonlight.
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
    float hide = 0.0;
    if (edgeDist < 0.35) hide = 1.0;
    if (t.b > 0.55) hide = 1.0;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uCullCount) break;
      vec4 c = uCull[i];
      if (distance(wrapped, c.xy) < c.z) hide = 1.0;
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
 * Razor-sharp depth-tested 3D grass. Blades are crisp thin blue-green quads
 * swaying in the wind and parting around the player, with wildflowers rendered
 * as a separate mesh of tiny non-stretched flat speck quads. Both wrap around
 * the player in a fixed ring so the instance budget stays constant regardless
 * of map size, and both sample the terrain + building exclusions to hide on
 * water, dirt paths and inside building footprints.
 */
export class GrassLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly flowerMaterial: THREE.ShaderMaterial;

  constructor(terrain: TerrainGrid, count = 87400, areaSize = 56) {
    const geometry = buildBladeGeometry();
    const flowerGeometry = buildFlowerGeometry();

    const baseColors = new Float32Array(count * 3);
    const tipColors = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    // Nocturnal pine / blue-green palette: #071e15 roots -> #194d38 lit tips.
    const BASE_R = 0x07 / 255;
    const BASE_G = 0x1e / 255;
    const BASE_B = 0x15 / 255;
    const TIP_R = 0x19 / 255;
    const TIP_G = 0x4d / 255;
    const TIP_B = 0x38 / 255;

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

      // Cleared off the river channel/shoreline and the dirt footpath.
      if (terrain.getRiverSDF(x, y) < 0.25) continue;
      if (terrain.getPathMask(x, y) > 0.6) continue;

      const heightScale = 0.8 + Math.random() * 0.5;
      const widthScale = 0.7 + Math.random() * 0.6;

      dummy.position.set(x, 0.01, -y);
      dummy.rotation.set(0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3);
      dummy.scale.set(widthScale, heightScale, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);

      phases[placed] = Math.random() * Math.PI * 2;

      const shade = 0.85 + Math.random() * 0.35;
      baseColors[placed * 3 + 0] = BASE_R * shade;
      baseColors[placed * 3 + 1] = BASE_G * shade;
      baseColors[placed * 3 + 2] = BASE_B * shade;
      tipColors[placed * 3 + 0] = TIP_R * shade;
      tipColors[placed * 3 + 1] = TIP_G * shade;
      tipColors[placed * 3 + 2] = TIP_B * shade;

      placed++;
    }

    this.mesh.count = placed;
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(baseColors, 3));
    geometry.setAttribute('aTip', new THREE.InstancedBufferAttribute(tipColors, 3));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.mesh.instanceMatrix.needsUpdate = true;

    // Place sparse wildflowers: pale moon-white with rare muted ember-orange.
    const flowerDummy = new THREE.Object3D();
    const flowerColors = new Float32Array(flowerCount * 3);
    let flowerPlaced = 0;
    let flowerAttempts = 0;
    while (flowerPlaced < flowerCount && flowerAttempts < flowerCount * 12) {
      flowerAttempts++;
      const x = (Math.random() - 0.5) * areaSize;
      const y = (Math.random() - 0.5) * areaSize;

      if (terrain.getRiverSDF(x, y) < 0.25) continue;
      if (terrain.getPathMask(x, y) > 0.6) continue;

      flowerDummy.position.set(x, 0.02, -y);
      flowerDummy.rotation.set(0, Math.random() * Math.PI, 0);
      flowerDummy.scale.setScalar(0.8 + Math.random() * 0.4);
      flowerDummy.updateMatrix();
      this.flowers.setMatrixAt(flowerPlaced, flowerDummy.matrix);

      const warm = Math.random() < 0.12;
      flowerColors[flowerPlaced * 3 + 0] = warm ? 0xb0 / 255 : 0xee / 255;
      flowerColors[flowerPlaced * 3 + 1] = warm ? 0x6a / 255 : 0xf6 / 255;
      flowerColors[flowerPlaced * 3 + 2] = warm ? 0x3a / 255 : 0xff / 255;

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
