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
  uniform vec2 uGridOffset;
  uniform vec2 uAtlasGrid;
  uniform float uGlyphCount;
  uniform float uBurstGlow;

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

  void main() {
    vec2 shifted = gl_FragCoord.xy - uGridOffset;
    vec2 cell = floor(shifted / uCellSize);
    vec2 cellUv = fract(shifted / uCellSize);

    vec2 base = cell * uCellSize + uCellSize * 0.5 + uGridOffset;

    // Tight 2x2 sub-cell average keeps fine silhouettes, rooflines and limbs
    // razor-sharp without sub-pixel moiré shimmer.
    vec3 col = vec3(0.0);
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        vec2 off = (vec2(float(i), float(j)) * 2.0 - 1.0) * (uCellSize * 0.18);
        col += sampleScene(base + off);
      }
    }
    col *= 0.25;

    vec3 tn = tonemap(col);
    float L = dot(tn, LUMA);

    // Pure #000000 floor for pitch-black ground/bank undercuts, while letting
    // moonlit buildings, trees, and midnight water remain clearly legible.
    if (L < 0.065) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Linear remap across the glyph ramp (no S-curve shadow crush).
    float mapped = clamp((L - 0.065) / 0.84, 0.0, 1.0);
    float idx = floor(mapped * (uGlyphCount - 1.0) + 0.5);
    float gcol = mod(idx, uAtlasGrid.x);
    float grow = floor(idx / uAtlasGrid.x);
    vec2 atlasUv = vec2(
      (gcol + cellUv.x) / uAtlasGrid.x,
      1.0 - ((grow + 1.0 - cellUv.y) / uAtlasGrid.y)
    );
    float glyphAlpha = texture2D(uAtlasTex, atlasUv).a;

    // Preserve hue on midtones (slate stone, timber, russet bark, navy water).
    // Sparse glyphs already encode darkness via coverage, so keep foreground ink
    // visible (0.42..1.05) instead of squaring darkness with *= mapped.
    vec3 chroma = tn / max(max(tn.r, max(tn.g, tn.b)), 0.001);
    vec3 fgColor = mix(tn, chroma, 0.45);
    fgColor = mix(fgColor, vec3(1.0), smoothstep(0.78, 0.96, L));
    fgColor *= mix(0.42, 1.05, mapped);

    // Warm Radiant Burst pulse.
    fgColor += vec3(0.30, 0.16, 0.04) * uBurstGlow;

    gl_FragColor = vec4(fgColor * glyphAlpha, 1.0);
  }
`;

export class AsciiPostProcess {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly depthOnlyMaterial: THREE.MeshBasicMaterial;
  private readonly originVec = new THREE.Vector3();
  private readonly drawSize = new THREE.Vector2();

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
        uCellSize: { value: new THREE.Vector2(5.5, 8.5) },
        uGridOffset: { value: new THREE.Vector2(0, 0) },
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
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    const dpr = renderer.getPixelRatio();
    (this.material.uniforms.uCellSize.value as THREE.Vector2).set(5.5 * dpr, 8.5 * dpr);
  }

  public setBurstGlow(amount: number): void {
    this.material.uniforms.uBurstGlow.value = amount;
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
    (this.material.uniforms.uGridOffset.value as THREE.Vector2).set(ox, oy);
  }

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

    this.updateGridOffset(renderer, worldCamera);

    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, true);
    renderer.render(worldScene, worldCamera);

    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    renderer.render(this.postScene, this.postCamera);

    const prevOverride = worldScene.overrideMaterial;
    const prevWaterVisible = waterObject ? waterObject.visible : true;
    const prevBackground = worldScene.background;

    renderer.clearDepth();
    if (waterObject) waterObject.visible = false;
    worldScene.background = null;
    worldScene.overrideMaterial = this.depthOnlyMaterial;
    renderer.render(worldScene, worldCamera);
    worldScene.overrideMaterial = prevOverride;
    worldScene.background = prevBackground;
    if (waterObject) waterObject.visible = prevWaterVisible;

    if (grassScene) renderer.render(grassScene, worldCamera);
    if (weatherScene) renderer.render(weatherScene, worldCamera);
    if (overlayScene) renderer.render(overlayScene, worldCamera);

    if (prevTarget !== null) renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    this.sceneRT.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.depthOnlyMaterial.dispose();
  }
}