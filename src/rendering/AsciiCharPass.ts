import * as THREE from 'three';
import { GlyphAtlas } from './GlyphAtlas';

const CHAR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CHAR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uCharTex;
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uCharGrid;
  uniform float uIsShadow;

  varying vec2 vUv;

  void main() {
    // 1. Quantize UVs into a crisp character grid
    vec2 cellCoord = floor(vUv * uCharGrid);
    vec2 cellUv = fract(vUv * uCharGrid);
    vec2 sampleUv = (cellCoord + 0.5) / uCharGrid;

    // 2. Sample the offscreen 3D character render
    vec4 texColor = texture2D(uCharTex, sampleUv);
    if (texColor.a < 0.15) discard;

    // 3. Map brightness (luminance) to density ramp in GlyphAtlas: .,:;-=+*#%@ (indices 1..11)
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    float rampIndex = floor(clamp(lum, 0.0, 1.0) * 10.0) + 1.0;

    // For shadows, use denser characters so the silhouette reads clearly on grass
    float idx = mix(rampIndex, clamp(rampIndex + 3.0, 4.0, 11.0), uIsShadow);

    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + cellUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
    );

    float glyphAlpha = texture2D(uAtlas, atlasUv).a;
    if (glyphAlpha < 0.15) discard;

    if (uIsShadow > 0.5) {
      gl_FragColor = vec4(0.02, 0.03, 0.04, glyphAlpha * 0.72);
    } else {
      // Slight rim boost so the character pops against the dark grass
      vec3 finalColor = mix(texColor.rgb * 1.15, vec3(1.0, 0.94, 0.85), lum * 0.35);
      gl_FragColor = vec4(finalColor, glyphAlpha);
    }
  }
`;

export class AsciiCharPass {
  public readonly group = new THREE.Group();

  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly offscreenScene: THREE.Scene;
  private readonly offscreenCamera: THREE.PerspectiveCamera;

  private readonly charRig = new THREE.Group();
  private readonly leftLeg: THREE.Mesh;
  private readonly rightLeg: THREE.Mesh;
  private readonly leftArm: THREE.Mesh;
  private readonly rightArm: THREE.Mesh;

  private readonly charMaterial: THREE.ShaderMaterial;
  private readonly shadowMaterial: THREE.ShaderMaterial;

  private walkPhase = 0;
  private facingAngle = 0;

  constructor(atlas: GlyphAtlas) {
    // 1. Offscreen 3D Render Target
    this.renderTarget = new THREE.WebGLRenderTarget(128, 128, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.offscreenScene = new THREE.Scene();
    this.offscreenCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    // Slight top-down RPG camera angle
    this.offscreenCamera.position.set(0, 2.2, 4.8);
    this.offscreenCamera.lookAt(0, 0.95, 0);

    // 2. High-contrast lighting so the ASCII luminance ramp has strong volume
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.6);
    keyLight.position.set(2.5, 4.0, 3.0);
    this.offscreenScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x88b4ff, 1.2);
    rimLight.position.set(-3.0, 2.0, -2.5);
    this.offscreenScene.add(rimLight);

    const ambient = new THREE.AmbientLight(0x3a4252, 0.65);
    this.offscreenScene.add(ambient);

    // 3. Procedural 3D Cloaked Traveler
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x5c6470, roughness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xe6d2b5, roughness: 0.5 });

    // Torso / Cloak
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, 0.95, 8), cloakMat);
    torso.position.y = 1.05;
    this.charRig.add(torso);

    // Hooded Head
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 7), accentMat);
    head.position.y = 1.72;
    this.charRig.add(head);

    // Limbs (pivoted at shoulders/hips)
    const legGeo = new THREE.BoxGeometry(0.14, 0.58, 0.14);
    legGeo.translate(0, -0.29, 0);
    this.leftLeg = new THREE.Mesh(legGeo, darkMat);
    this.leftLeg.position.set(-0.13, 0.6, 0);
    this.rightLeg = new THREE.Mesh(legGeo, darkMat);
    this.rightLeg.position.set(0.13, 0.6, 0);
    this.charRig.add(this.leftLeg, this.rightLeg);

    const armGeo = new THREE.BoxGeometry(0.11, 0.52, 0.11);
    armGeo.translate(0, -0.24, 0);
    this.leftArm = new THREE.Mesh(armGeo, cloakMat);
    this.leftArm.position.set(-0.28, 1.42, 0);
    this.rightArm = new THREE.Mesh(armGeo, cloakMat);
    this.rightArm.position.set(0.28, 1.42, 0);
    this.charRig.add(this.leftArm, this.rightArm);

    this.offscreenScene.add(this.charRig);

    // 4. Main-scene ASCII Billboard & Fake Shadow
    const sharedUniforms = {
      uCharTex: { value: this.renderTarget.texture },
      uAtlas: { value: atlas.texture },
      uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      uCharGrid: { value: new THREE.Vector2(18, 22) },
    };

    this.charMaterial = new THREE.ShaderMaterial({
      vertexShader: CHAR_VERTEX_SHADER,
      fragmentShader: CHAR_FRAGMENT_SHADER,
      uniforms: { ...sharedUniforms, uIsShadow: { value: 0.0 } },
      transparent: true,
      depthWrite: false,
    });

    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: CHAR_VERTEX_SHADER,
      fragmentShader: CHAR_FRAGMENT_SHADER,
      uniforms: { ...sharedUniforms, uIsShadow: { value: 1.0 } },
      transparent: true,
      depthWrite: false,
    });

    const charMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0), this.charMaterial);
    charMesh.position.set(0, 0.9, 1.2);

    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0), this.shadowMaterial);
    shadowMesh.scale.set(1.05, 0.38, 1);
    shadowMesh.position.set(0.15, -0.35, 0.6);

    this.group.add(shadowMesh, charMesh);
  }

  public update(
    dt: number,
    moveX: number,
    moveY: number,
    sprint: boolean,
    worldX: number,
    worldY: number
  ): void {
    this.group.position.set(worldX, worldY, 0);

    const speed = Math.hypot(moveX, moveY);
    if (speed > 0.05) {
      // Smoothly rotate 3D character toward movement direction
      const targetAngle = Math.atan2(moveX, -moveY);
      let diff = targetAngle - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 12);
      this.charRig.rotation.y = this.facingAngle;

      // Walk/sprint limb cycle
      this.walkPhase += dt * (sprint ? 14 : 9);
      const swing = Math.sin(this.walkPhase) * (sprint ? 0.75 : 0.5);
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.8;
      this.rightArm.rotation.x = swing * 0.8;
      this.charRig.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.08;
    } else {
      // Settle back to subtle idle breathing
      this.leftLeg.rotation.x *= 0.85;
      this.rightLeg.rotation.x *= 0.85;
      this.leftArm.rotation.x *= 0.85;
      this.rightArm.rotation.x *= 0.85;
      this.walkPhase += dt * 2.2;
      this.charRig.position.y = Math.sin(this.walkPhase) * 0.03;
    }
  }

  public render(renderer: THREE.WebGLRenderer): void {
    const prevTarget = renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.offscreenScene, this.offscreenCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  public dispose(): void {
    this.renderTarget.dispose();
    this.charMaterial.dispose();
    this.shadowMaterial.dispose();
  }
}