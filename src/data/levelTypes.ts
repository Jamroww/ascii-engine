// Serialization-friendly level & entity data types.
//
// A `LevelData` snapshot captures everything a level needs to be rebuilt from
// scratch: the terrain (base64-encoded TerrainGrid), a forest seed for the
// procedural fill, the player spawn, and every manually placed entity. This is
// the shape the upcoming dev editor will read/write as JSON.

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
}
