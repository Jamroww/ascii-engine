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

    // Perceptual luminance; a near-black floor reads as pure #000000 (no haze).
    float L = dot(col, vec3(0.299, 0.587, 0.114));
    if (L < 0.035) {
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

    // Colour retention: keep hues saturated and distinct over pure black so
    // moonlit white, lantern orange, emerald grass, russet bark and toxic green
    // all stay crisp instead of washing out to grey.
    vec3 saturated = mix(vec3(L), col, 1.35);
    float bright = 0.92 + L * 0.55;
    vec3 boosted = saturated * bright;

    // Minimal warm Radiant Burst pulse.
    boosted += vec3(0.30, 0.16, 0.04) * uBurstGlow;

    gl_FragColor = vec4(boosted * glyphAlpha, 1.0);
  }
`;

/**
 * Unified screen-space ASCII pass. Renders the full 3D world into an offscreen
 * target, then re-quantizes the whole viewport into a crisp fixed 7x10-pixel
 * glyph grid backed by the GlyphAtlas.
 */
export class AsciiPostProcess {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

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
  }

  /** Resize the offscreen scene target to the renderer's drawing buffer. */
  public setSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.sceneRT.setSize(width, height);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  /** Warm golden pulse uniform (driven by Radiant Burst). */
  public setBurstGlow(amount: number): void {
    this.material.uniforms.uBurstGlow.value = amount;
  }

  /** worldScene -> sceneRT -> AsciiPostProcess -> screen. */
  public render(
    renderer: THREE.WebGLRenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.OrthographicCamera,
    postOverlay?: () => void,
  ): void {
    const prevTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.sceneRT);
    renderer.render(worldScene, worldCamera);

    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCamera);

    postOverlay?.();

    if (prevTarget !== null) renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    this.sceneRT.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
