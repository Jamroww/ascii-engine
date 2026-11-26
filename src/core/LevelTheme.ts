import * as THREE from 'three';

/**
 * Live-editable palette for a level. Every field is a hex string so the
 * Settings "Palette Studio" can read / mutate / copy the exact colors without
 * any colour-space ambiguity.
 */
export interface PaletteConfig {
  foliageBase: string;
  foliageTip: string;
  sunColor: string;
  skyFillColor: string;
  groundColor: string;
  asciiVoidColor: string;
  bloomTint: string;
  /** Base tint for river / bay water (Level 1 only renders water). */
  waterColor: string;
  /** Tint multiplied into non-emissive building / prop / stone albedos. */
  structureColor: string;
}

/** The seven channel keys exposed by the HSV colour wheel. */
export type PaletteChannel = keyof PaletteConfig;

export type WeatherMode = 'rain' | 'petals';

/** Level-wide atmosphere + biome toggles that sit *beside* the palette. */
export interface LevelTheme {
  id: 'act1_harbor' | 'act2_wheatfield';
  palette: PaletteConfig;
  /** Directional light (moon / sun) intensity. */
  sunIntensity: number;
  /** Hemisphere fill intensity. */
  skyFillIntensity: number;
  /** Offset of the key light from the player (kept low for a grazing golden hour). */
  sunPosition: { x: number; y: number; z: number };
  hasWater: boolean;
  weatherMode: WeatherMode;
  /** Grass / wheat blade height multiplier. */
  foliageHeightScale: number;
  /** Grass / wheat wind-sway amplitude multiplier. */
  foliageSwayAmp: number;
  /** Radius of the circular dueling clearing (0 disables it, e.g. Level 1). */
  clearingRadius: number;
  /** Warm multiplier tint for the dry-earth ground shader (white = no change). */
  groundTint: { r: number; g: number; b: number };
}

export const ACT1_THEME: LevelTheme = {
  id: 'act1_harbor',
  palette: {
    foliageBase: '#071e15',
    foliageTip: '#194d38',
    sunColor: '#e2eeff',
    skyFillColor: '#7c98b8',
    groundColor: '#1b2822',
    asciiVoidColor: '#000000',
    bloomTint: '#d8e8ff',
    waterColor: '#1b4566',
    structureColor: '#9cb0c4',
  },
  sunIntensity: 3.0,
  skyFillIntensity: 0.34,
  sunPosition: { x: -16, y: 28, z: 16 },
  hasWater: true,
  weatherMode: 'rain',
  foliageHeightScale: 1.0,
  foliageSwayAmp: 1.0,
  clearingRadius: 0,
  groundTint: { r: 1.0, g: 1.0, b: 1.0 },
};

export const ACT2_THEME: LevelTheme = {
  id: 'act2_wheatfield',
  palette: {
    foliageBase: '#c4a260',
    foliageTip: '#eff27f',
    sunColor: '#ffad52',
    skyFillColor: '#d46a4c',
    groundColor: '#ff5385',
    asciiVoidColor: '#784635',
    bloomTint: '#ff6e4c',
    waterColor: '#1b4566',
    structureColor: '#c7a086',
  },
  sunIntensity: 3.6,
  skyFillIntensity: 0.46,
  sunPosition: { x: -24, y: 12, z: 18 },
  hasWater: false,
  weatherMode: 'petals',
  foliageHeightScale: 1.65,
  foliageSwayAmp: 1.85,
  clearingRadius: 10.5,
  groundTint: { r: 1.22, g: 0.88, b: 0.62 },
};

export function getLevelTheme(id: string): LevelTheme {
  return id === 'act2_wheatfield' ? ACT2_THEME : ACT1_THEME;
}

/** Convert a `#rrggbb` hex string into a fresh THREE.Color (no shared state). */
export function hexToColor(hex: string, out?: THREE.Color): THREE.Color {
  const target = out ?? new THREE.Color();
  target.set(hex);
  return target;
}

/** Deep-clone a palette so live edits never mutate the immutable presets. */
export function clonePalette(palette: PaletteConfig): PaletteConfig {
  return { ...palette };
}
