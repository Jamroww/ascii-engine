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
export const WORLD_BOUNDS = 19;

// The player's collision radius, used to resolve overlaps with trunks, rocks
// and boulders.
export const PLAYER_RADIUS = 0.42;
