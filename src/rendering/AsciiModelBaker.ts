import * as THREE from 'three';

/**
 * The result of baking a 3D model into an ASCII-friendly sprite texture.
 *
 * `worldWidth` / `worldHeight` are the model's *projected* extents (in world
 * units) as seen by the offscreen camera. They describe the real-world size of
 * the billboard quad so the glyph grid stays a consistent world-space size no
 * matter whether the source model is a small boulder or a large cottage.
 */
export interface BakedAsciiSprite {
  texture: THREE.Texture;
  worldWidth: number;
  worldHeight: number;
  /** worldWidth / worldHeight. */
  aspect: number;
}

/**
 * Pitch that matches `AsciiCharPass`'s elevated 3/4 top-down view angle. The
 * camera has no yaw, so a world point projects to the screen as:
 *
 *   screen.x = x
 *   screen.y = y * cos(PITCH) + z * sin(PITCH)
 *
 * (z is the model's depth toward the camera; a point further forward appears
 * slightly lower on screen, which is what gives the gentle top-down tilt).
 */
const PITCH = Math.atan2(1.25, 4.8);
const COS_PITCH = Math.cos(PITCH);
const SIN_PITCH = Math.sin(PITCH);

/** Framing padding around the projected model bounds (fraction of extent). */
const FRAME_PAD = 0.06;

const DEFAULT_RESOLUTION = 128;

/** Camera distance from the model centre (orthographic, so only affects clipping). */
const CAMERA_DISTANCE = 16;

/**
 * Measure a model's projected extents (in world units) without rendering, so
 * callers can size a billboard quad before its texture has been baked.
 */
export function measureModel(model: THREE.Object3D): {
  worldWidth: number;
  worldHeight: number;
  aspect: number;
} {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const worldWidth = Math.max(size.x, 0.05);
  const worldHeight = Math.max(size.y * COS_PITCH + size.z * SIN_PITCH, 0.05);
  return { worldWidth, worldHeight, aspect: worldWidth / worldHeight };
}

/**
 * Reusable offscreen bake rig. It holds a single 3/4 top-down camera and a set
 * of crisp directional + hemisphere lights tuned for `flatShading: true`, then
 * renders any `THREE.Object3D` into a transparent `WebGLRenderTarget` once per
 * cache key.
 */
export class AsciiModelBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly cache = new Map<string, BakedAsciiSprite>();

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
    this.camera.up.set(0, 1, 0);

    // Warm key light from the front-top, matching AsciiCharPass' look.
    const key = new THREE.DirectionalLight(0xfff1dc, 2.5);
    key.position.set(2.5, 4.0, 3.0);
    this.scene.add(key);

    // Cool rim light from the back so silhouettes separate from the ground.
    const rim = new THREE.DirectionalLight(0x88b4ff, 1.25);
    rim.position.set(-3.0, 2.0, -2.5);
    this.scene.add(rim);

    // Hemisphere for a soft sky/ground gradient across the flat-shaded facets.
    const hemi = new THREE.HemisphereLight(0x9fb8d0, 0x151a20, 0.85);
    this.scene.add(hemi);

    // Faint fill so dark sides never clip to pure black.
    const ambient = new THREE.AmbientLight(0x3a4252, 0.55);
    this.scene.add(ambient);
  }

  /** Return a previously-baked sprite without rendering, if present. */
  public get(key: string): BakedAsciiSprite | undefined {
    return this.cache.get(key);
  }

  /**
   * Bake `model` into a transparent sprite texture, keyed by `key` so each
   * asset/state renders at most once. The model is framed with its base near
   * the bottom of the frame and is never disposed here (the caller owns it).
   */
  public bake(
    renderer: THREE.WebGLRenderer,
    key: string,
    model: THREE.Object3D,
    resolution = DEFAULT_RESOLUTION,
  ): BakedAsciiSprite {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const sprite = this.renderSprite(renderer, model, resolution);
    this.cache.set(key, sprite);
    return sprite;
  }

  /**
   * Optional N-angle bake for rotating enemies/NPCs. Returns one sprite per
   * direction, cached under `${key}@${index}`. The model is rotated in place, so
   * it is only valid for models whose silhouette is roughly rotation-symmetric.
   */
  public bakeDirections(
    renderer: THREE.WebGLRenderer,
    key: string,
    model: THREE.Object3D,
    directions = 4,
    resolution = DEFAULT_RESOLUTION,
  ): BakedAsciiSprite[] {
    const sprites: BakedAsciiSprite[] = [];
    const originalY = model.rotation.y;
    for (let i = 0; i < directions; i += 1) {
      model.rotation.y = (i / directions) * Math.PI * 2;
      sprites.push(this.bake(renderer, `${key}@${i}`, model, resolution));
    }
    model.rotation.y = originalY;
    return sprites;
  }

  public dispose(): void {
    for (const sprite of this.cache.values()) {
      sprite.texture.dispose();
    }
    this.cache.clear();
  }

  // --- Internal -------------------------------------------------------------

  private renderSprite(
    renderer: THREE.WebGLRenderer,
    model: THREE.Object3D,
    resolution: number,
  ): BakedAsciiSprite {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const { worldWidth, worldHeight, aspect } = measureModel(model);

    const padX = worldWidth * FRAME_PAD;
    const padY = worldHeight * FRAME_PAD;

    // Position and orient the camera along the fixed 3/4 direction.
    this.camera.position
      .copy(center)
      .addScaledVector(new THREE.Vector3(0, SIN_PITCH, COS_PITCH), CAMERA_DISTANCE);
    this.camera.lookAt(center);

    // Frame the exact projected bounds. Because the front-bottom corner is the
    // lowest projected point, the model's base sits just above the bottom edge
    // (by the pad), reading as planted rather than floating.
    this.camera.left = -(worldWidth / 2 + padX);
    this.camera.right = worldWidth / 2 + padX;
    this.camera.top = worldHeight / 2 + padY;
    this.camera.bottom = -(worldHeight / 2 + padY);
    this.camera.updateProjectionMatrix();

    // Size the render target to the projected aspect so the model isn't
    // letterboxed or stretched.
    const texW =
      aspect >= 1 ? resolution : Math.max(2, Math.round(resolution * aspect));
    const texH =
      aspect >= 1 ? Math.max(2, Math.round(resolution / aspect)) : resolution;

    const target = new THREE.WebGLRenderTarget(texW, texH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    target.texture.generateMipmaps = false;

    this.scene.add(model);

    const prevTarget = renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);

    this.scene.remove(model);

    return { texture: target.texture, worldWidth, worldHeight, aspect };
  }
}

/**
 * Dispose every geometry and material in a model subtree. Models are only ever
 * needed for a single bake (the result is cached), so callers pass freshly
 * built factories here after baking to free their GPU resources.
 */
export function disposeModelTree(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}
