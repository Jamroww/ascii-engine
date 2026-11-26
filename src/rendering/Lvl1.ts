import * as THREE from 'three';

export type LandmarkPropAssetId =
  | 'castle_gatehouse'
  | 'castle_watchtower'
  | 'fishing_boat'
  | 'alley_barricade';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x181c22,
  deepSlate: 0x262e38,
  roofSlate: 0x222a35,
  midStone: 0x4f5a68,
  paleStone: 0xcbd3dc,
  timberDark: 0x38281c,
  timberMid: 0x664a32,
  weatheredWood: 0xa2825a,
  sailCream: 0xe8e2d5,
  hullDark: 0x252c34,
  warmGlow: 0xff9900,
} as const;

type Vec3Tuple = readonly [number, number, number];

function createFlatMaterial(
  color: number,
  roughness = 0.88,
  metalness = 0.05,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    flatShading: true,
  });
}

function createEmissiveMaterial(color: number, emissive: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 1.5,
    roughness: 0.35,
    metalness: 0.0,
    flatShading: true,
  });
}

function addPart(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec3Tuple = [0, 0, 0],
  rotation: Vec3Tuple = [0, 0, 0],
  isEmissive = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (isEmissive) {
    mesh.userData.isEmissive = true;
  }
  parent.add(mesh);
  return mesh;
}

function createChunkyLantern(
  frameMat: THREE.Material,
  glowMat: THREE.Material,
  scale = 1,
): THREE.Group {
  const lantern = new THREE.Group();
  addPart(lantern, new THREE.ConeGeometry(0.18 * scale, 0.16 * scale, 6), frameMat, [0, 0.2 * scale, 0]);
  addPart(lantern, new THREE.CylinderGeometry(0.15 * scale, 0.13 * scale, 0.12 * scale, 6), frameMat, [0, -0.18 * scale, 0]);
  addPart(
    lantern,
    new THREE.DodecahedronGeometry(0.15 * scale, 0),
    glowMat,
    [0, 0.01 * scale, 0],
    [0, 0, 0],
    true,
  );
  return lantern;
}

function createFramedCrate(
  size: number,
  darkWoodMat: THREE.Material,
  brightWoodMat: THREE.Material,
): THREE.Group {
  const crate = new THREE.Group();
  addPart(crate, new THREE.BoxGeometry(size * 0.86, size * 0.86, size * 0.86), darkWoodMat);

  const rail = Math.max(0.13, size * 0.18);
  const half = size / 2 - rail / 2;
  const xBeamGeo = new THREE.BoxGeometry(size, rail, rail);
  const yBeamGeo = new THREE.BoxGeometry(rail, size, rail);
  const zBeamGeo = new THREE.BoxGeometry(rail, rail, size);

  addPart(crate, xBeamGeo, brightWoodMat, [0, half, half]);
  addPart(crate, xBeamGeo, brightWoodMat, [0, half, -half]);
  addPart(crate, xBeamGeo, brightWoodMat, [0, -half, half]);
  addPart(crate, xBeamGeo, brightWoodMat, [0, -half, -half]);

  addPart(crate, yBeamGeo, brightWoodMat, [-half, 0, half]);
  addPart(crate, yBeamGeo, brightWoodMat, [half, 0, half]);
  addPart(crate, yBeamGeo, brightWoodMat, [-half, 0, -half]);
  addPart(crate, yBeamGeo, brightWoodMat, [half, 0, -half]);

  addPart(crate, zBeamGeo, brightWoodMat, [-half, half, 0]);
  addPart(crate, zBeamGeo, brightWoodMat, [half, half, 0]);
  addPart(crate, zBeamGeo, brightWoodMat, [-half, -half, 0]);
  addPart(crate, zBeamGeo, brightWoodMat, [half, -half, 0]);

  return crate;
}

