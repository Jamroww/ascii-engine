import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';

const WATER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xy;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform float uTime;
  uniform vec2 uPlayerPos;
  uniform vec2 uPlaneSize;
  uniform float uCellSize;
  uniform float uWaterGlyphs[6]; // [ '.', '-', '~', '=', 'o', '*' ]

  varying vec2 vUv;
  varying vec2 vWorldPos;

  // Lightweight 2D value noise for organic water currents
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

  // Signed distance to a curving diagonal river channel
  float riverSDF(vec2 p) {
    float curve = sin(p.y * 0.14) * 3.2 + cos(p.y * 0.07) * 1.5;
    float centerX = 6.5 + curve;
    float halfWidth = 3.8 + sin(p.y * 0.22) * 0.6;
    return abs(p.x - centerX) - halfWidth;
  }

  void main() {
    // 1. Quantize world space into a crisp ASCII character grid
    vec2 gridCoord = floor(vWorldPos / uCellSize);
    vec2 cellUv = fract(vWorldPos / uCellSize);
    vec2 cellWorld = (gridCoord + 0.5) * uCellSize;

    // 2. Check if this cell is inside the river
    float edgeDist = riverSDF(cellWorld);
    if (edgeDist > 0.0) discard;

    // 3. Three procedural boulders in the river that create foam wakes
    vec2 rock1 = vec2(6.8, -4.0);
    vec2 rock2 = vec2(5.2, 4.5);
    vec2 rock3 = vec2(8.0, 11.0);

    float dRock1 = length(cellWorld - rock1) - 1.15;
    float dRock2 = length(cellWorld - rock2) - 0.95;
    float dRock3 = length(cellWorld - rock3) - 1.3;
    float rockDist = min(dRock1, min(dRock2, dRock3));

    // Render dark solid rock silhouette if inside a boulder
    if (rockDist < 0.0) {
      float rockIdx = uWaterGlyphs[3]; // '=' dense stone texture
      float col = mod(rockIdx, uAtlasGrid.x);
      float row = floor(rockIdx / uAtlasGrid.x);
      vec2 atlasUv = vec2(
        (col + cellUv.x) / uAtlasGrid.x,
        1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
      );
      float a = texture2D(uAtlas, atlasUv).a;
      if (a < 0.15) discard;
      float shade = smoothstep(-1.2, 0.0, rockDist);
      gl_FragColor = vec4(vec3(0.28, 0.34, 0.40) * (0.55 + shade * 0.6), a);
      return;
    }

    // 4. Flowing current noise (scrolls downward along Y)
    vec2 flowUv = cellWorld * 0.45 + vec2(0.0, uTime * 1.45);
    float current = fbm(flowUv);
    float ripple = noise(cellWorld * 1.2 + vec2(uTime * 0.4, uTime * 2.3));

    // Foam intensifies near river banks and right around boulders
    float bankFoam = smoothstep(-1.1, 0.0, edgeDist);
    float rockFoam = smoothstep(1.2, 0.0, rockDist);
    float energy = clamp(current * 0.65 + ripple * 0.35 + bankFoam * 0.45 + rockFoam * 0.75, 0.0, 1.0);

    // Leave occasional dark gaps in calm deep water so it feels like @glyph.realms
    if (energy < 0.28) {
      gl_FragColor = vec4(0.02, 0.04, 0.07, 0.92);
      return;
    }

    // 5. Pick glyph from calm ('.', '-') to turbulent ('~', '=', 'o', '*')
    int gSlot = int(clamp(floor((energy - 0.28) / 0.72 * 6.0), 0.0, 5.0));
    float idx = uWaterGlyphs[0];
    if (gSlot == 1) idx = uWaterGlyphs[1];
    else if (gSlot == 2) idx = uWaterGlyphs[2];
    else if (gSlot == 3) idx = uWaterGlyphs[3];
    else if (gSlot == 4) idx = uWaterGlyphs[4];
    else if (gSlot >= 5) idx = uWaterGlyphs[5];

    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + cellUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
    );

    float glyphAlpha = texture2D(uAtlas, atlasUv).a;

    // Dark river bed behind the water glyphs so grass doesn't poke through
    vec3 bedColor = vec3(0.02, 0.04, 0.07);

    if (glyphAlpha < 0.15) {
      gl_FragColor = vec4(bedColor, 0.92);
      return;
    }

    // 6. Color: deep slate blue -> pale cyan/white foam + warm torch glint
    vec3 deepWater = vec3(0.18, 0.36, 0.52);
    vec3 foamColor = vec3(0.78, 0.88, 0.96);
    vec3 waterColor = mix(deepWater, foamColor, smoothstep(0.45, 0.92, energy));

    float dist = distance(cellWorld, uPlayerPos);
    float torchGlint = smoothstep(10.5, 0.8, dist);
    vec3 warmReflect = vec3(1.0, 0.76, 0.45);
    waterColor = mix(waterColor, warmReflect, torchGlint * 0.45 * energy);

    gl_FragColor = vec4(waterColor * (0.45 + torchGlint * 0.85), 1.0);
  }
`;

export class WaterLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(atlas: GlyphAtlas, areaSize = 60, cellSize = 0.42) {
    const geometry = new THREE.PlaneGeometry(areaSize, areaSize);

    const waterGlyphs = [
      atlas.getIndex('.'),
      atlas.getIndex('-'),
      atlas.getIndex('~'),
      atlas.getIndex('='),
      atlas.getIndex('o'),
      atlas.getIndex('*'),
    ];

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uPlaneSize: { value: new THREE.Vector2(areaSize, areaSize) },
        uCellSize: { value: cellSize },
        uWaterGlyphs: { value: waterGlyphs },
      },
      transparent: true,
      depthWrite: false,
    });

    this.object3D = new THREE.Mesh(geometry, this.material);
    // Sits above GroundLayer (0) and GrassLayer (0.2..0.5), below Character (1.2)
    this.object3D.position.z = 0.55;
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