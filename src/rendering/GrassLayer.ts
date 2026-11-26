import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import type { TerrainGrid } from '../core/TerrainGrid';

/** A shadow footprint (tree / building) that darkens the grass beneath it. */
export interface GrassDarkSpot {
  x: number;
  y: number;
  radius: number;
  strength: number;
  /** When true, grass blades + wildflowers are culled entirely inside the footprint. */
  cull?: boolean;
}

const MAX_DARK_SPOTS = 16;

const GRASS_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aBase;
  attribute vec3 aTip;
  attribute float aPhase;

  uniform float uTime;
  uniform vec2 uPlayerPos;

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
    vWorldPos = worldPos;

    float tipWeight = uv.y;

    // Smooth wind sway.
    float windWave = sin(uTime * 2.2 + worldPos.x * 0.35 - worldPos.y * 0.2 + aPhase);
    float windGust = 0.5 + 0.5 * sin(uTime * 0.9 + worldPos.x * 0.12);
    float swayX = windWave * (0.16 + windGust * 0.14) * tipWeight;
    float swayZ = cos(uTime * 1.7 + worldPos.y * 0.3 + aPhase) * 0.05 * tipWeight;

    // Part cleanly around the player's feet.
    vec2 toBlade = worldPos - uPlayerPos;
    float dist = length(toBlade);
    float pushStrength = 1.0 - smoothstep(0.2, 2.6, dist);
    vec2 pushDir = dist > 0.001 ? normalize(toBlade) : vec2(1.0, 0.0);
    vec2 playerBend = pushDir * pushStrength * 0.9 * tipWeight;

    vec3 displaced = position;
    displaced.x += swayX + playerBend.x;
    displaced.z += swayZ + playerBend.y * 0.6;
    displaced.y -= pushStrength * 0.22 * tipWeight;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(displaced, 1.0);
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
 * as a separate mesh of tiny non-stretched flat speck quads. Composited over the
 * ASCII pass by the AsciiPostProcess depth prepass.
 */
export class GrassLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly grassBases: Float32Array;
  private readonly flowerBases: Float32Array;

  constructor(terrain: TerrainGrid, count = 59000, areaSize = 55) {
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

    this.material = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX_SHADER,
      fragmentShader: GRASS_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
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
    const flowerMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const flowerCount = Math.floor(count * 0.012);
    this.flowers = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, flowerCount);
    this.flowers.frustumCulled = false;
    this.object3D.add(this.flowers);

    const dummy = new THREE.Object3D();

    this.grassBases = new Float32Array(count * 2);
    this.flowerBases = new Float32Array(flowerCount * 2);

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
      this.grassBases[placed * 2] = x;
      this.grassBases[placed * 2 + 1] = y;

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
    const flowerColor = new THREE.Color();
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
      this.flowerBases[flowerPlaced * 2] = x;
      this.flowerBases[flowerPlaced * 2 + 1] = y;

      flowerColor.setHex(Math.random() < 0.12 ? 0xb06a3a : 0xe8ecf2);
      this.flowers.setColorAt(flowerPlaced, flowerColor);

      flowerPlaced++;
    }
    this.flowers.count = flowerPlaced;
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

    // Fully cull grass + wildflowers under building footprints so blades never
    // poke through cottage walls, doors or porches.
    for (const s of spots) {
      if (s.cull) this.cullInstancesInside(s.x, s.y, s.radius);
    }
  }

  /**
   * Collapse every grass blade and wildflower whose base sits inside a footprint
   * to a zero-scale degenerate quad, so nothing renders inside the footprint.
   */
  private cullInstancesInside(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    const dummy = new THREE.Object3D();
    let grassChanged = false;
    let flowerChanged = false;

    for (let i = 0; i < this.mesh.count; i++) {
      const gx = this.grassBases[i * 2];
      const gy = this.grassBases[i * 2 + 1];
      const dx = gx - x;
      const dy = gy - y;
      if (dx * dx + dy * dy > r2) continue;
      dummy.position.set(gx, 0.01, -gy);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      grassChanged = true;
    }
    if (grassChanged) this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.flowers.count; i++) {
      const fx = this.flowerBases[i * 2];
      const fy = this.flowerBases[i * 2 + 1];
      const dx = fx - x;
      const dy = fy - y;
      if (dx * dx + dy * dy > r2) continue;
      dummy.position.set(fx, 0.02, -fy);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      this.flowers.setMatrixAt(i, dummy.matrix);
      flowerChanged = true;
    }
    if (flowerChanged) this.flowers.instanceMatrix.needsUpdate = true;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.flowers.geometry.dispose();
    (this.flowers.material as THREE.Material).dispose();
  }
}
