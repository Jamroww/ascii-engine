import * as THREE from 'three';
import type { IRenderLayer, InputState } from './types';
import { InputManager } from './InputManager';
import { CollisionSystem } from './CollisionSystem';
import { PlayerStats } from './PlayerStats';
import { EnemyManager } from './EnemyManager';
import { ProgressionSystem } from './ProgressionSystem';
import { GlyphAtlas } from '../rendering/GlyphAtlas';
import { AsciiPostProcess } from '../rendering/AsciiPostProcess';
import { Player3D } from '../rendering/Player3D';
import { Weapon } from '../rendering/Weapon';
import type { WeaponAssetId } from '../rendering/Weapons';
import { EnemyLayer } from '../rendering/EnemyLayer';
import { Hud } from '../ui/Hud';
import { DialogueBox } from '../ui/DialogueBox';
import { InventoryModal } from '../ui/InventoryModal';
import { InventorySystem } from './InventorySystem';
import { WORLD_BOUNDS, PLAYER_RADIUS } from './world';
import type { TerrainGrid } from './TerrainGrid';
import type { LevelManager } from './LevelManager';
import type { PlacedEntity } from '../data/levelTypes';

const HITSTOP_DURATION = 0.028;
const SHAKE_DURATION = 0.22;
const RESPAWN_DELAY = 0.8;

// Interaction + Radiant Burst tuning.
const INTERACT_RANGE = 2.8;
const RADIANT_COOLDOWN = 5.0;
const RADIANT_RADIUS = 5.5;
const RADIANT_DAMAGE = 15;
const RADIANT_STAMINA = 25;
const RADIANT_HEAL = 25;
const RADIANT_STUN_DURATION = 1.2;
const RADIANT_BURST_DURATION = 2.5;

// Tilted 3/4 camera framing: high above and to the south, looking down-north.
const CAMERA_HEIGHT = 24;
const CAMERA_BACK = 21;
const LOOK_HEIGHT = 0.6;

export class Engine {
  public readonly atlas: GlyphAtlas;
  public readonly collision = new CollisionSystem();
  public readonly scene: THREE.Scene;

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private readonly input: InputManager;
  private terrain: TerrainGrid | null = null;
  private levelManager: LevelManager | null = null;

  private readonly player3D: Player3D;
  public readonly weapon: Weapon;
  private readonly postProcess: AsciiPostProcess;
  private readonly hud: Hud;
  private readonly dialogueBox: DialogueBox;
  private readonly inventoryModal: InventoryModal;
  public readonly stats = new PlayerStats();
  public readonly enemies: EnemyManager;
  public readonly progression = new ProgressionSystem();
  public readonly inventory = new InventorySystem();
  private readonly layers: IRenderLayer[] = [];

  // Nocturnal lighting rig.
  private readonly moonLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly lanternLight: THREE.PointLight;

  // Cached raycast helpers for screen -> ground-plane picking.
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndcVec = new THREE.Vector2();
  private readonly hitVec = new THREE.Vector3();

  private viewHeight = 26;
  private editorMode = false;
  public readonly playerPos = new THREE.Vector2(0, 0);
  private readonly clock = new THREE.Clock();
  private rafId: number | null = null;

  // Combat feedback + respawn state.
  private hitstopTimer = 0;
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private knockbackX = 0;
  private knockbackY = 0;
  private respawnPending = false;
  private respawnTimer = 0;
  private readonly spawnPoint = new THREE.Vector2(0, 0);

