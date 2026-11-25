import * as THREE from 'three';

export type BuildingAssetId =
  | 'cottage_fisher'
  | 'cottage_boathouse'
  | 'village_dock'
  | 'stone_bridge'
  | 'fence_stone_wall';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x1b2026,
  deepSlate: 0x2a313b,
  midStone: 0x4b5563,
  timberDark: 0x3f2e21,
  timberMid: 0x6b4f35,
  weatheredWood: 0x997a54,
  palePlaster: 0xdbe0e6,
  stoneHighlight: 0xc2cad2,
  roofSlate: 0x2b3542,
  warmGlow: 0xffaa22,
} as const;

type Vec3Tuple = readonly [number, number, number];

function createFlatMaterial(color: number, roughness = 0.88): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.05,
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

function addRecessedWindow(
  parent: THREE.Object3D,
  frameMat: THREE.Material,
  glowMat: THREE.Material,
  position: Vec3Tuple,
  rotationY: number,
  width = 0.84,
  height = 0.96,
): void {
  const winGroup = new THREE.Group();
  winGroup.position.set(position[0], position[1], position[2]);
  winGroup.rotation.y = rotationY;

  const border = 0.14;
  // Chunky outer frame creating a real recess around the glowing glass
  addPart(winGroup, new THREE.BoxGeometry(width + border * 2, border, 0.24), frameMat, [0, height / 2 + border / 2, 0.06]);
  addPart(winGroup, new THREE.BoxGeometry(width + border * 2 + 0.1, border + 0.04, 0.3), frameMat, [0, -height / 2 - border / 2, 0.08]);
  addPart(winGroup, new THREE.BoxGeometry(border, height, 0.22), frameMat, [-width / 2 - border / 2, 0, 0.05]);
  addPart(winGroup, new THREE.BoxGeometry(border, height, 0.22), frameMat, [width / 2 + border / 2, 0, 0.05]);

  // Recessed glowing window pane (#FF9900)
  addPart(winGroup, new THREE.BoxGeometry(width, height, 0.12), glowMat, [0, 0, -0.02], [0, 0, 0], true);

  parent.add(winGroup);
}

/**
 * cottage_fisher
 * Width: ~5.2 (body 4.4) | Height: ~5.3 | Steep shingled roof, stone chimney,
 * porch overhang facing +Z, and recessed warm glowing windows (#FF9900).
 */
