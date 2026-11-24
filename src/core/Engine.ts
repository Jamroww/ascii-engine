import * as THREE from 'three';
import type { IRenderLayer } from './types';
import { InputManager } from './InputManager';
import { CollisionSystem } from './CollisionSystem';
import { PlayerStats } from './PlayerStats';
import { GlyphAtlas } from '../rendering/GlyphAtlas';
import { GroundLayer } from '../rendering/GroundLayer';
import { GrassLayer } from '../rendering/GrassLayer';
import { AsciiCharPass } from '../rendering/AsciiCharPass';
import { AtmosphereLayer } from '../rendering/AtmosphereLayer';
import { Weapon } from '../rendering/Weapon';
import { Hud } from '../ui/Hud';
import { BOULDERS, WORLD_BOUNDS, PLAYER_RADIUS, isInRiver } from './world';

export class Engine {
  public readonly atlas: GlyphAtlas;
  public readonly collision = new CollisionSystem();

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly input: InputManager;

  private readonly ground: GroundLayer;
  private readonly grass: GrassLayer;
  private readonly character: AsciiCharPass;
  private readonly weapon: Weapon;
  private readonly atmosphere: AtmosphereLayer;
  private readonly hud: Hud;
  private readonly stats = new PlayerStats();
  private readonly extraLayers: IRenderLayer[] = [];

  private viewHeight = 20;
  private readonly playerPos = new THREE.Vector2(0, 0);
  private readonly clock = new THREE.Clock();
  private rafId: number | null = null;

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

    this.ground = new GroundLayer(this.atlas);
    this.scene.add(this.ground.mesh);

    this.grass = new GrassLayer(this.atlas);
    this.scene.add(this.grass.mesh);

    this.character = new AsciiCharPass(this.atlas);
    this.scene.add(this.character.group);

    this.weapon = new Weapon(this.atlas);
    this.scene.add(this.weapon.object3D);

    this.atmosphere = new AtmosphereLayer();
    this.scene.add(this.atmosphere.object3D);

    this.hud = new Hud(container);

    // River boulders are solid.
    for (const b of BOULDERS) {
      this.collision.add({ x: b.x, y: b.y, radius: b.r });
    }

    this.applyViewport();
    window.addEventListener('resize', this.onResize);
  }

  public addLayer(layer: IRenderLayer): void {
    this.extraLayers.push(layer);
    this.scene.add(layer.object3D);
  }

  public start(): void {
    this.clock.start();
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.update(dt, elapsed);

      this.character.render(this.renderer);
      for (const layer of this.extraLayers) {
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

    // Attack on click / Space.
    if (this.input.takeAttack()) {
      this.weapon.swing();
    }

    const moving = Math.hypot(state.moveX, state.moveY) > 0.05;
    const wading = isInRiver(this.playerPos.x, this.playerPos.y);
    const canSprint = this.stats.update(dt, state.sprint, moving, wading);
    const sprinting = state.sprint && canSprint;

    const speed = (sprinting ? 10 : 5.5) * (wading ? 0.45 : 1);
    this.playerPos.x += state.moveX * speed * dt;
    this.playerPos.y += state.moveY * speed * dt;

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

    this.ground.update(this.playerPos.x, this.playerPos.y, elapsed);
    this.grass.update(this.playerPos.x, this.playerPos.y, elapsed);
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

    this.hud.update({
      health: this.stats.health,
      maxHealth: this.stats.maxHealth,
      stamina: this.stats.stamina,
      maxStamina: this.stats.maxStamina,
    });
    this.hud.drawPortrait(this.character.getPortraitPixels());

    const ctx = {
      dt,
      elapsed,
      playerPos: { x: this.playerPos.x, y: this.playerPos.y },
      input: state,
    };

    this.atmosphere.update(ctx);
    for (const layer of this.extraLayers) {
      layer.update(ctx);
    }
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
    this.ground.dispose();
    this.grass.dispose();
    this.character.dispose();
    this.weapon.dispose();
    this.atmosphere.dispose();
    this.hud.dispose();
    for (const layer of this.extraLayers) {
      layer.dispose();
    }
    this.atlas.dispose();
    this.renderer.dispose();
  }
}
