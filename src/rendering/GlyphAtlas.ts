import * as THREE from 'three';
import type { GlyphAtlasConfig } from '../core/types';

// Tight sculptural density ramp, ordered lightest -> densest so the screen-space
// post-process can map perceptual luminance straight onto the atlas. Free of
// noisy punctuation static: rounded/engraved forms pack together like a woodcut.
export const DEFAULT_CHARSET = " .:-=+*rcunxzoO0Q8%#MW@$";

export class GlyphAtlas {
  public readonly texture: THREE.CanvasTexture;
  public readonly cols: number;
  public readonly rows: number;
  public readonly charset: string;
  /** Number of glyphs actually rasterized (charset length, capped at cols*rows). */
  public readonly count: number;
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

    // Transparent background, pure white glyphs (tinted dynamically in shaders).
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    // ~87.5% of the cell leaves a clean 2px transparent gutter around every tile
    // so adjacent glyphs never bleed/flicker at cell borders with NearestFilter.
    ctx.font = `bold ${Math.floor(cellSize * 0.875)}px ${fontFamily}`;
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

    this.count = count;

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
