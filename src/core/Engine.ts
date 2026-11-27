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
import type { CustomLevelListItem, ModalServices, PlaytestTuning } from '../ui/InventoryModal';
import { StartScreen } from '../ui/StartScreen';
import { DeathScreen } from '../ui/DeathScreen';
import { InventorySystem } from './InventorySystem';
import { WORLD_BOUNDS, PLAYER_RADIUS } from './world';
import type { TerrainGrid } from './TerrainGrid';
import { LevelManager } from './LevelManager';
import { AssetRegistry } from '../data/AssetRegistry';
import {
  clonePalette,
  getLevelTheme,
  hexToColor,
  type LevelTheme,
  type PaletteConfig,
  type PaletteChannel,
} from './LevelTheme';
import type { CustomPngAsset, LevelData, PlacedEntity } from '../data/levelTypes';

const HITSTOP_DURATION = 0.028;
const SHAKE_DURATION = 0.22;
const CAMERA_LEAN_STORAGE_KEY = 'ascii-engine.camera-lean';
const PLAYTEST_TUNING_KEY = 'ascii-engine.playtest-tuning';

// Health Flask tuning.
const POTION_COOLDOWN = 0.8;
const POTION_HEAL_FRACTION = 0.45;
const POTION_PULSE_DURATION = 0.6;

const DEFAULT_TUNING: PlaytestTuning = {
  maxHealth: 100,
  maxStamina: 200,
  healthRegen: 0,
  staminaRegen: 22,
};

// Interaction + Radiant Burst tuning.
const INTERACT_RANGE = 2.8;
const RADIANT_COOLDOWN = 5.0;
const RADIANT_RADIUS = 5.5;
const RADIANT_DAMAGE = 15;
const RADIANT_STAMINA = 25;
const RADIANT_HEAL = 25;
const RADIANT_STUN_DURATION = 1.2;
const RADIANT_BURST_DURATION = 2.5;

// Right-click parry tuning.
const PARRY_COOLDOWN = 0.55;
const PARRY_WINDOW = 0.30;
const PARRY_STAMINA_COST = 10;
const PARRY_SUCCESS_COOLDOWN = 0.15;
const PARRY_STAMINA_REFUND = 35;
const PARRY_FLASH_DURATION = 0.1;
const BOSS_AGGRO_RANGE = 22;

// Tilted 3/4 camera framing: high above and to the south, looking down-north.
// A ~38 degree elevation (19 up / 24 back) shows front walls, doorways, warm
// windows, porches and upright NPCs instead of mostly dark rooftops.
const CAMERA_HEIGHT = 19;
const CAMERA_BACK = 24;
const LOOK_HEIGHT = 0.7;

// Directional shadow map: a 64-unit-wide frustum snapped to texel increments so
// shadows never crawl/shimmer and no frustum seam enters the viewport.
const SHADOW_MAP_SIZE = 2048;
const SHADOW_FRUSTUM_HALF = 32;

export class Engine {
  public readonly atlas: GlyphAtlas;
  public readonly collision = new CollisionSystem();
  public readonly scene: THREE.Scene;
  /** Depth-tested 3D grass, composited over the ASCII pass. */
  public readonly grassScene = new THREE.Scene();
  /** Rain / fireflies / blight spores, rendered above the composite. */
  public readonly weatherScene = new THREE.Scene();
  /** Dev-editor collider rings, rendered last and always on top. */
  public readonly overlayScene = new THREE.Scene();
  /** Water plane reference, hidden during the depth-only prepass. */
  public waterObject: THREE.Object3D | null = null;

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
  private readonly startScreen: StartScreen;
  private readonly deathScreen: DeathScreen;
  public readonly stats = new PlayerStats();
  public readonly enemies: EnemyManager;
  private readonly enemyLayer: EnemyLayer;
  public readonly progression = new ProgressionSystem();
  public readonly inventory = new InventorySystem();
  private readonly layers: IRenderLayer[] = [];

  // Nocturnal lighting rig.
  private readonly moonLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly lanternLight: THREE.PointLight;

  // Level theme + live palette (Level 1 midnight harbor vs Level 2 sunset field).
  private activeTheme: LevelTheme = getLevelTheme('act1_harbor');
  private activePalette: PaletteConfig = clonePalette(getLevelTheme('act1_harbor').palette);
  private readonly sunOffset = new THREE.Vector3(-16, 28, 16);

  // Half-res transparent target capturing the mirrored player for the water
  // reflection (one lightweight draw call per frame).
  private readonly playerReflectionRT: THREE.WebGLRenderTarget;
  private readonly reflectionSize = new THREE.Vector2();

  // Cached raycast helpers for screen -> ground-plane picking.
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndcVec = new THREE.Vector2();
  private readonly hitVec = new THREE.Vector3();

  private viewHeight = 14.5;
  private editorMode = false;
  public readonly playerPos = new THREE.Vector2(0, 0);
  private readonly clock = new THREE.Clock();
  private rafId: number | null = null;

  // Camera lean/sway on A/D strafing, persisted and user-toggleable from the
  // Settings tab. Defaults to OFF so movement is rock-steady out of the box.
  private cameraLeanEnabled = this.loadCameraLeanEnabled();
  private leanAmount = 0;

  // Combat feedback + respawn state.
  private hitstopTimer = 0;
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private knockbackX = 0;
  private knockbackY = 0;
  private readonly spawnPoint = new THREE.Vector2(0, 0);

