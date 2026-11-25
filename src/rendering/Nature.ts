import * as THREE from 'three';

export type NaturePropAssetId =
  | 'tree_pine'
  | 'tree_oak'
  | 'tree_wilted'
  | 'rock_river_boulder'
  | 'rock_shoreline_ledge'
  | 'rock_stepping_stones'
  | 'prop_drying_fish_rack'
  | 'prop_barrels_crates'
  | 'prop_campfire_ring'
  | 'prop_corrupted_reeds';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x181c22,
  deepSlate: 0x262e38,
  wetSlateTop: 0x3b4757,
  midStone: 0x525d6b,
  paleStone: 0xc8d0d8,
  barkDark: 0x3d2418,
  barkMid: 0x5a3a24,
  weatheredWood: 0x9b7c56,
  pineShadow: 0x1f2820,
  pineHighlight: 0x5f6b45,
  oakShadow: 0x272d20,
  oakHighlight: 0x6d7a4a,
  deadwoodPale: 0xc9d0d6,
  silverFish: 0xe6ecf2,
  emberOrange: 0xff6600,
  toxicGreen: 0x44ff66,
  blightViolet: 0xaa44ff,
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

function createWetSlateMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: PALETTE.wetSlateTop,
    roughness: 0.18,
    metalness: 0.35,
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

// ============================================================================
// TREES (Target height: ~4.0–6.0 units)
// ============================================================================

/**
 * tree_pine
 * Height: ~5.65 | Bold 4-tier conical evergreen silhouette with flared trunk base.
 */
export function createTreePineModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'tree_pine';

  const trunkMat = createFlatMaterial(PALETTE.barkDark);
  const shadowFoliageMat = createFlatMaterial(PALETTE.pineShadow);
  const brightFoliageMat = createFlatMaterial(PALETTE.pineHighlight);

  // Flared trunk grounded at y = 0
  addPart(root, new THREE.CylinderGeometry(0.26, 0.42, 1.55, 7), trunkMat, [0, 0.775, 0]);
  // Chunky root buttresses
  const rootGeo = new THREE.ConeGeometry(0.2, 0.56, 5);
  addPart(root, rootGeo, trunkMat, [0.34, 0.16, 0.18], [0.4, 0, -1.1]);
  addPart(root, rootGeo, trunkMat, [-0.32, 0.16, 0.2], [0.4, 0, 1.1]);
  addPart(root, rootGeo, trunkMat, [0, 0.16, -0.36], [-1.1, 0, 0]);

  // 4 stacked bold tiers alternating shadow underside & bright upper foliage
  addPart(root, new THREE.ConeGeometry(1.78, 1.55, 7), shadowFoliageMat, [0, 1.92, 0]);
  addPart(root, new THREE.ConeGeometry(1.46, 1.48, 7), brightFoliageMat, [0, 2.86, 0], [0, 0.45, 0]);
  addPart(root, new THREE.ConeGeometry(1.12, 1.42, 7), shadowFoliageMat, [0, 3.78, 0], [0, 0.9, 0]);
  addPart(root, new THREE.ConeGeometry(0.76, 1.45, 6), brightFoliageMat, [0, 4.92, 0], [0, 0.25, 0]);

  return root;
}

/**
 * tree_oak
 * Height: ~4.85 | Wide spreading faceted canopy over a stout, gnarled trunk.
 */
