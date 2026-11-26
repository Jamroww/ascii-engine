import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createPlayerTravelerModel,
  createDarkSteelMaterial,
  type PlayerRig,
} from './Characters';
import { disposeModelTree, setCastShadow } from './modelUtils';

const PORTRAIT_SIZE = 64;

// Procedural locomotion tuning (radians / seconds at full input).
const WALK_RATE = 8.5;
const SPRINT_RATE = 13.0;
const LEG_SWING_AMPLITUDE = 0.68;
const ARM_SWING_AMPLITUDE = 0.5;
const KNEE_BEND_AMPLITUDE = 0.95;
const ELBOW_BEND_AMPLITUDE = 0.32;
const TORSO_COUNTER_AMPLITUDE = 0.14;
const HIPS_COUNTER_AMPLITUDE = 0.1;

/**
 * Places the procedural 3D traveler directly in the world scene at
 * `(playerX, 0, -playerY)`, faces it toward the mouse aim, and renders a tiny
 * 64x64 upper-body portrait for the HUD from a dedicated offscreen camera.
 *
 * The traveler is an articulated humanoid driven procedurally every frame; if
 * `public/models/player.glb` is present, it is silently swapped in with a
 * `GLTFLoader` + `AnimationMixer` hook and the procedural rig is hidden.
 */
export class Player3D {
  public readonly group = new THREE.Group();
  /** Right-hand pivot the sword attaches to, aliasing the rig's weaponSocket. */
  public readonly handPivot: THREE.Group;