export function createCottageFisherModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'cottage_fisher';

  const stoneDarkMat = createFlatMaterial(PALETTE.charcoal);
  const stoneMidMat = createFlatMaterial(PALETTE.midStone);
  const plasterMat = createFlatMaterial(PALETTE.palePlaster);
  const timberMat = createFlatMaterial(PALETTE.timberDark);
  const roofMat = createFlatMaterial(PALETTE.roofSlate);
  const roofTrimMat = createFlatMaterial(PALETTE.stoneHighlight);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Heavy stone foundation plinth grounded at y = 0
  addPart(root, new THREE.BoxGeometry(4.6, 0.44, 3.8), stoneMidMat, [0, 0.22, -0.1]);

  // High-contrast pale plaster main walls
  addPart(root, new THREE.BoxGeometry(4.3, 2.2, 3.5), plasterMat, [0, 1.54, -0.1]);

  // Chunky timber corner beams
  const beamGeo = new THREE.BoxGeometry(0.24, 2.24, 0.24);
  addPart(root, beamGeo, timberMat, [-2.12, 1.54, 1.62]);
  addPart(root, beamGeo, timberMat, [2.12, 1.54, 1.62]);
  addPart(root, beamGeo, timberMat, [-2.12, 1.54, -1.82]);
  addPart(root, beamGeo, timberMat, [2.12, 1.54, -1.82]);

  // Steep pitched gable infill triangles (plaster)
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-2.15, 0);
  gableShape.lineTo(2.15, 0);
  gableShape.lineTo(0, 2.55);
  gableShape.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 3.46, bevelEnabled: false });
  addPart(root, gableGeo, plasterMat, [0, 2.64, -1.83]);

  // Exaggerated steep shingled roof with stepped tiers for crisp ASCII silhouette
  const roofLength = 4.2;
  const slopeAngle = 0.84;
  // Left & right main roof planes
  addPart(root, new THREE.BoxGeometry(3.45, 0.24, roofLength), roofMat, [-1.3, 3.84, -0.1], [0, 0, slopeAngle]);
  addPart(root, new THREE.BoxGeometry(3.45, 0.24, roofLength), roofMat, [1.3, 3.84, -0.1], [0, 0, -slopeAngle]);
  // Stepped shingle ridges along slopes
  addPart(root, new THREE.BoxGeometry(1.4, 0.16, roofLength + 0.08), stoneDarkMat, [-1.82, 3.24, -0.1], [0, 0, slopeAngle]);
  addPart(root, new THREE.BoxGeometry(1.4, 0.16, roofLength + 0.08), stoneDarkMat, [1.82, 3.24, -0.1], [0, 0, -slopeAngle]);
  // Bright ridge beam cap along the peak
  addPart(root, new THREE.BoxGeometry(0.36, 0.36, roofLength + 0.2), roofTrimMat, [0, 5.26, -0.1]);

  // Tall stone chimney protruding through left-rear roof slope
  addPart(root, new THREE.BoxGeometry(0.76, 2.7, 0.76), stoneMidMat, [-1.25, 4.35, -1.1]);
  addPart(root, new THREE.BoxGeometry(0.96, 0.22, 0.96), roofTrimMat, [-1.25, 5.64, -1.1]);
  addPart(root, new THREE.BoxGeometry(0.56, 0.24, 0.56), stoneDarkMat, [-1.25, 5.82, -1.1]);

  // Porch overhang facing +Z
  addPart(root, new THREE.BoxGeometry(2.6, 0.28, 1.35), stoneMidMat, [-0.55, 0.14, 2.35]);
  // Porch support posts
  const postGeo = new THREE.BoxGeometry(0.22, 2.1, 0.22);
  addPart(root, postGeo, timberMat, [-1.68, 1.32, 2.86]);
  addPart(root, postGeo, timberMat, [0.58, 1.32, 2.86]);
  // Sloped porch awning roof
  addPart(root, new THREE.BoxGeometry(2.85, 0.22, 1.68), roofMat, [-0.55, 2.52, 2.34], [0.34, 0, 0]);

  // Recessed front timber door under the porch
  addPart(root, new THREE.BoxGeometry(1.18, 1.88, 0.2), stoneDarkMat, [-0.55, 1.32, 1.66]);
  addPart(root, new THREE.BoxGeometry(0.92, 1.72, 0.16), timberMat, [-0.55, 1.28, 1.64]);

  // Warm recessed glowing windows (#FF9900)
  addRecessedWindow(root, timberMat, glowMat, [1.22, 1.56, 1.66], 0, 0.86, 0.98);
  addRecessedWindow(root, timberMat, glowMat, [0, 3.68, 1.66], 0, 0.64, 0.72);
  addRecessedWindow(root, timberMat, glowMat, [-2.16, 1.56, -0.1], -Math.PI / 2, 0.96, 0.92);
  addRecessedWindow(root, timberMat, glowMat, [2.16, 1.56, -0.1], Math.PI / 2, 0.96, 0.92);

  return root;
}

/**
 * cottage_boathouse
 * Width: ~4.8 | Length: ~5.8 | Height: ~3.7 | Longer, lower timber shed with
 * wide recessed boat-door opening facing +Z and a hanging doorway lantern.
 */
