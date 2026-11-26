import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import type { WeatherMode } from '../core/LevelTheme';
import { GlyphAtlas } from './GlyphAtlas';

const WEATHER_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aSpeed;
  attribute float aGlyphIndex;
  attribute vec3 aColor;
  attribute float aType; // 0.0 = rain, 1.0 = firefly/spore, 2.0 = falling petal

  uniform float uTime;
  uniform vec2 uPlayerPos;
  uniform vec2 uBounds;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;

    vec2 pos = aOffset.xy;

    if (aType < 0.5) {
      // Diagonal falling rain.
      pos.x -= uTime * aSpeed * 0.35;
      pos.y -= uTime * aSpeed;
      vAlpha = 0.55;
    } else if (aType < 1.5) {
      // Slow drifting fireflies / spores.
      pos.x += sin(uTime * 0.8 + aOffset.z * 6.28) * 1.4;
      pos.y += cos(uTime * 0.6 + aOffset.z * 6.28) * 1.1;
      vAlpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 3.0 + aOffset.z * 12.0));
    } else {
      // Wilted petals: flutter down with a side-to-side sway.
      pos.y -= uTime * aSpeed * 0.22;
      pos.x += sin(uTime * 1.2 + aOffset.z * 6.28) * 1.8;
      vAlpha = 0.85;
    }

    // Wrap particles seamlessly around the player so weather is infinite, then
    // map the 2D gameplay position into the tilted 3D world (x, height, -gy).
    vec2 rel = mod(pos - uPlayerPos + uBounds * 0.5, uBounds) - uBounds * 0.5;
    vec3 worldCenter = vec3(uPlayerPos.x + rel.x, 2.5, -(uPlayerPos.y + rel.y));

    vec4 worldPosition = vec4(worldCenter + vec3(position.x, position.y, 0.0), 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const WEATHER_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float idx = floor(vGlyphIndex + 0.5);
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + vUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - vUv.y) / uAtlasGrid.y)
    );

    float glyphAlpha = texture2D(uAtlas, atlasUv).a;
    if (glyphAlpha < 0.15) discard;

    gl_FragColor = vec4(vColor, glyphAlpha * vAlpha);
  }
`;

export class WeatherLayer implements IRenderLayer {
  public readonly object3D: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(atlas: GlyphAtlas, mode: WeatherMode = 'rain', rainCount = 760, sporeCount = 170, petalCount = 85) {
    const total = rainCount + sporeCount + petalCount;
    const boundsX = 48;
    const boundsY = 48;
    const petals = mode === 'petals';

    const geometry = new THREE.PlaneGeometry(0.42, 0.72);
    const offsets = new Float32Array(total * 3);
    const speeds = new Float32Array(total);
    const glyphIndices = new Float32Array(total);
    const colors = new Float32Array(total * 3);
    const types = new Float32Array(total);

    // The density ramp dropped the apostrophe, so rain falls as a thin colon
    // droplet; spores and petals use the same chars as before.
    const rainIdx = atlas.getIndex(':');
    const sporeIdx = atlas.getIndex('.');
    const petalIdx = atlas.getIndex('*');

    for (let i = 0; i < total; i++) {
      offsets[i * 3 + 0] = (Math.random() - 0.5) * boundsX;
      offsets[i * 3 + 1] = (Math.random() - 0.5) * boundsY;
      offsets[i * 3 + 2] = Math.random();

      if (i < rainCount) {
        types[i] = 0.0;
        speeds[i] = petals ? 2.0 + Math.random() * 3.0 : 14.0 + Math.random() * 8.0;
        glyphIndices[i] = rainIdx;
        colors[i * 3 + 0] = petals ? 0.95 : 0.55;
        colors[i * 3 + 1] = petals ? 0.72 : 0.68;
        colors[i * 3 + 2] = petals ? 0.42 : 0.82;
      } else if (i < rainCount + sporeCount) {
        types[i] = 1.0;
        speeds[i] = 1.0;
        glyphIndices[i] = sporeIdx;
        colors[i * 3 + 0] = petals ? 0.88 : 0.5;
        colors[i * 3 + 1] = petals ? 0.44 : 0.6;
        colors[i * 3 + 2] = petals ? 0.2 : 0.3;
      } else {
        types[i] = 2.0;
        speeds[i] = 0.6 + Math.random() * 0.8;
        glyphIndices[i] = petalIdx;
        colors[i * 3 + 0] = petals ? 0.78 : 0.5;
        colors[i * 3 + 1] = petals ? 0.26 : 0.28;
        colors[i * 3 + 2] = petals ? 0.2 : 0.26;
      }
    }

    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aType', new THREE.InstancedBufferAttribute(types, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: WEATHER_VERTEX_SHADER,
      fragmentShader: WEATHER_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uBounds: { value: new THREE.Vector2(boundsX, boundsY) },
      },
      transparent: true,
      depthWrite: false,
    });

    this.object3D = new THREE.InstancedMesh(geometry, this.material, total);
    this.object3D.frustumCulled = false;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uTime.value = ctx.elapsed;
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}
