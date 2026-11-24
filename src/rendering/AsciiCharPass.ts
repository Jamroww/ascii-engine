import * as THREE from 'three';
import { GlyphAtlas } from './GlyphAtlas';
import { yToZ } from '../core/world';

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

  varying vec2 vUv;

  void main() {
    // 1. Quantize UVs into a crisp character grid
    vec2 cellCoord = floor(vUv * uCharGrid);
    vec2 cellUv = fract(vUv * uCharGrid);
    vec2 sampleUv = (cellCoord + 0.5) / uCharGrid;

    // 2. Sample the offscreen 3D character render
    vec4 texColor = texture2D(uCharTex, sampleUv);
    if (texColor.a < 0.15) discard;

    // 3. Map brightness (luminance) to density ramp in GlyphAtlas: .,:;-=+*#%@
    //    Boost contrast so the traveler reads as a crisp pale silhouette.
    float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    lum = clamp((lum - 0.40) * 1.8 + 0.40, 0.0, 1.0);
    float rampIndex = floor(clamp(lum, 0.0, 1.0) * 10.0) + 1.0;

    float col = mod(rampIndex, uAtlasGrid.x);
    float row = floor(rampIndex / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + cellUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
    );

    float glyphAlpha = texture2D(uAtlas, atlasUv).a;
    if (glyphAlpha < 0.15) {
      // Opaque dark silhouette backing inside the traveler's body so ground
      // dots and grass never bleed through the cloak.
      gl_FragColor = vec4(0.03, 0.04, 0.05, 0.92);
      return;
    }

    // Warm pale cloak with a bright rim so the traveler is unmistakable at
    // the finer zoomed-out scale.
    vec3 finalColor = mix(texColor.rgb * 1.5, vec3(1.0, 0.94, 0.84), clamp(lum * 0.85, 0.0, 1.0));
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const SHADOW_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    float d = length(c);
    if (d > 1.0) discard;
    float a = smoothstep(1.0, 0.1, d) * 0.5;
    gl_FragColor = vec4(0.01, 0.015, 0.02, a);
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
  private readonly torso: THREE.Mesh;
  private readonly cape: THREE.Mesh;
  private readonly lanternCore: THREE.Mesh;
  private readonly lanternCoreMat: THREE.MeshStandardMaterial;
  private readonly lanternLight: THREE.PointLight;

  private readonly charMaterial: THREE.ShaderMaterial;
  private readonly groundShadowMaterial: THREE.ShaderMaterial;
  private readonly toDispose: Array<{ dispose(): void }> = [];

  private readonly charMesh: THREE.Mesh;
  private readonly shadowMesh: THREE.Mesh;
  private attachedModel: THREE.Object3D | null = null;

  private walkPhase = 0;
  private facingAngle = 0;

  // Read-back buffer for the live HUD portrait.
  private readonly portraitPixels = new Uint8Array(128 * 128 * 4);

  constructor(atlas: GlyphAtlas) {
    // 1. Offscreen 3D render target.
    this.renderTarget = new THREE.WebGLRenderTarget(128, 128, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.offscreenScene = new THREE.Scene();
    this.offscreenCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    this.offscreenCamera.position.set(0, 2.2, 4.8);
    this.offscreenCamera.lookAt(0, 0.95, 0);

    // 2. High-contrast lighting so the ASCII luminance ramp has strong volume.
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.4);
    keyLight.position.set(2.5, 4.0, 3.0);
    this.offscreenScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x88b4ff, 1.2);
    rimLight.position.set(-3.0, 2.0, -2.5);
    this.offscreenScene.add(rimLight);

    const ambient = new THREE.AmbientLight(0x3a4252, 0.6);
    this.offscreenScene.add(ambient);

    // Lantern glow that lights the cloak from below / behind the hand.
    this.lanternLight = new THREE.PointLight(0xffb45e, 0, 3.4, 1.8);
    this.lanternLight.position.set(0.34, 1.0, 0.35);
    this.offscreenScene.add(this.lanternLight);

    // 3. Procedural cloaked traveler with hood, cape, staff and lantern.
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x93a5b8, roughness: 0.85 });
    const cloakDarkMat = new THREE.MeshStandardMaterial({ color: 0x525e70, roughness: 0.9 });
    const hoodMat = new THREE.MeshStandardMaterial({ color: 0x7d90a6, roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.7 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.6 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6b3f, roughness: 0.75 });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f46,
      roughness: 0.4,
      metalness: 0.6,
    });
    this.lanternCoreMat = new THREE.MeshStandardMaterial({
      color: 0xffc46a,
      emissive: 0xffb45e,
      emissiveIntensity: 2.4,
      roughness: 0.4,
    });

    // Cape draping behind the shoulders.
    const capeGeo = new THREE.BoxGeometry(0.52, 1.15, 0.05);
    capeGeo.translate(0, -0.5, -0.17);
    this.cape = new THREE.Mesh(capeGeo, cloakDarkMat);
    this.cape.position.set(0, 1.5, 0.06);
    this.charRig.add(this.cape);
    this.toDispose.push(capeGeo, cloakDarkMat);

    // Torso / robe.
    const torsoGeo = new THREE.CylinderGeometry(0.2, 0.36, 0.95, 9);
    this.torso = new THREE.Mesh(torsoGeo, cloakMat);
    this.torso.position.y = 1.05;
    this.charRig.add(this.torso);
    this.toDispose.push(torsoGeo, cloakMat);

    // Leather belt at the waist.
    const beltGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.07, 9);
    const belt = new THREE.Mesh(beltGeo, leatherMat);
    belt.position.y = 0.82;
    this.charRig.add(belt);
    this.toDispose.push(beltGeo, leatherMat);

    // Hood.
    const hoodGeo = new THREE.ConeGeometry(0.28, 0.52, 9);
    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.position.y = 1.78;
    this.charRig.add(hood);
    this.toDispose.push(hoodGeo, hoodMat);

    // Shadowed face under the hood.
    const faceGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const face = new THREE.Mesh(faceGeo, skinMat);
    face.position.set(0, 1.62, 0.07);
    this.charRig.add(face);
    this.toDispose.push(faceGeo, skinMat);

    // Legs (pivoted at the hips).
    const legGeo = new THREE.BoxGeometry(0.14, 0.58, 0.15);
    legGeo.translate(0, -0.29, 0);
    this.leftLeg = new THREE.Mesh(legGeo, cloakDarkMat);
    this.leftLeg.position.set(-0.13, 0.6, 0);
    this.rightLeg = new THREE.Mesh(legGeo, cloakDarkMat);
    this.rightLeg.position.set(0.13, 0.6, 0);
    this.charRig.add(this.leftLeg, this.rightLeg);
    this.toDispose.push(legGeo);

    // Arms (pivoted at the shoulders).
    const armGeo = new THREE.BoxGeometry(0.11, 0.5, 0.11);
    armGeo.translate(0, -0.24, 0);
    this.leftArm = new THREE.Mesh(armGeo, cloakMat);
    this.leftArm.position.set(-0.28, 1.4, 0);
    this.rightArm = new THREE.Mesh(armGeo, cloakMat);
    this.rightArm.position.set(0.28, 1.4, 0);
    this.charRig.add(this.leftArm, this.rightArm);
    this.toDispose.push(armGeo);

    // Walking staff held in the left hand.
    const staff = new THREE.Group();
    const staffPoleGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.7, 6);
    const staffPole = new THREE.Mesh(staffPoleGeo, woodMat);
    staffPole.position.y = 0.2;
    staff.add(staffPole);
    const staffFinialGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const staffFinial = new THREE.Mesh(staffFinialGeo, woodMat);
    staffFinial.position.y = 1.08;
    staff.add(staffFinial);
    staff.position.set(-0.4, 0.55, 0.02);
    this.charRig.add(staff);
    this.toDispose.push(staffPoleGeo, staffFinialGeo, woodMat);

    // Lantern held in the right hand.
    const lantern = new THREE.Group();
    const lanternTopGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 6);
    const lanternTop = new THREE.Mesh(lanternTopGeo, metalMat);
    lanternTop.position.y = 0.16;
    lantern.add(lanternTop);
    const lanternFrameGeo = new THREE.BoxGeometry(0.15, 0.2, 0.15);
    const lanternFrame = new THREE.Mesh(lanternFrameGeo, metalMat);
    lantern.add(lanternFrame);
    const lanternCoreGeo = new THREE.BoxGeometry(0.11, 0.16, 0.11);
    this.lanternCore = new THREE.Mesh(lanternCoreGeo, this.lanternCoreMat);
    lantern.add(this.lanternCore);
    lantern.position.set(0.36, 0.9, 0.08);
    this.rightArm.add(lantern);
    this.toDispose.push(lanternTopGeo, lanternFrameGeo, lanternCoreGeo, metalMat);

    this.offscreenScene.add(this.charRig);

    // 4. Main-scene ASCII billboard + a clean oval grounding shadow.
    const sharedUniforms = {
      uCharTex: { value: this.renderTarget.texture },
      uAtlas: { value: atlas.texture },
      uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      uCharGrid: { value: new THREE.Vector2(24, 28) },
    };

    this.charMaterial = new THREE.ShaderMaterial({
      vertexShader: CHAR_VERTEX_SHADER,
      fragmentShader: CHAR_FRAGMENT_SHADER,
      uniforms: { ...sharedUniforms },
      transparent: true,
      depthWrite: true,
    });

    this.groundShadowMaterial = new THREE.ShaderMaterial({
      vertexShader: CHAR_VERTEX_SHADER,
      fragmentShader: SHADOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });

    this.charMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.1), this.charMaterial);
    this.charMesh.position.set(0, 0.9, yToZ(0));

    this.shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), this.groundShadowMaterial);
    this.shadowMesh.position.set(0.05, -0.55, 0.53);

    this.group.add(this.shadowMesh, this.charMesh);
  }

  public update(
    dt: number,
    moveX: number,
    moveY: number,
    sprint: boolean,
    wading: boolean,
    aimX: number,
    aimY: number,
    worldX: number,
    worldY: number
  ): void {
    this.group.position.set(worldX, worldY, 0);

    // Unified Y-based depth: the billboard sorts with trees/buildings/enemies.
    this.charMesh.position.z = yToZ(worldY);
    this.shadowMesh.position.z = 0.53;

    const speed = Math.hypot(moveX, moveY);
    const sink = wading ? -0.24 : 0;
    const breathe = Math.sin(this.walkPhase) * 0.03;

    // Face the aim direction (toward the mouse) rather than the movement.
    const aimLen = Math.hypot(aimX, aimY);
    if (aimLen > 0.001) {
      const targetAngle = Math.atan2(aimX, -aimY);
      let diff = targetAngle - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 14);
      this.charRig.rotation.y = this.facingAngle;
    }

    if (speed > 0.05) {
      // Walk / sprint cycle.
      this.walkPhase += dt * (sprint ? 14 : 9);
      const swing = Math.sin(this.walkPhase) * (sprint ? 0.7 : 0.5);
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = swing * 0.25; // staff arm stays planted
      this.rightArm.rotation.x = -swing * 0.8; // lantern arm swings
      this.cape.rotation.x = Math.sin(this.walkPhase) * 0.16 + 0.12;
      this.torso.rotation.x = sprint ? 0.16 : 0.06;
      this.charRig.position.y = sink + breathe + Math.abs(Math.cos(this.walkPhase)) * 0.07;
    } else {
      // Settle back into a gentle idle.
      this.leftLeg.rotation.x *= 0.85;
      this.rightLeg.rotation.x *= 0.85;
      this.leftArm.rotation.x *= 0.85;
      this.rightArm.rotation.x *= 0.85;
      this.torso.rotation.x *= 0.85;
      this.cape.rotation.x += (0.12 - this.cape.rotation.x) * Math.min(1, dt * 4);
      this.walkPhase += dt * 2.2;
      this.charRig.position.y = sink + breathe;
    }

    // Lantern flicker and glow.
    const flicker =
      0.75 + Math.sin(this.walkPhase * 1.7) * 0.12 + Math.sin(this.walkPhase * 5.3) * 0.08;
    this.lanternCoreMat.emissiveIntensity = 1.8 + flicker * 0.9;
    this.lanternLight.intensity = flicker * 1.1;
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
    renderer.readRenderTargetPixels(this.renderTarget, 0, 0, 128, 128, this.portraitPixels);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  public getPortraitPixels(): Uint8Array {
    return this.portraitPixels;
  }

  /**
   * Swap the procedural cloaked-traveler rig for an external 3D model (e.g. a
   * `.glb` loaded via GLTFLoader) inside the offscreen ASCII render target.
   * The ASCII shader and billboard stay untouched — only what the offscreen
   * camera renders changes.
   */
  public attachModel(object: THREE.Object3D): void {
    if (this.attachedModel) this.offscreenScene.remove(this.attachedModel);
    this.offscreenScene.remove(this.charRig);
    this.attachedModel = object;
    this.offscreenScene.add(object);
  }

  public dispose(): void {
    this.renderTarget.dispose();
    this.charMaterial.dispose();
    this.groundShadowMaterial.dispose();
    this.lanternCoreMat.dispose();
    for (const item of this.toDispose) item.dispose();
  }
}
