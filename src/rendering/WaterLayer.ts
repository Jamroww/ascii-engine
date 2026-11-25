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
  uniform float uMoonGlyphs[9];   // sparse -> dense: [ '-', '+', 'o', 'O', '0', '8', '%', '#', '@' ]
  uniform float uCloudGlyphs[4];  // [ '.', ',', ':', '~' ]
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

    // Pure-black obsidian mirror base (#030508) so reflected glyphs pop.
    vec3 bedColor = vec3(0.012, 0.020, 0.031);

    // 2. Three faceted boulders with downstream wakes
    vec2 rock1 = vec2(6.8, -4.0);
    vec2 rock2 = vec2(5.2, 4.5);
    vec2 rock3 = vec2(8.0, 11.0);

    float dRock1 = length(cellWorld - rock1) - 1.15;
    float dRock2 = length(cellWorld - rock2) - 0.95;
    float dRock3 = length(cellWorld - rock3) - 1.30;
    float rockDist = min(dRock1, min(dRock2, dRock3));

    if (rockDist < 0.0) {
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
    //    (kept subtle on the mirror surface).
    vec2 flowUv = vec2(cellWorld.x * 0.75, cellWorld.y * 0.28 + uTime * 1.35);
    float ribbon = fbm(flowUv);
    float microRipple = noise(cellWorld * 1.4 + vec2(sin(uTime * 0.6) * 0.4, uTime * 2.1));

    float wake = max(
      rockWake(cellWorld, rock1, 1.15),
      max(rockWake(cellWorld, rock2, 0.95), rockWake(cellWorld, rock3, 1.30))
    );
    float bankFoam = smoothstep(-1.5, 0.0, edgeDist);

    float playerDist = distance(cellWorld, uPlayerPos);
    float wadeRing = sin(playerDist * 5.0 - uTime * 5.5) * 0.5 + 0.5;
    float wadeWake = smoothstep(3.2, 0.3, playerDist) * wadeRing * 0.55;

    float energy = clamp(
      ribbon * 0.5 + microRipple * 0.22 + bankFoam * 0.55 + wake * 0.6 + wadeWake,
      0.0,
      1.0
    );

    // --- Reflected ASCII moon -------------------------------------------------
    // Parallax: the moon drifts gently (30% of player movement) as you walk the
    // riverbank. Horizontally rippled by a slow sine so the disc shimmers.
    vec2 moonCenter = vec2(7.0, -2.0) + uPlayerPos * 0.30;
    float moonRipple = sin(cellWorld.y * 2.2 + uTime * 0.55) * 0.42
                     + sin(cellWorld.y * 4.6 - uTime * 0.8) * 0.16;
    vec2 moonD = cellWorld - moonCenter;
    moonD.x -= moonRipple;
    float moonR = 2.9;
    float moonDist = length(moonD);
    float moonEdge = 1.0 - smoothstep(moonR * 0.80, moonR, moonDist);

    // Procedural crater noise -> glyph density across the moon disc.
    vec2 moonUv = moonD / moonR;
    float crater = fbm(moonUv * 2.6 + vec2(3.1, -1.4));
    float moonDensity = clamp(crater * 0.62 + (1.0 - moonDist / moonR) * 0.38, 0.0, 1.0);

    // --- Drifting reflected clouds -------------------------------------------
    vec2 cloudUv = cellWorld * 0.22 + vec2(uTime * 0.10, uTime * 0.03);
    float cloud = smoothstep(0.48, 0.72, fbm(cloudUv));

    // Moon brightness veiled by drifting clouds.
    float moonBright = moonEdge * (0.55 + moonDensity * 0.45) * (1.0 - cloud * 0.55);

    // --- Warm light reflections (lantern + cottage/lantern lights) ------------
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

    // --- Shoreline reflection band (muted bank/foliage, fading inward) --------
    float shore = smoothstep(0.02, -0.4, edgeDist) * (1.0 - smoothstep(-3.6, -1.1, edgeDist));

    // --- Glyph + colour selection (priority: blight > moon > light > shore > cloud > flow)
    vec3 color = bedColor;
    float idx = uWaterGlyphs[0];
    float brightness = 1.0;
    bool drew = false;

    if (blightMask > 0.42 && hash(gridCoord + floor(uTime * 3.5)) < blightMask * 0.65) {
      // Toxic green/violet upstream Blight: static that overrides the mirror.
      int bSlot = int(floor(hash(gridCoord + floor(uTime * 5.0)) * 4.0));
      if (bSlot == 0) idx = uBlightGlyphs[0];
      else if (bSlot == 1) idx = uBlightGlyphs[1];
      else if (bSlot == 2) idx = uBlightGlyphs[2];
      else idx = uBlightGlyphs[3];
      float violetMix = hash(gridCoord * 1.7 + floor(uTime * 2.0));
      color = mix(vec3(0.24, 0.88, 0.42), vec3(0.62, 0.24, 0.86), violetMix);
      brightness = 1.3;
      drew = true;
    } else if (moonBright > 0.04) {
      // Reflected moon: bright silver-white disc, density-mapped through the atlas.
      float m = moonDensity;
      idx = uMoonGlyphs[0];
      idx = mix(idx, uMoonGlyphs[1], step(0.14, m));
      idx = mix(idx, uMoonGlyphs[2], step(0.28, m));
      idx = mix(idx, uMoonGlyphs[3], step(0.42, m));
      idx = mix(idx, uMoonGlyphs[4], step(0.56, m));
      idx = mix(idx, uMoonGlyphs[5], step(0.70, m));
      idx = mix(idx, uMoonGlyphs[6], step(0.82, m));
      idx = mix(idx, uMoonGlyphs[7], step(0.92, m));
      idx = mix(idx, uMoonGlyphs[8], step(0.98, m));
      color = vec3(0.84, 0.88, 0.97) * (0.6 + moonBright);
      brightness = 1.0;
      drew = true;
    } else if (lanternRef > 0.06 || extraRefStrength > 0.06) {
      // Warm lantern / cottage reflections rippling brightly on the black mirror.
      float s = max(lanternRef, extraRefStrength);
      idx = s > 0.45 ? uMoonGlyphs[8] : (s > 0.22 ? uMoonGlyphs[6] : uMoonGlyphs[3]);
      vec3 lightCol = vec3(1.0, 0.62, 0.18) * lanternRef + extraRefColor;
      color = clamp(lightCol * (0.6 + s), 0.0, 1.4);
      brightness = 1.0;
      drew = true;
    } else if (shore > 0.02) {
      // Rippling horizontal reflections of the bank foliage (emerald/umber bands).
      float band = sin(cellWorld.y * 1.9 + uTime * 0.7 + cellWorld.x * 0.4);
      idx = uWaterGlyphs[3]; // '~'
      idx = mix(idx, uWaterGlyphs[2], step(0.0, band)); // '-'
      vec3 foliageA = vec3(0.20, 0.45, 0.30); // muted emerald
      vec3 foliageB = vec3(0.45, 0.30, 0.16); // warm umber
      color = mix(foliageA, foliageB, step(0.0, band)) * (0.4 + shore * 0.6);
      brightness = 1.0;
      drew = true;
    } else if (cloud > 0.02) {
      // Drifting dim silver-grey mist, sparse glyphs, partially veiling the moon.
      float cSlot = hash(gridCoord + floor(uTime * 1.0));
      idx = cSlot > 0.7 ? uCloudGlyphs[3] : (cSlot > 0.45 ? uCloudGlyphs[2] : (cSlot > 0.2 ? uCloudGlyphs[1] : uCloudGlyphs[0]));
      color = vec3(0.5, 0.55, 0.62) * (0.25 + cloud * 0.5);
      brightness = 0.8;
      drew = true;
    } else if (energy > 0.30) {
      // Faint silver flow ripples on otherwise calm water.
      float normE = clamp((energy - 0.30) / 0.70, 0.0, 1.0);
      int gSlot = int(clamp(floor(normE * 6.0), 0.0, 5.0));
      if (gSlot == 1) idx = uWaterGlyphs[1];
      else if (gSlot == 2) idx = uWaterGlyphs[2];
      else if (gSlot == 3) idx = uWaterGlyphs[3];
      else if (gSlot == 4) idx = uWaterGlyphs[4];
      else if (gSlot >= 5) idx = uWaterGlyphs[5];
      color = vec3(0.34, 0.42, 0.50) * (0.3 + normE * 0.4);
      brightness = 0.9;
      drew = true;
    }

    if (!drew) {
      // Calm deep water: pure obsidian mirror with a faint rippled sheen.
      float sheen = microRipple * 0.05;
      gl_FragColor = vec4(bedColor + vec3(0.02, 0.03, 0.045) * sheen, 0.94);
      return;
    }

    float glyphAlpha = sampleGlyph(idx, cellUv);
    if (glyphAlpha < 0.15) {
      gl_FragColor = vec4(bedColor, 0.94);
      return;
    }

    gl_FragColor = vec4(color * brightness, 1.0);
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

    // Sparse -> dense: the reflected moon maps crater noise into these glyphs.
    const moonGlyphs = [
      atlas.getIndex('-'),
      atlas.getIndex('+'),
      atlas.getIndex('o'),
      atlas.getIndex('O'),
      atlas.getIndex('0'),
      atlas.getIndex('8'),
      atlas.getIndex('%'),
      atlas.getIndex('#'),
      atlas.getIndex('@'),
    ];

    const cloudGlyphs = [
      atlas.getIndex('.'),
      atlas.getIndex(','),
      atlas.getIndex(':'),
      atlas.getIndex('~'),
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
        uMoonGlyphs: { value: moonGlyphs },
        uCloudGlyphs: { value: cloudGlyphs },
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
