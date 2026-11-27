// Shared editor state types, kept separate from the controller/panel so both can
// import them without introducing a runtime import cycle.

/** Top-level editor mode: place assets, or paint terrain & grass brushes. */
export type EditorMode = 'place' | 'terrain';

/** Sub-tools inside the Place Assets mode. */
export type PlaceTool = 'place' | 'select';

/** Terrain & grass brush kinds (mirrors TerrainGrid.TerrainBrushMode). */
export type TerrainBrushKind =
  | 'grass_add'
  | 'grass_erase'
  | 'path'
  | 'water'
  | 'land'
  | 'blight_add'
  | 'blight_clear';