export function createTreeOakModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'tree_oak';

  const trunkMat = createFlatMaterial(PALETTE.barkDark);
  const boughMat = createFlatMaterial(PALETTE.barkMid);
  const shadowLeafMat = createFlatMaterial(PALETTE.oakShadow);
  const brightLeafMat = createFlatMaterial(PALETTE.oakHighlight);

  // Stout flared trunk grounded at y = 0 (LatheGeometry)
  const trunkPoints = [
    new THREE.Vector2(0.72, 0.0),
    new THREE.Vector2(0.5, 0.45),
    new THREE.Vector2(0.42, 1.3),
    new THREE.Vector2(0.52, 2.15),
    new THREE.Vector2(0.36, 2.55),
  ];
  addPart(root, new THREE.LatheGeometry(trunkPoints, 7), trunkMat);

  // Thick spreading primary boughs
  addPart(root, new THREE.CylinderGeometry(0.18, 0.26, 1.45, 6), boughMat, [-0.68, 2.5, 0.12], [0.12, 0, 0.68]);
  addPart(root, new THREE.CylinderGeometry(0.18, 0.24, 1.4, 6), boughMat, [0.7, 2.46, -0.1], [-0.14, 0, -0.66]);
  addPart(root, new THREE.CylinderGeometry(0.16, 0.22, 1.25, 6), boughMat, [0.06, 2.52, 0.62], [0.68, 0, -0.08]);

  // Lower shadow canopy clusters (dark base for high ASCII contrast)
  addPart(root, new THREE.DodecahedronGeometry(1.18, 0), shadowLeafMat, [-1.18, 3.04, 0.16]);
  addPart(root, new THREE.DodecahedronGeometry(1.14, 0), shadowLeafMat, [1.18, 2.98, -0.14]);
  addPart(root, new THREE.DodecahedronGeometry(1.06, 0), shadowLeafMat, [0.04, 2.96, 1.06]);
  addPart(root, new THREE.DodecahedronGeometry(1.08, 0), shadowLeafMat, [-0.12, 3.0, -1.04]);

  // Wide bright upper crown domes
  addPart(root, new THREE.DodecahedronGeometry(1.36, 0), brightLeafMat, [0, 3.68, 0]);
  addPart(root, new THREE.DodecahedronGeometry(0.98, 0), brightLeafMat, [-1.02, 3.52, -0.34]);
  addPart(root, new THREE.DodecahedronGeometry(0.96, 0), brightLeafMat, [0.98, 3.48, 0.38]);
  addPart(root, new THREE.DodecahedronGeometry(0.84, 0), brightLeafMat, [0.08, 4.18, -0.12]);

  return root;
}

/**
 * tree_wilted
 * Height: ~4.70 | Gnarled bare blighted deadwood tree with thick crooked limbs
 * and faint glowing toxic root veins climbing the base.
 */