export function createCottageBoathouseModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'cottage_boathouse';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const timberDarkMat = createFlatMaterial(PALETTE.timberDark);
  const timberMidMat = createFlatMaterial(PALETTE.timberMid);
  const weatheredMat = createFlatMaterial(PALETTE.weatheredWood);
  const roofMat = createFlatMaterial(PALETTE.roofSlate);
  const trimMat = createFlatMaterial(PALETTE.stoneHighlight);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Heavy foundation pilings/skids at y = 0
  const skidGeo = new THREE.BoxGeometry(0.42, 0.36, 5.6);
  addPart(root, skidGeo, darkMat, [-2.05, 0.18, 0]);
  addPart(root, skidGeo, darkMat, [2.05, 0.18, 0]);
  addPart(root, new THREE.BoxGeometry(4.5, 0.32, 0.44), darkMat, [0, 0.16, -2.6]);

  // Low timber side walls & solid back wall
  addPart(root, new THREE.BoxGeometry(0.32, 2.05, 5.4), timberMidMat, [-2.06, 1.38, 0]);
  addPart(root, new THREE.BoxGeometry(0.32, 2.05, 5.4), timberMidMat, [2.06, 1.38, 0]);
  addPart(root, new THREE.BoxGeometry(4.4, 2.05, 0.34), timberMidMat, [0, 1.38, -2.62]);

  // Exterior vertical timber ribs along sides for ASCII horizontal rhythm
  const ribGeo = new THREE.BoxGeometry(0.18, 2.08, 0.22);
  const ribZPositions = [-1.6, 0, 1.6];
  for (const rz of ribZPositions) {
    addPart(root, ribGeo, weatheredMat, [-2.22, 1.38, rz]);
    addPart(root, ribGeo, weatheredMat, [2.22, 1.38, rz]);
  }

  // Front wall (+Z) framing a wide boat-door opening (2.6 wide x 2.05 tall)
  addPart(root, new THREE.BoxGeometry(0.9, 2.08, 0.36), timberDarkMat, [-1.77, 1.38, 2.58]);
  addPart(root, new THREE.BoxGeometry(0.9, 2.08, 0.36), timberDarkMat, [1.77, 1.38, 2.58]);
  addPart(root, new THREE.BoxGeometry(4.44, 0.42, 0.4), weatheredMat, [0, 2.26, 2.58]);

  // Deep charcoal interior recess so the wide boat-door reads as a crisp dark opening
  addPart(root, new THREE.BoxGeometry(3.6, 2.0, 4.6), darkMat, [0, 1.15, -0.15]);

  // Chunky double boat-doors swung wide open outward at +Z
  const doorGeo = new THREE.BoxGeometry(1.18, 1.96, 0.18);
  addPart(root, doorGeo, weatheredMat, [-1.78, 1.12, 3.06], [0, 0.72, 0]);
  addPart(root, doorGeo, weatheredMat, [1.78, 1.12, 3.06], [0, -0.72, 0]);

  // Low-pitched gable ends
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-2.22, 0);
  gableShape.lineTo(2.22, 0);
  gableShape.lineTo(0, 1.25);
  gableShape.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 5.44, bevelEnabled: false });
  addPart(root, gableGeo, timberMidMat, [0, 2.4, -2.72]);

  // Lower, longer pitched roof overhanging the boat-door
  const roofSlope = 0.5;
  addPart(root, new THREE.BoxGeometry(2.9, 0.24, 6.2), roofMat, [-1.25, 3.02, 0.1], [0, 0, roofSlope]);
  addPart(root, new THREE.BoxGeometry(2.9, 0.24, 6.2), roofMat, [1.25, 3.02, 0.1], [0, 0, -roofSlope]);

  // Protruding ridge beam extending forward over the doorway to hold the hanging lantern
  addPart(root, new THREE.BoxGeometry(0.28, 0.28, 6.9), trimMat, [0, 3.68, 0.35]);

  // Hanging doorway lantern suspended from the protruding ridge beam (+Z)
  addPart(root, new THREE.CylinderGeometry(0.065, 0.065, 0.46, 6), darkMat, [0, 3.36, 3.52]);
  const doorwayLantern = createChunkyLantern(darkMat, glowMat, 1.15);
  doorwayLantern.position.set(0, 2.94, 3.52);
  root.add(doorwayLantern);

  return root;
}