function createSpokedWheel(
  radius: number,
  woodMat: THREE.Material,
  ironMat: THREE.Material,
): THREE.Group {
  const wheel = new THREE.Group();

  // Thick extruded octagonal wheel rim (rim wall >= 0.15 thick)
  const rimShape = new THREE.Shape();
  rimShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  const rimHole = new THREE.Path();
  rimHole.absarc(0, 0, radius - 0.15, 0, Math.PI * 2, true);
  rimShape.holes.push(rimHole);

  const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
    depth: 0.16,
    curveSegments: 8,
    bevelEnabled: false,
  });
  addPart(wheel, rimGeo, ironMat, [0, 0, -0.08]);

  // Chunky crossed spokes
  const spokeLen = (radius - 0.08) * 2;
  addPart(wheel, new THREE.BoxGeometry(spokeLen, 0.14, 0.14), woodMat);
  addPart(wheel, new THREE.BoxGeometry(0.14, spokeLen, 0.14), woodMat);

  // Heavy central hub
  addPart(wheel, new THREE.CylinderGeometry(0.16, 0.16, 0.24, 6), ironMat, [0, 0, 0], [Math.PI / 2, 0, 0]);

  return wheel;
}

/**
 * castle_gatehouse
 * Width: ~9.2 | Depth: ~3.6 | Height: ~7.4 | Twin crenellated flanking towers
 * joined by an arched gateway with a raised iron portcullis and warm lanterns.
 */
export function createCastleGatehouseModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'castle_gatehouse';

  const darkStoneMat = createFlatMaterial(PALETTE.charcoal);
  const midStoneMat = createFlatMaterial(PALETTE.midStone);
  const paleStoneMat = createFlatMaterial(PALETTE.paleStone);
  const ironMat = createFlatMaterial(PALETTE.deepSlate, 0.6, 0.35);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Central gatehouse wall with passable semicircular archway facing +Z (width 2.5, height 3.35)
  const gateShape = new THREE.Shape();
  gateShape.moveTo(-2.5, 0);
  gateShape.lineTo(-1.25, 0);
  gateShape.lineTo(-1.25, 2.1);
  gateShape.absarc(0, 2.1, 1.25, Math.PI, 0, true);
  gateShape.lineTo(1.25, 0);
  gateShape.lineTo(2.5, 0);
  gateShape.lineTo(2.5, 5.4);
  gateShape.lineTo(-2.5, 5.4);
  gateShape.closePath();

  const gateWallGeo = new THREE.ExtrudeGeometry(gateShape, {
    depth: 2.5,
    curveSegments: 8,
    bevelEnabled: false,
  });
  addPart(root, gateWallGeo, midStoneMat, [0, 0, -1.25]);

  // High-contrast pale voussoir arch blocks framing front (+Z) and back (-Z) faces
  const archStoneGeo = new THREE.BoxGeometry(0.42, 0.34, 0.22);
  const archAngles = [0.22, 0.72, 1.22, 1.57, 1.92, 2.42, 2.92];
  for (const angle of archAngles) {
    const ax = Math.cos(angle) * 1.42;
    const ay = 2.1 + Math.sin(angle) * 1.42;
    const rotZ = angle - Math.PI / 2;
    addPart(root, archStoneGeo, paleStoneMat, [ax, ay, 1.28], [0, 0, rotZ]);
    addPart(root, archStoneGeo, paleStoneMat, [ax, ay, -1.28], [0, 0, rotZ]);
  }

  // Raised chunky iron portcullis teeth suspended inside the upper archway
  addPart(root, new THREE.BoxGeometry(2.56, 0.18, 0.18), ironMat, [0, 2.72, 0.65]);
  const barX = [-0.88, -0.44, 0, 0.44, 0.88];
  for (const bx of barX) {
    addPart(root, new THREE.BoxGeometry(0.14, 0.96, 0.14), ironMat, [bx, 2.86, 0.65]);
    addPart(root, new THREE.ConeGeometry(0.09, 0.24, 4), ironMat, [bx, 2.28, 0.65], [Math.PI, 0, 0]);
  }

  // Central bridge overhanging cornice & crenellated battlements
  addPart(root, new THREE.BoxGeometry(4.6, 0.32, 2.9), paleStoneMat, [0, 5.48, 0]);
  addPart(root, new THREE.BoxGeometry(4.3, 0.2, 2.3), darkStoneMat, [0, 5.66, 0]);

  const bridgeMerlonGeo = new THREE.BoxGeometry(0.68, 0.64, 0.36);
  const merlonX = [-1.4, -0.47, 0.47, 1.4];
  for (const mx of merlonX) {
    addPart(root, bridgeMerlonGeo, paleStoneMat, [mx, 5.96, 1.26]);
    addPart(root, bridgeMerlonGeo, paleStoneMat, [mx, 5.96, -1.26]);
  }

  // Twin flanking octagonal castle towers at x = ±3.15
  const towerXPositions = [-3.15, 3.15];
  for (const tx of towerXPositions) {
    const tower = new THREE.Group();
    tower.position.set(tx, 0, 0);

    // Flared battered stone base grounded at y = 0
    addPart(tower, new THREE.CylinderGeometry(1.38, 1.62, 1.45, 8), darkStoneMat, [0, 0.725, 0]);
    // Main shaft
    addPart(tower, new THREE.CylinderGeometry(1.26, 1.38, 4.55, 8), midStoneMat, [0, 3.725, 0]);
    // Overhanging machicolation crown collar
    addPart(tower, new THREE.CylinderGeometry(1.56, 1.28, 0.56, 8), paleStoneMat, [0, 6.24, 0]);
    // Dark recessed roof deck inside battlements
    addPart(tower, new THREE.CylinderGeometry(1.42, 1.42, 0.24, 8), darkStoneMat, [0, 6.56, 0]);

    // 8 chunky perimeter merlons creating an unmistakable castle crown
    const merlonCount = 8;
    const towerMerlonGeo = new THREE.BoxGeometry(0.64, 0.76, 0.38);
    for (let i = 0; i < merlonCount; i += 1) {
      const angle = (i / merlonCount) * Math.PI * 2;
      addPart(
        tower,
        towerMerlonGeo,
        paleStoneMat,
        [Math.sin(angle) * 1.34, 6.94, Math.cos(angle) * 1.34],
        [0, angle, 0],
      );
    }

    // Glowing recessed arrow-slit window on front face (+Z)
    addPart(tower, new THREE.BoxGeometry(0.46, 1.24, 0.22), darkStoneMat, [0, 4.15, 1.24]);
    addPart(tower, new THREE.BoxGeometry(0.22, 0.96, 0.24), glowMat, [0, 4.15, 1.28], [0, 0, 0], true);

    root.add(tower);
  }

  // Pair of warm wall-mounted gatehouse lanterns flanking the archway (+Z)
  const lanternX = [-1.72, 1.72];
  for (const lx of lanternX) {
    addPart(root, new THREE.BoxGeometry(0.16, 0.16, 0.56), ironMat, [lx, 2.95, 1.52]);
    const lantern = createChunkyLantern(ironMat, glowMat, 1.25);
    lantern.position.set(lx, 2.54, 1.74);
    root.add(lantern);
  }

  return root;
}

