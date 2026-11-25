import * as THREE from 'three';
import type { GlyphAtlasConfig } from '../core/types';

// Ordered roughly by visual density, followed by directional/nature strokes
export const DEFAULT_CHARSET =
  ' .,:;-=+*#%@' +
  '/\\|~_^\'"`' +
  'oO0()[]{}' +
  'vV^<>!?' +
  'abcdefghijklmnopqrstuvwxyz' +
  '8'; // appended (index 62) so the reflected moon has a dense '8' glyph to use

export class GlyphAtlas {
  public readonly texture: THREE.CanvasTexture;
  public readonly cols: number;
  public readonly rows: number;
  public readonly charset: string;
  private readonly charToIndex: Map<string, number> = new Map();

  constructor(config?: Partial<GlyphAtlasConfig>) {
    this.charset = config?.charset ?? DEFAULT_CHARSET;
    this.cols = config?.cols ?? 8;
    this.rows = config?.rows ?? 8;
    const cellSize = config?.cellSize ?? 32;
    const fontFamily = config?.fontFamily ?? '"JetBrains Mono", "Fira Code", monospace';

    const canvas = document.createElement('canvas');
    canvas.width = this.cols * cellSize;
    canvas.height = this.rows * cellSize;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for GlyphAtlas');
    }

    // Transparent background, pure white glyphs (tinted dynamically in shaders)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    // ~94% of the cell height so dense glyphs (@ # % 8 $ = W M) fill their cell
    // edge-to-edge, tiling into a tightly packed halftone/engraving texture.
    ctx.font = `bold ${Math.floor(cellSize * 0.94)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxSlots = this.cols * this.rows;
    const count = Math.min(this.charset.length, maxSlots);

    for (let i = 0; i < count; i++) {
      const char = this.charset[i];
      this.charToIndex.set(char, i);

      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const x = col * cellSize + cellSize / 2;
      const y = row * cellSize + cellSize / 2 + 1;

      ctx.fillText(char, x, y);
    }

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  public getIndex(char: string): number {
    return this.charToIndex.get(char) ?? 0;
  }

  public dispose(): void {
    this.texture.dispose();
  }
}