import type { AsciiPropAsset, AsciiPropCell } from './PropLayer';

type RGB = [number, number, number];

/**
 * Build an AsciiPropAsset from a list of string rows (top-to-bottom, y = 0 is
 * the base). Each non-space character is coloured via the supplied palette.
 */
function buildProp(
  name: string,
  rows: string[],
  palette: Record<string, RGB>,
  fallback: RGB = [0.6, 0.6, 0.6]
): AsciiPropAsset {
  const height = rows.length;
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);

  const cells: AsciiPropCell[] = [];
  for (let r = 0; r < height; r++) {
    const line = rows[r];
    const y = height - 1 - r;
    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char === ' ') continue;
      const [cr, cg, cb] = palette[char] ?? fallback;
      cells.push({ x, y, char, r: cr, g: cg, b: cb });
    }
  }

  return { name, width, height, cells };
}

const PINE_PALETTE: Record<string, RGB> = {
  '^': [0.84, 0.89, 0.93],
  '*': [0.8, 0.86, 0.92],
  '/': [0.12, 0.35, 0.22],
  '\\': [0.12, 0.35, 0.22],
  '#': [0.1, 0.3, 0.19],
  '%': [0.16, 0.43, 0.27],
  '@': [0.07, 0.23, 0.15],
  '|': [0.4, 0.26, 0.15],
};

export function createPine(): AsciiPropAsset {
  return buildProp(
    'pine',
    [
      '       ^       ',
      '      /^\\      ',
      '     /#*#\\     ',
      '    /#%*%#\\    ',
      '   /#%@*@%#\\   ',
      '  /#%@%*%@%#\\  ',
      ' /#%@%@*@%@%#\\ ',
      '/#%@%@%*%@%@%#\\',
      '  /#%@%@%@%#\\  ',
      '   /#%@#%@%#\\  ',
      '    /#%#%#\\    ',
      '     /#%#\\     ',
      '      |||       ',
      '      |||       ',
      '      |||       ',
    ],
    PINE_PALETTE
  );
}

const OAK_PALETTE: Record<string, RGB> = {
  o: [0.2, 0.46, 0.29],
  '*': [0.82, 0.88, 0.9],
  '#': [0.09, 0.28, 0.18],
  '%': [0.14, 0.39, 0.25],
  '@': [0.07, 0.22, 0.15],
  '|': [0.38, 0.25, 0.15],
};

export function createOak(): AsciiPropAsset {
  return buildProp(
    'oak',
    [
      '     o*o     ',
      '    o%*@%o   ',
      '   o#%@*@%#o ',
      '  o#%@%*%@%#o',
      '  o#%@%@%@%#o',
      ' o#%@%@*@%@%#o',
      '  o#%@%#%@%#o',
      '   o#%@#%#o  ',
      '    o#%#o    ',
      '     o#o     ',
      '     |||     ',
      '     |||     ',
    ],
    OAK_PALETTE
  );
}

const WILTED_PALETTE: Record<string, RGB> = {
  '/': [0.34, 0.3, 0.26],
  '\\': [0.34, 0.3, 0.26],
  '|': [0.32, 0.28, 0.24],
};

export function createWiltedTree(): AsciiPropAsset {
  return buildProp(
    'wilted_tree',
    [
      '    /\\    ',
      '   /  \\   ',
      '  /    \\  ',
      ' /  /\\  \\ ',
      '/  /  \\   \\',
      '\\ /    \\ / ',
      ' |      |  ',
      ' |      |  ',
      ' |      |  ',
    ],
    WILTED_PALETTE
  );
}

const FLOWER_PALETTE: Record<string, RGB> = {
  '@': [0.44, 0.16, 0.21],
  '*': [0.66, 0.27, 0.32],
  '%': [0.58, 0.22, 0.27],
  '|': [0.33, 0.42, 0.24],
  '/': [0.26, 0.4, 0.22],
  '\\': [0.26, 0.4, 0.22],
};

/** A tall, drooping bloom — the landmark that gives the area its name. */
export function createWiltedFlower(): AsciiPropAsset {
  return buildProp(
    'wilted_flower',
    [
      '      @@@  ',
      '     @*@*@ ',
      '    @*%*%*@',
      '     @*@*@ ',
      '      @@@  ',
      '       |   ',
      '      /|   ',
      '     / |   ',
      '    |  |   ',
      '    |  |   ',
      '     \\ |   ',
      '      \\|   ',
      '       |   ',
      '      / \\  ',
      '     /   \\ ',
    ],
    FLOWER_PALETTE
  );
}

const ROCK_PALETTE: Record<string, RGB> = {
  '#': [0.3, 0.33, 0.36],
  '%': [0.42, 0.46, 0.5],
  '@': [0.22, 0.25, 0.28],
};

export function createRock(): AsciiPropAsset {
  return buildProp(
    'rock',
    ['   %@%   ', '  @#%@#  ', ' #@%#@%# ', '#%@#@#%@#'],
    ROCK_PALETTE
  );
}

const BUSH_PALETTE: Record<string, RGB> = {
  o: [0.22, 0.48, 0.3],
  '*': [0.3, 0.55, 0.34],
  '#': [0.1, 0.3, 0.19],
  '%': [0.15, 0.4, 0.25],
  '@': [0.08, 0.24, 0.16],
};

export function createBush(): AsciiPropAsset {
  return buildProp('bush', ['  o*o  ', ' o#@#o ', 'o#%@%#o'], BUSH_PALETTE);
}

const STUMP_PALETTE: Record<string, RGB> = {
  '@': [0.32, 0.28, 0.22],
  '%': [0.4, 0.34, 0.26],
  '#': [0.28, 0.25, 0.2],
  '|': [0.36, 0.3, 0.22],
};

export function createStump(): AsciiPropAsset {
  return buildProp('stump', ['  @%@  ', ' #@%@# ', '  |||  '], STUMP_PALETTE);
}

const MUSHROOM_PALETTE: Record<string, RGB> = {
  o: [0.66, 0.3, 0.24],
  '(': [0.78, 0.44, 0.36],
  ')': [0.78, 0.44, 0.36],
  '|': [0.8, 0.75, 0.66],
};

export function createMushrooms(): AsciiPropAsset {
  return buildProp('mushrooms', ['  o   o ', ' (o) (o)', '  |   | '], MUSHROOM_PALETTE);
}

const SWORD_PALETTE: Record<string, RGB> = {
  '^': [0.85, 0.88, 0.92],
  '|': [0.72, 0.76, 0.82],
  '/': [0.62, 0.67, 0.74],
  '\\': [0.62, 0.67, 0.74],
  '#': [0.5, 0.38, 0.28],
  o: [0.85, 0.7, 0.35],
};

/** A top-down sword sprite pointing up, with the hilt at the bottom centre (the pivot). */
export function createSword(): AsciiPropAsset {
  return buildProp(
    'sword',
    [
      '    ^    ',
      '   /|\\   ',
      '   /|\\   ',
      '   /|\\   ',
      '    |    ',
      '   /#\\   ',
      '    |    ',
      '    o    ',
    ],
    SWORD_PALETTE
  );
}
