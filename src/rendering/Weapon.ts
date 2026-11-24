import * as THREE from 'three';
import { GlyphAtlas } from './GlyphAtlas';
import type { AsciiPropAsset, AsciiPropCell } from '../core/types';
import { yToZ } from '../core/world';

const WEAPON_VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const WEAPON_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;

  void main() {
    float idx = floor(vGlyphIndex + 0.5);
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + vUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - vUv.y) / uAtlasGrid.y)
    );

    float alpha = texture2D(uAtlas, atlasUv).a;
    if (alpha < 0.15) {
      // Dark silhouette backing so the blade reads crisply over grass/trees.
      gl_FragColor = vec4(0.03, 0.04, 0.05, 0.92);
      return;
    }

    // Always fully lit so the blade reads clearly against the dark ground.
    gl_FragColor = vec4(vColor * 1.4, 1.0);
  }
`;

type RGB = [number, number, number];

/**
 * Build an AsciiPropAsset from a list of string rows (top-to-bottom, y = 0 is
 * the base). Each non-space character is coloured via the supplied palette.
 */
function buildProp(
  name: string,
  rows: string[],
  palette: Record<string, RGB>,
  fallback: RGB = [0.6, 0.6, 0.6]
): AsciiPropAsset {
  const height = rows.length;
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);

  const cells: AsciiPropCell[] = [];
  for (let r = 0; r < height; r++) {
    const line = rows[r];
    const y = height - 1 - r;
    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char === ' ') continue;
      const [cr, cg, cb] = palette[char] ?? fallback;
      cells.push({ x, y, char, r: cr, g: cg, b: cb });
    }
  }

  return { name, width, height, cells };
}

const SWORD_PALETTE: Record<string, RGB> = {
  '^': [0.85, 0.88, 0.92],
  '|': [0.72, 0.76, 0.82],
  '/': [0.62, 0.67, 0.74],
  '\\': [0.62, 0.67, 0.74],
  '#': [0.5, 0.38, 0.28],
  o: [0.85, 0.7, 0.35],
};

/** A top-down sword sprite pointing up, with the hilt at the bottom centre (the pivot). */
function createSword(): AsciiPropAsset {
  return buildProp(
    'sword',
    [
      '    ^    ',
      '   /|\\   ',
      '   /|\\   ',
      '   /|\\   ',
      '    |    ',
      '   /#\\   ',
      '    |    ',
      '    o    ',
    ],
    SWORD_PALETTE
  );
}

export class Weapon {
  public readonly object3D = new THREE.Group();

  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;

  private angle = 0;
  private swinging = false;
  private swingT = 0;
  private swingCount = 0;
  private readonly swingDuration = 0.22;

  /** How far the blade reaches from the traveler's centre, in world units. */
  public readonly reach = 1.9;
  /** Half the angular width of the swing arc, in radians. */
  public readonly arcHalfAngle = Math.PI / 2.4;

  constructor(atlas: GlyphAtlas) {
    const sword = createSword();
    const size = 0.16;
    const cells = sword.cells;
    const pivotX = (sword.width - 1) / 2; // blade is centred horizontally
    const pivotY = 0; // hilt sits at the local origin

    const geometry = new THREE.PlaneGeometry(1, 1);
    const glyphIndices = new Float32Array(cells.length);
    const colors = new Float32Array(cells.length * 3);

    this.material = new THREE.ShaderMaterial({
      vertexShader: WEAPON_VERTEX_SHADER,
      fragmentShader: WEAPON_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      },
      transparent: true,
      depthWrite: true,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, cells.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      dummy.position.set((cell.x - pivotX) * size, (cell.y - pivotY) * size, 0);
      dummy.scale.set(size, size, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      glyphIndices[i] = atlas.getIndex(cell.char);
      colors[i * 3 + 0] = cell.r;
      colors[i * 3 + 1] = cell.g;
      colors[i * 3 + 2] = cell.b;
    }

    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    this.mesh.instanceMatrix.needsUpdate = true;

    this.object3D.add(this.mesh);
  }

  public update(dt: number, aimX: number, aimY: number, worldX: number, worldY: number): void {
    let dirX = aimX;
    let dirY = aimY;
    const len = Math.hypot(dirX, dirY);
    if (len > 0.001) {
      dirX /= len;
      dirY /= len;
      this.angle = Math.atan2(dirX, dirY);
    }

    if (this.swinging) {
      this.swingT += dt;
      const p = Math.min(1, this.swingT / this.swingDuration);
      const ease = p * (2 - p); // ease-out
      const sweep = -1.2 + 2.4 * ease;
      this.object3D.rotation.z = this.angle + sweep;
      if (p >= 1) this.swinging = false;
    } else {
      this.object3D.rotation.z = this.angle;
    }

    // The hilt rides just ahead of the traveler, so the blade reaches outward.
    // Sort with the player: a hair in front, or slightly behind when aiming
    // north so the up-swing never floats above the canopy.
    const aimNorth = dirY > 0;
    this.object3D.position.set(
      worldX + dirX * 0.4,
      worldY + dirY * 0.4,
      yToZ(worldY) + (aimNorth ? -0.015 : 0.015)
    );
  }

  public swing(): void {
    if (!this.swinging) {
      this.swinging = true;
      this.swingT = 0;
      this.swingCount += 1;
    }
  }

  /** True while a swing is in flight. */
  public get isSwinging(): boolean {
    return this.swinging;
  }

  /** Increments once per new swing so the combat system can dedupe hits. */
  public get swingId(): number {
    return this.swingCount;
  }

  /** The aim direction (radians, atan2 convention) of the current or last swing. */
  public get aimAngle(): number {
    return this.angle;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