/**
 * village_dock
 * Width: ~4.4 (walkway + moored boat) | Length: ~5.6 | Plank walkway on pilings,
 * moored wooden rowboat on +X side, and optional corner post lantern.
 */
export function createVillageDockModel(includeLantern = true): THREE.Group {
  const root = new THREE.Group();
  root.name = 'village_dock';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const pilingMat = createFlatMaterial(PALETTE.timberDark);
  const plankMat = createFlatMaterial(PALETTE.weatheredWood);
  const boatHullMat = createFlatMaterial(PALETTE.timberMid);
  const boatTrimMat = createFlatMaterial(PALETTE.stoneHighlight);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Dock walkway centered slightly left (-X) so dock + moored rowboat sit balanced around origin
  const dockOffsetX = -0.8;

  // Heavy pilings grounded at y = 0, rising above deck as mooring bollards
  const pilingGeo = new THREE.CylinderGeometry(0.16, 0.18, 1.48, 7);
  const pilingZ = [-2.2, -0.75, 0.75, 2.2];
  for (const pz of pilingZ) {
    addPart(root, pilingGeo, pilingMat, [dockOffsetX - 1.02, 0.74, pz]);
    // Skip standard height on front-right corner if placing the tall lantern post
    if (!(includeLantern && pz === 2.2)) {
      addPart(root, pilingGeo, pilingMat, [dockOffsetX + 1.02, 0.74, pz]);
    }
  }

  // Longitudinal stringer beams under the planks
  const stringerGeo = new THREE.BoxGeometry(0.24, 0.24, 5.2);
  addPart(root, stringerGeo, pilingMat, [dockOffsetX - 0.85, 0.84, 0]);
  addPart(root, stringerGeo, pilingMat, [dockOffsetX + 0.85, 0.84, 0]);

  // Spaced chunky deck planks (clear gaps read cleanly from top-down ASCII)
  const plankGeo = new THREE.BoxGeometry(2.26, 0.14, 0.44);
  for (let i = 0; i < 10; i += 1) {
    const pz = -2.42 + i * 0.54;
    addPart(root, plankGeo, plankMat, [dockOffsetX, 1.02, pz]);
  }

  // Optional corner post lantern on front-right dock piling (+X, +Z)
  if (includeLantern) {
    const postX = dockOffsetX + 1.02;
    const postZ = 2.2;
    addPart(root, new THREE.CylinderGeometry(0.16, 0.18, 2.7, 7), pilingMat, [postX, 1.35, postZ]);
    addPart(root, new THREE.BoxGeometry(0.16, 0.16, 0.64), darkMat, [postX, 2.58, postZ + 0.26]);
    const lantern = createChunkyLantern(darkMat, glowMat, 1.05);
    lantern.position.set(postX, 2.22, postZ + 0.48);
    root.add(lantern);
  }

  // Moored wooden rowboat resting on water plane (y = 0) along +X side of dock
  const boatGroup = new THREE.Group();
  boatGroup.position.set(1.36, 0.08, 0.35);
  boatGroup.rotation.y = 0.12;

  // Extruded pointed hull silhouette (top-down XZ shape extruded vertically along Y)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, 1.45);
  hullShape.lineTo(0.62, 0.65);
  hullShape.lineTo(0.56, -0.85);
  hullShape.lineTo(0.32, -1.25);
  hullShape.lineTo(-0.32, -1.25);
  hullShape.lineTo(-0.56, -0.85);
  hullShape.lineTo(-0.62, 0.65);
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.46, bevelEnabled: false });
  addPart(boatGroup, hullGeo, boatHullMat, [0, 0.46, 0], [Math.PI / 2, 0, 0]);

  // Recessed dark interior floor + bright gunwale rim contrast
  const innerShape = new THREE.Shape();
  innerShape.moveTo(0, 1.12);
  innerShape.lineTo(0.42, 0.52);
  innerShape.lineTo(0.38, -0.78);
  innerShape.lineTo(0.22, -1.04);
  innerShape.lineTo(-0.22, -1.04);
  innerShape.lineTo(-0.38, -0.78);
  innerShape.lineTo(-0.42, 0.52);
  innerShape.closePath();

  const innerGeo = new THREE.ExtrudeGeometry(innerShape, { depth: 0.14, bevelEnabled: false });
  addPart(boatGroup, innerGeo, darkMat, [0, 0.52, 0], [Math.PI / 2, 0, 0]);

  // Two chunky rowing benches (thwarts)
  const thwartGeo = new THREE.BoxGeometry(1.04, 0.14, 0.28);
  addPart(boatGroup, thwartGeo, boatTrimMat, [0, 0.48, 0.24]);
  addPart(boatGroup, thwartGeo, boatTrimMat, [0, 0.48, -0.46]);

  // Thick mooring line beam tying bow to dock piling
  addPart(root, new THREE.CylinderGeometry(0.065, 0.065, 1.15, 6), boatTrimMat, [0.76, 0.9, 1.12], [0.45, 0, 1.18]);

  root.add(boatGroup);

  return root;
}