export function createTreeWiltedModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'tree_wilted';

  const darkBarkMat = createFlatMaterial(PALETTE.charcoal);
  const deadwoodMat = createFlatMaterial(PALETTE.deadwoodPale);
  const veinGlowMat = createEmissiveMaterial(PALETTE.toxicGreen, PALETTE.toxicGreen);

  // Twisted lower trunk leaning off-axis
  addPart(root, new THREE.CylinderGeometry(0.32, 0.56, 1.7, 7), darkBarkMat, [0, 0.85, 0], [0.06, 0, 0.1]);
  // Crooked mid-trunk kinking back
  addPart(root, new THREE.CylinderGeometry(0.24, 0.34, 1.55, 7), darkBarkMat, [-0.14, 2.25, 0.08], [-0.12, 0, -0.22]);

  // Splayed dead roots grounded at y = 0 + glowing toxic root veins
  const rootAngles = [0.2, 1.75, 3.3, 4.9];
  for (let i = 0; i < rootAngles.length; i += 1) {
    const angle = rootAngles[i];
    const rx = Math.sin(angle) * 0.68;
    const rz = Math.cos(angle) * 0.68;
    const rootMesh = addPart(root, new THREE.ConeGeometry(0.2, 1.05, 5), darkBarkMat, [rx, 0.22, rz]);
    rootMesh.lookAt(rx * 2.4, 0.02, rz * 2.4);
    rootMesh.rotateX(Math.PI / 2);

    // Thick glowing blight vein riding the upper surface of the root (>= 0.13 thick)
    const veinMesh = addPart(
      root,
      new THREE.BoxGeometry(0.13, 0.13, 0.72),
      veinGlowMat,
      [rx * 0.78, 0.32, rz * 0.78],
      [0, 0, 0],
      true,
    );
    veinMesh.lookAt(rx * 2.0, 0.08, rz * 2.0);
  }

  // Vertical glowing blight fissure climbing the lower trunk
  addPart(root, new THREE.BoxGeometry(0.14, 1.12, 0.16), veinGlowMat, [-0.06, 0.92, 0.34], [0.06, 0, 0.18], true);

  // Bare gnarled pale deadwood branches (every tip & fork >= 0.14 thick)
  // Major left claw-branch
  addPart(root, new THREE.CylinderGeometry(0.15, 0.24, 1.55, 6), deadwoodMat, [-0.64, 3.32, 0.14], [0.16, 0, 0.64]);
  addPart(root, new THREE.ConeGeometry(0.15, 0.95, 5), deadwoodMat, [-1.32, 4.02, 0.26], [0.22, 0, 0.34]);
  addPart(root, new THREE.ConeGeometry(0.12, 0.76, 5), darkBarkMat, [-0.84, 4.04, 0.04], [-0.14, 0, -0.22]);

  // Major right crooked spire reaching ~4.70
  addPart(root, new THREE.CylinderGeometry(0.14, 0.22, 1.65, 6), deadwoodMat, [0.46, 3.44, -0.06], [-0.16, 0, -0.44]);
  addPart(root, new THREE.ConeGeometry(0.14, 1.05, 5), deadwoodMat, [0.92, 4.32, -0.18], [-0.26, 0, -0.18]);

  // Forward-reaching jagged limb (+Z)
  addPart(root, new THREE.CylinderGeometry(0.13, 0.2, 1.25, 6), darkBarkMat, [0.06, 3.12, 0.56], [0.76, 0, -0.12]);
  addPart(root, new THREE.ConeGeometry(0.13, 0.78, 5), deadwoodMat, [0.16, 3.62, 1.18], [0.42, 0, -0.08]);

  return root;
}

// ============================================================================
// ROCK BOULDER PACK (Wet dark-slate specular top)
// ============================================================================

/**
 * rock_river_boulder
 * Width: ~2.4 | Height: ~1.58 | Angular faceted river boulder cluster with
 * wet dark-slate specular cap slabs.
 */
export function createRockRiverBoulderModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'rock_river_boulder';

  const baseStoneMat = createFlatMaterial(PALETTE.charcoal, 0.9, 0.05);
  const midStoneMat = createFlatMaterial(PALETTE.midStone, 0.85, 0.08);
  const wetTopMat = createWetSlateMaterial();

  // Primary angular boulder core grounded at y = 0
  addPart(root, new THREE.DodecahedronGeometry(0.92, 0), baseStoneMat, [-0.12, 0.64, 0], [0.18, 0.4, 0.1]);
  // Wet dark-slate specular top slab crowning the main rock
  addPart(root, new THREE.CylinderGeometry(0.68, 0.88, 0.44, 6), wetTopMat, [-0.12, 1.28, 0.02], [0.12, 0.3, -0.08]);

  // Secondary flanking angular boulder (+X, +Z)
  addPart(root, new THREE.DodecahedronGeometry(0.64, 0), midStoneMat, [0.74, 0.42, 0.36], [0.3, 0.8, 0.2]);
  addPart(root, new THREE.CylinderGeometry(0.46, 0.6, 0.3, 6), wetTopMat, [0.74, 0.86, 0.36], [-0.1, 0.5, 0.12]);

  // Low river rock wedge (-X, +Z)
  addPart(root, new THREE.DodecahedronGeometry(0.46, 0), baseStoneMat, [-0.88, 0.28, 0.48], [0.2, 0.1, 0.4]);

  return root;
}

/**
 * rock_shoreline_ledge
 * Width: ~3.4 | Height: ~1.12 | Stepped angular shoreline rock shelf with
 * flat wet dark-slate specular upper ledges.
 */
