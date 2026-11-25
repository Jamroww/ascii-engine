import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import type { TerrainGrid } from '../core/TerrainGrid';

/** A shadow footprint (tree / building) that darkens the grass beneath it. */
export interface GrassDarkSpot {
  x: number;
  y: number;
  radius: number;
  strength: number;
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
    // Base -> tip emerald gradient.
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
  const halfW = 0.05;
  const height = 0.55;
  const tipScale = 0.12;

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

/**
 * Razor-sharp depth-tested 3D grass. Blades are crisp thin emerald quads swaying
 * in the wind and parting around the player, composited over the ASCII pass by
 * the AsciiPostProcess depth prepass. No glyph/atlas sampling here — the whole
 * field stays sharp and is only occluded by the real 3D world via hardware depth.
 */
export class GrassLayer implements IRenderLayer {
  public readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  public get object3D(): THREE.Object3D {
    return this.mesh;
  }

  constructor(terrain: TerrainGrid, count = 42000, areaSize = 55) {
    const geometry = buildBladeGeometry();

    const baseColors = new Float32Array(count * 3);
    const tipColors = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    // Nocturnal emerald-teal palette: #14422a base -> #2d784e tips.
    const BASE_R = 0x14 / 255;
    const BASE_G = 0x42 / 255;
    const BASE_B = 0x2a / 255;
    const TIP_R = 0x2d / 255;
    const TIP_G = 0x78 / 255;
    const TIP_B = 0x4e / 255;

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

      const isFlower = Math.random() < 0.015;

      const heightScale = isFlower ? 0.3 + Math.random() * 0.18 : 0.8 + Math.random() * 0.5;
      const widthScale = isFlower ? 1.6 + Math.random() * 0.8 : 0.7 + Math.random() * 0.6;

      dummy.position.set(x, 0.01, -y);
      dummy.rotation.set(0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3);
      dummy.scale.set(widthScale, heightScale, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);

      phases[placed] = Math.random() * Math.PI * 2;

      if (isFlower) {
        // Sparse crisp white / warm-cream wildflower specks.
        const warm = Math.random() < 0.5;
        const r = warm ? 0.95 : 0.94;
        const g = warm ? 0.85 : 0.9;
        const b = warm ? 0.6 : 0.9;
        baseColors[placed * 3 + 0] = r;
        baseColors[placed * 3 + 1] = g;
        baseColors[placed * 3 + 2] = b;
        tipColors[placed * 3 + 0] = Math.min(1, r + 0.03);
        tipColors[placed * 3 + 1] = Math.min(1, g + 0.03);
        tipColors[placed * 3 + 2] = Math.min(1, b + 0.03);
      } else {
        const shade = 0.85 + Math.random() * 0.35;
        baseColors[placed * 3 + 0] = BASE_R * shade;
        baseColors[placed * 3 + 1] = BASE_G * shade;
        baseColors[placed * 3 + 2] = BASE_B * shade;
        tipColors[placed * 3 + 0] = TIP_R * shade;
        tipColors[placed * 3 + 1] = TIP_G * shade;
        tipColors[placed * 3 + 2] = TIP_B * shade;
      }

      placed++;
    }

    this.mesh.count = placed;
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(baseColors, 3));
    geometry.setAttribute('aTip', new THREE.InstancedBufferAttribute(tipColors, 3));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.mesh.instanceMatrix.needsUpdate = true;
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

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
