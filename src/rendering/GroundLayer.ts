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

    // Wild deep-forest floor stays dark and cool so the 3D grass tufts still pop
    // cleanly against a faint moonlit ground instead of a flat black floor.
    vec3 col = mix(vec3(0.015, 0.020, 0.024), vec3(0.023, 0.031, 0.037), grain);

    // Moonlit village clearing / trail: subtle cool-slate elevation contour bands.
    float cleared = smoothstep(0.0, 0.5, path);
    float elev = fbm(vWorld * 0.22 + vec2(8.0, -1.4));
    float bandF = fract(elev * 2.6);
    float band = smoothstep(0.0, 0.5, bandF) * (1.0 - smoothstep(0.5, 1.0, bandF));
    col += vec3(0.05, 0.066, 0.085) * band * cleared;

    // Warm damp-earth footpath (the packed-dirt path band).
    float pathBand = smoothstep(0.6, 0.95, path);
    vec3 dirt = vec3(0.16, 0.115, 0.072) * (0.55 + n * 0.6);
    col = mix(col, dirt, pathBand * 0.9);

    // Rocky shoreline lips hugging the riverbank (sdf 0.0 .. +1.2) that read
    // cleanly around and between the grass tufts.
    float shore = 1.0 - smoothstep(0.0, 1.2, edgeDist);
    float rockGrain = fbm(vWorld * 1.5 + vec2(-4.4, 7.8));
    vec3 shoreCol = vec3(0.075, 0.095, 0.115) * (0.6 + rockGrain * 0.55);
    col = mix(col, shoreCol, shore * 0.8);

    // Cold blight tint where corrupted.
    col = mix(col, vec3(0.04, 0.09, 0.06), blight * 0.3);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GroundLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(terrain: TerrainGrid, areaSize = 60) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERTEX_SHADER,
      fragmentShader: GROUND_FRAGMENT_SHADER,
      uniforms: {
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uSdfRange: { value: SDF_RANGE },
      },
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(areaSize, areaSize);
    this.object3D = new THREE.Mesh(geometry, this.material);
    this.object3D.rotation.x = -Math.PI / 2;
    this.object3D.position.y = 0;
    this.object3D.receiveShadow = true;
  }

  public update(_ctx: FrameContext): void {}

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