  private readonly model: THREE.Group;
  private readonly rig: PlayerRig;
  private readonly portraitModel: THREE.Group;
  private readonly portraitRig: PlayerRig;
  private readonly portraitScene = new THREE.Scene();
  private readonly portraitCamera: THREE.PerspectiveCamera;
  private readonly portraitRT: THREE.WebGLRenderTarget;
  private readonly portraitPixels = new Uint8Array(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
  private readonly contactShadow: THREE.Mesh;

  // Optional GLB hook state.
  private gltfRoot: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private gltfActions: {
    idle: THREE.AnimationAction | null;
    run: THREE.AnimationAction | null;
    attack: THREE.AnimationAction | null;
  } = { idle: null, run: null, attack: null };
  private currentAction: THREE.AnimationAction | null = null;
  private attackTimer = 0;
  private wasSwinging = false;

  // Procedural pose state.
  private facingAngle = 0;
  private legsYaw = 0;
  private walkPhase = 0;
  private moveBlend = 0;
  private torsoLean = 0;
  private capePitch = 0;
  private elapsed = 0;
  private lastPortraitTime = -1;

  // Base transforms captured at build time so animation layers cleanly on top.
  private readonly hipsBaseY: number;
  private readonly torsoBaseRotX: number;
  private readonly capeBaseRotX: number;

  constructor() {
    this.model = createPlayerTravelerModel();
    setCastShadow(this.model, true);
    this.rig = this.model.userData.rig as PlayerRig;
    this.handPivot = this.rig.weaponSocket;
    this.group.add(this.model);

    this.hipsBaseY = this.rig.hips.position.y;
    this.torsoBaseRotX = this.rig.torso.rotation.x;
    this.capeBaseRotX = this.rig.cape.rotation.x;

    // Dedicated portrait rig: a second traveler instance under its own camera.
    this.portraitModel = createPlayerTravelerModel();
    this.portraitRig = this.portraitModel.userData.rig as PlayerRig;
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

    // Dark translucent grounding contact shadow so the dark glossy silhouette
    // still reads cleanly against light dirt paths, grass and water alike.
    const contactGeo = new THREE.CircleGeometry(0.65, 24);
    const contactMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.contactShadow = new THREE.Mesh(contactGeo, contactMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.set(0, 0.03, 0);
    this.group.add(this.contactShadow);

    this.tryLoadGltf();
  }

  /** Asynchronously try to swap in `public/models/player.glb` (silent on failure). */
  private tryLoadGltf(): void {
    const url = `${import.meta.env.BASE_URL}models/player.glb`;
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => this.onGltfLoaded(gltf),
      undefined,
      () => {
        // 404 / parse failure: keep the procedural articulated humanoid silently.
      },
    );
  }

  private onGltfLoaded(gltf: GLTF): void {
    const scene = gltf.scene;

    // Normalize: uniform 1.90-unit height, feet anchored at y = 0.
    const box = new THREE.Box3().setFromObject(scene);
    const height = box.max.y - box.min.y;
    if (height <= 0.001) return; // Degenerate model: keep the procedural rig.

    const scale = 1.9 / height;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);
    const fit = new THREE.Box3().setFromObject(scene);
    scene.position.y -= fit.min.y;

    // Dark glossy metallic override on every non-emissive surface.
    const steel = createDarkSteelMaterial();
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      const mats = node.material;
      if (Array.isArray(mats)) {
        for (let i = 0; i < mats.length; i++) {
          if (!this.isEmissive(mats[i])) {
            mats[i].dispose();
            mats[i] = steel;
          }
        }
      } else if (!this.isEmissive(mats)) {
        mats.dispose();
        node.material = steel;
      }
    });

    // Auto-match animation clips by case-insensitive substring.
    const clips = gltf.animations ?? [];
    const mixer = new THREE.AnimationMixer(scene);
    this.gltfActions = {
      idle: this.clipToAction(mixer, this.findClip(clips, ['idle'])),
      run: this.clipToAction(mixer, this.findClip(clips, ['run', 'walk'])),
      attack: this.clipToAction(mixer, this.findClip(clips, ['attack', 'slash'])),
    };
    this.mixer = mixer;

    // Hide the procedural rig and attach the GLB root in its place.
    this.model.visible = false;
    this.gltfRoot = scene;
    this.group.add(scene);
  }

  private clipToAction(
    mixer: THREE.AnimationMixer,
    clip: THREE.AnimationClip | null,
  ): THREE.AnimationAction | null {
    return clip ? mixer.clipAction(clip) : null;
  }

  private findClip(clips: THREE.AnimationClip[], keywords: string[]): THREE.AnimationClip | null {
    for (const clip of clips) {
      const name = clip.name.toLowerCase();
      for (const keyword of keywords) {
        if (name.includes(keyword)) return clip;
      }
    }
    return null;
  }

  private isEmissive(mat: THREE.Material): boolean {
    if (!('emissive' in mat)) return false;
    const emissive = (mat as THREE.MeshStandardMaterial).emissive;
    if (!emissive) return false;
    const intensity = (mat as THREE.MeshStandardMaterial).emissiveIntensity ?? 1;
    return (emissive.r > 0.01 || emissive.g > 0.01 || emissive.b > 0.01) && intensity > 0.01;
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
    dashing: boolean,
    swinging: boolean,
  ): void {
    this.group.position.set(worldX, 0, -worldY);
    this.elapsed += dt;

    const speed = Math.hypot(moveX, moveY);
    const moving = speed > 0.05;

    // Smoothly face the aim direction (upper body + sword).
    const aimLen = Math.hypot(aimX, aimY);
    if (aimLen > 0.001) {
      const target = Math.atan2(aimX, -aimY);
      let diff = target - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 14);
    }

    // Legs orient toward travel when moving, toward aim when idle. The torso is
    // counter-rotated so the upper body + sword always stay locked on the aim.
    const legsTarget = moving ? Math.atan2(moveX, -moveY) : this.facingAngle;
    let offset = legsTarget - this.facingAngle;
    while (offset > Math.PI) offset -= Math.PI * 2;
    while (offset < -Math.PI) offset += Math.PI * 2;
    this.legsYaw += (offset - this.legsYaw) * Math.min(1, dt * 10);

    const sink = wading ? -0.24 : 0;

    // Smoothly blend locomotion intensity (0 idle -> 1 full stride) so pressing
    // or releasing WASD never snaps the limbs, and blend the stride bounce in
    // and out on the same damp instead of popping the hips.
    const targetMove = moving ? 1 : 0;
    this.moveBlend += (targetMove - this.moveBlend) * (1 - Math.exp(-12 * dt));

    if (moving) {
      this.walkPhase += dt * speed * (sprint ? SPRINT_RATE : WALK_RATE);
    }

    const strideBob = Math.abs(Math.cos(this.walkPhase)) * 0.06;
    const idleBob = Math.sin(this.elapsed * 2.0) * 0.015;
    const bob = idleBob * (1 - this.moveBlend) + strideBob * this.moveBlend;

    this.applyProceduralPose(dt, sink, bob, moving, speed, dashing);
    this.updateGltf(dt, moving, swinging, sink);

    // Mirror facing + a gentle idle breath onto the portrait rig so the HUD
    // portrait stays live.
    this.portraitModel.rotation.y = this.facingAngle;
    this.portraitRig.torso.rotation.x =
      this.torsoBaseRotX + Math.sin(this.elapsed * 2.0) * 0.04;
    this.portraitRig.hips.position.y =
      this.hipsBaseY + Math.sin(this.elapsed * 2.0) * 0.015;
  }

  private applyProceduralPose(
    dt: number,
    sink: number,
    bob: number,
    moving: boolean,
    speed: number,
    dashing: boolean,
  ): void {
    this.model.rotation.y = this.facingAngle;
    this.model.position.y = sink;

    const b = this.moveBlend;
    const swing = Math.sin(this.walkPhase);

    // Natural gait: thighs swing opposite, knees bend backward during the
    // recovery lift, elbows bend on the free arm, and the torso/hips
    // counter-rotate into each stride.
    const legSwing = swing * LEG_SWING_AMPLITUDE * b;
    const armSwing = -swing * ARM_SWING_AMPLITUDE * b;
    const kneeBendL = Math.max(0, -Math.sin(this.walkPhase - 0.35)) * KNEE_BEND_AMPLITUDE * b;
    const kneeBendR = Math.max(0, Math.sin(this.walkPhase - 0.35)) * KNEE_BEND_AMPLITUDE * b;
    const elbowBendL = Math.max(0, -Math.sin(this.walkPhase - 0.9)) * ELBOW_BEND_AMPLITUDE * b;
    const elbowBendR = Math.max(0, Math.sin(this.walkPhase - 0.9)) * ELBOW_BEND_AMPLITUDE * b;

    // Poised athletic idle stance (slight foot / arm offsets).
    const idleLeg = 0.09 * (1 - b);
    const idleArm = 0.14 * (1 - b);

    this.rig.hips.position.y = this.hipsBaseY + bob;
    this.rig.hips.rotation.y = this.legsYaw + swing * HIPS_COUNTER_AMPLITUDE * b;
    this.rig.torso.rotation.y = -this.legsYaw - swing * TORSO_COUNTER_AMPLITUDE * b;

    this.rig.leftLeg.rotation.x = legSwing + idleLeg;
    this.rig.rightLeg.rotation.x = -legSwing - idleLeg;
    this.rig.leftKnee.rotation.x = kneeBendL;
    this.rig.rightKnee.rotation.x = kneeBendR;
    this.rig.leftArm.rotation.x = armSwing + idleArm;
    this.rig.rightArm.rotation.x = -armSwing - idleArm;
    this.rig.leftElbow.rotation.x = elbowBendL;
    this.rig.rightElbow.rotation.x = elbowBendR;

    // Torso lean: forward while moving, strongest during a dash, with a slow
    // idle chest/shoulder breath.
    const breath = Math.sin(this.elapsed * 2.0) * (moving ? 0 : 0.03);
    const lean = dashing ? 0.36 : moving ? 0.16 : 0.04;
    this.torsoLean += (lean + breath - this.torsoLean) * Math.min(1, dt * 10);
    this.rig.torso.rotation.x = this.torsoBaseRotX + this.torsoLean;

    // Cape flutter: swept back proportionally to speed, strongest during a dash.
    const capeTarget = dashing ? 0.5 : moving ? speed * 0.14 : 0.06;
    this.capePitch += (capeTarget - this.capePitch) * Math.min(1, dt * 10);
    this.rig.cape.rotation.x = this.capeBaseRotX + this.capePitch;
  }

  private updateGltf(dt: number, moving: boolean, swinging: boolean, sink: number): void {
    if (!this.mixer || !this.gltfRoot) return;

    this.gltfRoot.rotation.y = this.facingAngle;
    this.gltfRoot.position.y = sink;

    // Latch a short attack window on each new swing so the slash clip plays out.
    if (swinging && !this.wasSwinging) {
      this.attackTimer = Math.max(this.attackTimer, 0.28);
    }
    this.wasSwinging = swinging;
    this.attackTimer = Math.max(0, this.attackTimer - dt);

    let action: THREE.AnimationAction | null;
    if (this.attackTimer > 0) action = this.gltfActions.attack;
    else if (moving) action = this.gltfActions.run;
    else action = this.gltfActions.idle;

    if (action && action !== this.currentAction) {
      action.reset();
      action.fadeIn(0.25);
      action.play();
      if (this.currentAction) this.currentAction.fadeOut(0.25);
      this.currentAction = action;
    }

    this.mixer.update(dt);
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
    this.contactShadow.geometry.dispose();
    (this.contactShadow.material as THREE.Material).dispose();
    this.portraitRT.dispose();

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    if (this.gltfRoot) {
      disposeModelTree(this.gltfRoot);
      this.gltfRoot = null;
    }
  }
}
