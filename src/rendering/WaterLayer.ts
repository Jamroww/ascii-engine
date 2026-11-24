import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';
import { SDF_RANGE } from '../core/TerrainGrid';
import type { TerrainGrid } from '../core/TerrainGrid';

export interface WaterLight {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
}

const MAX_EXTRA_LIGHTS = 8;

const WATER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldPos;

  void main() {
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
  uniform float uCellSize;
  uniform sampler2D uTerrainMap;
  uniform float uWorldSize;
  uniform float uSdfRange;
  uniform float uWaterGlyphs[6];  // [ '.', ':', '-', '~', 'o', '*' ]
  uniform float uRockGlyphs[3];   // [ '#', '=', '.' ]
  uniform float uBlightGlyphs[4]; // [ '%', '?', '!', '#' ]
  uniform int uLightCount;
  uniform vec3 uLightPos[${MAX_EXTRA_LIGHTS}];   // x, y, radius
  uniform vec3 uLightColor[${MAX_EXTRA_LIGHTS}]; // r, g, b

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

  float sampleGlyph(float idx, vec2 cellUv) {
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);
    vec2 atlasUv = vec2(
      (col + cellUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
    );
    return texture2D(uAtlas, atlasUv).a;
  }

  // Signed distance to the curving river channel is read from the shared
  // TerrainGrid texture (R channel, 128 == shoreline).

  // Elongated downstream wake behind a boulder (current flows toward -Y)
  float rockWake(vec2 cellWorld, vec2 rockPos, float radius) {
    vec2 d = cellWorld - rockPos;
    float around = smoothstep(radius + 0.85, radius, length(d));
    // Trail stretches downward (-Y) behind the rock
    vec2 trailVec = vec2(d.x * 1.35, (d.y + radius * 1.4) * 0.42);
    float downstream = smoothstep(radius + 1.1, 0.1, length(trailVec)) * step(d.y, 0.2);
    return max(around, downstream * 0.85);
  }

  void main() {
    vec2 gridCoord = floor(vWorldPos / uCellSize);
    vec2 cellUv = fract(vWorldPos / uCellSize);
    vec2 cellWorld = (gridCoord + 0.5) * uCellSize;

    // Sample the shared terrain field (R = river SDF, G = blight, B = path).
    vec2 terrainUv = (cellWorld + uWorldSize * 0.5) / uWorldSize;
    vec4 terrainData = texture2D(uTerrainMap, terrainUv);

    // Decode the river signed distance field from the R channel (128 == shoreline).
    float edgeDist = (terrainData.r * 255.0 - 128.0) / 128.0 * uSdfRange;

    // 1. Clip to river channel
    if (edgeDist > 0.0) discard;

    // Deep obsidian river bed behind glyphs
    vec3 bedColor = vec3(0.015, 0.025, 0.042);

    // 2. Three faceted boulders with downstream wakes
    vec2 rock1 = vec2(6.8, -4.0);
    vec2 rock2 = vec2(5.2, 4.5);
    vec2 rock3 = vec2(8.0, 11.0);

    float dRock1 = length(cellWorld - rock1) - 1.15;
    float dRock2 = length(cellWorld - rock2) - 0.95;
    float dRock3 = length(cellWorld - rock3) - 1.30;
    float rockDist = min(dRock1, min(dRock2, dRock3));

    if (rockDist < 0.0) {
      // Pick active rock center for simple directional top-left shading
      vec2 activeRock = dRock1 < dRock2 ? (dRock1 < dRock3 ? rock1 : rock3)
                                        : (dRock2 < dRock3 ? rock2 : rock3);
      vec2 norm = normalize(cellWorld - activeRock + vec2(0.001));
      float lightDot = clamp(dot(norm, normalize(vec2(-0.6, 0.8))) * 0.5 + 0.5, 0.0, 1.0);

      float rockIdx = lightDot > 0.62 ? uRockGlyphs[0] : (lightDot > 0.32 ? uRockGlyphs[1] : uRockGlyphs[2]);
      float a = sampleGlyph(rockIdx, cellUv);
      if (a < 0.15) {
        gl_FragColor = vec4(0.03, 0.04, 0.055, 0.96);
        return;
      }

      vec3 stoneCol = mix(vec3(0.14, 0.17, 0.21), vec3(0.46, 0.52, 0.58), lightDot);
      float pDist = distance(cellWorld, uPlayerPos);
      float lantern = smoothstep(10.0, 0.5, pDist);
      stoneCol += vec3(0.28, 0.18, 0.08) * lantern * lightDot;

      gl_FragColor = vec4(stoneCol, 1.0);
      return;
    }

    // 3. Upstream Trace Blight factor (starts creeping in north of y = 7.5)
    float blightZone = terrainData.g;
    float blightPulse = noise(cellWorld * 0.55 + vec2(0.0, uTime * 0.9));
    float blightMask = blightZone * smoothstep(0.32, 0.72, blightPulse);

    // 4. Directional current ribbons + boulder wakes + player wading ripple
    vec2 flowUv = vec2(cellWorld.x * 0.75, cellWorld.y * 0.28 + uTime * 1.35);
    float ribbon = fbm(flowUv);
    float microRipple = noise(cellWorld * 1.4 + vec2(sin(uTime * 0.6) * 0.4, uTime * 2.1));

    float wake = max(
      rockWake(cellWorld, rock1, 1.15),
      max(rockWake(cellWorld, rock2, 0.95), rockWake(cellWorld, rock3, 1.30))
    );
    float bankFoam = smoothstep(-0.95, 0.0, edgeDist);

    // Expanding ripple rings when the player is near or wading in the river
    float playerDist = distance(cellWorld, uPlayerPos);
    float wadeRing = sin(playerDist * 5.0 - uTime * 5.5) * 0.5 + 0.5;
    float wadeWake = smoothstep(3.2, 0.3, playerDist) * wadeRing * 0.55;

    float energy = clamp(
      ribbon * 0.58 + microRipple * 0.28 + bankFoam * 0.42 + wake * 0.72 + wadeWake,
      0.0,
      1.0
    );

    // 5. Shimmering lantern & world-light reflections on the dark mirror surface
    float shimmer = sin(cellWorld.y * 3.2 + uTime * 4.5 + ribbon * 4.0) * 0.35;
    vec2 refPlayerPos = uPlayerPos + vec2(shimmer, -0.8);
    float playerRefDist = length((cellWorld - refPlayerPos) * vec2(1.15, 0.65));
    float flicker = 1.0 + sin(uTime * 6.5) * 0.03 + sin(uTime * 13.7) * 0.02;
    float lanternRef = smoothstep(7.5 * flicker, 0.4, playerRefDist);
    lanternRef *= lanternRef;

    vec3 extraRefColor = vec3(0.0);
    float extraRefStrength = 0.0;
    for (int i = 0; i < ${MAX_EXTRA_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec3 lp = uLightPos[i];
      float ld = length((cellWorld - (lp.xy + vec2(shimmer, -0.6))) * vec2(1.1, 0.65));
      float lf = smoothstep(lp.z * flicker, 0.3, ld);
      lf *= lf;
      extraRefColor += uLightColor[i] * lf;
      extraRefStrength += lf;
    }

    // Keep calm deep water dark and quiet unless a reflection or Blight artifact hits it
    float visibleThreshold = 0.36 - lanternRef * 0.18 - extraRefStrength * 0.18 - blightMask * 0.20;
    if (energy < visibleThreshold) {
      vec3 mirrorGlow = vec3(0.18, 0.10, 0.04) * lanternRef * 0.45 + extraRefColor * 0.25;
      gl_FragColor = vec4(bedColor + mirrorGlow, 0.94);
      return;
    }

    // 6. Choose clean water glyph vs. glitching upstream Blight glyph
    float idx = uWaterGlyphs[0];
    bool isBlightGlyph = false;

    if (blightMask > 0.42 && hash(gridCoord + floor(uTime * 3.5)) < blightMask * 0.65) {
      isBlightGlyph = true;
      int bSlot = int(floor(hash(gridCoord + floor(uTime * 5.0)) * 4.0));
      if (bSlot == 0) idx = uBlightGlyphs[0];
      else if (bSlot == 1) idx = uBlightGlyphs[1];
      else if (bSlot == 2) idx = uBlightGlyphs[2];
      else idx = uBlightGlyphs[3];
    } else {
      float normE = clamp((energy - visibleThreshold) / max(1.0 - visibleThreshold, 0.01), 0.0, 1.0);
      int gSlot = int(clamp(floor(normE * 6.0), 0.0, 5.0));
      if (gSlot == 1) idx = uWaterGlyphs[1];
      else if (gSlot == 2) idx = uWaterGlyphs[2];
      else if (gSlot == 3) idx = uWaterGlyphs[3];
      else if (gSlot == 4) idx = uWaterGlyphs[4];
      else if (gSlot >= 5) idx = uWaterGlyphs[5];
    }

    float glyphAlpha = sampleGlyph(idx, cellUv);
    if (glyphAlpha < 0.15) {
      gl_FragColor = vec4(bedColor, 0.94);
      return;
    }

    // 7. Color: dark slate-blue -> crisp pale foam -> warm #FF9900 reflection / Blight corruption
    vec3 deepWater = vec3(0.14, 0.24, 0.34);
    vec3 foamColor = vec3(0.68, 0.78, 0.86);
    vec3 waterColor = mix(deepWater, foamColor, smoothstep(0.50, 0.92, energy));

    // Apply warm #FF9900 lantern reflection (suppressed where Blight turns water into static)
    vec3 warmReflect = vec3(1.0, 0.62, 0.18);
    float cleanReflect = (1.0 - blightMask * 0.8);
    waterColor = mix(waterColor, warmReflect, clamp(lanternRef * 0.78 * cleanReflect, 0.0, 0.85));
    waterColor += extraRefColor * 0.65 * cleanReflect;

    // Apply toxic green/violet Blight tint upstream
    if (isBlightGlyph) {
      float violetMix = hash(gridCoord * 1.7 + floor(uTime * 2.0));
      vec3 blightCol = mix(vec3(0.24, 0.88, 0.42), vec3(0.62, 0.24, 0.86), violetMix);
      waterColor = blightCol;
    } else if (blightMask > 0.1) {
      waterColor = mix(waterColor, vec3(0.18, 0.42, 0.28), blightMask * 0.55);
    }

    float brightness = 0.48 + lanternRef * 0.75 + extraRefStrength * 0.65 + (isBlightGlyph ? 0.45 : 0.0);
    gl_FragColor = vec4(waterColor * brightness, 1.0);
  }
`;

export class WaterLayer implements IRenderLayer {
  public readonly object3D: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(atlas: GlyphAtlas, terrain: TerrainGrid, areaSize = 60, cellSize = 0.32) {
    const geometry = new THREE.PlaneGeometry(areaSize, areaSize);

    const waterGlyphs = [
      atlas.getIndex('.'),
      atlas.getIndex(':'),
      atlas.getIndex('-'),
      atlas.getIndex('~'),
      atlas.getIndex('o'),
      atlas.getIndex('*'),
    ];

    const rockGlyphs = [
      atlas.getIndex('#'),
      atlas.getIndex('='),
      atlas.getIndex('.'),
    ];

    const blightGlyphs = [
      atlas.getIndex('%'),
      atlas.getIndex('?'),
      atlas.getIndex('!'),
      atlas.getIndex('#'),
    ];

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uCellSize: { value: cellSize },
        uTerrainMap: { value: terrain.texture },
        uWorldSize: { value: terrain.worldSize },
        uSdfRange: { value: SDF_RANGE },
        uWaterGlyphs: { value: waterGlyphs },
        uRockGlyphs: { value: rockGlyphs },
        uBlightGlyphs: { value: blightGlyphs },
        uLightCount: { value: 0 },
        uLightPos: {
          value: Array.from({ length: MAX_EXTRA_LIGHTS }, () => new THREE.Vector3()),
        },
        uLightColor: {
          value: Array.from({ length: MAX_EXTRA_LIGHTS }, () => new THREE.Vector3()),
        },
      },
      transparent: true,
      depthWrite: false,
    });

    this.object3D = new THREE.Mesh(geometry, this.material);
    this.object3D.position.z = 0.55;
  }

  public setLights(lights: WaterLight[]): void {
    const count = Math.min(lights.length, MAX_EXTRA_LIGHTS);
    this.material.uniforms.uLightCount.value = count;
    const posArr = this.material.uniforms.uLightPos.value as THREE.Vector3[];
    const colArr = this.material.uniforms.uLightColor.value as THREE.Vector3[];

    for (let i = 0; i < count; i++) {
      const l = lights[i];
      posArr[i].set(l.x, l.y, l.radius);
      colArr[i].set(l.r, l.g, l.b);
    }
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