export function createRockShorelineLedgeModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'rock_shoreline_ledge';

  const darkRockMat = createFlatMaterial(PALETTE.charcoal, 0.9, 0.05);
  const midRockMat = createFlatMaterial(PALETTE.midStone, 0.85, 0.08);
  const wetTopMat = createWetSlateMaterial();

  // Rear high angular cliff slab (ExtrudeGeometry)
  const upperShape = new THREE.Shape();
  upperShape.moveTo(-1.55, -0.75);
  upperShape.lineTo(1.45, -0.82);
  upperShape.lineTo(1.62, 0.18);
  upperShape.lineTo(0.42, 0.48);
  upperShape.lineTo(-1.28, 0.34);
  upperShape.closePath();

  const upperBaseGeo = new THREE.ExtrudeGeometry(upperShape, { depth: 0.78, bevelEnabled: false });
  addPart(root, upperBaseGeo, darkRockMat, [0, 0.78, -0.25], [Math.PI / 2, 0, 0]);

  const upperTopGeo = new THREE.ExtrudeGeometry(upperShape, { depth: 0.28, bevelEnabled: false });
  addPart(root, upperTopGeo, wetTopMat, [0, 1.06, -0.25], [Math.PI / 2, 0, 0]);

  // Forward lower stepped shelf (+Z)
  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-1.32, -0.2);
  lowerShape.lineTo(1.18, -0.15);
  lowerShape.lineTo(1.38, 0.76);
  lowerShape.lineTo(-0.35, 0.96);
  lowerShape.lineTo(-1.46, 0.62);
  lowerShape.closePath();

  const lowerBaseGeo = new THREE.ExtrudeGeometry(lowerShape, { depth: 0.44, bevelEnabled: false });
  addPart(root, lowerBaseGeo, midRockMat, [0.1, 0.44, 0.25], [Math.PI / 2, 0, 0]);

  const lowerTopGeo = new THREE.ExtrudeGeometry(lowerShape, { depth: 0.2, bevelEnabled: false });
  addPart(root, lowerTopGeo, wetTopMat, [0.1, 0.64, 0.25], [Math.PI / 2, 0, 0]);

  return root;
}

/**
 * rock_stepping_stones
 * Length: ~3.8 along Z | 4 staggered angular river stepping stones with
 * wet dark-slate specular top faces.
 */
export function createRockSteppingStonesModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'rock_stepping_stones';

  const baseStoneMat = createFlatMaterial(PALETTE.deepSlate, 0.9, 0.05);
  const wetTopMat = createWetSlateMaterial();

  const stones: readonly {
    readonly x: number;
    readonly z: number;
    readonly radius: number;
    readonly height: number;
    readonly rotY: number;
  }[] = [
    { x: -0.24, z: -1.42, radius: 0.48, height: 0.34, rotY: 0.2 },
    { x: 0.26, z: -0.46, radius: 0.56, height: 0.38, rotY: 1.1 },
    { x: -0.2, z: 0.52, radius: 0.52, height: 0.36, rotY: 2.3 },
    { x: 0.22, z: 1.46, radius: 0.46, height: 0.32, rotY: 0.7 },
  ];

  for (const s of stones) {
    // Tapered submerged stone base grounded at y = 0
    addPart(
      root,
      new THREE.CylinderGeometry(s.radius * 0.96, s.radius * 1.12, s.height, 6),
      baseStoneMat,
      [s.x, s.height / 2, s.z],
      [0, s.rotY, 0],
    );
    // Flat wet dark-slate specular stepping cap
    addPart(
      root,
      new THREE.CylinderGeometry(s.radius * 0.88, s.radius * 0.98, 0.14, 6),
      wetTopMat,
      [s.x, s.height + 0.07, s.z],
      [0, s.rotY, 0],
    );
  }

  return root;
}

// ============================================================================
// VILLAGE CLUTTER PACK
// ============================================================================

/**
 * prop_drying_fish_rack
 * Width: ~2.3 | Height: ~1.78 | Chunky timber A-frame drying rack with
 * 4 oversized high-contrast hanging fish silhouettes.
 */
