import * as THREE from 'three';
import type { TerrainGrid } from '../core/TerrainGrid';
import { SDF_RANGE } from '../core/TerrainGrid';
import type { FrameContext, IRenderLayer } from '../core/types';

const GROUND_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(world.x, -world.z);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GROUND_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTerrainMap;
  uniform float uWorldSize;
  uniform float uSdfRange;
  uniform vec3 uBaseTint;

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
      p *= 2.0;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = (vWorld + uWorldSize * 0.5) / uWorldSize;
    vec4 t = texture2D(uTerrainMap, uv);

    // Leave the river channel open so the water plane below shows through.
    float riverByte = t.r * 255.0;
    if (riverByte < 128.0) discard;

    float edgeDist = (riverByte - 128.0) / 128.0 * uSdfRange;
    float path = t.b;
    float blight = t.g;

    float n = fbm(vWorld * 0.38 + vec2(5.2, -3.7));
    float grain = fbm(vWorld * 0.85 + vec2(-2.3, 6.1));

    // Soil directly beneath the grass stays deep shadow so the meadow reads
    // over darkness without grey noise bleeding up through the blades.
    vec3 col = mix(vec3(0.008, 0.011, 0.014), vec3(0.012, 0.016, 0.020), grain);

    // Moonlit village clearing / trail: subtle cool-slate elevation contour bands.
    float cleared = smoothstep(0.0, 0.5, path);
    float elev = fbm(vWorld * 0.22 + vec2(8.0, -1.4));
    float bandF = fract(elev * 2.6);
    float band = smoothstep(0.0, 0.5, bandF) * (1.0 - smoothstep(0.5, 1.0, bandF));
    col += vec3(0.05, 0.066, 0.085) * band * cleared;

    // Warm damp-earth footpath: crisp pebbles, ruts and earth banding so the
    // packed-dirt path reads immediately against the grass.
    float pathBand = smoothstep(0.6, 0.95, path);
    float rut = 0.5 + 0.5 * sin(vWorld.y * 0.9 + fbm(vWorld * 0.7) * 6.0);
    float pebble = fbm(vWorld * 4.5 + vec2(1.7, -2.9));
    vec3 dirt = vec3(0.17, 0.125, 0.078) * (0.5 + n * 0.45 + pebble * 0.18 + rut * 0.12);
    col = mix(col, dirt, pathBand * 0.95);

    // Stony riverbank edges: tactile pebbled banding hugging the shore.
    float shore = 1.0 - smoothstep(0.0, 1.2, edgeDist);
    float rockGrain = fbm(vWorld * 1.5 + vec2(-4.4, 7.8));
    float pebbleShore = fbm(vWorld * 3.2 + vec2(2.8, 5.1));
    vec3 shoreCol = vec3(0.085, 0.108, 0.132) * (0.55 + rockGrain * 0.4 + pebbleShore * 0.28);
    col = mix(col, shoreCol, shore * 0.85);

    // Cold blight tint where corrupted.
    col = mix(col, vec3(0.04, 0.09, 0.06), blight * 0.3);

    // Warm sunset dry-earth tint (white = no change for Level 1).
    col *= uBaseTint;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GroundLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(terrain: TerrainGrid, areaSize?: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERTEX_SHADER,
      fragmentShader: GROUND_FRAGMENT_SHADER,
      uniforms: {
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uSdfRange: { value: SDF_RANGE },
        uBaseTint: { value: new THREE.Color(1, 1, 1) },
      },
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(areaSize ?? terrain.worldSize, areaSize ?? terrain.worldSize);
    this.object3D = new THREE.Mesh(geometry, this.material);
    this.object3D.rotation.x = -Math.PI / 2;
    this.object3D.position.y = 0;
    this.object3D.receiveShadow = true;
  }

  public update(_ctx: FrameContext): void {}

  /** Warm dry-earth multiplier tint for the arena (white = no change). */
  public setBaseTint(color: THREE.Color): void {
    (this.material.uniforms.uBaseTint.value as THREE.Color).copy(color);
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