/**
 * stone_bridge
 * Width: ~3.2 | Length: ~5.6 | Low arched stone footbridge spanning Z,
 * with 4 corner stone pillars topped with warm lanterns (#FF9900).
 */
export function createStoneBridgeModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'stone_bridge';

  const darkStoneMat = createFlatMaterial(PALETTE.charcoal);
  const midStoneMat = createFlatMaterial(PALETTE.midStone);
  const paleStoneMat = createFlatMaterial(PALETTE.stoneHighlight);
  const glowMat = createEmissiveMaterial(PALETTE.warmGlow, PALETTE.warmGlow);

  // Low arched bridge body profile in XY, rotated to span Z and extruded across X width
  const archShape = new THREE.Shape();
  archShape.moveTo(-2.7, 0);
  archShape.lineTo(-1.45, 0);
  // Underside arch curve
  archShape.quadraticCurveTo(0, 1.25, 1.45, 0);
  archShape.lineTo(2.7, 0);
  // Top deck gentle arch
  archShape.lineTo(2.7, 0.26);
  archShape.quadraticCurveTo(0, 1.52, -2.7, 0.26);
  archShape.closePath();

  const archGeo = new THREE.ExtrudeGeometry(archShape, { depth: 2.5, bevelEnabled: false });
  // Extrude runs along +Z; rotate Y by Math.PI/2 so arch spans Z and width spans X (-1.25..+1.25)
  addPart(root, archGeo, midStoneMat, [-1.25, 0, 0], [0, Math.PI / 2, 0]);

  // Bright cobblestone crown slabs along deck center for top-down contrast
  addPart(root, new THREE.BoxGeometry(2.1, 0.14, 1.6), paleStoneMat, [0, 0.9, 0]);
  addPart(root, new THREE.BoxGeometry(2.1, 0.14, 1.55), paleStoneMat, [0, 0.62, 1.52], [0.34, 0, 0]);
  addPart(root, new THREE.BoxGeometry(2.1, 0.14, 1.55), paleStoneMat, [0, 0.62, -1.52], [-0.34, 0, 0]);

  // Low stone parapet walls along -X and +X edges following the arch
  const sideOffsets = [-1.28, 1.28];
  for (const sx of sideOffsets) {
    addPart(root, new THREE.BoxGeometry(0.32, 0.62, 1.65), paleStoneMat, [sx, 1.22, 0]);
    addPart(root, new THREE.BoxGeometry(0.32, 0.58, 1.55), paleStoneMat, [sx, 0.94, 1.48], [0.34, 0, 0]);
    addPart(root, new THREE.BoxGeometry(0.32, 0.58, 1.55), paleStoneMat, [sx, 0.94, -1.48], [-0.34, 0, 0]);
  }

  // 4 chunky corner stone pillars with warm post lanterns
  const pillarCoords: readonly (readonly [number, number])[] = [
    [-1.34, -2.45],
    [1.34, -2.45],
    [-1.34, 2.45],
    [1.34, 2.45],
  ];

  const pillarBaseGeo = new THREE.BoxGeometry(0.64, 0.36, 0.64);
  const pillarShaftGeo = new THREE.BoxGeometry(0.5, 1.24, 0.5);
  const pillarCapGeo = new THREE.BoxGeometry(0.64, 0.18, 0.64);

  for (const [px, pz] of pillarCoords) {
    addPart(root, pillarBaseGeo, darkStoneMat, [px, 0.18, pz]);
    addPart(root, pillarShaftGeo, paleStoneMat, [px, 0.96, pz]);
    addPart(root, pillarCapGeo, darkStoneMat, [px, 1.64, pz]);

    // Warm lantern seated directly on each bridge post
    const postLantern = createChunkyLantern(darkStoneMat, glowMat, 1.0);
    postLantern.position.set(px, 1.96, pz);
    root.add(postLantern);
  }

  return root;
}