export function createDryingFishRackModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'prop_drying_fish_rack';

  const timberDarkMat = createFlatMaterial(PALETTE.barkDark);
  const timberLightMat = createFlatMaterial(PALETTE.weatheredWood);
  const fishBodyMat = createFlatMaterial(PALETTE.silverFish, 0.45, 0.2);

  // Left & right chunky A-frame timber legs grounded at y = 0
  const legGeo = new THREE.BoxGeometry(0.16, 1.82, 0.16);
  const sideOffsets = [-1.02, 1.02];
  for (const sx of sideOffsets) {
    addPart(root, legGeo, timberDarkMat, [sx, 0.86, 0.3], [-0.34, 0, 0]);
    addPart(root, legGeo, timberDarkMat, [sx, 0.86, -0.3], [0.34, 0, 0]);
    // Lower horizontal brace on each A-frame
    addPart(root, new THREE.BoxGeometry(0.14, 0.14, 0.88), timberLightMat, [sx, 0.56, 0]);
  }

  // Thick horizontal drying crossbar
  addPart(root, new THREE.CylinderGeometry(0.085, 0.085, 2.45, 6), timberLightMat, [0, 1.56, 0], [0, 0, Math.PI / 2]);

  // 4 chunky hanging fish silhouettes (ExtrudeGeometry) for crisp ASCII readability
  const fishShape = new THREE.Shape();
  fishShape.moveTo(0, 0.34);
  fishShape.lineTo(0.14, 0.14);
  fishShape.lineTo(0.16, -0.18);
  fishShape.lineTo(0.05, -0.34);
  fishShape.lineTo(0.14, -0.48);
  fishShape.lineTo(-0.14, -0.48);
  fishShape.lineTo(-0.05, -0.34);
  fishShape.lineTo(-0.16, -0.18);
  fishShape.lineTo(-0.14, 0.14);
  fishShape.closePath();

  const fishGeo = new THREE.ExtrudeGeometry(fishShape, { depth: 0.12, bevelEnabled: false });
  const fishX = [-0.66, -0.22, 0.22, 0.66];
  for (let i = 0; i < fishX.length; i += 1) {
    const rotY = i % 2 === 0 ? 0.18 : -0.18;
    addPart(root, fishGeo, fishBodyMat, [fishX[i], 1.18, -0.06], [0, rotY, 0]);
  }

  return root;
}

/**
 * prop_barrels_crates
 * Width: ~1.85 | Height: ~1.36 | Stacked chunky wooden crates paired with
 * a coopered wooden barrel ringed by dark iron hoops.
 */
