import * as THREE from 'three';
import type { GlyphAtlas } from './GlyphAtlas';

const POST_VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_UV_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uSceneTex;
  uniform sampler2D uCharTex;
  uniform sampler2D uAtlasTex;
  uniform vec2 uResolution;
  uniform vec2 uCellSize;
  uniform vec2 uGridOffset;
  uniform vec2 uSampleOffset;
  uniform vec2 uAtlasGrid;
  uniform float uGlyphCount;
  uniform float uBurstGlow;
  uniform float uParryFlash;
  uniform vec3 uBgColor;

  const vec3 LUMA = vec3(0.299, 0.587, 0.114);

  vec3 tonemap(vec3 c) {
    c = max(c, vec3(0.0));
    // Soft Reinhard shoulder preserves bright moon / emissive windows without
    // crushing dark-slate buildings and trees in linear space.
    c = c / (c + vec3(0.45));
    // Clean linear -> sRGB decode.
    return pow(c, vec3(1.0 / 2.2));
  }

  vec3 sampleScene(vec2 px) {
    vec2 uv = px / uResolution;
    uv = clamp(uv, vec2(0.5) / uResolution, vec2(1.0) - vec2(0.5) / uResolution);
    return texture2D(uSceneTex, uv).rgb;
  }

  vec4 sampleChar(vec2 px) {
    vec2 uv = px / uResolution;
    uv = clamp(uv, vec2(0.5) / uResolution, vec2(1.0) - vec2(0.5) / uResolution);
    return texture2D(uCharTex, uv);
  }

  float sampleGlyph(float idx, vec2 cellUv) {
    float gcol = mod(idx, uAtlasGrid.x);
    float grow = floor(idx / uAtlasGrid.x);
    vec2 atlasUv = vec2(
      (gcol + cellUv.x) / uAtlasGrid.x,
      1.0 - ((grow + 1.0 - cellUv.y) / uAtlasGrid.y)
    );
    return texture2D(uAtlasTex, atlasUv).a;
  }

  void main() {
    vec2 shifted = gl_FragCoord.xy - uGridOffset;
    vec2 cell = floor(shifted / uCellSize);
    vec2 cellUv = fract(shifted / uCellSize);

    vec2 base = cell * uCellSize + uCellSize * 0.5 + uSampleOffset;

    // Tight 2x2 sub-cell average keeps fine silhouettes, rooflines and limbs
    // razor-sharp without sub-pixel moiré shimmer (environment + characters).
    vec3 col = vec3(0.0);
    vec4 charAvg = vec4(0.0);
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        vec2 off = (vec2(float(i), float(j)) * 2.0 - 1.0) * (uCellSize * 0.18);
        col += sampleScene(base + off);
        charAvg += sampleChar(base + off);
      }
    }
    col *= 0.25;
    charAvg *= 0.25;

    // 1-cell cardinal neighbour coverage for the silhouette separation border.
    float nLeft = sampleChar(base + vec2(-uCellSize.x, 0.0)).a;
    float nRight = sampleChar(base + vec2(uCellSize.x, 0.0)).a;
    float nUp = sampleChar(base + vec2(0.0, uCellSize.y)).a;
    float nDown = sampleChar(base + vec2(0.0, -uCellSize.y)).a;
    float neighborA = max(max(nLeft, nRight), max(nUp, nDown));

    bool isChar = charAvg.a > 0.22;

    if (isChar) {
      // Characters are drawn from their own lit pass with a crisp readability
      // lift, then composited over a fixed dark ink backdrop. This completely
      // prevents bright terracotta/sunset void or pink/gold ground from washing
      // out the silhouette.
      vec3 charRgb = charAvg.rgb * 1.35;
      vec3 ctn = tonemap(charRgb);
      float cL = dot(ctn, LUMA);
      if (cL < 0.08) cL = 0.08;

      float mapped = clamp((cL - 0.08) / 0.84, 0.0, 1.0);
      float idx = floor(mapped * (uGlyphCount - 1.0) + 0.5);
      float glyphAlpha = sampleGlyph(idx, cellUv);

      vec3 chroma = ctn / max(max(ctn.r, max(ctn.g, ctn.b)), 0.001);
      vec3 fg = mix(ctn, chroma, 0.45);
      fg = mix(fg, vec3(1.0), smoothstep(0.78, 0.96, cL));
      fg *= mix(0.14, 1.12, pow(mapped, 1.35));
      fg += vec3(0.30, 0.16, 0.04) * uBurstGlow;
      fg += vec3(0.9, 0.94, 1.0) * uParryFlash;

      vec3 cellBg = vec3(0.018, 0.018, 0.024);
      gl_FragColor = vec4(mix(cellBg, fg, glyphAlpha), 1.0);
      return;
    }

    // Environment cell, with a subtle 1-cell dark silhouette border.
    vec3 tn = tonemap(col);
    float L = dot(tn, LUMA);
    vec3 cellBg = uBgColor;
    if (neighborA > 0.45) {
      cellBg = mix(cellBg, vec3(0.02), 0.55);
    }

    // Pure uBgColor floor for pitch-black ground/bank undercuts, while letting
    // moonlit buildings, trees, and midnight water remain clearly legible.
    if (L < 0.08) {
      gl_FragColor = vec4(cellBg, 1.0);
      return;
    }

    // Linear remap across the glyph ramp (no S-curve shadow crush).
    float mapped = clamp((L - 0.08) / 0.84, 0.0, 1.0);
    float idx = floor(mapped * (uGlyphCount - 1.0) + 0.5);
    float glyphAlpha = sampleGlyph(idx, cellUv);

    // Preserve hue on midtones (slate stone, timber, russet bark, navy water).
    // A dark chiaroscuro curve keeps shadows deep nocturnal while lit faces,
    // cottage windows, the moon and the player stay sharp and bright.
    vec3 chroma = tn / max(max(tn.r, max(tn.g, tn.b)), 0.001);
    vec3 fgColor = mix(tn, chroma, 0.45);
    fgColor = mix(fgColor, vec3(1.0), smoothstep(0.78, 0.96, L));
    fgColor *= mix(0.14, 1.12, pow(mapped, 1.35));

    // Warm Radiant Burst pulse.
    fgColor += vec3(0.30, 0.16, 0.04) * uBurstGlow;

    // Crisp bright-white parry flash.
    fgColor += vec3(0.9, 0.94, 1.0) * uParryFlash;

    // Composite the glyph over the void colour so the empty space *between*
    // glyphs matches the below-black-point floor.
    vec3 outCol = mix(cellBg, fgColor, glyphAlpha);
    gl_FragColor = vec4(outCol, 1.0);
  }
