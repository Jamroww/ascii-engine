import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import type { TerrainGrid } from '../core/TerrainGrid';
import { createTreePineModel, createTreeOakModel, createTreeWiltedModel } from './Nature';
import { disposeModelTree, setCastShadow } from './modelUtils';

export type TreeKind = 'pine' | 'oak' | 'wilted';

export interface TreeCell {
  x: number;
  y: number;
  char: string;
  r: number;
  g: number;
  b: number;
  swayWeight: number; // 0 for trunk/roots, 0.2..1.0 for canopy
}

export interface TreeAsset {
  kind: TreeKind;
  width: number;
  height: number;
  cells: TreeCell[];
  trunkRadius: number;
}

export interface TreePlacement {
  kind: TreeKind;
  worldX: number; // Center base X
  worldY: number; // Base Y
  scale?: number;
}

function buildTreeAsset(kind: TreeKind, rows: string[], trunkHeight: number): TreeAsset {
  const height = rows.length;
  const width = rows[0].length;
  const cells: TreeCell[] = [];

  for (let r = 0; r < height; r++) {
    const line = rows[r];
    const y = height - 1 - r;
    const heightNorm = y / Math.max(height - 1, 1);

    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char === ' ') continue;

      const isTrunk = y < trunkHeight;
      const distFromCenter = Math.abs(x - (width - 1) / 2) / (width / 2);

      const bodyShade = 0.58 + heightNorm * 0.5;
      const rim = Math.max(heightNorm * heightNorm, distFromCenter * 0.85);

      let cr: number;
      let cg: number;
      let cb: number;

      if (kind === 'wilted') {
        cr = 0.32 * bodyShade + rim * 0.18;
        cg = 0.34 * bodyShade + rim * 0.2;
        cb = 0.36 * bodyShade + rim * 0.24;
      } else if (isTrunk) {
        const barkShade = 0.55 + (1.0 - distFromCenter) * 0.35;
        cr = 0.44 * barkShade + rim * 0.12;
        cg = 0.18 * barkShade + rim * 0.06;
        cb = 0.1 * barkShade + rim * 0.03;
      } else if (kind === 'pine') {
        cr = 0.22 * bodyShade + rim * 0.28;
        cg = 0.32 * bodyShade + rim * 0.16;
        cb = 0.24 * bodyShade + rim * 0.1;
      } else {
        const isMoss = char === ':' || char === ',' || char === ';';
        cr = (isMoss ? 0.32 : 0.24) * bodyShade + rim * 0.3;
        cg = (isMoss ? 0.32 : 0.28) * bodyShade + rim * 0.14;
        cb = (isMoss ? 0.2 : 0.18) * bodyShade + rim * 0.08;
      }

      const swayWeight = isTrunk
        ? 0.0
        : Math.max(0.15, (y - trunkHeight + 1) / (height - trunkHeight));
      cells.push({ x, y, char, r: cr, g: cg, b: cb, swayWeight });
    }
  }

  return {
    kind,
    width,
    height,
    cells,
    trunkRadius: kind === 'oak' ? 0.95 : 0.65,
  };
}

export function createAncientPine(): TreeAsset {
  return buildTreeAsset(
    'pine',
    [
      '       ^       ',
      '      /^\\      ',
      '     /#*#\\     ',
      '    /##%##\\    ',
      '     /#@#\\     ',
      '   /##%*%##\\   ',
      '  /##%@#@%##\\  ',
      '    /##%##\\    ',
      '  /##%@*@%##\\  ',
      ' /##%@###@%##\\ ',
      '/##%@##%##@%##\\',
      '  /##%@#@%##\\  ',
      ' /##%@###@%##\\ ',
      '   ~~~|#|~~~   ',
      '      |#|      ',
      '      |#|      ',
      '     /|#|\\     ',
    ],
    4,
  );
}

export function createGnarledOak(): TreeAsset {
  return buildTreeAsset(
    'oak',
    [
      '     .~~~~~.     ',
      '   .~#%@%@%#~.   ',
      '  /#%@#####@%#\\  ',
      ' /#%@##*#*##@%#\\ ',
      '(#%@##%@#@%##@%#)',
      '(#%@#########%@#)',
      ' \\#%@##%@%##@%#/ ',
      '  \\:#%#####%#:/  ',
      '   :,~\\|#|/~,:   ',
      '    :  |#|  ,    ',
      '       |#|       ',
      '      /|#|\\      ',
      '     //|#|\\\\     ',
    ],
    5,
  );
}