/**
 * castle_watchtower
 * Width: ~3.6 | Height: ~9.35 | Tall east-bank stone watchtower with buttress ribs,
 * cantilevered gallery, open glowing signal-beacon belfry (#FF9900), and steep slate spire.
 */
export function createCastleWatchtowerModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'castle_watchtower';

  const darkStoneMat = createFlatMaterial(PALETTE.charcoal);
  const midStoneMat = createFlatMaterial(PALETTE.midStone);
  const paleStoneMat = createFlatMaterial(PALETTE.paleStone);
  const roofMat = createFlatMaterial(PALETTE.roofSlate);
  const timberMat = createFlatMaterial(PALETTE.timberDark);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Heavy octagonal battered foundation plinth grounded at y = 0
  addPart(root, new THREE.CylinderGeometry(1.42, 1.78, 1.5, 8), darkStoneMat, [0, 0.75, 0]);

  // Tall tapered main masonry shaft
  addPart(root, new THREE.CylinderGeometry(1.18, 1.42, 4.1, 8), midStoneMat, [0, 3.55, 0]);

  // Vertical pale stone buttress ribs on left, right, and rear for crisp vertical contrast
  const ribGeo = new THREE.BoxGeometry(0.36, 4.15, 0.36);
  addPart(root, ribGeo, paleStoneMat, [-1.32, 3.5, 0]);
  addPart(root, ribGeo, paleStoneMat, [1.32, 3.5, 0]);
  addPart(root, ribGeo, paleStoneMat, [0, 3.5, -1.32]);

  // Heavy recessed timber guard door at base facing +Z
  addPart(root, new THREE.BoxGeometry(1.18, 1.92, 0.38), paleStoneMat, [0, 0.96, 1.52]);
  addPart(root, new THREE.BoxGeometry(0.84, 1.66, 0.32), timberMat, [0, 0.86, 1.58]);

  // Glowing recessed watch slits on front (+Z), east (+X), and west (-X)
  const addSlit = (pos: Vec3Tuple, rotY: number): void => {
    const slit = new THREE.Group();
    slit.position.set(pos[0], pos[1], pos[2]);
    slit.rotation.y = rotY;
    addPart(slit, new THREE.BoxGeometry(0.46, 1.16, 0.22), darkStoneMat, [0, 0, 0]);
    addPart(slit, new THREE.BoxGeometry(0.22, 0.88, 0.24), glowMat, [0, 0, 0.04], [0, 0, 0], true);
    root.add(slit);
  };
  addSlit([0, 3.9, 1.24], 0);
  addSlit([1.24, 4.45, 0], Math.PI / 2);
  addSlit([-1.24, 4.45, 0], -Math.PI / 2);

  // Cantilevered upper watch-gallery overhang supported by 8 chunky corbels
  addPart(root, new THREE.CylinderGeometry(1.68, 1.2, 0.56, 8), paleStoneMat, [0, 5.84, 0]);
  const corbelGeo = new THREE.BoxGeometry(0.26, 0.56, 0.44);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    addPart(
      root,
      corbelGeo,
      darkStoneMat,
      [Math.sin(angle) * 1.32, 5.56, Math.cos(angle) * 1.32],
      [0.34, angle, 0],
    );
  }

  // Dark inner gallery floor + crenellated parapet ring
  addPart(root, new THREE.CylinderGeometry(1.56, 1.56, 0.22, 8), darkStoneMat, [0, 6.2, 0]);
  const merlonGeo = new THREE.BoxGeometry(0.62, 0.56, 0.32);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    addPart(
      root,
      merlonGeo,
      paleStoneMat,
      [Math.sin(angle) * 1.48, 6.52, Math.cos(angle) * 1.48],
      [0, angle, 0],
    );
  }

  // 4 chunky corner belfry piers supporting the spire around an open beacon chamber
  const pierGeo = new THREE.BoxGeometry(0.36, 1.45, 0.36);
  const pierOffsets: readonly (readonly [number, number])[] = [
    [-0.95, -0.95],
    [0.95, -0.95],
    [-0.95, 0.95],
    [0.95, 0.95],
  ];
  for (const [px, pz] of pierOffsets) {
    addPart(root, pierGeo, paleStoneMat, [px, 6.94, pz]);
  }

  // Central iron signal brazier with bright warm beacon flame (#FF9900)
  addPart(root, new THREE.CylinderGeometry(0.48, 0.26, 0.36, 6), darkStoneMat, [0, 6.46, 0]);
  addPart(root, new THREE.DodecahedronGeometry(0.38, 0), glowMat, [0, 6.84, 0], [0, 0, 0], true);
  addPart(root, new THREE.ConeGeometry(0.3, 0.62, 5), glowMat, [0, 7.18, 0], [0, 0.4, 0], true);

  // Steep dark slate conical turret spire + pale stone finial reaching ~9.35
  addPart(root, new THREE.ConeGeometry(1.88, 1.85, 8), roofMat, [0, 8.42, 0]);
  addPart(root, new THREE.CylinderGeometry(0.14, 0.22, 0.36, 6), paleStoneMat, [0, 9.32, 0]);

  return root;
}

