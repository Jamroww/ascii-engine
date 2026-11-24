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
  uniform float uLanternRadius;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec2 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    float dist = distance(vWorldPos, uPlayerPos);

    // Warm radial lantern pool centred on the player, breathing gently.
    float radius = uLanternRadius + sin(uTime * 1.3) * 0.6;
    float lantern = 1.0 - smoothstep(0.0, radius, dist);
    float warmGlow = lantern * lantern;

    // Outer fog: moody cool-slate darkness creeping in past the lantern pool.
    float fog = smoothstep(uFogNear, uFogFar, dist);

    // Softened screen-space vignette for the viewport corners.
    vec2 rel = (vWorldPos - uPlayerPos) / uViewSize;
    float edge = max(abs(rel.x), abs(rel.y));
    float corner = smoothstep(0.38, 0.62, edge);

    // The lantern clears darkness near the player; keep the outer fade gentle.
    float dark = clamp(max(fog, corner) * (1.0 - lantern * 0.55), 0.0, 0.8);

    // Cool slate in the dark, warmed by a faint amber wash under the lantern.
    vec3 color = vec3(0.022, 0.042, 0.068);
    color += vec3(1.0, 0.50, 0.18) * warmGlow * 0.18;

    float dither = hash(gl_FragCoord.xy) * 0.03 - 0.015;
    float alpha = clamp(dark + dither + warmGlow * 0.05, 0.0, 0.84);

    gl_FragColor = vec4(color, alpha);
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
        uLanternRadius: { value: 10.0 },
        uFogNear: { value: 11.0 },
        uFogFar: { value: 30.0 },
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
    // Scale the lantern pool and fog with the view so the clearing stays open
    // and legible at the finer zoomed-out scale instead of a cramped circle.
    this.material.uniforms.uLanternRadius.value = worldHeight * 0.5;
    this.material.uniforms.uFogNear.value = worldHeight * 0.55;
    this.material.uniforms.uFogFar.value = worldHeight * 1.5;
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