  // Dash + ability + dialogue state.
  private dashDirX = 0;
  private dashDirY = 0;
  private radiantCooldown = 0;
  private radiantBurstTimer = 0;
  private dialogueOpen = false;
  private inventoryOpen = false;
  private currentInteract: PlacedEntity | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      (-this.viewHeight * aspect) / 2,
      (this.viewHeight * aspect) / 2,
      this.viewHeight / 2,
      -this.viewHeight / 2,
      0.1,
      100,
    );
    this.camera.position.set(0, CAMERA_HEIGHT, CAMERA_BACK);
    this.camera.lookAt(0, LOOK_HEIGHT, 0);

    this.input = new InputManager(container);
    this.atlas = new GlyphAtlas();

    this.postProcess = new AsciiPostProcess(this.atlas);

    this.player3D = new Player3D();
    this.scene.add(this.player3D.group);
    this.weapon = new Weapon(this.player3D.handPivot);

    // Real PCF soft-shadow moonlight from the south-west, tracking the player.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.moonLight = new THREE.DirectionalLight(0xdfe8ff, 2.2);
    this.moonLight.position.set(-16, 28, 16);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    const shadowCam = this.moonLight.shadow.camera;
    shadowCam.left = -28;
    shadowCam.right = 28;
    shadowCam.top = 28;
    shadowCam.bottom = -28;
    shadowCam.near = 1;
    shadowCam.far = 90;
    shadowCam.updateProjectionMatrix();
    this.moonLight.shadow.bias = -0.0004;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x6a829c, 0x1a241e, 0.45);
    this.scene.add(this.hemiLight);

    // Soft physically-decaying warm hip lantern.
    this.lanternLight = new THREE.PointLight(0xff9933, 1.8, 7, 2);
    this.lanternLight.position.set(0, 0.9, 0);
    this.scene.add(this.lanternLight);

    this.enemies = new EnemyManager(this);
    this.addLayer(new EnemyLayer(this.enemies));

    this.hud = new Hud(container);
    this.dialogueBox = new DialogueBox(container);
    this.inventoryModal = new InventoryModal(container, this.inventory, this.progression);

    // The sidebar [I] button toggles the gear & quest screen.
    this.hud.setInventoryHandler(() => this.toggleInventory());

    // Shrine purification heals the player through this handler.
    this.progression.setHealHandler((amount) => this.stats.heal(amount));

    this.applyViewport();
    this.postProcess.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
    this.camera.updateMatrixWorld(true);
    window.addEventListener('resize', this.onResize);
  }

  public addLayer(layer: IRenderLayer): void {
    this.layers.push(layer);
    this.scene.add(layer.object3D);
  }

  public removeLayer(layer: IRenderLayer): void {
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
    this.scene.remove(layer.object3D);
  }

  public setTerrain(terrain: TerrainGrid): void {
    this.terrain = terrain;
  }

  public setLevelManager(levelManager: LevelManager): void {
    this.levelManager = levelManager;
  }

  public setPlayerPosition(x: number, y: number): void {
    this.playerPos.set(x, y);
  }

  public setSpawnPoint(x: number, y: number): void {
    this.spawnPoint.set(x, y);
  }

  /** Freeze the simulation for a few frames on a melee connect. */
  public triggerHitstop(duration = HITSTOP_DURATION): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, duration);
  }

  /** Nudge the camera for a short, decaying shake. */
  public triggerShake(intensity = 0.18, duration = SHAKE_DURATION): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  /** Add a knockback velocity to the player (decays smoothly in the sim step). */
  public applyPlayerKnockback(vx: number, vy: number): void {
    this.knockbackX = vx;
    this.knockbackY = vy;
  }

  /** Reset transient combat state when (re)loading a level. */
  public resetCombatState(): void {
    this.hitstopTimer = 0;
    this.shakeTimer = 0;
    this.shakeIntensity = 0;
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.respawnPending = false;
    this.respawnTimer = 0;
    this.stats.reset();
    this.radiantCooldown = 0;
    this.radiantBurstTimer = 0;
    this.currentInteract = null;
    if (this.dialogueBox.isOpen) {
      this.dialogueBox.close();
      this.dialogueOpen = false;
    }
    if (this.inventoryModal.isOpen) {
      this.inventoryModal.close();
      this.inventoryOpen = false;
    }
  }

  /**
   * Toggle the dev editor's free camera mode. While enabled, player movement,
   * wading damage, stamina drain and weapon swings are paused so WASD/arrows can
   * pan the camera instead.
   */
  public setEditorMode(enabled: boolean): void {
    this.editorMode = enabled;
    if (enabled) {
      // Clear any queued attack so enabling the editor never fires a stale swing.
      this.input.takeAttack();
    }
  }

  /** The WebGL canvas the editor attaches its pointer handlers to. */
  public get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Convert pointer client coordinates into world-space (x, y) on the Y = 0 plane. */
  public screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { x: this.playerPos.x, y: this.playerPos.y };
    }
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return this.ndcToWorld(ndcX, ndcY);
  }

  /** Raycast a normalised-device point through the tilted camera onto Y = 0. */
  private ndcToWorld(ndcX: number, ndcY: number): { x: number; y: number } {
    this.ndcVec.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndcVec, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hitVec)) {
      return { x: this.hitVec.x, y: -this.hitVec.z };
    }
    return { x: this.playerPos.x, y: this.playerPos.y };
  }

  public start(): void {
    this.clock.start();
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.update(dt, elapsed);

      this.player3D.renderPortrait(this.renderer);
      for (const layer of this.layers) {
        layer.preRender?.(this.renderer);
      }

      // worldScene -> sceneRT -> AsciiPostProcess -> screen.
      this.postProcess.render(this.renderer, this.scene, this.camera);
    };
    tick();
  }

  private get aspect(): number {
    return this.container.clientWidth / this.container.clientHeight;
  }

  private applyViewport(): void {
    const aspect = this.aspect;
    this.camera.left = (-this.viewHeight * aspect) / 2;
    this.camera.right = (this.viewHeight * aspect) / 2;
    this.camera.top = this.viewHeight / 2;
    this.camera.bottom = -this.viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  private update(dt: number, elapsed: number): void {
    const state = this.input.getState();

    // Camera zoom (scroll in / out), paused while a modal is open.
    const wheel = this.input.takeWheelDelta();
    if (wheel !== 0 && !this.dialogueOpen && !this.inventoryOpen) {
      this.viewHeight = THREE.MathUtils.clamp(this.viewHeight * Math.exp(wheel * 0.0015), 18, 36);
      this.applyViewport();
    }

    // Combat feedback timers decay on wall-clock time even while hitstop holds.
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.radiantBurstTimer = Math.max(0, this.radiantBurstTimer - dt);

    // I / Tab toggles the inventory & quest screen.
    if (this.input.consumeInventory()) {
      this.toggleInventory();
    }

    if (this.dialogueOpen) {
      this.updateDialogue();
    } else if (this.inventoryOpen) {
      this.updateInventory();
    } else {
      this.input.consumeCancel();
      if (this.editorMode) {
        this.input.takeAttack();
        this.panEditorCamera(dt, state);
      } else if (this.hitstopTimer <= 0) {
        this.updateGameplay(dt, state);
      }
    }

    const ctx = {
      dt,
      elapsed,
      playerPos: { x: this.playerPos.x, y: this.playerPos.y },
      input: state,
      corruption: this.progression.corruption / 100,
      virtue: this.progression.virtue / 100,
    };

    for (const layer of this.layers) {
      layer.update(ctx);
    }

    const burst =
      this.radiantBurstTimer > 0
        ? Math.pow(this.radiantBurstTimer / RADIANT_BURST_DURATION, 1.5)
        : 0;
    this.postProcess.setBurstGlow(burst);
  }

  /** Modal dialogue: freeze the world and route E / Space / click to advance. */
  private updateDialogue(): void {
    const advance =
      this.input.takeAttack() ||
      this.input.consumeInteract() ||
      this.input.consumeDash();
    const cancel = this.input.consumeCancel();

    if (advance) {
      this.dialogueBox.advance();
    } else if (cancel) {
      this.dialogueBox.close();
    }

    // Drain the ability so a stray Q never fires on close.
    this.input.consumeLightAbility();

    if (!this.dialogueBox.isOpen) {
      this.dialogueOpen = false;
      this.drainGameplayInput();
    }
  }

  private drainGameplayInput(): void {
    this.input.takeAttack();
    this.input.consumeDash();
    this.input.consumeInteract();
    this.input.consumeLightAbility();
    this.input.consumeCancel();
  }

  /** Open/close the gear & quest screen (pauses the world like dialogue). */
  private toggleInventory(): void {
    if (this.dialogueOpen) return;
    this.inventoryOpen = !this.inventoryOpen;
    if (this.inventoryOpen) {
      this.inventoryModal.open();
    } else {
      this.inventoryModal.close();
    }
    this.drainGameplayInput();
  }

  /** Pause the world while the inventory is open; Esc closes it. */
  private updateInventory(): void {
    if (this.input.consumeCancel()) {
      this.inventoryOpen = false;
      this.inventoryModal.close();
      this.drainGameplayInput();
      return;
    }
    // Drain stray gameplay input so a queued swing / dash never fires on close.
    this.input.takeAttack();
    this.input.consumeDash();
    this.input.consumeInteract();
    this.input.consumeLightAbility();
  }

  private updateGameplay(dt: number, state: InputState): void {
    // Death pause: freeze the world, then respawn at the level's spawn point.
    if (this.respawnPending) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.doRespawn();
      }
      return;
    }

    // Feed corruption to the stats for Blight Dash + move-speed bonuses.
    this.stats.corruption = this.progression.corruption;

    // Wire equipped gear into stats, the sword and enemy combat each frame.
    const combat = this.inventory.getCombatStats();
    this.stats.applyEquipment(combat.bonusMaxHp, combat.bonusMaxStamina, combat.damageReduction);
    this.weapon.setCombat(combat.reach, combat.arcHalfAngle);
    this.weapon.setTint(combat.weaponTint.r, combat.weaponTint.g, combat.weaponTint.b);
    this.weapon.setWeaponAsset(`weapon_${this.inventory.equippedWeaponId}` as WeaponAssetId);
    this.enemies.swordDamage = combat.swordDamage;

    // Sword swings: left click only.
    if (this.input.takeAttack()) {
      this.weapon.swing();
    }

    // Radiant Burst (Q).
    if (this.input.consumeLightAbility()) {
      this.tryRadiantBurst();
    }

    // Interact (E).
    if (this.input.consumeInteract()) {
      this.tryInteract();
    }

    this.radiantCooldown = Math.max(0, this.radiantCooldown - dt);

    const moving = Math.hypot(state.moveX, state.moveY) > 0.05;
    const wading = this.terrain ? this.terrain.isInRiver(this.playerPos.x, this.playerPos.y) : false;
    // Blight Dash skims the river: no slowdown and no cold-water damage.
    const blightSkim = this.stats.isDashing && this.stats.isBlightDash;
    const effWading = wading && !blightSkim;

    const canSprint = this.stats.update(dt, state.sprint, moving, effWading);
    this.stats.updateDash(dt);

    // Aim vector (world space) for dash direction + sword aim.
    const aim = this.computeAim(state);
    let aimX = aim.x;
    let aimY = aim.y;

    // Dash (Space).
    if (this.input.consumeDash()) {
      this.tryStartDash(state, aimX, aimY);
    }

    const sprinting = state.sprint && canSprint && !this.stats.isDashing;

    // Movement: dash overrides normal movement for its short duration.
    if (this.stats.isDashing) {
      this.playerPos.x += this.dashDirX * this.stats.dashSpeed * dt;
      this.playerPos.y += this.dashDirY * this.stats.dashSpeed * dt;
    } else {
      const speed =
        (sprinting ? 10 : 5.5) *
        (1 + this.stats.moveSpeedBonus) *
        combat.speedMultiplier *
        (effWading ? 0.45 : 1);
      this.playerPos.x += (state.moveX * speed + this.knockbackX) * dt;
      this.playerPos.y += (state.moveY * speed + this.knockbackY) * dt;
    }

    // Knockback velocity decays fast so the micro-shove snaps back to control.
    const knockDecay = Math.exp(-10 * dt);
    this.knockbackX *= knockDecay;
    this.knockbackY *= knockDecay;

    this.collision.resolve(this.playerPos, PLAYER_RADIUS);

    const distFromCenter = this.playerPos.length();
    if (distFromCenter > WORLD_BOUNDS) {
      this.playerPos.multiplyScalar(WORLD_BOUNDS / distFromCenter);
    }

    this.updateFollowCamera(dt);

    // Recompute aim against the settled camera for the sword + facing.
    const settled = this.computeAim(state);
    aimX = settled.x;
    aimY = settled.y;

    this.player3D.update(
      dt,
      state.moveX,
      state.moveY,
      sprinting,
      effWading,
      aimX,
      aimY,
      this.playerPos.x,
      this.playerPos.y,
      this.stats.isDashing,
    );
    this.weapon.update(dt, aimX, aimY, this.playerPos.x, this.playerPos.y);

    // Enemy AI, sword/enemy hits and projectiles.
    this.enemies.update(dt);

    // Register death once, then hand off to the respawn pause.
    if (this.stats.isDead) {
      this.respawnPending = true;
      this.respawnTimer = RESPAWN_DELAY;
    }

    // Quest: once the upstream Blight is cleared, send the player home.
    if (this.progression.questStage === 'active' && this.enemies.getEnemies().length === 0) {
      this.progression.questStage = 'upstream_cleared';
      this.hud.showToast('The upstream Blight subsides — return to the Ferryman.');
      this.hud.flashInventoryButton();
    }

    this.updateInteractPrompt();
    this.hud.update({
      health: this.stats.health,
      maxHealth: this.stats.maxHealth,
      stamina: this.stats.stamina,
      maxStamina: this.stats.maxStamina,
      corruption: this.progression.corruption / 100,
      virtue: this.progression.virtue / 100,
      dashUnlocked: this.stats.isBlightDash,
      dashReady: this.stats.dashReady,
      dashCooldownFraction: this.stats.dashCooldownFraction,
      dashCooldownSeconds: this.stats.dashCooldownRemaining,
      radiantUnlocked: this.progression.virtue >= 25,
      radiantReady:
        this.progression.virtue >= 25 &&
        this.radiantCooldown <= 0 &&
        this.stats.stamina >= RADIANT_STAMINA,
      radiantCooldownFraction: this.radiantCooldown > 0 ? this.radiantCooldown / RADIANT_COOLDOWN : 0,
      radiantCooldownSeconds: this.radiantCooldown,
    });
    this.hud.drawPortrait(this.player3D.getPortraitPixels());
  }

  /** Aim vector from the mouse cursor (world space), relative to the player. */
  private computeAim(state: InputState): { x: number; y: number } {
    const world = this.ndcToWorld(state.mouseNdc.x, state.mouseNdc.y);
    return { x: world.x - this.playerPos.x, y: world.y - this.playerPos.y };
  }

  /** Smoothly track the tilted camera behind the player + move the moon light. */
  private updateFollowCamera(dt: number): void {
    const k = Math.min(1, dt * 8);
    this.camera.position.x += (this.playerPos.x - this.camera.position.x) * k;
    this.camera.position.y += (CAMERA_HEIGHT - this.camera.position.y) * k;
    this.camera.position.z += (-this.playerPos.y + CAMERA_BACK - this.camera.position.z) * k;

    if (this.shakeTimer > 0) {
      const amp = this.shakeIntensity * Math.min(1, this.shakeTimer / SHAKE_DURATION);
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.z += (Math.random() * 2 - 1) * amp;
    }
    this.camera.lookAt(this.playerPos.x, LOOK_HEIGHT, -this.playerPos.y);
    this.camera.updateMatrixWorld(true);

    // Track the moon light + its shadow frustum cleanly across the village.
    this.moonLight.position.set(this.playerPos.x - 16, 28, -this.playerPos.y + 16);
    this.moonLight.target.position.set(this.playerPos.x, 0, -this.playerPos.y);
    this.moonLight.target.updateMatrixWorld(true);

    this.lanternLight.position.set(this.playerPos.x, 0.9, -this.playerPos.y);
  }

  /** Start a dash in the current WASD direction (or toward the mouse if still). */
  private tryStartDash(state: InputState, aimX: number, aimY: number): void {
    if (!this.stats.tryStartDash()) return;

    const moving = Math.hypot(state.moveX, state.moveY) > 0.05;
    let dx: number;
    let dy: number;
    if (moving) {
      dx = state.moveX;
      dy = state.moveY;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
    } else {
      dx = aimX;
      dy = aimY;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) {
        dx = 0;
        dy = 1;
      } else {
        dx /= len;
        dy /= len;
      }
    }
    this.dashDirX = dx;
    this.dashDirY = dy;
  }

  /** Radiant Burst: heal, stun + damage nearby enemies, flare the post-process. */
  private tryRadiantBurst(): void {
    if (this.radiantCooldown > 0) return;
    if (this.progression.virtue < 25) return;
    if (!this.stats.spendStamina(RADIANT_STAMINA)) return;

    this.radiantCooldown = RADIANT_COOLDOWN;
    this.stats.heal(RADIANT_HEAL);
    this.enemies.radiantBurst(
      this.playerPos.x,
      this.playerPos.y,
      RADIANT_RADIUS,
      RADIANT_DAMAGE,
      RADIANT_STUN_DURATION,
    );
    this.radiantBurstTimer = RADIANT_BURST_DURATION;
    this.hud.showToast('Radiant Burst!');
  }

  /** Show a prompt for the nearest interactable within range, then act on E. */
  private updateInteractPrompt(): void {
    const lm = this.levelManager;
    if (!lm) {
      this.hud.setInteractPrompt(null);
      this.currentInteract = null;
      return;
    }

    let nearest: PlacedEntity | null = null;
    let bestDist = INTERACT_RANGE;
    for (const e of lm.getInteractableEntities()) {
      if (e.kind === 'node' && this.progression.absorbedNodeIds.has(e.id)) continue;
      if (e.kind === 'shrine' && this.progression.purifiedShrineIds.has(e.id)) continue;
      const d = Math.hypot(e.x - this.playerPos.x, e.y - this.playerPos.y);
      if (d <= bestDist) {
        bestDist = d;
        nearest = e;
      }
    }

    this.currentInteract = nearest;
    lm.setInteractableHighlight(nearest ? nearest.id : null);
    if (nearest) {
      this.hud.setInteractPrompt(this.interactPromptFor(nearest));
    } else {
      this.hud.setInteractPrompt(null);
    }
  }

  private interactPromptFor(e: PlacedEntity): string {
    switch (e.kind) {
      case 'npc': {
        const speaker = this.progression.getDialogueLines(e.assetId).speaker;
        return `[E] Talk — ${speaker}`;
      }
      case 'node':
        return '[E] Absorb Poison Node (+Corruption / Blight Dash)';
      case 'shrine':
        return '[E] Purify Light Shrine (+Virtue / Radiant Burst)';
      default:
        return '[E] Interact';
    }
  }

  private tryInteract(): void {
    const lm = this.levelManager;
    if (!lm || !this.currentInteract) return;
    const e = this.currentInteract;

    switch (e.kind) {
      case 'npc':
        this.openNpcDialogue(e);
        break;
      case 'node':
        if (this.progression.absorbPoisonNode(e.id)) {
          lm.absorbPoisonNode(e.id);
          this.hud.showToast('Absorbed Poison Node — the Blight surges within you.');
        }
        break;
      case 'shrine':
        if (this.progression.purifyLightShrine(e.id)) {
          lm.purifyShrine(e.id);
          this.hud.showToast('Light Shrine purified — warm light floods through you.');
        }
        break;
      default:
        break;
    }
  }

  private openNpcDialogue(e: PlacedEntity): void {
    const data = this.progression.getDialogueLines(e.assetId);
    this.dialogueBox.open(data);
    this.dialogueOpen = true;

    // The Ferryman drives the quest stage transitions.
    if (e.assetId === 'npc_ferryman') {
      if (this.progression.questStage === 'not_started') {
        this.progression.questStage = 'active';
        this.hud.showToast('The Tainted Catch — clear the upstream Blight.');
        this.hud.flashInventoryButton();
      } else if (this.progression.questStage === 'upstream_cleared') {
        this.progression.questStage = 'completed';
        this.hud.showToast('The Tainted Catch complete — the river runs clean.');
        this.hud.flashInventoryButton();
      }
    }
  }

  private doRespawn(): void {
    this.respawnPending = false;
    this.stats.reset();
    this.enemies.reset();
    this.playerPos.set(this.spawnPoint.x, this.spawnPoint.y);
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.camera.position.set(this.spawnPoint.x, CAMERA_HEIGHT, -this.spawnPoint.y + CAMERA_BACK);
    this.camera.lookAt(this.spawnPoint.x, LOOK_HEIGHT, -this.spawnPoint.y);
    this.camera.updateMatrixWorld(true);
  }

  /** WASD/arrow panning across the world while the editor is active. */
  private panEditorCamera(dt: number, state: InputState): void {
    const panSpeed = 16;
    this.camera.position.x += state.moveX * panSpeed * dt;
    this.camera.position.z -= state.moveY * panSpeed * dt;
    const limit = 30;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -limit, limit);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -limit, limit);
    this.camera.lookAt(this.camera.position.x, LOOK_HEIGHT, this.camera.position.z - CAMERA_BACK);
    this.camera.updateMatrixWorld(true);
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.applyViewport();
    this.postProcess.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
  };

  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.player3D.dispose();
    this.weapon.dispose();
    this.hud.dispose();
    this.dialogueBox.dispose();
    this.inventoryModal.dispose();
    for (const layer of this.layers) {
      layer.dispose();
    }
    this.postProcess.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
  }
}
