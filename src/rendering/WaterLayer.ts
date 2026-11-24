import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import { BOULDERS, RIVER } from '../core/world';

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

// The river shape + boulders are injected from core/world.ts so CPU collision
// and GPU rendering can never drift apart.
function buildWaterFragmentShader(): string {
  const boulderDecls = BOULDERS.map(
    (b, i) => `    vec2 rock${i + 1} = vec2(${b.x.toFixed(3)}, ${b.y.toFixed(3)});`
  ).join('\n');
  const boulderDists = BOULDERS.map(
    (b, i) => `    float dRock${i + 1} = length(cellWorld - rock${i + 1}) - ${b.r.toFixed(3)};`
  ).join('\n');

  let rockMin = '1000.0';
  for (let i = 0; i < BOULDERS.length; i++) {
    rockMin = rockMin === '1000.0' ? `dRock${i + 1}` : `min(${rockMin}, dRock${i + 1})`;
  }

  const boulderBlock = BOULDERS.length
    ? `${boulderDecls}\n${boulderDists}\n    float rockDist = ${rockMin};`
    : '    float rockDist = 1000.0;';

  const river = RIVER;

  return /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform float uTime;
  uniform vec2 uPlayerPos;
  uniform float uCellSize;
  uniform float uWaterGlyphs[6];

  varying vec2 vUv;
  varying vec2 vWorldPos;

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

  // Signed distance to the curving river channel (<= 0 inside).
  float riverSDF(vec2 p) {
    float curve = sin(p.y * ${river.curveFreqA.toFixed(4)}) * ${river.curveAmpA.toFixed(3)}
                + cos(p.y * ${river.curveFreqB.toFixed(4)}) * ${river.curveAmpB.toFixed(3)};
    float centerX = ${river.baseX.toFixed(3)} + curve;
    float halfWidth = ${river.halfWidthBase.toFixed(3)}
                    + sin(p.y * ${river.halfWidthFreq.toFixed(4)}) * ${river.halfWidthAmp.toFixed(3)};
    return abs(p.x - centerX) - halfWidth;
  }

  void main() {
    vec2 gridCoord = floor(vWorldPos / uCellSize);
    vec2 cellUv = fract(vWorldPos / uCellSize);
    vec2 cellWorld = (gridCoord + 0.5) * uCellSize;

    float edgeDist = riverSDF(cellWorld);
    if (edgeDist > 0.0) discard;

    ${boulderBlock}

    // Solid dark boulder silhouettes with a soft highlight.
    if (rockDist < 0.0) {
      float rockIdx = uWaterGlyphs[3];
      float col = mod(rockIdx, uAtlasGrid.x);
      float row = floor(rockIdx / uAtlasGrid.x);
      vec2 atlasUv = vec2(
        (col + cellUv.x) / uAtlasGrid.x,
        1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
      );
      float a = texture2D(uAtlas, atlasUv).a;
      if (a < 0.15) discard;
      float shade = smoothstep(-1.2, 0.0, rockDist);
      gl_FragColor = vec4(vec3(0.28, 0.34, 0.40) * (0.5 + shade * 0.65), a);
      return;
    }

    // Flowing current (scrolls downstream) + fine ripple texture.
    vec2 flowUv = cellWorld * 0.45 + vec2(0.0, uTime * 1.6);
    float current = fbm(flowUv);
    float ripple = noise(cellWorld * 1.2 + vec2(uTime * 0.4, uTime * 2.3));

    float bankFoam = smoothstep(-1.1, 0.0, edgeDist);
    float rockFoam = smoothstep(1.4, 0.0, rockDist);

    // Wading player: expanding ripple rings + a wake of foam at the feet.
    float playerSdf = riverSDF(uPlayerPos);
    float wading = smoothstep(0.7, -0.7, playerSdf);
    float pDist = distance(cellWorld, uPlayerPos);
    float ring = sin(pDist * 9.0 - uTime * 5.0) * exp(-pDist * 1.6);
    float wake = wading * (smoothstep(1.7, 0.0, pDist) * 0.8 + clamp(ring, 0.0, 1.0) * 0.5);

    // Reflected torchlight: a warm streak shimmering downstream from the player.
    float dist = distance(cellWorld, uPlayerPos);
    float torchGlint = smoothstep(12.0, 0.8, dist);
    float streak = exp(
      -abs(cellWorld.x - uPlayerPos.x) * 0.9 - abs(cellWorld.y - uPlayerPos.y) * 0.22
    );
    streak *= 0.55 + 0.45 * noise(cellWorld * 2.0 + vec2(uTime * 0.5, -uTime * 1.2));

    // Slow moving reflected light patches (a pale "cloud" sheen).
    float sheen = fbm(cellWorld * 0.35 + vec2(uTime * 0.2, -uTime * 0.12));

    float energy = clamp(
      current * 0.55 + ripple * 0.25 + bankFoam * 0.4 + rockFoam * 0.7
      + wake * 0.9 + sheen * 0.3 + streak * 0.5,
      0.0, 1.0
    );

    // Deep calm pockets read as near-black gaps.
    if (energy < 0.24) {
      gl_FragColor = vec4(0.02, 0.04, 0.07, 0.92);
      return;
    }

    int gSlot = int(clamp(floor((energy - 0.24) / 0.76 * 6.0), 0.0, 5.0));
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

    vec3 bedColor = vec3(0.02, 0.04, 0.07);
    if (glyphAlpha < 0.15) {
      gl_FragColor = vec4(bedColor, 0.92);
      return;
    }

    vec3 deepWater = vec3(0.16, 0.33, 0.48);
    vec3 foamColor = vec3(0.76, 0.87, 0.95);
    vec3 waterColor = mix(deepWater, foamColor, smoothstep(0.45, 0.92, energy));

    // Warm torch reflection + cool sky sheen.
    waterColor = mix(waterColor, vec3(1.0, 0.72, 0.40), torchGlint * 0.5 * energy);
    waterColor = mix(waterColor, vec3(0.62, 0.78, 0.92), sheen * 0.25);

    float bright = 0.42 + torchGlint * 0.9 + wake * 0.3;
    gl_FragColor = vec4(waterColor * bright, 1.0);
  }
`;
}

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
      fragmentShader: buildWaterFragmentShader(),
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uCellSize: { value: cellSize },
        uWaterGlyphs: { value: waterGlyphs },
      },
      transparent: true,
      depthWrite: false,
    });

    this.object3D = new THREE.Mesh(geometry, this.material);
    // Sits above GroundLayer (0) and GrassLayer (0.2..0.5), below Character (1.2).
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