export function createWiltedTree(): TreeAsset {
  return buildTreeAsset(
    'wilted',
    [
      '   \\       /   ',
      '    \\  |  /    ',
      '  \\  \\ | /  /  ',
      '   \\__\\|/__/   ',
      '     : | :     ',
      '   \\  \\|/  /   ',
      '    \\__|__/    ',
      '      ,|       ',
      '       |       ',
      '      /|\\      ',
      '     / | \\     ',
    ],
    4,
  );
}

const TREE_FACTORIES: Record<TreeKind, () => THREE.Group> = {
  pine: createTreePineModel,
  oak: createTreeOakModel,
  wilted: createTreeWiltedModel,
};

/**
 * Lift dark tree albedos so russet/umber trunks and foliage read as sculpted
 * ASCII gradients instead of black cutouts, and stop canopies from receiving
 * shadows so they cast crisp ground shadows without self-shadowing black.
 */
function liftTreeMaterials(tree: THREE.Group): void {
  tree.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mat = node.material;
    if (mat instanceof THREE.MeshStandardMaterial && !node.userData.isEmissive) {
      mat.color.offsetHSL(0, 0, 0.14);
      mat.emissive = mat.color.clone().multiplyScalar(0.05);
    }

    const geo = node.geometry;
    const canopy =
      (geo instanceof THREE.ConeGeometry || geo instanceof THREE.DodecahedronGeometry) &&
      node.position.y > 1.0;
    if (canopy) node.receiveShadow = false;
  });
}

/** Instantiates real 3D trees around the perimeter ring with shadow casting. */
export class ForestLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private trees: THREE.Group[] = [];
  private colliders: Array<{ x: number; y: number; radius: number }> = [];

  constructor(placements: TreePlacement[]) {
    this.object3D.userData.isWorldReflection = true;
    this.build(placements);
  }

  /** Rebuild the instanced models from a fresh placement list. */
  public rebuild(placements: TreePlacement[]): void {
    this.disposeTrees();
    this.object3D.clear();
    this.colliders = [];
    this.build(placements);
  }

  public getColliders(): Array<{ x: number; y: number; radius: number }> {
    return this.colliders;
  }

  public update(_ctx: FrameContext): void {}

  public dispose(): void {
    this.disposeTrees();
    this.object3D.clear();
  }

  private disposeTrees(): void {
    for (const tree of this.trees) disposeModelTree(tree);
    this.trees = [];
  }

  private build(placements: TreePlacement[]): void {
    for (const p of placements) {
      const factory = TREE_FACTORIES[p.kind];
      const tree = factory();
      tree.position.set(p.worldX, 0, -p.worldY);
      const scale = p.scale ?? 1.0;
      tree.scale.setScalar(scale);
      setCastShadow(tree, true);
      liftTreeMaterials(tree);
      this.object3D.add(tree);
      this.trees.push(tree);

      this.colliders.push({
        x: p.worldX,
        y: p.worldY + 0.35 * scale,
        radius: (p.kind === 'oak' ? 0.95 : 0.65) * scale,
      });
    }
  }
}

/** Deterministic pseudo-random helper so the forest layout stays consistent across reloads */
function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generates a sparse perimeter forest ring framing a wide-open Riverside Village clearing */
export function generateRiversideForest(terrain: TerrainGrid, seed = 42): TreePlacement[] {
  const rand = seededRand(seed);
  const placements: TreePlacement[] = [];

  const isBlocked = (x: number, y: number): boolean => {
    if (terrain.getRiverSDF(x, y) < 2.4) return true;
    if (terrain.getPathMask(x, y) > 0.15) return true;
    for (const p of placements) {
      if (Math.hypot(x - p.worldX, y - p.worldY) < 3.0) return true;
    }
    return false;
  };

  const PERIMETER_MIN = 17;
  const PERIMETER_MAX = 29;

  for (let i = 0; i < 2000 && placements.length < 90; i++) {
    const r = Math.sqrt(rand()) * (PERIMETER_MAX - PERIMETER_MIN) + PERIMETER_MIN;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;

    if (isBlocked(x, y)) continue;

    const roll = rand();
    let kind: TreeKind;
    if (y > 14 && roll < 0.45) {
      kind = 'wilted';
    } else if (roll < 0.62) {
      kind = 'pine';
    } else if (roll < 0.9) {
      kind = 'oak';
    } else {
      kind = 'wilted';
    }

    placements.push({
      kind,
      worldX: x,
      worldY: y,
      scale: 1.25 + rand() * 0.5,
    });
  }

  return placements;
}