/**
 * fishing_boat
 * Length: ~6.8 (with bowsprit) | Beam: ~2.6 | Mast Height: ~5.25 | Seaworthy intro
 * fishing vessel with deep flared hull, aft wheelhouse cabin, chunky furled sail,
 * forward deck cargo, and warm glowing cabin windows + mast lantern (#FF9900).
 */
export function createFishingBoatModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'fishing_boat';

  const darkHullMat = createFlatMaterial(PALETTE.hullDark);
  const timberDarkMat = createFlatMaterial(PALETTE.timberDark);
  const timberMidMat = createFlatMaterial(PALETTE.timberMid);
  const weatheredWoodMat = createFlatMaterial(PALETTE.weatheredWood);
  const cabinWallMat = createFlatMaterial(PALETTE.paleStone);
  const sailMat = createFlatMaterial(PALETTE.sailCream);
  const roofMat = createFlatMaterial(PALETTE.roofSlate);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Helper for seaworthy pointed-bow / flat-transom hull footprint (bow along +Y -> rotated to +Z)
  const makeHullShape = (scaleX: number, scaleY: number): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(0, 3.35 * scaleY);
    s.lineTo(0.86 * scaleX, 2.25 * scaleY);
    s.lineTo(1.28 * scaleX, 0.65 * scaleY);
    s.lineTo(1.26 * scaleX, -1.45 * scaleY);
    s.lineTo(0.98 * scaleX, -2.85 * scaleY);
    s.lineTo(-0.98 * scaleX, -2.85 * scaleY);
    s.lineTo(-1.26 * scaleX, -1.45 * scaleY);
    s.lineTo(-1.28 * scaleX, 0.65 * scaleY);
    s.lineTo(-0.86 * scaleX, 2.25 * scaleY);
    s.closePath();
    return s;
  };

  // Lower dark waterline hull grounded cleanly at y = 0 (spans y = 0..0.52)
  const lowerHullGeo = new THREE.ExtrudeGeometry(makeHullShape(0.86, 0.92), {
    depth: 0.52,
    bevelEnabled: false,
  });
  addPart(root, lowerHullGeo, darkHullMat, [0, 0.52, 0], [Math.PI / 2, 0, 0]);

  // Flared upper wooden hull (spans y = 0.44..1.08)
  const upperHullGeo = new THREE.ExtrudeGeometry(makeHullShape(1.0, 1.0), {
    depth: 0.64,
    bevelEnabled: false,
  });
  addPart(root, upperHullGeo, timberMidMat, [0, 1.08, 0], [Math.PI / 2, 0, 0]);

  // Hollow pale gunwale bulwark rim framing a recessed dark deck floor
  const rimShape = makeHullShape(1.03, 1.01);
  const innerDeckPath = new THREE.Path();
  innerDeckPath.moveTo(0, 2.82);
  innerDeckPath.lineTo(0.66, 1.9);
  innerDeckPath.lineTo(1.02, 0.55);
  innerDeckPath.lineTo(1.0, -1.35);
  innerDeckPath.lineTo(0.76, -2.52);
  innerDeckPath.lineTo(-0.76, -2.52);
  innerDeckPath.lineTo(-1.0, -1.35);
  innerDeckPath.lineTo(-1.02, 0.55);
  innerDeckPath.lineTo(-0.66, 1.9);
  innerDeckPath.closePath();
  rimShape.holes.push(innerDeckPath);

  const bulwarkGeo = new THREE.ExtrudeGeometry(rimShape, {
    depth: 0.32,
    bevelEnabled: false,
  });
  addPart(root, bulwarkGeo, weatheredWoodMat, [0, 1.36, 0], [Math.PI / 2, 0, 0]);

  // Recessed dark deck planks (y = 1.06..1.14)
  const deckGeo = new THREE.ExtrudeGeometry(makeHullShape(0.82, 0.88), {
    depth: 0.12,
    bevelEnabled: false,
  });
  addPart(root, deckGeo, timberDarkMat, [0, 1.14, 0], [Math.PI / 2, 0, 0]);

  // Heavy angled bowsprit timber jutting off the prow (+Z)
  addPart(root, new THREE.CylinderGeometry(0.085, 0.12, 1.65, 6), timberDarkMat, [0, 1.48, 3.45], [1.32, 0, 0]);

  // Aft wheelhouse / pilot cabin (-Z section)
  const cabinGroup = new THREE.Group();
  cabinGroup.position.set(0, 1.12, -1.35);
  addPart(cabinGroup, new THREE.BoxGeometry(1.56, 1.42, 1.72), cabinWallMat, [0, 0.71, 0]);
  // Overhanging sloped dark slate cabin roof + chunky smokestack
  addPart(cabinGroup, new THREE.BoxGeometry(1.86, 0.22, 2.08), roofMat, [0, 1.5, 0.04], [0.08, 0, 0]);
  addPart(cabinGroup, new THREE.CylinderGeometry(0.14, 0.16, 0.72, 6), darkHullMat, [0.46, 1.88, -0.42]);

  // Warm glowing cabin windows on front (+Z) and sides (±X)
  addPart(cabinGroup, new THREE.BoxGeometry(1.12, 0.46, 0.16), darkHullMat, [0, 0.96, 0.84]);
  addPart(cabinGroup, new THREE.BoxGeometry(0.92, 0.3, 0.18), glowMat, [0, 0.96, 0.86], [0, 0, 0], true);

  const sideWinFrameGeo = new THREE.BoxGeometry(0.16, 0.46, 0.76);
  const sideWinGlassGeo = new THREE.BoxGeometry(0.18, 0.3, 0.56);
  addPart(cabinGroup, sideWinFrameGeo, darkHullMat, [-0.76, 0.96, 0.1]);
  addPart(cabinGroup, sideWinGlassGeo, glowMat, [-0.78, 0.96, 0.1], [0, 0, 0], true);
  addPart(cabinGroup, sideWinFrameGeo, darkHullMat, [0.76, 0.96, 0.1]);
  addPart(cabinGroup, sideWinGlassGeo, glowMat, [0.78, 0.96, 0.1], [0, 0, 0], true);

  root.add(cabinGroup);

  // Heavy central wooden mast stepped forward of the cabin
  const mastZ = 0.72;
  addPart(root, new THREE.CylinderGeometry(0.11, 0.15, 4.18, 7), timberDarkMat, [0, 3.16, mastZ]);

  // Chunky upper yardarm + half-reefed bright cream canvas sail angled for bold silhouette
  const sailGroup = new THREE.Group();
  sailGroup.position.set(0, 3.72, mastZ + 0.14);
  sailGroup.rotation.y = 0.24;
  // Thick timber spar
  addPart(sailGroup, new THREE.CylinderGeometry(0.085, 0.085, 2.48, 6), timberMidMat, [0, 0.46, 0], [0, 0, Math.PI / 2]);
  // Rolled upper sail bundle + billowing reefed canvas slab (>= 0.18 thick)
  addPart(sailGroup, new THREE.CylinderGeometry(0.22, 0.2, 2.24, 7), sailMat, [0, 0.24, 0.14], [0, 0, Math.PI / 2]);
  addPart(sailGroup, new THREE.BoxGeometry(2.08, 0.92, 0.2), sailMat, [0, -0.32, 0.22], [-0.16, 0, 0]);
  root.add(sailGroup);

  // Hanging warm mast lantern facing forward (+Z)
  addPart(root, new THREE.BoxGeometry(0.14, 0.14, 0.56), darkHullMat, [0, 2.94, mastZ + 0.28]);
  const mastLantern = createChunkyLantern(darkHullMat, glowMat, 1.1);
  mastLantern.position.set(0, 2.58, mastZ + 0.5);
  root.add(mastLantern);

  // Forward deck cargo: framed fish crate + heaped dark fishing net mound
  const deckCrate = createFramedCrate(0.64, timberDarkMat, weatheredWoodMat);
  deckCrate.position.set(-0.36, 1.44, 1.72);
  deckCrate.rotation.y = 0.25;
  root.add(deckCrate);

  addPart(root, new THREE.DodecahedronGeometry(0.38, 0), darkHullMat, [0.34, 1.34, 1.92], [0.2, 0.4, 0.1]);
  addPart(root, new THREE.DodecahedronGeometry(0.28, 0), weatheredWoodMat, [0.16, 1.3, 2.28], [0.1, 0.9, 0.3]);

  return root;
}