  // Dash + ability + dialogue state.
  private dashDirX = 0;
  private dashDirY = 0;
  private radiantCooldown = 0;
  private radiantBurstTimer = 0;
  private dialogueOpen = false;
  private inventoryOpen = false;
  private currentInteract: PlacedEntity | null = null;
  private pendingRoninStart = false;
  private pendingRoninPhase2 = false;
  private roninInteract = false;
  private roninFightActive = false;

  // Screen state (start screen / death screen) + flask state.
  private startScreenActive = true;
  private deathScreenActive = false;
  private deathContext: string | null = null;
  private potionCooldown = 0;
  private potionPulseTimer = 0;

  // Parry state + live aim direction (world space) for projectile deflects.
  private parryCooldown = 0;
  private parryActiveTimer = 0;
  private parryFlashTimer = 0;
  public aimX = 0;
  public aimY = 1;

  // Directional camera punch (decays quickly) + lazily-created clang synth.
  private punchX = 0;
  private punchZ = 0;
  private audioContext: AudioContext | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x000000, 1);
    // Every clear is managed explicitly by the multi-pass renderer so a stray
    // autoClear can never wipe the ASCII pass underneath the overlays.
    this.renderer.autoClear = false;
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

    // Half-res transparent target for the exact-height player reflection.
    this.playerReflectionRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    this.resizePlayerReflection();

    // Real PCF soft-shadow moonlight from the south-west, tracking the player.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadow maps are updated exactly once per frame, right before the main
    // world render (AsciiPostProcess sets `needsUpdate`). Keeping autoUpdate
    // off prevents the depth prepass and the HUD portrait from re-rendering
    // them (a per-frame GPU cost that caused movement stutter).
    this.renderer.shadowMap.autoUpdate = false;

    this.moonLight = new THREE.DirectionalLight(0xe2eeff, 3.0);
    this.moonLight.position.set(-16, 28, 16);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const shadowCam = this.moonLight.shadow.camera;
    shadowCam.left = -SHADOW_FRUSTUM_HALF;
    shadowCam.right = SHADOW_FRUSTUM_HALF;
    shadowCam.top = SHADOW_FRUSTUM_HALF;
    shadowCam.bottom = -SHADOW_FRUSTUM_HALF;
    shadowCam.near = 1;
    shadowCam.far = 90;
    shadowCam.updateProjectionMatrix();
    // Small negative depth bias + a normal bias keeps PCF shadows acne-free and
    // lets the widened frustum never draw a seam through the viewport.
    this.moonLight.shadow.bias = -0.0002;
    this.moonLight.shadow.normalBias = 0.02;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // Almost no ambient fill: unlit sides of trees/rocks/buildings drop into
    // pure black, letting the directional moonlight carve the chiaroscuro.
    this.hemiLight = new THREE.HemisphereLight(0x7c98b8, 0x1b2822, 0.34);
    this.scene.add(this.hemiLight);

    // Soft, tight physically-decaying warm hip lantern (never washes the ground).
    this.lanternLight = new THREE.PointLight(0xff9900, 1.0, 5.5, 2);
    this.lanternLight.position.set(0, 0.9, 0);
    this.scene.add(this.lanternLight);

    this.enemies = new EnemyManager(this);
    this.enemyLayer = new EnemyLayer(this.enemies);
    this.addLayer(this.enemyLayer);

    this.hud = new Hud(container);
    this.dialogueBox = new DialogueBox(container);

    // Apply persisted playtest tuning before the first level load resets stats.
    this.applyTuning(this.loadTuning());
    // Restore any user-imported PNG assets from localStorage.
    AssetRegistry.loadCustomPngs();

    const services: ModalServices = {
      getTuning: () => this.getTuning(),
      setMaxHealth: (v) => this.setMaxHealth(v),
      setMaxStamina: (v) => this.setMaxStamina(v),
      setHealthRegen: (v) => this.setHealthRegen(v),
      setStaminaRegen: (v) => this.setStaminaRegen(v),
      resetStats: () => this.resetStats(),
      getCustomAssets: () => AssetRegistry.getCustomPngAssets(),
      registerPng: (asset) => this.registerCustomPng(asset),
      deletePng: (id) => this.deleteCustomPng(id),
      exportLevel: () => this.exportLevelJson(),
      loadLevelFromJson: (json) => this.loadLevelFromJson(json),
      getCustomLevels: () => this.getCustomLevels(),
      playCustomLevel: (id) => this.loadLevel(id),
      returnToTitle: () => this.returnToTitle(),
    };

    this.inventoryModal = new InventoryModal(
      container,
      this.inventory,
      this.progression,
      {
        getCameraLeanEnabled: () => this.cameraLeanEnabled,
        setCameraLeanEnabled: (enabled) => this.setCameraLeanEnabled(enabled),
      },
      {
        getActiveLevelId: () => this.activeTheme.id,
        loadLevel: (id) => this.loadLevel(id),
        getPalette: () => this.activePalette,
        setPaletteChannel: (channel, hex) => this.setPaletteChannel(channel, hex),
        resetPalette: () => this.resetPalette(),
      },
      services,
    );

    this.startScreen = new StartScreen(container, {
      onSelectLevel: (id) => this.loadLevel(id),
      onOpenOptions: () => this.openModalFromTitle('settings'),
      onOpenAssets: () => this.openModalFromTitle('assets'),
      getCustomLevels: () => this.getCustomLevels(),
    });

    this.deathScreen = new DeathScreen(container, {
      onRetry: () => this.retryAttempt(),
      onMainMenu: () => this.returnToTitle(),
    });

    // The sidebar [I] button toggles the gear & quest screen.
    this.hud.setInventoryHandler(() => this.toggleInventory());

    // Shrine purification heals the player through this handler.
    this.progression.setHealHandler((amount) => this.stats.heal(amount));

    // Start on the Title Screen over the live world; hide the HUD until play.
    this.startScreen.show();
    this.hud.setVisible(false);

    this.applyViewport();
    this.postProcess.setSize(this.renderer);
    this.camera.updateMatrixWorld(true);
    window.addEventListener('resize', this.onResize);
  }

  public addLayer(layer: IRenderLayer): void {
    this.layers.push(layer);
    this.scene.add(layer.object3D);
  }

  /** Add a layer whose object renders in the separate depth-tested grass pass. */
  public addGrassLayer(layer: IRenderLayer): void {
    this.layers.push(layer);
    this.grassScene.add(layer.object3D);
  }

  /** Add a layer whose object renders above the ASCII + grass composite. */
  public addWeatherLayer(layer: IRenderLayer): void {
    this.layers.push(layer);
    this.weatherScene.add(layer.object3D);
  }

  public removeLayer(layer: IRenderLayer): void {
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
    this.scene.remove(layer.object3D);
    this.grassScene.remove(layer.object3D);
    this.weatherScene.remove(layer.object3D);
  }

  public setTerrain(terrain: TerrainGrid): void {
    this.terrain = terrain;
  }

  public setLevelManager(levelManager: LevelManager): void {
    this.levelManager = levelManager;
  }

  /** Load a level by id (built-in or custom, used by selectors + Start Screen). */
  public loadLevel(id: string): void {
    let data: LevelData;
    if (id === 'act2_wheatfield') {
      data = LevelManager.createSunsetWheatfieldLevel();
    } else if (id === 'act1_harbor') {
      data = LevelManager.createDefaultVillageLevel();
    } else {
      const custom = this.levelManager?.getCustomLevel(id);
      if (!custom) return;
      data = custom;
    }
    this.beginLevelLoad(data);
  }

  /** Common reset + level handoff, then leave any menu / death screen. */
  private beginLevelLoad(data: LevelData): void {
    this.pendingRoninStart = false;
    this.pendingRoninPhase2 = false;
    this.roninInteract = false;
    this.roninFightActive = false;
    this.deathContext = null;
    this.startScreenActive = false;
    this.deathScreenActive = false;
    this.startScreen.hide();
    this.deathScreen.hide();
    this.hud.setVisible(true);
    this.levelManager?.loadLevel(data);
    this.closeInventory();
    this.drainGameplayInput();
  }

  /** Apply a level's theme to the lighting rig + post-process (called on load). */
  public applyTheme(theme: LevelTheme): void {
    this.activeTheme = theme;
    this.activePalette = clonePalette(theme.palette);
    this.sunOffset.set(theme.sunPosition.x, theme.sunPosition.y, theme.sunPosition.z);
    this.moonLight.intensity = theme.sunIntensity;
    this.hemiLight.intensity = theme.skyFillIntensity;
    this.syncPalette();
  }

  /** Live-edit one palette channel (HSV colour wheel / Palette Studio). */
  public setPaletteChannel(channel: PaletteChannel, hex: string): void {
    this.activePalette[channel] = hex;
    this.syncPalette();
  }

  /** Restore the active level's preset palette. */
  public resetPalette(): void {
    this.activePalette = clonePalette(this.activeTheme.palette);
    this.syncPalette();
  }

  /** Push the live palette into lights, post-process and foliage. */
  private syncPalette(): void {
    const p = this.activePalette;
    this.moonLight.color.set(p.sunColor);
    this.hemiLight.color.set(p.skyFillColor);
    this.hemiLight.groundColor.set(p.groundColor);
    this.postProcess.setBgColor(hexToColor(p.asciiVoidColor));
    this.postProcess.setBloomTint(hexToColor(p.bloomTint));
    this.levelManager?.setFoliageColors(hexToColor(p.foliageBase), hexToColor(p.foliageTip));
    this.levelManager?.setGroundColor(hexToColor(p.groundColor));
    this.levelManager?.setWaterColor(p.waterColor);
    this.levelManager?.setStructureColor(p.structureColor);
  }

  /** Close the inventory modal (used by the level selector). */
  private closeInventory(): void {
    if (this.inventoryOpen) {
      this.inventoryOpen = false;
      this.inventoryModal.close();
    }
  }

  public setPlayerPosition(x: number, y: number): void {
    this.playerPos.set(x, y);
  }

  public setSpawnPoint(x: number, y: number): void {
    this.spawnPoint.set(x, y);
  }

  /** Show a transient toast banner (used by level load + quest beats). */
  public showToast(text: string): void {
    this.hud.showToast(text);
  }

  /** True while the player's active parry window is open. */
  public isParryActive(): boolean {
    return this.parryActiveTimer > 0;
  }

  /** Parry payoff: refund stamina, cut cooldown, hitstop + camera punch + flash. */
  public onParrySuccess(): void {
    this.stats.restoreStamina(PARRY_STAMINA_REFUND);
    this.parryCooldown = Math.min(this.parryCooldown, PARRY_SUCCESS_COOLDOWN);
    this.triggerHitstop(0.08);
    this.triggerShake(0.3, 0.16);
    this.parryFlashTimer = PARRY_FLASH_DURATION;
  }

  /** Melee-only parry payoff: directional camera punch + synthesized clang. */
  public onMeleeParry(dirX: number, dirY: number): void {
    this.triggerCameraPunch(dirX, dirY, 0.5);
    this.playParryClang();
  }

  /** Blinding white screen flash (draw counter, parry counter, transitions). */
  public triggerScreenFlash(duration = PARRY_FLASH_DURATION): void {
    this.parryFlashTimer = Math.max(this.parryFlashTimer, duration);
  }

  /** Synthesized metallic clash, exposed for boss counters. */
  public playClang(): void {
    this.playParryClang();
  }

  /** Nudge the camera in a fixed world direction, decaying over a few frames. */
  public triggerCameraPunch(dirX: number, dirY: number, amount: number): void {
    this.punchX += dirX * amount;
    this.punchZ += -dirY * amount;
  }

  /**
   * Synthesized metallic sword clang (Web Audio). Created lazily on the first
   * parry so the AudioContext initialises inside a real user gesture; no
   * external audio assets are required.
   */
  private playParryClang(): void {
    try {
      if (!this.audioContext) {
        const Ctor =
          (window as { AudioContext?: typeof AudioContext }).AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.audioContext = new Ctor();
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.32, now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      master.connect(ctx.destination);

      // Ringing metallic partials through a tight bandpass.
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(2100, now);
      band.Q.setValueAtTime(7, now);
      band.connect(master);

      const partials = [1640, 2190, 980];
      for (const freq of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 36, now);
        osc.connect(band);
        osc.start(now);
        osc.stop(now + 0.24);
      }

      // Bright noise attack for the initial "clang" transient.
      const noiseFrames = Math.max(1, Math.floor(ctx.sampleRate * 0.04));
      const buffer = ctx.createBuffer(1, noiseFrames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.setValueAtTime(3200, now);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.5, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      noise.connect(high);
      high.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + 0.06);
    } catch {
      // Audio is best-effort; a missing context never interrupts combat.
    }
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
    this.stats.reset();
    this.radiantCooldown = 0;
    this.radiantBurstTimer = 0;
    this.parryCooldown = 0;
    this.parryActiveTimer = 0;
    this.parryFlashTimer = 0;
    this.punchX = 0;
    this.punchZ = 0;
    this.currentInteract = null;
    this.pendingRoninStart = false;
    this.pendingRoninPhase2 = false;
    this.roninInteract = false;
    this.roninFightActive = false;
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

  /** Whether the camera sways/leans into A/D strafing (default: off). */
  public getCameraLeanEnabled(): boolean {
    return this.cameraLeanEnabled;
  }

  /** Toggle camera lean/sway live, persisting the choice to localStorage. */
  public setCameraLeanEnabled(enabled: boolean): void {
    this.cameraLeanEnabled = enabled;
    try {
      localStorage.setItem(CAMERA_LEAN_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Storage may be unavailable (e.g. private mode); the toggle still works.
    }
  }

  private loadCameraLeanEnabled(): boolean {
    try {
      return localStorage.getItem(CAMERA_LEAN_STORAGE_KEY) === 'true';
    } catch {
      return false;
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

  /** Character roots isolated into the dedicated `charRT` by the post-process. */
  private getCharacterObjects(): THREE.Object3D[] {
    return [
      this.player3D.group,
      this.enemyLayer.object3D,
      ...(this.levelManager?.getCharacterObjects() ?? []),
    ];
  }

  public start(): void {
    this.clock.start();
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.update(dt, elapsed);

      this.player3D.renderPortrait(this.renderer, elapsed);
      for (const layer of this.layers) {
        layer.preRender?.(this.renderer);
      }

      this.renderPlayerReflection();

      // worldScene -> sceneRT -> AsciiPostProcess -> screen, then depth-tested
      // grass, weather and the editor overlay composited on top.
      this.postProcess.render(
        this.renderer,
        this.scene,
        this.camera,
        this.grassScene,
        this.weatherScene,
        this.overlayScene,
        this.waterObject,
        this.getCharacterObjects(),
      );
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

  /** Resize the half-res reflection target to half the drawing buffer. */
  private resizePlayerReflection(): void {
    this.renderer.getDrawingBufferSize(this.reflectionSize);
    const width = Math.max(1, Math.floor(this.reflectionSize.x / 2));
    const height = Math.max(1, Math.floor(this.reflectionSize.y / 2));
    this.playerReflectionRT.setSize(width, height);
  }

  /**
   * Capture the player plus the nearby shoreline world models and trees,
   * mirrored across the water plane (y = -0.05), into the half-res reflection
   * target. Exactly one extra draw call per frame.
   */
  private renderPlayerReflection(): void {
    if (!this.waterObject) return;

    const playerGroup = this.player3D.group;

    // Reflect the player and every shoreline world model + tree; hide the flat
    // ground/water planes, enemies and legacy billboards, but keep the lights
    // so the mirrored silhouettes stay moonlit.
    const reflectables: THREE.Object3D[] = [playerGroup];
    const hidden: THREE.Object3D[] = [];
    for (const child of this.scene.children) {
      if (child === playerGroup) continue;
      if ((child as THREE.Light).isLight) continue;
      if (child.userData.isWorldReflection === true) {
        reflectables.push(child);
      } else if (child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }

    // The mirrored meshes flip winding order, so render them double-sided to
    // avoid hollow/inside-out culling on cloaks, rooflines and canopies.
    const sides: Array<{ material: THREE.Material; side: THREE.Side }> = [];
    for (const reflectable of reflectables) {
      reflectable.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const m of material) {
            sides.push({ material: m, side: m.side });
            m.side = THREE.DoubleSide;
          }
        } else {
          sides.push({ material: material, side: material.side });
          material.side = THREE.DoubleSide;
        }
      });
    }

    const prevShadowEnabled = this.renderer.shadowMap.enabled;
    const prevTarget = this.renderer.getRenderTarget();
    const prevBackground = this.scene.background;
    const prevColor = new THREE.Color();
    this.renderer.getClearColor(prevColor);
    const prevAlpha = this.renderer.getClearAlpha();

    // Mirror each reflectable across y = -0.05: the base lands at y = -0.10 and
    // the body extends downward by its exact height, keeping the reflection
    // bounded to the character, buildings and trees.
    const transforms: Array<{ object: THREE.Object3D; scaleY: number; y: number }> = [];
    for (const reflectable of reflectables) {
      transforms.push({
        object: reflectable,
        scaleY: reflectable.scale.y,
        y: reflectable.position.y,
      });
      reflectable.scale.y = -1;
      reflectable.position.y = -0.10;
    }

    this.renderer.shadowMap.enabled = false;
    this.scene.background = null;

    this.renderer.setRenderTarget(this.playerReflectionRT);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevColor, prevAlpha);
    this.renderer.shadowMap.enabled = prevShadowEnabled;
    this.scene.background = prevBackground;

    for (const t of transforms) {
      t.object.scale.y = t.scaleY;
      t.object.position.y = t.y;
    }
    for (const s of sides) s.material.side = s.side;
    for (const child of hidden) child.visible = true;

    // Hand the fresh reflection + full-res drawing-buffer size to the water
    // shader so the screen-space UV lookup lines up exactly.
    const mesh = this.waterObject as THREE.Mesh | null;
    const material = mesh?.material as THREE.ShaderMaterial | undefined;
    if (material?.uniforms) {
      material.uniforms.uPlayerReflectionTex.value = this.playerReflectionRT.texture;
      this.renderer.getDrawingBufferSize(this.reflectionSize);
      (material.uniforms.uScreenResolution.value as THREE.Vector2).set(
        this.reflectionSize.x,
        this.reflectionSize.y,
      );
    }
  }

  private update(dt: number, elapsed: number): void {
    const state = this.input.getState();
    const screenPaused = this.startScreenActive || this.deathScreenActive;

    // Camera zoom (scroll in / out), paused while a modal or screen is open.
    const wheel = this.input.takeWheelDelta();
    if (wheel !== 0 && !this.dialogueOpen && !this.inventoryOpen && !screenPaused) {
      this.viewHeight = THREE.MathUtils.clamp(this.viewHeight * Math.exp(wheel * 0.0015), 9.0, 19.5);
      this.applyViewport();
    }

    // Combat feedback timers decay on wall-clock time even while hitstop holds.
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.radiantBurstTimer = Math.max(0, this.radiantBurstTimer - dt);
    this.parryFlashTimer = Math.max(0, this.parryFlashTimer - dt);
    this.potionPulseTimer = Math.max(0, this.potionPulseTimer - dt);
    this.potionCooldown = Math.max(0, this.potionCooldown - dt);
    const punchDecay = Math.exp(-10 * dt);
    this.punchX *= punchDecay;
    this.punchZ *= punchDecay;

    if (this.deathScreenActive) {
      // Fully frozen: pause movement, AI, regen and menus while the overlay shows.
      this.drainGameplayInput();
      this.input.consumeHeal();
      this.input.consumeInventory();
    } else if (this.startScreenActive) {
      // Title screen: the world keeps breathing, but gameplay stays frozen.
      if (this.inventoryOpen) {
        this.updateInventory();
      } else {
        this.drainGameplayInput();
        this.input.consumeHeal();
        this.input.consumeInventory();
      }
    } else if (this.input.consumeInventory()) {
      // I / Tab toggles the inventory & quest screen.
      this.toggleInventory();
    } else if (this.dialogueOpen) {
      this.updateDialogue();
    } else if (this.inventoryOpen) {
      this.updateInventory();
    } else if (this.input.consumeCancel()) {
      // Esc opens the gear/quest/settings screen when no dialogue is active.
      this.toggleInventory();
    } else if (this.editorMode) {
      this.input.takeAttack();
      this.input.consumeHeal();
      this.panEditorCamera(dt, state);
    } else if (this.hitstopTimer <= 0) {
      this.updateGameplay(dt, state);
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
    // Flask use adds a brief emerald-gold bloom pulse on top of any burst.
    const potionPulse = this.potionPulseTimer > 0 ? this.potionPulseTimer / POTION_PULSE_DURATION : 0;
    this.postProcess.setBurstGlow(Math.max(burst, potionPulse));

    const parryFlash =
      this.parryFlashTimer > 0 ? this.parryFlashTimer / PARRY_FLASH_DURATION : 0;
    this.postProcess.setParryFlash(parryFlash);
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
      if (this.pendingRoninStart) {
        this.pendingRoninStart = false;
        this.startRoninFight();
      } else if (this.pendingRoninPhase2) {
        this.pendingRoninPhase2 = false;
        this.enemies.completeRoninPhase2Dialogue();
      }
    }
  }

  private drainGameplayInput(): void {
    this.input.takeAttack();
    this.input.consumeDash();
    this.input.consumeInteract();
    this.input.consumeLightAbility();
    this.input.consumeParry();
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
    this.input.consumeParry();
  }

  private updateGameplay(dt: number, state: InputState): void {
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

    // Parry (Right-Click).
    if (this.input.consumeParry()) {
      this.tryParry();
    }

    // Health Flask (R).
    if (this.input.consumeHeal()) {
      this.consumePotion();
    }

    this.radiantCooldown = Math.max(0, this.radiantCooldown - dt);
    this.parryCooldown = Math.max(0, this.parryCooldown - dt);

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

    const worldRadius = this.activeTheme.id === 'act2_wheatfield' ? 36 : WORLD_BOUNDS;
    const distFromCenter = this.playerPos.length();
    if (distFromCenter > worldRadius) {
      this.playerPos.multiplyScalar(worldRadius / distFromCenter);
    }

    this.updateFollowCamera(dt, state.moveX);

    // Recompute aim against the settled camera for the sword + facing.
    const settled = this.computeAim(state);
    aimX = settled.x;
    aimY = settled.y;
    this.aimX = aimX;
    this.aimY = aimY;

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
      this.weapon.isSwinging,
    );
    this.weapon.update(dt, aimX, aimY, this.playerPos.x, this.playerPos.y);
    this.player3D.setParrying(this.parryActiveTimer > 0);

    // Enemy AI, sword/enemy hits and projectiles.
    this.enemies.update(dt);
    this.parryActiveTimer = Math.max(0, this.parryActiveTimer - dt);

    // The Ronin defeat beat (slow-mo + victory toast).
    if (
      this.activeTheme.id === 'act2_wheatfield' &&
      this.roninFightActive &&
      !this.enemies.hasAliveGroup('boss')
    ) {
      this.roninFightActive = false;
      this.triggerHitstop(0.25);
      this.hud.showToast('The Ronin lowers his blade.');
      this.hud.flashInventoryButton();
    }

    // Register death once, then hand off to the Death Screen.
    if (this.stats.isDead) {
      this.showDeathScreen();
      return;
    }

    // Act 1 quest: alley ambush -> survivors -> castle warden -> completed.
    this.updateQuest();

    this.updateInteractPrompt();
    const boss = this.enemies.getBoss();
    const bossIsRonin = boss?.assetId === 'the_ronin';
    const bossInRange =
      !!boss && Math.hypot(boss.x - this.playerPos.x, boss.y - this.playerPos.y) < BOSS_AGGRO_RANGE;
    const bossVisible = bossIsRonin ? bossInRange && boss.roninPhase !== 0 : bossInRange;
    const bossName = bossIsRonin ? 'THE RONIN' : 'CASTLE WARDEN';
    const bossSubtitle = bossIsRonin
      ? boss.roninPhase === 2
        ? '— Unsheathed'
        : '— Wandering Blade'
      : '— Blight Sentinel';

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
      parryReady: this.parryCooldown <= 0 && this.stats.stamina >= PARRY_STAMINA_COST,
      parryCooldownFraction: this.parryCooldown > 0 ? this.parryCooldown / PARRY_COOLDOWN : 0,
      parryCooldownSeconds: this.parryCooldown,
      flaskCharges: this.stats.potions,
      flaskMax: this.stats.maxPotions,
      bossVisible,
      bossName,
      bossSubtitle,
      bossHpFraction: boss ? boss.hp / boss.maxHp : 0,
    });
    this.hud.drawPortrait(this.player3D.getPortraitPixels());
  }

  /** Aim vector from the mouse cursor (world space), relative to the player. */
  private computeAim(state: InputState): { x: number; y: number } {
    const world = this.ndcToWorld(state.mouseNdc.x, state.mouseNdc.y);
    return { x: world.x - this.playerPos.x, y: world.y - this.playerPos.y };
  }

  /**
   * Track the tilted camera behind the player and move the moon light. When
   * camera lean is enabled a subtle A/D banking/look-ahead is applied; when it
   * is disabled (default) the camera tracks the player rigidly with zero
   * roll/tilt/lag so movement stays rock-steady.
   */
  private updateFollowCamera(dt: number, moveX: number): void {
    if (this.cameraLeanEnabled) {
      // Damped follow with a subtle horizontal lean + look-ahead on A/D.
      const k = Math.min(1, dt * 8);
      this.camera.position.x += (this.playerPos.x - this.camera.position.x) * k;
      this.camera.position.y = CAMERA_HEIGHT;
      this.camera.position.z += (-this.playerPos.y + CAMERA_BACK - this.camera.position.z) * k;

      this.leanAmount += (moveX - this.leanAmount) * Math.min(1, dt * 6);
      this.camera.position.x += this.leanAmount * 1.4;
    } else {
      // Rigid, zero-lag tracking — combined with the world-locked ASCII grid
      // this holds the scene perfectly steady.
      this.camera.position.set(this.playerPos.x, CAMERA_HEIGHT, -this.playerPos.y + CAMERA_BACK);
    }

    if (this.shakeTimer > 0) {
      const amp = this.shakeIntensity * Math.min(1, this.shakeTimer / SHAKE_DURATION);
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.z += (Math.random() * 2 - 1) * amp;
    }
    // Subtle directional punch from a successful parry.
    this.camera.position.x += this.punchX;
    this.camera.position.z += this.punchZ;
    this.camera.lookAt(this.playerPos.x, LOOK_HEIGHT, -this.playerPos.y);
    if (this.cameraLeanEnabled) {
      // Subtle banking roll into the strafe direction.
      this.camera.rotateZ(this.leanAmount * -0.05);
    }
    this.camera.updateMatrixWorld(true);

    // Track the moon light + its shadow frustum cleanly across the village,
    // snapping the target to shadow-map texels so shadows never crawl/shimmer
    // as the player walks.
    const texelSize = (SHADOW_FRUSTUM_HALF * 2) / SHADOW_MAP_SIZE;
    const shadowX = Math.round(this.playerPos.x / texelSize) * texelSize;
    const shadowZ = Math.round(-this.playerPos.y / texelSize) * texelSize;
    this.moonLight.position.set(
      shadowX + this.sunOffset.x,
      this.sunOffset.y,
      shadowZ + this.sunOffset.z,
    );
    this.moonLight.target.position.set(shadowX, 0, shadowZ);
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

  /** Right-click parry: open a short active guard window at a stamina cost. */
  private tryParry(): void {
    if (this.parryCooldown > 0) return;
    if (!this.stats.spendStamina(PARRY_STAMINA_COST)) return;

    this.parryActiveTimer = PARRY_WINDOW;
    this.parryCooldown = PARRY_COOLDOWN;
    this.weapon.parry();
  }

  /** Drive the Act 1 quest stage transitions (alley -> survivors -> castle). */
  private updateQuest(): void {
    // The Act 1 quest is harbor-only; Level 2 has no quest stages.
    if (this.activeTheme.id !== 'act1_harbor') return;

    const stage = this.progression.questStage;

    if (stage === 'alley_ambush') {
      const reachedClearing = Math.hypot(this.playerPos.x + 28, this.playerPos.y - 10) < 9;
      if (!this.enemies.hasAliveGroup('alley') || reachedClearing) {
        this.progression.questStage = 'speak_survivors';
        this.hud.showToast('The alley is clear — speak with the survivors in the clearing.');
        this.hud.flashInventoryButton();
      }
    } else if (stage === 'assault_castle') {
      if (!this.enemies.hasAliveGroup('boss')) {
        this.progression.questStage = 'completed';
        this.hud.showToast('The Castle Warden falls — the harbor is saved.');
        this.hud.flashInventoryButton();
      }
    }
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

    // The Ronin (pre-fight) can be spoken to before the duel starts.
    const ronin = this.enemies.getBoss();
    const roninNear =
      !!ronin &&
      ronin.assetId === 'the_ronin' &&
      ronin.roninPhase === 0 &&
      Math.hypot(ronin.x - this.playerPos.x, ronin.y - this.playerPos.y) <= INTERACT_RANGE;
    if (roninNear) {
      this.currentInteract = null;
      this.roninInteract = true;
      lm.setInteractableHighlight(null);
      this.hud.setInteractPrompt('[E] Speak — The Ronin');
      return;
    }
    this.roninInteract = false;

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
    if (this.roninInteract) {
      this.openRoninDialogue();
      return;
    }

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

    // Speaking with the Ferryman or Elder advances the survivors -> castle stage.
    if (this.progression.questStage === 'speak_survivors') {
      if (e.assetId === 'npc_ferryman' || e.assetId === 'npc_elder') {
        this.progression.questStage = 'assault_castle';
        this.hud.showToast('Follow the blighted river north across the bridge — defeat the Castle Warden.');
        this.hud.flashInventoryButton();
      }
    }
  }

  /** Open The Ronin's pre-fight dialogue; the duel begins when it closes. */
  private openRoninDialogue(): void {
    const data = this.progression.getDialogueLines('npc_ronin');
    this.dialogueBox.open(data);
    this.dialogueOpen = true;
    this.pendingRoninStart = true;
  }

  /** Mid-fight screen-freeze speech when the Ronin drops to half health. */
  public beginRoninPhase2Dialogue(): void {
    const data = this.progression.getDialogueLines('npc_ronin_phase2');
    this.dialogueBox.open(data);
    this.dialogueOpen = true;
    this.pendingRoninPhase2 = true;
    this.drainGameplayInput();
  }

  /** Gale pushback + phase-one transition for The Ronin after dialogue. */
  private startRoninFight(): void {
    const ronin = this.enemies.getBoss();
    if (!ronin) return;

    this.enemies.beginRoninFight();
    this.roninFightActive = true;

    // Strong decaying knockback shoves the player ~5.5 units back.
    const dx = this.playerPos.x - ronin.x;
    const dy = this.playerPos.y - ronin.y;
    const d = Math.hypot(dx, dy) || 1;
    this.applyPlayerKnockback((dx / d) * 55, (dy / d) * 55);

    // Golden-white shockwave ring + camera nudge + clash sound (no damage).
    this.enemies.spawnShockwave(ronin.x, ronin.y, 1.0, 0.95, 0.72);
    this.triggerCameraPunch(dx / d, dy / d, 0.5);
    this.triggerShake(0.3);
    this.playParryClang();
    this.hud.showToast('The Ronin accepts your challenge.');
  }

  // --- Screen / death / retry state ------------------------------------------

  /** Record the death context (e.g. the Ronin's pre-fight draw counter). */
  public setDeathContext(text: string): void {
    this.deathContext = text;
  }

  /** Open the Settings / Assets modal from the Title Screen. */
  private openModalFromTitle(tab: 'settings' | 'assets'): void {
    this.inventoryOpen = true;
    this.inventoryModal.openTo(tab);
  }

  /** Show the Death Screen with an optional death-context subtitle. */
  private showDeathScreen(): void {
    this.deathScreenActive = true;
    this.hud.setVisible(false);
    this.deathScreen.show(this.deathContext ?? undefined);
  }

  /** Retry the current level with full HP, stamina, flasks and fresh enemies. */
  public retryAttempt(): void {
    const data = this.levelManager?.getLevelData();
    if (!data) return;
    this.beginLevelLoad(data);
  }

  /** Return cleanly to the Title Screen (from Settings or the Death Screen). */
  public returnToTitle(): void {
    this.startScreenActive = true;
    this.deathScreenActive = false;
    this.deathScreen.hide();
    this.closeInventory();
    this.hud.setVisible(false);
    this.drainGameplayInput();
    this.startScreen.show();
  }

  // --- Health Flask ----------------------------------------------------------

  /** Consume a flask charge (R key): heal 45% max HP with visual/audio cues. */
  private consumePotion(): void {
    if (this.stats.potions <= 0) {
      this.hud.showToast('No flasks remaining');
      return;
    }
    if (this.potionCooldown > 0) return;
    if (this.stats.health >= this.stats.maxHealth) return; // don't waste a charge

    this.stats.potions -= 1;
    const before = this.stats.health;
    this.stats.heal(Math.round(this.stats.maxHealth * POTION_HEAL_FRACTION));
    const healed = Math.round(this.stats.health - before);

    this.potionCooldown = POTION_COOLDOWN;
    this.potionPulseTimer = POTION_PULSE_DURATION;
    this.triggerScreenFlash(0.12);
    this.playPotionChime();
    this.hud.showToast(`Flask used (+${healed} HP)`);
  }

  /** Soft two-tone chime for flask use (Web Audio, best-effort). */
  private playPotionChime(): void {
    try {
      if (!this.audioContext) {
        const Ctor =
          (window as { AudioContext?: typeof AudioContext }).AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.audioContext = new Ctor();
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      gain.connect(ctx.destination);

      const freqs = [880, 1318.5];
      for (let i = 0; i < freqs.length; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqs[i], now + i * 0.09);
        osc.connect(gain);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.42);
      }
    } catch {
      // Audio is best-effort.
    }
  }

  // --- Playtest tuning -------------------------------------------------------

  public getTuning(): PlaytestTuning {
    return {
      maxHealth: this.stats.getBaseMaxHealth(),
      maxStamina: this.stats.getBaseMaxStamina(),
      healthRegen: this.stats.getHealthRegen(),
      staminaRegen: this.stats.getStaminaRegen(),
    };
  }

  public setMaxHealth(v: number): void {
    this.stats.setBaseMaxHealth(v);
    this.saveTuning();
  }

  public setMaxStamina(v: number): void {
    this.stats.setBaseMaxStamina(v);
    this.saveTuning();
  }

  public setHealthRegen(v: number): void {
    this.stats.setHealthRegen(v);
    this.saveTuning();
  }

  public setStaminaRegen(v: number): void {
    this.stats.setStaminaRegen(v);
    this.saveTuning();
  }

  public resetStats(): void {
    this.applyTuning({ ...DEFAULT_TUNING });
    this.saveTuning();
  }

  private applyTuning(tuning: PlaytestTuning): void {
    this.stats.setBaseMaxHealth(tuning.maxHealth);
    this.stats.setBaseMaxStamina(tuning.maxStamina);
    this.stats.setHealthRegen(tuning.healthRegen);
    this.stats.setStaminaRegen(tuning.staminaRegen);
  }

  private saveTuning(): void {
    try {
      localStorage.setItem(PLAYTEST_TUNING_KEY, JSON.stringify(this.getTuning()));
    } catch {
      // Storage unavailable.
    }
  }

  private loadTuning(): PlaytestTuning {
    try {
      const raw = localStorage.getItem(PLAYTEST_TUNING_KEY);
      if (!raw) return { ...DEFAULT_TUNING };
      const parsed = JSON.parse(raw) as Partial<PlaytestTuning>;
      return {
        maxHealth: typeof parsed.maxHealth === 'number' ? parsed.maxHealth : DEFAULT_TUNING.maxHealth,
        maxStamina: typeof parsed.maxStamina === 'number' ? parsed.maxStamina : DEFAULT_TUNING.maxStamina,
        healthRegen: typeof parsed.healthRegen === 'number' ? parsed.healthRegen : DEFAULT_TUNING.healthRegen,
        staminaRegen: typeof parsed.staminaRegen === 'number' ? parsed.staminaRegen : DEFAULT_TUNING.staminaRegen,
      };
    } catch {
      return { ...DEFAULT_TUNING };
    }
  }

  // --- Custom PNG assets & level loader --------------------------------------

  public registerCustomPng(asset: CustomPngAsset): void {
    AssetRegistry.registerCustomPng(asset);
  }

  public deleteCustomPng(id: string): void {
    AssetRegistry.removeCustomPng(id);
  }

  public exportLevelJson(): void {
    const data = this.levelManager?.exportLevelData();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${data.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  public loadLevelFromJson(json: string): { ok: boolean; error?: string; id?: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'Invalid JSON' };
    }
    if (!this.isLevelData(parsed)) {
      return { ok: false, error: 'Not a valid level file' };
    }
    this.levelManager?.addCustomLevel(parsed);
    this.beginLevelLoad(parsed);
    return { ok: true, id: parsed.id };
  }

  public getCustomLevels(): CustomLevelListItem[] {
    return (this.levelManager?.getCustomLevels() ?? []).map((lvl) => ({
      id: lvl.id,
      name: lvl.name,
    }));
  }

  private isLevelData(value: unknown): value is LevelData {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj.id === 'string' &&
      typeof obj.terrainBase64 === 'string' &&
      Array.isArray(obj.entities)
    );
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
    this.postProcess.setSize(this.renderer);
    this.resizePlayerReflection();
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
    this.startScreen.dispose();
    this.deathScreen.dispose();
    for (const layer of this.layers) {
      layer.dispose();
    }
    this.postProcess.dispose();
    this.atlas.dispose();
    this.playerReflectionRT.dispose();
    this.renderer.dispose();
  }
}
