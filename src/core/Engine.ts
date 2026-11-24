import * as THREE from 'three';
import type { IRenderLayer, InputState } from './types';
import { InputManager } from './InputManager';
import { CollisionSystem } from './CollisionSystem';
import { PlayerStats } from './PlayerStats';
import { EnemyManager } from './EnemyManager';
import { GlyphAtlas } from '../rendering/GlyphAtlas';
import { AsciiCharPass } from '../rendering/AsciiCharPass';
import { AtmosphereLayer } from '../rendering/AtmosphereLayer';
import { Weapon } from '../rendering/Weapon';
import { EnemyLayer } from '../rendering/EnemyLayer';
import { Hud } from '../ui/Hud';
import { WORLD_BOUNDS, PLAYER_RADIUS } from './world';
import type { TerrainGrid } from './TerrainGrid';

const HITSTOP_DURATION = 0.045;
const SHAKE_DURATION = 0.22;
const RESPAWN_DELAY = 0.8;

export class Engine {
  public readonly atlas: GlyphAtlas;
  public readonly collision = new CollisionSystem();
  public readonly scene: THREE.Scene;

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private readonly input: InputManager;
  private terrain: TerrainGrid | null = null;

  private readonly character: AsciiCharPass;
  public readonly weapon: Weapon;
  private readonly atmosphere: AtmosphereLayer;
  private readonly hud: Hud;
  public readonly stats = new PlayerStats();
  public readonly enemies: EnemyManager;
  private readonly layers: IRenderLayer[] = [];