/**
 * alley_barricade
 * Width: ~3.8 | Depth: ~2.1 | Height: ~1.88 | Overturned wooden handcart with
 * chunky spoked wheels, spilled framed crates, tipped barrel, and braced planks
 * to block and funnel alleyways. No emissives.
 */
export function createAlleyBarricadeModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'alley_barricade';

  const ironMat = createFlatMaterial(PALETTE.charcoal, 0.65, 0.3);
  const darkWoodMat = createFlatMaterial(PALETTE.timberDark);
  const midWoodMat = createFlatMaterial(PALETTE.timberMid);
  const brightWoodMat = createFlatMaterial(PALETTE.weatheredWood);

  // Overturned wooden cart pitched onto its side across the left/center (-X)
  const cartGroup = new THREE.Group();
  cartGroup.position.set(-0.62, 0.94, -0.04);
  cartGroup.rotation.set(0.14, 0.24, 1.15);

  // Solid slatted cart bed
  addPart(cartGroup, new THREE.BoxGeometry(1.24, 0.18, 1.96), midWoodMat, [0, 0, 0]);
  // Raised chunky cart sideboards & tailgate framing the hollow bed
  addPart(cartGroup, new THREE.BoxGeometry(0.14, 0.48, 1.96), brightWoodMat, [-0.56, 0.3, 0]);
  addPart(cartGroup, new THREE.BoxGeometry(0.14, 0.48, 1.96), brightWoodMat, [0.56, 0.3, 0]);
  addPart(cartGroup, new THREE.BoxGeometry(1.24, 0.48, 0.14), brightWoodMat, [0, 0.3, -0.92]);
  addPart(cartGroup, new THREE.BoxGeometry(1.24, 0.34, 0.14), darkWoodMat, [0, 0.22, 0.92]);

  // Heavy axle beam + twin oversized spoked wheels (one grounded, one jutting high)
  addPart(cartGroup, new THREE.CylinderGeometry(0.08, 0.08, 1.72, 6), ironMat, [0, -0.1, 0], [0, 0, Math.PI / 2]);
  const leftWheel = createSpokedWheel(0.6, brightWoodMat, ironMat);
  leftWheel.position.set(-0.78, -0.06, 0);
  leftWheel.rotation.y = Math.PI / 2;
  cartGroup.add(leftWheel);

  const rightWheel = createSpokedWheel(0.6, brightWoodMat, ironMat);
  rightWheel.position.set(0.78, -0.06, 0);
  rightWheel.rotation.y = Math.PI / 2;
  cartGroup.add(rightWheel);

  // Twin chunky wooden draft shafts jutting diagonally out (+Z)
  const shaftGeo = new THREE.BoxGeometry(0.14, 0.14, 1.18);
  addPart(cartGroup, shaftGeo, darkWoodMat, [-0.46, -0.06, 1.48]);
  addPart(cartGroup, shaftGeo, darkWoodMat, [0.46, -0.06, 1.48]);

  root.add(cartGroup);

  // Stacked & wedged framed crates sealing the right flank (+X)
  const baseCrate = createFramedCrate(0.86, darkWoodMat, brightWoodMat);
  baseCrate.position.set(1.02, 0.43, -0.14);
  baseCrate.rotation.y = -0.22;
  root.add(baseCrate);

  const topCrate = createFramedCrate(0.64, darkWoodMat, brightWoodMat);
  topCrate.position.set(1.16, 1.18, -0.24);
  topCrate.rotation.y = 0.42;
  root.add(topCrate);

  const spilledCrate = createFramedCrate(0.58, darkWoodMat, brightWoodMat);
  spilledCrate.position.set(0.18, 0.32, -0.58);
  spilledCrate.rotation.set(0.28, 0.55, -0.18);
  root.add(spilledCrate);

  // Tipped coopered wooden barrel wedged at the front-right (+X, +Z)
  const barrelPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.32, 0.0),
    new THREE.Vector2(0.42, 0.46),
    new THREE.Vector2(0.32, 0.92),
    new THREE.Vector2(0.0, 0.92),
  ];
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0.68, 0.4, 0.62);
  barrelGroup.rotation.set(Math.PI / 2, 0.35, 0.52);
  addPart(barrelGroup, new THREE.LatheGeometry(barrelPoints, 8), midWoodMat, [0, -0.46, 0]);
  addPart(barrelGroup, new THREE.CylinderGeometry(0.39, 0.36, 0.13, 8), ironMat, [0, -0.26, 0]);
  addPart(barrelGroup, new THREE.CylinderGeometry(0.36, 0.39, 0.13, 8), ironMat, [0, 0.26, 0]);
  root.add(barrelGroup);

  // Two chunky braced barricade planks jammed diagonally across the seam
  addPart(root, new THREE.BoxGeometry(1.75, 0.18, 0.14), brightWoodMat, [0.36, 0.78, 0.28], [0.22, -0.18, -0.34]);
  addPart(root, new THREE.BoxGeometry(1.42, 0.16, 0.14), darkWoodMat, [1.46, 0.68, 0.44], [-0.36, 0.25, 0.52]);

  return root;
}

export const LANDMARK_PROP_MODEL_FACTORIES: Record<LandmarkPropAssetId, () => THREE.Group> = {
  castle_gatehouse: createCastleGatehouseModel,
  castle_watchtower: createCastleWatchtowerModel,
  fishing_boat: createFishingBoatModel,
  alley_barricade: createAlleyBarricadeModel,
};