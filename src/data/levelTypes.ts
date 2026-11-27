// Serialization-friendly level & entity data types.
//
// A `LevelData` snapshot captures everything a level needs to be rebuilt from
// scratch: the terrain (base64-encoded TerrainGrid), a forest seed for the
// procedural fill, the player spawn, and every manually placed entity. This is
// the shape the upcoming dev editor will read/write as JSON.

import type { PaletteConfig } from '../core/LevelTheme';

export type EntityKind =
  | 'building'
  | 'tree'
  | 'boulder'
  | 'enemy'
  | 'npc'
  | 'node'
  | 'shrine'
  | 'prop';

export interface PlacedEntity {
  id: string;
  kind: EntityKind;
  assetId: string;
  x: number;
  y: number;
  /** Collider radius in world units. Optional for entities that derive it from their asset. */
  radius?: number;
  /** Shrine-only: true renders the purified warm-gold state. */
  purified?: boolean;
  /** Enemy grouping for quest/combat logic (e.g. 'alley', 'patrol', 'boss'). */
  group?: string;
  /** Y-axis rotation in radians (used by the F2 editor for custom PNG assets). */
  rotation?: number;
}

/** Category a user-imported PNG asset can be registered as. */
export type CustomPngKind = 'prop' | 'building' | 'npc';

/** Geometry style for a user-imported PNG asset. */
export type CustomPngStyle = 'card' | 'crossed';

/** A user-imported PNG asset registered into the reusable AssetRegistry. */
export interface CustomPngAsset {
  id: string;
  kind: CustomPngKind;
  /** PNG / WebP / JPEG data URL (persisted in localStorage when it fits). */
  dataUrl: string;
  /** World-space height in units. */
  height: number;
  /** Collider radius in world units. */
  radius: number;
  style: CustomPngStyle;
  /** Width / height ratio of the source image (defaults to 1 when unknown). */
  aspectRatio?: number;
}

/** A single circle within an asset's collider footprint, offset from its origin. */
export interface ColliderSpec {
  /** Horizontal offset from the entity origin, in world units. */
  offsetX: number;
  /** Vertical (north +Y) offset from the entity origin, in world units. */
  offsetY: number;
  radius: number;
}

export interface LevelData {
  id: string;
  name: string;
  worldSize: number;
  gridResolution: number;
  terrainBase64: string;
  forestSeed: number;
  spawn: { x: number; y: number };
  entities: PlacedEntity[];
  /** Optional live palette override captured by the Level Exporter. */
  palette?: PaletteConfig;
  /** Optional custom PNG assets embedded by the Level Exporter. */
  customAssets?: CustomPngAsset[];
}
