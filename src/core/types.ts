import type * as THREE from 'three';

export interface Vec2 {
  x: number;
  y: number;
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
}

export interface IRenderLayer {
  readonly object3D: THREE.Object3D;
  update(ctx: FrameContext): void;
  preRender?(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}