  private viewHeight = 20;
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

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050709');

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      (-this.viewHeight * aspect) / 2,
      (this.viewHeight * aspect) / 2,
      this.viewHeight / 2,
      -this.viewHeight / 2,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 10);

    this.input = new InputManager(container);
    this.atlas = new GlyphAtlas();

    this.character = new AsciiCharPass(this.atlas);
    this.scene.add(this.character.group);

    this.weapon = new Weapon(this.atlas);
    this.scene.add(this.weapon.object3D);

    this.enemies = new EnemyManager(this);
    this.addLayer(new EnemyLayer(this.atlas, this.enemies));

    this.atmosphere = new AtmosphereLayer();
    this.scene.add(this.atmosphere.object3D);

    this.hud = new Hud(container);

    this.applyViewport();
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
  public triggerShake(intensity = 0.35, duration = SHAKE_DURATION): void {
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

  /** Convert pointer client coordinates into world-space (x, y) on the z = 0 plane. */
  public screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { x: this.camera.position.x, y: this.camera.position.y };
    }
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return {
      x: this.camera.position.x + ndcX * this.camera.right,
      y: this.camera.position.y + ndcY * this.camera.top,
    };
  }

  public start(): void {
    this.clock.start();
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.update(dt, elapsed);

      this.character.render(this.renderer);
      for (const layer of this.layers) {
        layer.preRender?.(this.renderer);
      }

      this.renderer.render(this.scene, this.camera);
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
    this.atmosphere.setViewport(this.viewHeight * aspect, this.viewHeight);
  }

  private update(dt: number, elapsed: number): void {
    const state = this.input.getState();

    // Camera zoom (scroll in / out).
    const wheel = this.input.takeWheelDelta();
    if (wheel !== 0) {
      this.viewHeight = THREE.MathUtils.clamp(this.viewHeight * Math.exp(wheel * 0.0015), 9, 30);
      this.applyViewport();
    }

    // Combat feedback timers decay on wall-clock time even while hitstop holds.
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);

    if (this.editorMode) {
      this.input.takeAttack();
      this.panEditorCamera(dt, state);
    } else if (this.hitstopTimer <= 0) {
      this.updateGameplay(dt, state);
    }

    const ctx = {
      dt,
      elapsed,
      playerPos: { x: this.playerPos.x, y: this.playerPos.y },
      input: state,
    };

    this.atmosphere.update(ctx);
    for (const layer of this.layers) {
      layer.update(ctx);
    }
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

    // Attack on click / Space.
    if (this.input.takeAttack()) {
      this.weapon.swing();
    }

    const moving = Math.hypot(state.moveX, state.moveY) > 0.05;
    const wading = this.terrain ? this.terrain.isInRiver(this.playerPos.x, this.playerPos.y) : false;
    const canSprint = this.stats.update(dt, state.sprint, moving, wading);
    const sprinting = state.sprint && canSprint;

    const speed = (sprinting ? 10 : 5.5) * (wading ? 0.45 : 1);
    this.playerPos.x += (state.moveX * speed + this.knockbackX) * dt;
    this.playerPos.y += (state.moveY * speed + this.knockbackY) * dt;

    // Knockback velocity decays smoothly toward zero.
    const knockDecay = Math.exp(-6 * dt);
    this.knockbackX *= knockDecay;
    this.knockbackY *= knockDecay;

    this.collision.resolve(this.playerPos, PLAYER_RADIUS);

    const distFromCenter = this.playerPos.length();
    if (distFromCenter > WORLD_BOUNDS) {
      this.playerPos.multiplyScalar(WORLD_BOUNDS / distFromCenter);
    }

    this.camera.position.x += (this.playerPos.x - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.y += (this.playerPos.y - this.camera.position.y) * Math.min(1, dt * 8);

    // Aim direction from the mouse cursor (world space).
    const viewW = this.viewHeight * this.aspect;
    const viewH = this.viewHeight;
    const mouseX = this.camera.position.x + (state.mouseNdc.x * viewW) / 2;
    const mouseY = this.camera.position.y + (state.mouseNdc.y * viewH) / 2;
    const aimX = mouseX - this.playerPos.x;
    const aimY = mouseY - this.playerPos.y;

    this.character.update(
      dt,
      state.moveX,
      state.moveY,
      sprinting,
      wading,
      aimX,
      aimY,
      this.playerPos.x,
      this.playerPos.y
    );
    this.weapon.update(dt, aimX, aimY, this.playerPos.x, this.playerPos.y);

    // Enemy AI, sword/enemy hits and projectiles.
    this.enemies.update(dt);

    // Subtle camera shake (applied last so a hit this frame is felt immediately).
    if (this.shakeTimer > 0) {
      const amp = this.shakeIntensity * Math.min(1, this.shakeTimer / SHAKE_DURATION);
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.y += (Math.random() * 2 - 1) * amp;
    }

    // Register death once, then hand off to the respawn pause.
    if (this.stats.isDead) {
      this.respawnPending = true;
      this.respawnTimer = RESPAWN_DELAY;
    }

    this.hud.update({
      health: this.stats.health,
      maxHealth: this.stats.maxHealth,
      stamina: this.stats.stamina,
      maxStamina: this.stats.maxStamina,
    });
    this.hud.drawPortrait(this.character.getPortraitPixels());
  }

  private doRespawn(): void {
    this.respawnPending = false;
    this.stats.reset();
    this.enemies.reset();
    this.playerPos.set(this.spawnPoint.x, this.spawnPoint.y);
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.camera.position.set(this.spawnPoint.x, this.spawnPoint.y, this.camera.position.z);
  }

  /** WASD/arrow panning across the full ±30 world while the editor is active. */
  private panEditorCamera(dt: number, state: InputState): void {
    const panSpeed = 16;
    this.camera.position.x += state.moveX * panSpeed * dt;
    this.camera.position.y += state.moveY * panSpeed * dt;
    const limit = 30;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -limit, limit);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, -limit, limit);
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.applyViewport();
  };

  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.character.dispose();
    this.weapon.dispose();
    this.atmosphere.dispose();
    this.hud.dispose();
    for (const layer of this.layers) {
      layer.dispose();
    }
    this.atlas.dispose();
    this.renderer.dispose();
  }
}
