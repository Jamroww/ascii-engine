// Shared world-layout constants and helpers.
//
// The river is defined exactly once here so that the CPU-side collision /
// wading logic and the GPU-side WaterLayer shader agree on its shape. If you
// tweak these numbers, WaterLayer picks them up automatically (it interpolates
// them into its GLSL at construction time).

export interface Boulder {
  x: number;
  y: number;
  r: number;
}

export const BOULDERS: Boulder[] = [
  { x: 6.8, y: -4.0, r: 1.15 },
  { x: 5.2, y: 4.5, r: 0.95 },
  { x: 8.0, y: 11.0, r: 1.3 },
];

// riverSDF(x, y) <= 0 means the point is inside the river channel.
export const RIVER = {
  baseX: 6.5,
  curveAmpA: 3.2,
  curveFreqA: 0.14,
  curveAmpB: 1.5,
  curveFreqB: 0.07,
  halfWidthBase: 3.8,
  halfWidthAmp: 0.6,
  halfWidthFreq: 0.22,
} as const;

export function riverCenterX(y: number): number {
  return (
    RIVER.baseX +
    Math.sin(y * RIVER.curveFreqA) * RIVER.curveAmpA +
    Math.cos(y * RIVER.curveFreqB) * RIVER.curveAmpB
  );
}

export function riverHalfWidth(y: number): number {
  return RIVER.halfWidthBase + Math.sin(y * RIVER.halfWidthFreq) * RIVER.halfWidthAmp;
}

export function riverSDF(x: number, y: number): number {
  return Math.abs(x - riverCenterX(y)) - riverHalfWidth(y);
}

export function isInRiver(x: number, y: number): boolean {
  return riverSDF(x, y) < 0;
}

// Radius of the playable clearing (in world units). The player is softly
// clamped to stay inside this circle so the finite ground never shows an edge.
export const WORLD_BOUNDS = 19;

// The player's collision radius, used to resolve overlaps with trunks, rocks
// and boulders.
export const PLAYER_RADIUS = 0.42;
