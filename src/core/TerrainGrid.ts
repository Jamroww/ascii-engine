import * as THREE from 'three';

/**
 * Single source of truth for the world's terrain fields (river, blight,
 * footpath / village clearing). The same `Uint8Array` is exposed as a
 * `THREE.DataTexture` so the CPU (collision, wading, placement) and the GPU
 * (WaterLayer shader) read identical data instead of each duplicating the
 * hardcoded math.
 *
 * Channel layout (each texel is 4 bytes, RGBA):
 *   R — river signed distance field, remapped so 128 == shoreline.
 *   G — blight intensity: 0 == clean, 255 == full blight.
 *   B — footpath / village clearing mask: 0 == wild, 255 == cleared path,
 *       with 128 used for the softer village/trail clearing (no trees, but
 *       still grass/moss). See the PATH_* constants below.
 *   A — terrain modifier: 0 == normal, 128 == mud/slow, 255 == impassable
 *       (reserved for future biomes).
 */

export const SDF_RANGE = 8.0;

export type TerrainChannel = 0 | 1 | 2 | 3;

// B-channel values. The footpath is the packed-earth band the player walks on;
// the village clearing + northern trail are cleared of trees but keep their
// grass/moss ground cover.
export const PATH_WILD = 0;
export const PATH_CLEARED = 128;
export const PATH_DIRT = 255;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- Legacy formulas -------------------------------------------------------
// Read once from the pre-TerrainGrid code (world.ts / WaterLayer / ForestLayer)
// by bakeFromLegacy() so the Riverside Village keeps its exact shape.

const RIVER = {
  baseX: 6.5,
  curveAmpA: 3.2,
  curveFreqA: 0.14,
  curveAmpB: 1.5,
  curveFreqB: 0.07,
  halfWidthBase: 3.8,
  halfWidthAmp: 0.6,
  halfWidthFreq: 0.22,
} as const;

function riverCenterX(y: number): number {
  return (
    RIVER.baseX +
    Math.sin(y * RIVER.curveFreqA) * RIVER.curveAmpA +
    Math.cos(y * RIVER.curveFreqB) * RIVER.curveAmpB
  );
}

function riverHalfWidth(y: number): number {
  return RIVER.halfWidthBase + Math.sin(y * RIVER.halfWidthFreq) * RIVER.halfWidthAmp;
}

/** riverSDF(x, y) <= 0 means the point is inside the river channel. */
function riverSDF(x: number, y: number): number {
  return Math.abs(x - riverCenterX(y)) - riverHalfWidth(y);
}

/** Legacy footpath + village clearing mask (B channel, 0..255 byte). */
function pathMaskByte(x: number, y: number): number {
  // Winding dirt footpath leading from spawn toward the river (GroundLayer).
  const pathY = Math.sin(x * 0.55) * 1.3;
  const onPath = Math.abs(y - pathY) < 0.95 && x > -6 && x < 9;

  // Central village clearing + cottage yard (ForestLayer).
  const inVillage = Math.hypot(x + 3, y - 1) < 15.0;

  // Winding northern trail toward the upstream Blight (ForestLayer).
  const inTrail = x > -2.5 && x < 4.5 && y > 6 && y < 38;

  if (onPath) return PATH_DIRT;
  if (inVillage || inTrail) return PATH_CLEARED;
  return PATH_WILD;
}

// --- Act 1: Harbor-to-Castle layout (128x128) -------------------------------

const HARBOR = { cx: -4, cy: -40, radius: 34 } as const;

/** Pier landing: a narrow walkable strip jutting south from the village shore. */
const PIER = { cx: 2, halfW: 2.2, yTop: -6, yBottom: -22 } as const;

function harborSDF(x: number, y: number): number {
  return Math.hypot(x - HARBOR.cx, y - HARBOR.cy) - HARBOR.radius;
}

