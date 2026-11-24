import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';

interface AsciiPropCell {
  x: number;
  y: number;
  char: string;
  r: number;
  g: number;
  b: number;
}

interface AsciiPropAsset {
  name: string;
  width: number;
  height: number;
  cells: AsciiPropCell[];
}

const DENSITY_RAMP = '.:-=+*#%@';

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function pngToAscii(
  inputPath: string,
  outputPath: string,
  targetWidth: number = 16
): Promise<void> {
  const { data, info } = await sharp(inputPath)
    .resize({ width: targetWidth, withoutEnlargement: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const cells: AsciiPropCell[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * channels;
      const r8 = data[idx];
      const g8 = data[idx + 1];
      const b8 = data[idx + 2];
      const a8 = data[idx + 3];

      if (a8 < 64) {
        continue;
      }

      const r = r8 / 255;
      const g = g8 / 255;
      const b = b8 / 255;

      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const rampIndex = Math.min(
        DENSITY_RAMP.length - 1,
        Math.max(0, Math.floor(luminance * DENSITY_RAMP.length))
      );

      cells.push({
        x: col,
        y: height - 1 - row,
        char: DENSITY_RAMP[rampIndex],
        r: round3(r),
        g: round3(g),
        b: round3(b),
      });
    }
  }

  const asset: AsciiPropAsset = {
    name: path.basename(inputPath, path.extname(inputPath)),
    width,
    height,
    cells,
  };

  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(asset, null, 2), 'utf-8');
}

async function main(): Promise<void> {
  const [, , inputPath, outputPath, widthArg] = process.argv;

  if (!inputPath || !outputPath) {
    console.error('Usage: npx tsx pngToAscii.ts <inputPath> <outputPath> [targetWidth]');
    process.exit(1);
  }

  const targetWidth = widthArg ? Number.parseInt(widthArg, 10) : 16;

  if (Number.isNaN(targetWidth) || targetWidth <= 0) {
    console.error('Error: targetWidth must be a positive integer.');
    process.exit(1);
  }

  await pngToAscii(inputPath, outputPath, targetWidth);
}

main().catch((err: unknown) => {
  console.error('Failed to convert PNG to ASCII JSON:', err);
  process.exit(1);
});