/**
 * fence_stone_wall
 * Width: ~3.6 | Height: ~1.28 | Modular low dry-stone wall topped with a
 * chunky two-rail wooden fence segment. No emissives.
 */
export function createFenceStoneWallModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'fence_stone_wall';

  const darkStoneMat = createFlatMaterial(PALETTE.charcoal);
  const midStoneMat = createFlatMaterial(PALETTE.midStone);
  const paleStoneMat = createFlatMaterial(PALETTE.stoneHighlight);
  const timberDarkMat = createFlatMaterial(PALETTE.timberDark);
  const timberPaleMat = createFlatMaterial(PALETTE.weatheredWood);

  // Solid base masonry core grounded at y = 0 (tiles cleanly along X)
  addPart(root, new THREE.BoxGeometry(3.4, 0.56, 0.52), midStoneMat, [0, 0.28, 0]);

  // Offset chunky fieldstone blocks along front & back for rugged ASCII silhouette
  addPart(root, new THREE.BoxGeometry(0.92, 0.32, 0.58), paleStoneMat, [-1.06, 0.18, 0.02]);
  addPart(root, new THREE.BoxGeometry(0.84, 0.34, 0.58), darkStoneMat, [0.02, 0.2, -0.02]);
  addPart(root, new THREE.BoxGeometry(0.92, 0.32, 0.58), paleStoneMat, [1.06, 0.18, 0.02]);

  // Stepped stone coping slabs crowning the low wall
  addPart(root, new THREE.BoxGeometry(1.12, 0.16, 0.6), paleStoneMat, [-1.08, 0.62, 0]);
  addPart(root, new THREE.BoxGeometry(1.06, 0.16, 0.6), paleStoneMat, [0, 0.64, 0]);
  addPart(root, new THREE.BoxGeometry(1.12, 0.16, 0.6), paleStoneMat, [1.08, 0.62, 0]);

  // Three chunky vertical timber fence posts embedded in the wall
  const endPostGeo = new THREE.BoxGeometry(0.24, 1.24, 0.24);
  const midPostGeo = new THREE.BoxGeometry(0.2, 1.18, 0.2);
  addPart(root, endPostGeo, timberDarkMat, [-1.66, 0.62, 0]);
  addPart(root, midPostGeo, timberDarkMat, [0, 0.59, 0]);
  addPart(root, endPostGeo, timberDarkMat, [1.66, 0.62, 0]);

  // Two thick horizontal wooden rails spanning the modular segment
  const railGeo = new THREE.BoxGeometry(3.56, 0.14, 0.14);
  addPart(root, railGeo, timberPaleMat, [0, 1.12, 0]);
  addPart(root, railGeo, timberPaleMat, [0, 0.84, 0]);

  return root;
}

export const BUILDING_MODEL_FACTORIES: Record<BuildingAssetId, () => THREE.Group> = {
  cottage_fisher: createCottageFisherModel,
  cottage_boathouse: createCottageBoathouseModel,
  village_dock: createVillageDockModel,
  stone_bridge: createStoneBridgeModel,
  fence_stone_wall: createFenceStoneWallModel,
};