export function createBarrelsCratesModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'prop_barrels_crates';

  const darkIronMat = createFlatMaterial(PALETTE.charcoal, 0.65, 0.3);
  const darkWoodMat = createFlatMaterial(PALETTE.barkDark);
  const midWoodMat = createFlatMaterial(PALETTE.barkMid);
  const brightWoodMat = createFlatMaterial(PALETTE.weatheredWood);

  // Helper to build a high-contrast framed crate (bright corner frame over dark core)
  const addCrate = (size: number, pos: Vec3Tuple, rotY: number): void => {
    const crate = new THREE.Group();
    crate.position.set(pos[0], pos[1], pos[2]);
    crate.rotation.y = rotY;

    // Dark recessed inner cube
    addPart(crate, new THREE.BoxGeometry(size * 0.86, size * 0.86, size * 0.86), darkWoodMat);

    // Chunky pale outer edge rails (>= 0.13 thick)
    const rail = Math.max(0.13, size * 0.18);
    const half = size / 2 - rail / 2;
    const hBeamGeo = new THREE.BoxGeometry(size, rail, rail);
    const vBeamGeo = new THREE.BoxGeometry(rail, size, rail);
    const zBeamGeo = new THREE.BoxGeometry(rail, rail, size);

    addPart(crate, hBeamGeo, brightWoodMat, [0, half, half]);
    addPart(crate, hBeamGeo, brightWoodMat, [0, half, -half]);
    addPart(crate, hBeamGeo, brightWoodMat, [0, -half, half]);
    addPart(crate, hBeamGeo, brightWoodMat, [0, -half, -half]);

    addPart(crate, vBeamGeo, brightWoodMat, [-half, 0, half]);
    addPart(crate, vBeamGeo, brightWoodMat, [half, 0, half]);
    addPart(crate, vBeamGeo, brightWoodMat, [-half, 0, -half]);
    addPart(crate, vBeamGeo, brightWoodMat, [half, 0, -half]);

    addPart(crate, zBeamGeo, brightWoodMat, [-half, half, 0]);
    addPart(crate, zBeamGeo, brightWoodMat, [half, half, 0]);
    addPart(crate, zBeamGeo, brightWoodMat, [-half, -half, 0]);
    addPart(crate, zBeamGeo, brightWoodMat, [half, -half, 0]);

    root.add(crate);
  };

  // Large bottom crate + angled smaller stacked crate on left (-X)
  addCrate(0.84, [-0.42, 0.42, -0.06], 0.14);
  addCrate(0.58, [-0.36, 1.13, -0.08], -0.32);

  // Coopered wooden barrel on right (+X) using LatheGeometry
  const barrelPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.32, 0.0),
    new THREE.Vector2(0.42, 0.46),
    new THREE.Vector2(0.32, 0.92),
    new THREE.Vector2(0.0, 0.92),
  ];
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0.48, 0, 0.18);
  addPart(barrelGroup, new THREE.LatheGeometry(barrelPoints, 8), midWoodMat);
  // Thick iron hoops for crisp horizontal bands
  addPart(barrelGroup, new THREE.CylinderGeometry(0.39, 0.36, 0.12, 8), darkIronMat, [0, 0.2, 0]);
  addPart(barrelGroup, new THREE.CylinderGeometry(0.36, 0.39, 0.12, 8), darkIronMat, [0, 0.72, 0]);
  root.add(barrelGroup);

  return root;
}

/**
 * prop_campfire_ring
 * Diameter: ~1.55 | Ring of angular hearth stones, crossed charred logs,
 * and glowing orange embers (#FF6600).
 */
export function createCampfireRingModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'prop_campfire_ring';

  const darkStoneMat = createFlatMaterial(PALETTE.charcoal);
  const paleStoneMat = createFlatMaterial(PALETTE.paleStone);
  const charredWoodMat = createFlatMaterial(PALETTE.barkDark);
  const emberGlowMat = createEmissiveMaterial(PALETTE.emberOrange, PALETTE.emberOrange);

  // Ring of 8 faceted hearth stones grounded at y = 0
  const stoneCount = 8;
  const ringRadius = 0.66;
  const stoneGeo = new THREE.DodecahedronGeometry(0.22, 0);
  for (let i = 0; i < stoneCount; i += 1) {
    const angle = (i / stoneCount) * Math.PI * 2;
    const mat = i % 2 === 0 ? paleStoneMat : darkStoneMat;
    addPart(
      root,
      stoneGeo,
      mat,
      [Math.sin(angle) * ringRadius, 0.15, Math.cos(angle) * ringRadius],
      [i * 0.4, angle, 0.2],
    );
  }

  // Dark ash bed
  addPart(root, new THREE.CylinderGeometry(0.56, 0.6, 0.12, 8), darkStoneMat, [0, 0.06, 0]);

  // Crossed chunky charred firewood logs
  const logGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.92, 6);
  addPart(root, logGeo, charredWoodMat, [0, 0.22, 0], [1.22, 0.35, 0]);
  addPart(root, logGeo, charredWoodMat, [0, 0.22, 0], [1.22, 2.45, 0]);
  addPart(root, logGeo, charredWoodMat, [0, 0.24, 0], [1.18, 4.55, 0]);

  // Glowing campfire ember bed + central flame heart (#FF6600)
  addPart(root, new THREE.DodecahedronGeometry(0.26, 0), emberGlowMat, [0, 0.2, 0], [0, 0, 0], true);
  addPart(root, new THREE.ConeGeometry(0.2, 0.48, 5), emberGlowMat, [0, 0.46, 0], [0, 0.3, 0], true);
  const coalGeo = new THREE.DodecahedronGeometry(0.11, 0);
  addPart(root, coalGeo, emberGlowMat, [-0.26, 0.14, 0.18], [0, 0, 0], true);
  addPart(root, coalGeo, emberGlowMat, [0.24, 0.14, 0.2], [0, 0, 0], true);
  addPart(root, coalGeo, emberGlowMat, [0.06, 0.14, -0.28], [0, 0, 0], true);

  return root;
}

