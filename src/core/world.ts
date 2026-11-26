// Shared world-layout constants and helpers.
//
// The river, blight and footpath/clearing fields now live in TerrainGrid (the
// single CPU + GPU source of truth). This file keeps the remaining CPU-side
// layout: boulders, world bounds and the player's collision radius.

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

// Radius of the playable clearing (in world units). The player is softly
// clamped to stay inside this circle so the finite ground never shows an edge.
export const WORLD_BOUNDS = 62;

// The player's collision radius, used to resolve overlaps with trunks, rocks
// and boulders.
export const PLAYER_RADIUS = 0.42;

// The foreground depth-sort band. Everything that should occlude correctly
// against its neighbours (trees, buildings, the player, enemies, the sword)
// lives inside [Y_TO_Z_MIN, Y_TO_Z_MAX]; background layers (ground, grass,
// shadows, water) sit below it and overlays (weather, atmosphere) sit above it.
export const Y_TO_Z_MIN = 0.85;
export const Y_TO_Z_MAX = 1.95;

/**
 * Map a world-space Y into the foreground depth band. Smaller Y (further
 * south, toward the bottom of the screen) yields a HIGHER z and is therefore
 * drawn in front, so walking north of a trunk hides the player behind it and
 * walking south brings the player in front of it.
 */
export function yToZ(worldY: number): number {
  const z = 1.4 - worldY * 0.012;
  return z < Y_TO_Z_MIN ? Y_TO_Z_MIN : z > Y_TO_Z_MAX ? Y_TO_Z_MAX : z;
}