/** Winding north-east river: source top-right, S-curves into the bay's east edge. */
function act1RiverCenterX(y: number): number {
  const t = clamp((y + 22) / 86, 0, 1);
  const base = 13 + 21 * t;
  const wiggle = (Math.sin(y * 0.1) * 5.0 + Math.cos(y * 0.05) * 2.5) * smoothstep(0, 1, t);
  return base + wiggle;
}

function act1RiverHalfWidth(y: number): number {
  return 2.5 + Math.sin(y * 0.18) * 0.35;
}

function act1RiverSDF(x: number, y: number): number {
  return Math.abs(x - act1RiverCenterX(y)) - act1RiverHalfWidth(y);
}

function pierLandSDF(x: number, y: number): number {
  const dx = Math.max(Math.abs(x - PIER.cx) - PIER.halfW, 0);
  const dy = Math.max(Math.max(PIER.yBottom - y, y - PIER.yTop), 0);
  return Math.hypot(dx, dy);
}

/** Union of harbor bay + river; the pier strip is carved out into dry land. */
function act1WaterSDF(x: number, y: number): number {
  const water = Math.min(harborSDF(x, y), act1RiverSDF(x, y));
  if (pierLandSDF(x, y) < 1.0) return Math.max(water, 1.0 - pierLandSDF(x, y) + 0.2);
  return water;
}

/** Strong toxic Blight along the upper river and bridge approach (y > +16). */
function act1BlightByte(x: number, y: number): number {
  const upstream = smoothstep(16, 36, y);
  const nearRiver = 1.0 - smoothstep(2.0, 8.0, Math.abs(act1RiverSDF(x, y)));
  const v = upstream * (0.72 + 0.28 * nearRiver) * (0.9 + 0.1 * Math.sin(x * 0.4 - y * 0.3));
  return Math.round(clamp(v, 0, 1) * 255);
}

// Footpath waypoints: pier -> NW alley -> survivor clearing -> NE river -> bridge -> castle.
const ACT1_PATH: ReadonlyArray<readonly [number, number]> = [
  [2, -20],
  [-2, -8],
  [-12, -4],
  [-22, 2],
  [-28, 10],
  [-20, 22],
  [0, 30],
  [14, 36],
  [20, 44],
  [26, 48],
];

function pointSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? clamp((apx * abx + apy * aby) / lenSq, 0, 1) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function act1PathDist(x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < ACT1_PATH.length; i++) {
    const [ax, ay] = ACT1_PATH[i - 1];
    const [bx, by] = ACT1_PATH[i];
    best = Math.min(best, pointSegmentDist(x, y, ax, ay, bx, by));
  }
  return best;
}

function act1PathMaskByte(x: number, y: number): number {
  const d = act1PathDist(x, y);
  if (d < 1.5) return PATH_DIRT;
  if (d < 3.5) return PATH_CLEARED;
  // Open survivor clearing (north-west) + castle courtyard (north-east).
  if (Math.hypot(x + 28, y - 10) < 9) return PATH_CLEARED;
  if (Math.hypot(x - 26, y - 48) < 8) return PATH_CLEARED;
  return PATH_WILD;
}

export class TerrainGrid {
  public readonly resolution: number;
  public readonly worldSize: number;
  public readonly data: Uint8Array;
  public readonly texture: THREE.DataTexture;

