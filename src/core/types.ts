import type * as THREE from 'three';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CircleCollider {
  x: number;
  y: number;
  radius: number;
}

export interface RGB {
  r: number; // 0.0 to 1.0
  g: number; // 0.0 to 1.0
  b: number; // 0.0 to 1.0
}

export interface GlyphCell {
  glyphIndex: number;
  color: RGB;
}

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

export interface GlyphAtlasConfig {
  charset: string;
  cellSize: number;
  fontFamily: string;
  cols: number;
  rows: number;
}

export interface InputState {
  moveX: number;
  moveY: number;
  sprint: boolean;
  mouseNdc: Vec2;
}

export interface IInputManager {
  getState(): InputState;
  dispose(): void;
}

export interface FrameContext {
  dt: number;
  elapsed: number;
  playerPos: Vec2;
  input: InputState;
  /** 0..1 — corruptive alignment (drives colder/tighter atmosphere). */
  corruption: number;
  /** 0..1 — virtuous alignment (drives warmer/wider lantern light). */
  virtue: number;
}

export interface IRenderLayer {
  readonly object3D: THREE.Object3D;
  update(ctx: FrameContext): void;
  preRender?(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}