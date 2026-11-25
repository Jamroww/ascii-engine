import * as THREE from 'three';
import type { TerrainGrid } from '../core/TerrainGrid';
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

    float path = t.b;
    float blight = t.g;

    // Mossy slate earth with subtle elevation contours.
    float n = fbm(vWorld * 0.38 + vec2(5.2, -3.7));
    float bands = floor(n * 5.0);
    float frac = fract(n * 5.0);
    vec3 moss = vec3(0.10, 0.20, 0.16) * (0.8 + n * 0.4);
    if (frac < 0.12) moss *= 1.15; // faint contour highlight

    // Warm damp packed-earth footpath.
    vec3 dirt = vec3(0.34, 0.23, 0.13) * (0.85 + n * 0.3);
    vec3 col = mix(moss, dirt, smoothstep(0.55, 0.95, path));

    // Subtle cold blight tint where corrupted.
    vec3 blightCol = vec3(0.08, 0.14, 0.10);
    col = mix(col, blightCol, blight * 0.35);

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