  constructor(resolution = 512, worldSize = 128) {
    this.resolution = resolution;
    this.worldSize = worldSize;
    this.data = new Uint8Array(resolution * resolution * 4);

    this.texture = new THREE.DataTexture(
      this.data,
      resolution,
      resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    // Raw bytes, no sRGB decode; row 0 sits at v=0 so it lines up with world y = -worldSize/2.
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
  }

  private index(x: number, y: number, channel: TerrainChannel): number {
    return (y * this.resolution + x) * 4 + channel;
  }

  private static encodeSdf(sdf: number): number {
    return clamp(Math.round(128 + (sdf / SDF_RANGE) * 128), 0, 255);
  }

  /**
   * Bilinear-sample one channel at a world-space point, returning the raw byte
   * (0..255). Texel centres sit at (i + 0.5) / resolution * worldSize - half.
   */
  private sampleByte(x: number, y: number, channel: TerrainChannel): number {
    const { resolution, worldSize, data } = this;
    const half = worldSize / 2;

    let gx = ((x + half) / worldSize) * resolution - 0.5;
    let gy = ((y + half) / worldSize) * resolution - 0.5;
    gx = clamp(gx, 0, resolution - 1);
    gy = clamp(gy, 0, resolution - 1);

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const x1 = Math.min(x0 + 1, resolution - 1);
    const y1 = Math.min(y0 + 1, resolution - 1);

    const at = (ix: number, iy: number): number => data[(iy * resolution + ix) * 4 + channel];
    const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
    return top + (bottom - top) * ty;
  }

  /** Bilinear-sample a channel, normalized to 0..1. */
  public sampleChannel(x: number, y: number, channel: TerrainChannel): number {
    return this.sampleByte(x, y, channel) / 255;
  }

  /** River signed distance in world units (negative == inside the river). */
  public getRiverSDF(x: number, y: number): number {
    return ((this.sampleByte(x, y, 0) - 128) / 128) * SDF_RANGE;
  }

  public isInRiver(x: number, y: number): boolean {
    return this.getRiverSDF(x, y) < 0;
  }

  /** Blight intensity, 0..1. */
  public getBlight(x: number, y: number): number {
    return this.sampleByte(x, y, 1) / 255;
  }

  /** Footpath / village clearing mask, 0..1. */
  public getPathMask(x: number, y: number): number {
    return this.sampleByte(x, y, 2) / 255;
  }

  /** Paint a soft circle into one channel (used by the upcoming dev editor). */
  public paintCircle(
    x: number,
    y: number,
    radius: number,
    channel: TerrainChannel,
    value: number,
    softness = 0
  ): void {
    const { resolution, worldSize, data } = this;
    const half = worldSize / 2;
    const byte = clamp(Math.round(value * 255), 0, 255);

    const worldToGrid = (w: number): number => ((w + half) / worldSize) * resolution;
    const minX = Math.max(0, Math.floor(worldToGrid(x - radius - softness)));
    const maxX = Math.min(resolution - 1, Math.ceil(worldToGrid(x + radius + softness)));
    const minY = Math.max(0, Math.floor(worldToGrid(y - radius - softness)));
    const maxY = Math.min(resolution - 1, Math.ceil(worldToGrid(y + radius + softness)));

    for (let iy = minY; iy <= maxY; iy++) {
      const wy = ((iy + 0.5) / resolution) * worldSize - half;
      for (let ix = minX; ix <= maxX; ix++) {
        const wx = ((ix + 0.5) / resolution) * worldSize - half;
        const d = Math.hypot(wx - x, wy - y);
        const edge =
          softness > 0
            ? smoothstep(radius + softness, radius - softness, d)
            : d <= radius
              ? 1
              : 0;
        if (edge <= 0) continue;

        const idx = this.index(ix, iy, channel);
        data[idx] =
          edge >= 1
            ? byte
            : clamp(Math.round(data[idx] + (byte - data[idx]) * edge), 0, 255);
      }
    }

    this.texture.needsUpdate = true;
  }

  /**
   * Bake the Act 2 golden sunset wheatfield: an 80x80 dry rolling plain with no
   * river, a circular beaten-earth dueling clearing around (0,0), and a dirt
   * approach path coming north from the south spawn.
   */
  public static bakeAct2Wheatfield(resolution = 256, worldSize = 80): TerrainGrid {
    const grid = new TerrainGrid(resolution, worldSize);
    const half = worldSize / 2;
    const CLEARING_RADIUS = 10.5;

    for (let iy = 0; iy < resolution; iy++) {
      const wy = ((iy + 0.5) / resolution) * worldSize - half;
      for (let ix = 0; ix < resolution; ix++) {
        const wx = ((ix + 0.5) / resolution) * worldSize - half;

        // R — dry land everywhere (no river / water on the wheatfield).
        grid.data[grid.index(ix, iy, 0)] = 255;

        // G — clean earth (no blight).
        grid.data[grid.index(ix, iy, 1)] = 0;

        // B — circular dueling clearing + the southern dirt approach path.
        const clearingDist = Math.hypot(wx, wy);
        const clearing = 1 - smoothstep(CLEARING_RADIUS - 1.5, CLEARING_RADIUS + 1.5, clearingDist);
        const onPathY = wy > -25 && wy < -8;
        const path = onPathY ? 1 - smoothstep(1.1, 2.4, Math.abs(wx)) : 0;
        const mask = Math.max(clearing, path);
        grid.data[grid.index(ix, iy, 2)] = Math.round(clamp(mask, 0, 1) * 255);

        // A — no terrain modifier.
        grid.data[grid.index(ix, iy, 3)] = 0;
      }
    }

    grid.texture.needsUpdate = true;
    return grid;
  }

  public toBase64(): string {
    const bytes = this.data;
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  public static fromBase64(base64: string, resolution = 128, worldSize = 60): TerrainGrid {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const grid = new TerrainGrid(resolution, worldSize);
    grid.data.set(bytes);
    grid.texture.needsUpdate = true;
    return grid;
  }

  /**
   * Bake the legacy river / blight / footpath formulas into a fresh grid so the
   * Riverside Village renders exactly as before the refactor.
   */
  public static bakeFromLegacy(resolution = 128, worldSize = 60): TerrainGrid {
    const grid = new TerrainGrid(resolution, worldSize);
    const half = worldSize / 2;

    for (let iy = 0; iy < resolution; iy++) {
      const wy = ((iy + 0.5) / resolution) * worldSize - half;
      for (let ix = 0; ix < resolution; ix++) {
        const wx = ((ix + 0.5) / resolution) * worldSize - half;

        grid.data[grid.index(ix, iy, 0)] = TerrainGrid.encodeSdf(riverSDF(wx, wy));
        grid.data[grid.index(ix, iy, 1)] = Math.round(
          smoothstep(6.5, 16.0, wy + Math.sin(wx * 0.5) * 1.6) * 255
        );
        grid.data[grid.index(ix, iy, 2)] = pathMaskByte(wx, wy);
        grid.data[grid.index(ix, iy, 3)] = 0;
      }
    }

    grid.texture.needsUpdate = true;
    return grid;
  }

  /**
   * Bake the Act 1 harbor-to-castle topology: a south-center semicircular harbor
   * bay, a winding north-east river, the blighted upstream approach, and the
   * footpath threading pier -> alley -> clearing -> bridge -> castle.
   */
  public static bakeAct1Harbor(resolution = 512, worldSize = 128): TerrainGrid {
    const grid = new TerrainGrid(resolution, worldSize);
    const half = worldSize / 2;

    for (let iy = 0; iy < resolution; iy++) {
      const wy = ((iy + 0.5) / resolution) * worldSize - half;
      for (let ix = 0; ix < resolution; ix++) {
        const wx = ((ix + 0.5) / resolution) * worldSize - half;

        grid.data[grid.index(ix, iy, 0)] = TerrainGrid.encodeSdf(act1WaterSDF(wx, wy));
        grid.data[grid.index(ix, iy, 1)] = act1BlightByte(wx, wy);
        grid.data[grid.index(ix, iy, 2)] = act1PathMaskByte(wx, wy);
        grid.data[grid.index(ix, iy, 3)] = 0;
      }
    }

    grid.texture.needsUpdate = true;
    return grid;
  }
}
