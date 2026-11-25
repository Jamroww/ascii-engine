import * as THREE from 'three';
import type { GlyphAtlas } from './GlyphAtlas';

const POST_VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uSceneTex;
  uniform sampler2D uAtlasTex;
  uniform vec2 uResolution;
  uniform vec2 uCellSize;
  uniform vec2 uAtlasGrid;
  uniform float uGlyphCount;
  uniform float uBurstGlow;

  void main() {
    // Uniform 7x10-pixel character cells across the whole viewport.
    vec2 cell = floor(gl_FragCoord.xy / uCellSize);
    vec2 cellUv = fract(gl_FragCoord.xy / uCellSize);

    // 2x2 sub-cell average of the scene colour to suppress shimmering on thin
    // geometry (sword blades, tree boughs) while keeping crisp per-cell output.
    vec2 base = (cell + 0.5) * uCellSize;
    vec2 o = uCellSize * 0.25;
    vec3 col = vec3(0.0);
    col += texture2D(uSceneTex, (base + vec2(-o.x, -o.y)) / uResolution).rgb;
    col += texture2D(uSceneTex, (base + vec2( o.x, -o.y)) / uResolution).rgb;
    col += texture2D(uSceneTex, (base + vec2(-o.x,  o.y)) / uResolution).rgb;
    col += texture2D(uSceneTex, (base + vec2( o.x,  o.y)) / uResolution).rgb;
    col *= 0.25;

    // Linear -> sRGB BEFORE any luminance work, otherwise the whole scene reads
    // pitch black and dark tones crush together. Exposure + soft tone mapping
    // first, then the gamma decode.
    col = col * 1.85;
    col = col / (col + vec3(0.55));
    col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

    // Perceptual luminance on the gamma-corrected colour; a near-black floor
    // reads as pure #000000 (no haze).
    float L = dot(col, vec3(0.299, 0.587, 0.114));
    if (L < 0.04) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Map luminance cleanly onto the glyph ramp.
    float mapped = pow(clamp(L, 0.0, 1.0), 0.82);
    float idx = floor(mapped * (uGlyphCount - 1.0) + 0.5);
    float gcol = mod(idx, uAtlasGrid.x);
    float grow = floor(idx / uAtlasGrid.x);
    vec2 atlasUv = vec2(
      (gcol + cellUv.x) / uAtlasGrid.x,
      1.0 - ((grow + 1.0 - cellUv.y) / uAtlasGrid.y)
    );
    float glyphAlpha = texture2D(uAtlasTex, atlasUv).a;

    // Decouple glyph brightness from raw colour. Sparse glyphs already encode
    // darkness via ink coverage, so pull a hue-preserving chroma and lift the
    // darker ramp entries (dot, colon, dash) back into visible nocturnal tones
    // while lit surfaces (player, moon, cottage windows) stay bright/saturated.
    vec3 chroma = col / max(max(col.r, max(col.g, col.b)), 0.001);
    vec3 fgColor = mix(col, chroma, 0.45) * mix(0.65, 1.35, L);

    // Minimal warm Radiant Burst pulse.
    fgColor += vec3(0.30, 0.16, 0.04) * uBurstGlow;

    gl_FragColor = vec4(fgColor * glyphAlpha, 1.0);
  }
`;

/**
 * Unified screen-space ASCII pass. Renders the full 3D world into an offscreen
 * target, then re-quantizes the whole viewport into a crisp fixed 7x10-pixel
 * glyph grid backed by the GlyphAtlas. It also orchestrates the two post-ASCII
 * compositing passes: a depth-only prepass so the razor-sharp 3D grass can be
 * depth-tested against the opaque world, then the grass and weather overlays.
 */
export class AsciiPostProcess {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly depthOnlyMaterial: THREE.MeshBasicMaterial;

  constructor(atlas: GlyphAtlas) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_FRAGMENT_SHADER,
      uniforms: {
        uSceneTex: { value: this.sceneRT.texture },
        uAtlasTex: { value: atlas.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCellSize: { value: new THREE.Vector2(7, 10) },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uGlyphCount: { value: atlas.count },
        uBurstGlow: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);

    // Populates the screen hardware Z-buffer with the opaque solids so the
    // grass can depth-test against them without drawing any colour.
    this.depthOnlyMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
    });
  }

  /** Resize the offscreen scene target to the renderer's drawing buffer. */
  public setSize(renderer: THREE.WebGLRenderer): void {
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const width = size.x;
    const height = size.y;
    if (width <= 0 || height <= 0) return;
    this.sceneRT.setSize(width, height);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  /** Warm golden pulse uniform (driven by Radiant Burst). */
  public setBurstGlow(amount: number): void {
    this.material.uniforms.uBurstGlow.value = amount;
  }

  /**
   * Full-frame render with every clear managed explicitly (the renderer has
   * `autoClear = false`):
   *   1. world -> sceneRT (clear colour + depth) -> ASCII quantize
   *   2. ASCII quantize -> screen (clear colour + depth)
   *   3. depth-only solids -> screen Z-buffer (clear depth ONLY, preserve colour)
   *   4. depth-tested grass, then weather, then editor overlay (no clear)
   */
  public render(
    renderer: THREE.WebGLRenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.OrthographicCamera,
    grassScene: THREE.Scene | null,
    weatherScene: THREE.Scene | null,
    overlayScene: THREE.Scene | null,
    waterObject: THREE.Object3D | null,
  ): void {
    const prevTarget = renderer.getRenderTarget();

    // 1. ASCII pass (grass + weather live in their own scenes, so they are
    //    excluded here automatically).
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, true);
    renderer.render(worldScene, worldCamera);

    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    renderer.render(this.postScene, this.postCamera);

    // 2-4. Layer the razor-sharp overlays onto the ASCII result. Skip shadow-map
    // re-renders (already computed in pass 1); never clear colour here.
    const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const prevOverride = worldScene.overrideMaterial;
    const prevWaterVisible = waterObject ? waterObject.visible : true;
    const prevBackground = worldScene.background;

    renderer.shadowMap.autoUpdate = false;

    // 2. Depth prepass: populate the screen Z-buffer with the opaque solids.
    //    `worldScene.background` is a Color, which three.js turns into a
    //    forceClear that wipes the colour buffer even with autoClear disabled —
    //    null it here so only depth is written and the ASCII result survives.
    renderer.clearDepth();
    if (waterObject) waterObject.visible = false;
    worldScene.background = null;
    worldScene.overrideMaterial = this.depthOnlyMaterial;
    renderer.render(worldScene, worldCamera);
    worldScene.overrideMaterial = prevOverride;
    worldScene.background = prevBackground;
    if (waterObject) waterObject.visible = prevWaterVisible;

    // 3. Grass, depth-tested against the prepass but not writing depth.
    if (grassScene) renderer.render(grassScene, worldCamera);

    // 4. Weather above the composite.
    if (weatherScene) renderer.render(weatherScene, worldCamera);

    // 5. Editor overlay (collider rings) on top.
    if (overlayScene) renderer.render(overlayScene, worldCamera);

    renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;

    if (prevTarget !== null) renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    this.sceneRT.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.depthOnlyMaterial.dispose();
  }
}
