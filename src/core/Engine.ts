import * as THREE from 'three';
import type { IRenderLayer } from './types';
import { InputManager } from './InputManager';
import { GlyphAtlas } from '../rendering/GlyphAtlas';
import { GroundLayer } from '../rendering/GroundLayer';
import { GrassLayer } from '../rendering/GrassLayer';
import { AsciiCharPass } from '../rendering/AsciiCharPass';

export class Engine {
  public readonly atlas: GlyphAtlas;

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly input: InputManager;

  private readonly ground: GroundLayer;
  private readonly grass: GrassLayer;
  private readonly character: AsciiCharPass;
  private readonly extraLayers: IRenderLayer[] = [];

  private readonly viewHeight = 20;
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

  private update(dt: number, elapsed: number): void {
    const state = this.input.getState();
    const speed = state.sprint ? 10 : 5.5;

    this.playerPos.x += state.moveX * speed * dt;
    this.playerPos.y += state.moveY * speed * dt;

    this.camera.position.x += (this.playerPos.x - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.y += (this.playerPos.y - this.camera.position.y) * Math.min(1, dt * 8);

    this.ground.update(this.playerPos.x, this.playerPos.y, elapsed);
    this.grass.update(this.playerPos.x, this.playerPos.y, elapsed);
    this.character.update(dt, state.moveX, state.moveY, state.sprint, this.playerPos.x, this.playerPos.y);

    const ctx = {
      dt,
      elapsed,
      playerPos: { x: this.playerPos.x, y: this.playerPos.y },
      input: state,
    };

    for (const layer of this.extraLayers) {
      layer.update(ctx);
    }
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;

    this.camera.left = (-this.viewHeight * aspect) / 2;
    this.camera.right = (this.viewHeight * aspect) / 2;
    this.camera.top = this.viewHeight / 2;
    this.camera.bottom = -this.viewHeight / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  };

  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.ground.dispose();
    this.grass.dispose();
    this.character.dispose();
    for (const layer of this.extraLayers) {
      layer.dispose();
    }
    this.atlas.dispose();
    this.renderer.dispose();
  }
}