import * as THREE from 'three';
import type { CircleCollider, FrameContext, IRenderLayer } from '../core/types';
import { GlyphAtlas } from './GlyphAtlas';

export interface AsciiPropCell {
  x: number;    // Local grid X (0..width-1)
  y: number;    // Local grid Y (0 = bottom, height-1 = top)
  char: string; // Single ASCII character
  r: number;    // 0.0 to 1.0
  g: number;    // 0.0 to 1.0
  b: number;    // 0.0 to 1.0
}

export interface AsciiPropAsset {
  name: string;
  width: number;
  height: number;
  cells: AsciiPropCell[];
}

export interface PropPlacement {
  asset: AsciiPropAsset;
  worldX: number;
  worldY: number;
  cellSize?: number;
  /** Solid collision radius in world units (trunk / rock body). */
  colliderRadius?: number;
  /** Optional absolute-world override for the collider centre (e.g. an off-centre stem). */
  colliderX?: number;
  colliderY?: number;
}

const PROP_VERTEX_SHADER = /* glsl */ `
  attribute float aGlyphIndex;
  attribute vec3 aColor;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;

  void main() {
    vUv = uv;
    vGlyphIndex = aGlyphIndex;
    vColor = aColor;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xy;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const PROP_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uPlayerPos;
  uniform float uTime;

  varying vec2 vUv;
  varying float vGlyphIndex;
  varying vec3 vColor;
  varying vec2 vWorldPos;

  void main() {
    float idx = floor(vGlyphIndex + 0.5);
    float col = mod(idx, uAtlasGrid.x);
    float row = floor(idx / uAtlasGrid.x);

    vec2 atlasUv = vec2(
      (col + vUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - vUv.y) / uAtlasGrid.y)
    );

    float alpha = texture2D(uAtlas, atlasUv).a;
    if (alpha < 0.15) discard;

    // Flickering torchlight matching GroundLayer and GrassLayer
    float flicker = 1.0 + sin(uTime * 7.0) * 0.03 + sin(uTime * 13.0) * 0.02;
    float dist = distance(vWorldPos, uPlayerPos);
    float torchLight = smoothstep(12.0 * flicker, 0.8, dist);

    vec3 ambient = vColor * 0.28;
    vec3 torchTint = vec3(1.0, 0.78, 0.48);
    vec3 lit = vColor * mix(vec3(1.0), torchTint, 0.45) * torchLight * 1.4;

    gl_FragColor = vec4(ambient + lit, alpha);
  }
`;

export class PropLayer implements IRenderLayer {
  public readonly object3D: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly placements: PropPlacement[];

  constructor(atlas: GlyphAtlas, placements: PropPlacement[]) {
    this.placements = placements;
    const totalCells = placements.reduce((sum, p) => sum + p.asset.cells.length, 0);
    const geometry = new THREE.PlaneGeometry(1, 1);

    const glyphIndices = new Float32Array(totalCells);
    const colors = new Float32Array(totalCells * 3);

    this.material = new THREE.ShaderMaterial({
      vertexShader: PROP_VERTEX_SHADER,
      fragmentShader: PROP_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uPlayerPos: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });

    this.object3D = new THREE.InstancedMesh(geometry, this.material, totalCells);
    const dummy = new THREE.Object3D();

    let i = 0;
    for (const p of placements) {
      const size = p.cellSize ?? 0.42;
      const offsetX = (p.asset.width * size) / 2;

      for (const cell of p.asset.cells) {
        dummy.position.set(
          p.worldX + cell.x * size - offsetX,
          p.worldY + cell.y * size,
          0.95 // Sits above grass/water, slightly behind character
        );
        dummy.scale.set(size, size, 1);
        dummy.updateMatrix();
        this.object3D.setMatrixAt(i, dummy.matrix);

        glyphIndices[i] = atlas.getIndex(cell.char);
        colors[i * 3 + 0] = cell.r;
        colors[i * 3 + 1] = cell.g;
        colors[i * 3 + 2] = cell.b;
        i++;
      }
    }

    geometry.setAttribute('aGlyphIndex', new THREE.InstancedBufferAttribute(glyphIndices, 1));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    this.object3D.instanceMatrix.needsUpdate = true;
  }

  public update(ctx: FrameContext): void {
    this.material.uniforms.uPlayerPos.value.set(ctx.playerPos.x, ctx.playerPos.y);
    this.material.uniforms.uTime.value = ctx.elapsed;
  }

  /** Solid circle colliders, one per placement (centred near the trunk/body). */
  public getColliders(): CircleCollider[] {
    const colliders: CircleCollider[] = [];
    for (const p of this.placements) {
      const size = p.cellSize ?? 0.42;
      // Cell placement is offset by width*size/2, so the visual centre of the
      // asset sits at worldX - size/2 (the trunk for tree sprites).
      const cx = p.colliderX ?? p.worldX - size / 2;
      const cy = p.colliderY ?? p.worldY + size;
      const radius =
        p.colliderRadius ?? Math.max(0.3, Math.min(0.75, p.asset.width * size * 0.15));
      colliders.push({ x: cx, y: cy, radius });
    }
    return colliders;
  }

  public dispose(): void {
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}