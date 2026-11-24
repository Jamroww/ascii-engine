import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';

const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xy;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uPlayerPos;
  uniform vec2 uViewSize;
  uniform float uTime;

  varying vec2 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    // 1. Gentle radial falloff: a soft circle of clarity around the player.
    float dist = distance(vWorldPos, uPlayerPos);
    float pool = smoothstep(14.0, 6.0, dist) * 0.32;

    // 2. Far fade that swallows the treeline and hides the ground's edge.
    float fog = smoothstep(19.0, 34.0, dist);

    // 3. Screen-space vignette that darkens the corners of the viewport.
    vec2 rel = (vWorldPos - uPlayerPos) / uViewSize;
    float edge = max(abs(rel.x), abs(rel.y));
    float corner = smoothstep(0.30, 0.52, edge) * 0.9;

    float alpha = clamp(max(pool + fog, corner), 0.0, 0.88);

    // Gentle dithering so the gradient keeps the coarse, printed feel.
    float dither = hash(gl_FragCoord.xy) * 0.04 - 0.02;
    alpha = clamp(alpha + dither, 0.0, 0.9);

    // Faint blue-green darkness rather than pure black, to match the moss palette.
    vec3 fogColor = vec3(0.014, 0.021, 0.028);
    gl_FragColor = vec4(fogColor, alpha);
  }
`;

export class AtmosphereLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(size = 160) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      uniforms: {
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uViewSize: { value: new THREE.Vector2(20, 20) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.object3D = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.material);
    this.object3D.position.z = 5;
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = 1000;
  }

  public setViewport(worldWidth: number, worldHeight: number): void {
    this.material.uniforms.uViewSize.value.set(worldWidth, worldHeight);
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