`;

// Extracts only high-luminance pixels (soft knee) while downsampling the
// finished composite into the quarter-res bloom buffer.
const BRIGHT_PASS_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uTex;
  uniform float uThreshold;
  uniform float uKnee;
  uniform vec3 uBloomTint;

  varying vec2 vUv;

  const vec3 LUMA = vec3(0.299, 0.587, 0.114);

  void main() {
    vec3 col = texture2D(uTex, vUv).rgb;
    float luma = dot(col, LUMA);
    // Soft-knee bright pass keeps bright rims glowing without hard edges, then
    // tints the bloom (near-white for Level 1, warm gold for the sunset field).
    float w = smoothstep(uThreshold - uKnee, uThreshold + uKnee, luma);
    gl_FragColor = vec4(col * w * uBloomTint, 1.0);
  }
`;

// Separable 9-tap Gaussian blur, run once horizontally then once vertically.
const BLUR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uTex;
  uniform vec2 uTexelSize;
  uniform vec2 uDirection;

  varying vec2 vUv;

  void main() {
    vec2 off1 = uDirection * uTexelSize;
    vec2 off2 = off1 * 2.0;
    vec2 off3 = off1 * 3.0;
    vec2 off4 = off1 * 4.0;

    // Unrolled 9-tap Gaussian (sigma ~1.0), symmetric about the center.
    vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
    sum += (texture2D(uTex, vUv + off1).rgb + texture2D(uTex, vUv - off1).rgb) * 0.1945946;
    sum += (texture2D(uTex, vUv + off2).rgb + texture2D(uTex, vUv - off2).rgb) * 0.1216216;
    sum += (texture2D(uTex, vUv + off3).rgb + texture2D(uTex, vUv - off3).rgb) * 0.054054;
    sum += (texture2D(uTex, vUv + off4).rgb + texture2D(uTex, vUv - off4).rgb) * 0.016216;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// Recombines the crisp finished frame with the soft blurred bloom.
const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uCompositeTex;
  uniform sampler2D uBloomTex;
  uniform float uBloomStrength;

  varying vec2 vUv;

  void main() {
    vec3 base = texture2D(uCompositeTex, vUv).rgb;
    vec3 bloom = texture2D(uBloomTex, vUv).rgb;
    gl_FragColor = vec4(base + bloom * uBloomStrength, 1.0);
  }
`;

export class AsciiPostProcess {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  /** Occluded-character isolation target (RGB + alpha coverage). */
  private readonly charRT: THREE.WebGLRenderTarget;
  /** Finished ASCII + depth-tested grass + weather frame (pre-bloom). */
  private readonly compositeRT: THREE.WebGLRenderTarget;
  /** Quarter-res bloom buffers (A doubles as the final blurred result). */
  private readonly bloomRT_A: THREE.WebGLRenderTarget;
  private readonly bloomRT_B: THREE.WebGLRenderTarget;

  private readonly postScene = new THREE.Scene();
  private readonly bloomScene = new THREE.Scene();
  private readonly compositeScene = new THREE.Scene();

  private readonly postCamera: THREE.OrthographicCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly brightPassMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;

  private readonly fullscreenGeometry: THREE.PlaneGeometry;
  private readonly quad: THREE.Mesh;
  private readonly bloomQuad: THREE.Mesh;
  private readonly compositeQuad: THREE.Mesh;

  private readonly depthOnlyMaterial: THREE.MeshBasicMaterial;
  private readonly originVec = new THREE.Vector3();
  private readonly drawSize = new THREE.Vector2();
  private readonly skipDepthMeshes: THREE.Object3D[] = [];

  constructor(atlas: GlyphAtlas) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    this.charRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    this.compositeRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    this.bloomRT_A = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    this.bloomRT_B = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });

    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fullscreenGeometry = new THREE.PlaneGeometry(2, 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_FRAGMENT_SHADER,
      uniforms: {
        uSceneTex: { value: this.sceneRT.texture },
        uCharTex: { value: this.charRT.texture },
        uAtlasTex: { value: atlas.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCellSize: { value: new THREE.Vector2(6, 9) },
        uGridOffset: { value: new THREE.Vector2(0, 0) },
        uSampleOffset: { value: new THREE.Vector2(0, 0) },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uGlyphCount: { value: atlas.count },
        uBurstGlow: { value: 0 },
        uParryFlash: { value: 0 },
        uBgColor: { value: new THREE.Color(0, 0, 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(this.fullscreenGeometry, this.material);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);

    this.brightPassMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_UV_VERTEX_SHADER,
      fragmentShader: BRIGHT_PASS_FRAGMENT_SHADER,
      uniforms: {
        uTex: { value: this.compositeRT.texture },
        uThreshold: { value: 0.48 },
        uKnee: { value: 0.12 },
        uBloomTint: { value: new THREE.Color(1, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_UV_VERTEX_SHADER,
      fragmentShader: BLUR_FRAGMENT_SHADER,
      uniforms: {
        uTex: { value: this.bloomRT_A.texture },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uDirection: { value: new THREE.Vector2(1, 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_UV_VERTEX_SHADER,
      fragmentShader: COMPOSITE_FRAGMENT_SHADER,
      uniforms: {
        uCompositeTex: { value: this.compositeRT.texture },
        uBloomTex: { value: this.bloomRT_A.texture },
        uBloomStrength: { value: 0.55 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.bloomQuad = new THREE.Mesh(this.fullscreenGeometry, this.brightPassMaterial);
    this.bloomQuad.frustumCulled = false;
    this.bloomScene.add(this.bloomQuad);

    this.compositeQuad = new THREE.Mesh(this.fullscreenGeometry, this.compositeMaterial);
    this.compositeQuad.frustumCulled = false;
    this.compositeScene.add(this.compositeQuad);

    this.depthOnlyMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
    });
  }

  public setSize(renderer: THREE.WebGLRenderer): void {
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const width = size.x;
    const height = size.y;
    if (width <= 0 || height <= 0) return;
    this.sceneRT.setSize(width, height);
    this.charRT.setSize(width, height);
    this.compositeRT.setSize(width, height);

    const bloomWidth = Math.max(1, Math.floor(width / 4));
    const bloomHeight = Math.max(1, Math.floor(height / 4));
    this.bloomRT_A.setSize(bloomWidth, bloomHeight);
    this.bloomRT_B.setSize(bloomWidth, bloomHeight);
    (this.blurMaterial.uniforms.uTexelSize.value as THREE.Vector2).set(
      1 / bloomWidth,
      1 / bloomHeight,
    );

    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    // Strict integer physical pixels: fractional cell sizes cause nearest-neighbor
    // glyph stroke strobing when the camera starts/stops moving.
    const dpr = renderer.getPixelRatio();
    const cellX = Math.max(5, Math.round(6 * dpr));
    const cellY = Math.max(8, Math.round(9 * dpr));
    (this.material.uniforms.uCellSize.value as THREE.Vector2).set(cellX, cellY);
  }

  public setBurstGlow(amount: number): void {
    this.material.uniforms.uBurstGlow.value = amount;
  }

  public setParryFlash(amount: number): void {
    this.material.uniforms.uParryFlash.value = amount;
  }

  /** Void colour shown below the black point and between glyphs. */
  public setBgColor(color: THREE.Color): void {
    (this.material.uniforms.uBgColor.value as THREE.Color).copy(color);
  }

  /** Tint applied to the quarter-res bloom pass. */
  public setBloomTint(color: THREE.Color): void {
    (this.brightPassMaterial.uniforms.uBloomTint.value as THREE.Color).copy(color);
  }

  private updateGridOffset(
    renderer: THREE.WebGLRenderer,
    worldCamera: THREE.OrthographicCamera,
  ): void {
    renderer.getDrawingBufferSize(this.drawSize);
    const width = this.drawSize.x;
    const height = this.drawSize.y;
    if (width <= 0 || height <= 0) return;

    worldCamera.updateMatrixWorld(true);
    this.originVec.set(0, 0, 0).project(worldCamera);

    const cellSize = this.material.uniforms.uCellSize.value as THREE.Vector2;
    const px = (this.originVec.x * 0.5 + 0.5) * width;
    const py = (this.originVec.y * 0.5 + 0.5) * height;
    const ox = ((px % cellSize.x) + cellSize.x) % cellSize.x;
    const oy = ((py % cellSize.y) + cellSize.y) % cellSize.y;
    // Crisp integer grid anchor keeps glyph strokes free of sub-pixel aliasing,
    // while a separate continuous anchor drives the world sampling so the grid
    // never jumps a full pixel (which caused a one-frame flash on start/stop).
    (this.material.uniforms.uGridOffset.value as THREE.Vector2).set(
      Math.floor(ox),
      Math.floor(oy),
    );
    (this.material.uniforms.uSampleOffset.value as THREE.Vector2).set(ox, oy);
  }

  /** Gather currently-visible meshes flagged to skip the depth-only prepass. */
  private collectSkipDepthPrepass(worldScene: THREE.Scene): void {
    this.skipDepthMeshes.length = 0;
    worldScene.traverse((obj) => {
      if (obj.visible && obj.userData.skipDepthPrepass === true) {
        this.skipDepthMeshes.push(obj);
      }
    });
  }

  public render(
    renderer: THREE.WebGLRenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.OrthographicCamera,
    grassScene: THREE.Scene | null,
    weatherScene: THREE.Scene | null,
    overlayScene: THREE.Scene | null,
    waterObject: THREE.Object3D | null,
    characterObjects: THREE.Object3D[],
  ): void {
    const prevTarget = renderer.getRenderTarget();

    this.updateGridOffset(renderer, worldCamera);

    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    // 1a. Environment -> sceneRT (characters hidden so the void/ground never
    //     bleeds into them; they are re-composited from their own charRT pass).
    for (const o of characterObjects) o.visible = false;
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, true);
    renderer.render(worldScene, worldCamera);
    for (const o of characterObjects) o.visible = true;

    // 1b. Occluded characters -> charRT (RGB + alpha coverage, world-depth exact).
    this.renderCharacters(renderer, worldScene, worldCamera, waterObject, characterObjects);

    // 2. ASCII glyph pass -> compositeRT.
    renderer.setRenderTarget(this.compositeRT);
    renderer.clear(true, true, true);
    renderer.render(this.postScene, this.postCamera);

    // 3. Depth-only prepass into compositeRT's depth so grass/weather occlude
    //    correctly against world geometry. Meshes flagged `skipDepthPrepass`
    //    (the ghostly see-through tree branches) are hidden for this pass so
    //    their depth never occludes the wheat/duel beneath the canopy.
    const prevOverride = worldScene.overrideMaterial;
    const prevWaterVisible = waterObject ? waterObject.visible : true;
    const prevBackground = worldScene.background;

    this.collectSkipDepthPrepass(worldScene);
    for (const skip of this.skipDepthMeshes) skip.visible = false;

    renderer.clearDepth();
    if (waterObject) waterObject.visible = false;
    worldScene.background = null;
    worldScene.overrideMaterial = this.depthOnlyMaterial;
    renderer.render(worldScene, worldCamera);
    worldScene.overrideMaterial = prevOverride;
    worldScene.background = prevBackground;
    if (waterObject) waterObject.visible = prevWaterVisible;

    for (const skip of this.skipDepthMeshes) skip.visible = true;
    this.skipDepthMeshes.length = 0;

    // 4. Depth-tested grass, weather and the editor overlay -> compositeRT.
    if (grassScene) renderer.render(grassScene, worldCamera);
    if (weatherScene) renderer.render(weatherScene, worldCamera);
    if (overlayScene) renderer.render(overlayScene, worldCamera);

    // 5. Bloom: bright-pass downsample (compositeRT -> bloomRT_A).
    this.bloomQuad.material = this.brightPassMaterial;
    renderer.setRenderTarget(this.bloomRT_A);
    renderer.clear(true, false, false);
    renderer.render(this.bloomScene, this.postCamera);

    // 6. Horizontal blur (bloomRT_A -> bloomRT_B).
    this.bloomQuad.material = this.blurMaterial;
    this.blurMaterial.uniforms.uTex.value = this.bloomRT_A.texture;
    (this.blurMaterial.uniforms.uDirection.value as THREE.Vector2).set(1, 0);
    renderer.setRenderTarget(this.bloomRT_B);
    renderer.clear(true, false, false);
    renderer.render(this.bloomScene, this.postCamera);

    // 7. Vertical blur (bloomRT_B -> bloomRT_A).
    this.blurMaterial.uniforms.uTex.value = this.bloomRT_B.texture;
    (this.blurMaterial.uniforms.uDirection.value as THREE.Vector2).set(0, 1);
    renderer.setRenderTarget(this.bloomRT_A);
    renderer.clear(true, false, false);
    renderer.render(this.bloomScene, this.postCamera);

    // 8. Final composite (compositeRT + bloomRT_A * 0.55) -> screen.
    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    renderer.render(this.compositeScene, this.postCamera);

    if (prevTarget !== null) renderer.setRenderTarget(prevTarget);
  }

  /**
   * Isolate visible, unoccluded character pixels into `charRT`. First the opaque
   * world blockers are rendered depth-only (skipping the see-through canopy), so
   * the character pass is correctly occluded behind cottages and the great tree
   * trunk; then only the character meshes + active scene lights are rendered with
   * depth test/write so their lit RGB lands with alpha = 1.0.
   */
  private renderCharacters(
    renderer: THREE.WebGLRenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.OrthographicCamera,
    waterObject: THREE.Object3D | null,
    characterObjects: THREE.Object3D[],
  ): void {
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevOverride = worldScene.overrideMaterial;
    const prevBackground = worldScene.background;

    renderer.setRenderTarget(this.charRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);

    // Hide characters, water and the translucent canopy for the depth prepass.
    for (const o of characterObjects) o.visible = false;
    const prevWater = waterObject ? waterObject.visible : true;
    if (waterObject) waterObject.visible = false;
    worldScene.background = null;

    this.collectSkipDepthPrepass(worldScene);
    for (const skip of this.skipDepthMeshes) skip.visible = false;

    // Opaque world blockers -> depth only (charRT's Z-buffer = exact occlusion).
    worldScene.overrideMaterial = this.depthOnlyMaterial;
    renderer.render(worldScene, worldCamera);
    worldScene.overrideMaterial = prevOverride;

    for (const skip of this.skipDepthMeshes) skip.visible = true;
    this.skipDepthMeshes.length = 0;

    // Restore characters so they render their lit colour into charRT.
    for (const o of characterObjects) o.visible = true;

    // Keep only character meshes + lights visible, then render their lit colour.
    const charSet = new Set(characterObjects);
    const hidden: THREE.Object3D[] = [];
    worldScene.traverse((obj) => {
      if (obj === worldScene) return;
      if ((obj as THREE.Light).isLight) return;
      if (this.isCharacterOrDescendant(obj, charSet)) return;
      const renderable = obj as THREE.Object3D & {
        isMesh?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
      };
      if (obj.visible && (renderable.isMesh || renderable.isLine || renderable.isPoints || renderable.isSprite)) {
        obj.visible = false;
        hidden.push(obj);
      }
    });

    renderer.render(worldScene, worldCamera);

    for (const h of hidden) h.visible = true;
    worldScene.background = prevBackground;
    if (waterObject) waterObject.visible = prevWater;
    for (const o of characterObjects) o.visible = true;

    renderer.setClearColor(prevColor, prevAlpha);
  }

  /** True when `obj` is a character root or a descendant of one. */
  private isCharacterOrDescendant(obj: THREE.Object3D, charSet: Set<THREE.Object3D>): boolean {
    let p: THREE.Object3D | null = obj;
    while (p) {
      if (charSet.has(p)) return true;
      p = p.parent;
    }
    return false;
  }

  public dispose(): void {
    this.sceneRT.dispose();
    this.charRT.dispose();
    this.compositeRT.dispose();
    this.bloomRT_A.dispose();
    this.bloomRT_B.dispose();
    this.material.dispose();
    this.brightPassMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.fullscreenGeometry.dispose();
    this.depthOnlyMaterial.dispose();
  }
}
