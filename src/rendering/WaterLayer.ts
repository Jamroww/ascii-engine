import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { SDF_RANGE } from '../core/TerrainGrid';
import type { TerrainGrid } from '../core/TerrainGrid';

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

    // Smooth obsidian dark-water base.
    vec3 col = vec3(0.012, 0.020, 0.031);

    // Subtle animated ripples / current ribbons.
    float ripple = fbm(vWorld * 0.6 + vec2(0.0, uTime * 0.8));
    float sheen = sin(vWorld.x * 3.0 + uTime * 1.5) * 0.5 + 0.5;
    col += vec3(0.02, 0.03, 0.045) * (ripple * 0.5 + sheen * 0.05);

    // Upstream blight tint (toxic green / violet) from the G channel.
    vec3 blightCol = mix(vec3(0.10, 0.30, 0.18), vec3(0.20, 0.10, 0.32), 0.5);
    col = mix(col, blightCol, blight * 0.45);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class WaterLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(terrain: TerrainGrid, areaSize = 60) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uSdfRange: { value: SDF_RANGE },
        uTime: { value: 0 },
      },
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(areaSize, areaSize);
    this.object3D = new THREE.Mesh(geometry, this.material);
    this.object3D.rotation.x = -Math.PI / 2;
    this.object3D.position.y = -0.05;
    this.object3D.receiveShadow = true;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