/**
 * prop_corrupted_reeds
 * Width: ~1.1 | Height: ~1.58 | Dense clump of chunky marsh reeds with
 * glowing toxic green & violet tips.
 */
export function createCorruptedReedsModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'prop_corrupted_reeds';

  const mudBaseMat = createFlatMaterial(PALETTE.charcoal);
  const stalkMat = createFlatMaterial(PALETTE.pineShadow);
  const greenTipMat = createEmissiveMaterial(PALETTE.toxicGreen, PALETTE.toxicGreen);
  const violetTipMat = createEmissiveMaterial(PALETTE.blightViolet, PALETTE.blightViolet);

  // Small rooted tussock mound grounded at y = 0
  addPart(root, new THREE.CylinderGeometry(0.42, 0.54, 0.2, 7), mudBaseMat, [0, 0.1, 0]);

  const reeds: readonly {
    readonly x: number;
    readonly z: number;
    readonly height: number;
    readonly tiltX: number;
    readonly tiltZ: number;
    readonly isViolet: boolean;
  }[] = [
    { x: 0.0, z: 0.0, height: 1.32, tiltX: 0.08, tiltZ: -0.06, isViolet: false },
    { x: -0.24, z: 0.16, height: 1.12, tiltX: 0.18, tiltZ: 0.22, isViolet: true },
    { x: 0.24, z: 0.14, height: 1.2, tiltX: 0.16, tiltZ: -0.2, isViolet: false },
    { x: -0.18, z: -0.22, height: 1.04, tiltX: -0.2, tiltZ: 0.16, isViolet: false },
    { x: 0.22, z: -0.18, height: 1.16, tiltX: -0.18, tiltZ: -0.18, isViolet: true },
  ];

  for (const r of reeds) {
    const stalkGroup = new THREE.Group();
    stalkGroup.position.set(r.x, 0.12, r.z);
    stalkGroup.rotation.set(r.tiltX, 0, r.tiltZ);

    // Chunky reed stalk (diameter >= 0.13)
    addPart(stalkGroup, new THREE.CylinderGeometry(0.065, 0.075, r.height, 5), stalkMat, [0, r.height / 2, 0]);

    // Oversized glowing corrupted cattail/spore tip
    const tipMat = r.isViolet ? violetTipMat : greenTipMat;
    addPart(
      stalkGroup,
      new THREE.CylinderGeometry(0.095, 0.1, 0.34, 6),
      tipMat,
      [0, r.height - 0.04, 0],
      [0, 0, 0],
      true,
    );
    addPart(
      stalkGroup,
      new THREE.ConeGeometry(0.095, 0.18, 6),
      tipMat,
      [0, r.height + 0.22, 0],
      [0, 0, 0],
      true,
    );

    root.add(stalkGroup);
  }

  return root;
}

export const NATURE_PROP_MODEL_FACTORIES: Record<NaturePropAssetId, () => THREE.Group> = {
  tree_pine: createTreePineModel,
  tree_oak: createTreeOakModel,
  tree_wilted: createTreeWiltedModel,
  rock_river_boulder: createRockRiverBoulderModel,
  rock_shoreline_ledge: createRockShorelineLedgeModel,
  rock_stepping_stones: createRockSteppingStonesModel,
  prop_drying_fish_rack: createDryingFishRackModel,
  prop_barrels_crates: createBarrelsCratesModel,
  prop_campfire_ring: createCampfireRingModel,
  prop_corrupted_reeds: createCorruptedReedsModel,
};