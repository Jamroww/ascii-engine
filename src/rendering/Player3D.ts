import * as THREE from 'three';
import { createPlayerTravelerModel } from './Characters';
import { disposeModelTree, setCastShadow } from './modelUtils';

const PORTRAIT_SIZE = 64;

/**
 * Places the procedural 3D traveler directly in the world scene at
 * `(playerX, 0, -playerY)`, faces it toward the mouse aim, and renders a tiny
 * 64x64 upper-body portrait for the HUD from a dedicated offscreen camera.
 */
export class Player3D {
  public readonly group = new THREE.Group();
  /** Right-hand pivot the sword attaches to, at torso/hand height. */
  public readonly handPivot = new THREE.Group();

  private readonly model: THREE.Group;
  private readonly portraitModel: THREE.Group;
  private readonly portraitScene = new THREE.Scene();
  private readonly portraitCamera: THREE.PerspectiveCamera;
  private readonly portraitRT: THREE.WebGLRenderTarget;
  private readonly portraitPixels = new Uint8Array(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);

  private facingAngle = 0;
  private walkPhase = 0;
  private lastPortraitTime = -1;

  constructor() {
    this.model = createPlayerTravelerModel();
    setCastShadow(this.model, true);
    this.stylizeTraveler(this.model);
    this.group.add(this.model);

    this.handPivot.position.set(0.4, 0.95, 0.16);
    this.model.add(this.handPivot);

    // Dedicated portrait rig: a second traveler instance under its own camera.
    this.portraitModel = createPlayerTravelerModel();
    this.stylizeTraveler(this.portraitModel);
    this.portraitScene.add(this.portraitModel);

    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(-2.5, 4.0, 3.0);
    this.portraitScene.add(key);

    const rim = new THREE.DirectionalLight(0x88b4ff, 1.2);
    rim.position.set(-3.0, 2.0, -2.5);
    this.portraitScene.add(rim);

    this.portraitScene.add(new THREE.AmbientLight(0x3a4252, 0.35));

    this.portraitCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.portraitCamera.position.set(0, 1.55, 3.1);
    this.portraitCamera.lookAt(0, 1.2, 0);

    this.portraitRT = new THREE.WebGLRenderTarget(PORTRAIT_SIZE, PORTRAIT_SIZE, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
    });
  }

  /**
   * Strengthen the traveler's chiaroscuro: lift the lit hood, shoulder mantle
   * and pauldrons to crisp pale silver-white (#f2f6ff) with a cool emissive
   * floor so the upper silhouette reads clearly and drops into the dark cloak
   * folds below, while the warm hip lantern stays untouched.
   */
  private stylizeTraveler(root: THREE.Group): void {
    const lit = new THREE.Color('#f2f6ff');
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const mat = node.material;
      if (!(mat instanceof THREE.MeshStandardMaterial)) return;
      if (node.userData.isEmissive) return;

      const hex = mat.color.getHex();
      const isPaleUpper =
        (hex === 0xf0f4fa || hex === 0xcbd2d9) && node.position.y > 1.2;
      if (!isPaleUpper) return;

      mat.color.copy(lit);
      mat.emissive = lit.clone().multiplyScalar(0.18);
    });
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
    worldY: number,
    _dashing: boolean,
  ): void {
    this.group.position.set(worldX, 0, -worldY);

    // Smoothly face the aim direction (toward the mouse).
    const aimLen = Math.hypot(aimX, aimY);
    if (aimLen > 0.001) {
      const target = Math.atan2(aimX, -aimY);
      let diff = target - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 14);
      this.model.rotation.y = this.facingAngle;
    }

    const speed = Math.hypot(moveX, moveY);
    const sink = wading ? -0.24 : 0;
    this.walkPhase += dt * (speed > 0.05 ? (sprint ? 14 : 9) : 2.2);
    const bob =
      speed > 0.05
        ? Math.abs(Math.cos(this.walkPhase)) * 0.06
        : Math.sin(this.walkPhase) * 0.02;
    this.model.position.y = sink + bob;

    // Mirror facing + bob onto the portrait rig so the HUD portrait stays live.
    this.portraitModel.rotation.y = this.facingAngle;
    this.portraitModel.position.y = bob;
  }

  public renderPortrait(renderer: THREE.WebGLRenderer, elapsed: number): void {
    // Throttle the offscreen portrait render + `readRenderTargetPixels` GPU
    // readback to ~13 Hz. The synchronous readback stalls the GPU pipeline, so
    // doing it every frame was a key source of movement stutter.
    if (elapsed - this.lastPortraitTime < 0.075) return;
    this.lastPortraitTime = elapsed;

    const prevTarget = renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.portraitRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.portraitScene, this.portraitCamera);
    renderer.readRenderTargetPixels(
      this.portraitRT,
      0,
      0,
      PORTRAIT_SIZE,
      PORTRAIT_SIZE,
      this.portraitPixels,
    );

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  public getPortraitPixels(): Uint8Array {
    return this.portraitPixels;
  }

  public dispose(): void {
    disposeModelTree(this.model);
    disposeModelTree(this.portraitModel);
    this.portraitRT.dispose();
  }
}
