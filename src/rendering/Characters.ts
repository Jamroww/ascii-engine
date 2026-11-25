import * as THREE from 'three';

export type CharacterAssetId =
  | 'player_traveler'
  | 'npc_sibling'
  | 'npc_ferryman'
  | 'npc_lantern_keeper'
  | 'npc_herbalist'
  | 'npc_elder';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x1c2026,
  deepSlate: 0x2b323c,
  midSlate: 0x4b5563,
  warmUmber: 0x5c4433,
  weatheredOchre: 0x9c7a4c,
  paleStone: 0xcbd2d9,
  warmIvory: 0xe6dfd3,
  brightHighlight: 0xf4f1ea,
  cloakWhite: 0xf0f4fa,
  lanternWarm: 0xff9900,
  staffWarm: 0xffb84d,
  herbGreen: 0x48b85a,
} as const;

type Vec3Tuple = readonly [number, number, number];

function createFlatMaterial(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
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
    roughness: 0.4,
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

/**
 * player_traveler
 * Height: ~1.84 | Hooded cloak, broad shoulders, belt satchel, warm hip lantern (#FF9900).
 */
export function createPlayerTravelerModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'player_traveler';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  // Crisp bright-white hooded cloak so the traveler pops instantly against the
  // dark nocturnal world.
  const cloakMat = createFlatMaterial(PALETTE.cloakWhite);
  const mantleMat = createFlatMaterial(PALETTE.paleStone);
  const leatherMat = createFlatMaterial(PALETTE.warmUmber);
  const lanternGlowMat = createEmissiveMaterial(PALETTE.lanternWarm, PALETTE.lanternWarm);

  // Boots planted at y = 0
  const bootGeo = new THREE.BoxGeometry(0.2, 0.24, 0.3);
  addPart(root, bootGeo, darkMat, [-0.16, 0.12, 0.04]);
  addPart(root, bootGeo, darkMat, [0.16, 0.12, 0.04]);

  // Sweeping A-line cloak (LatheGeometry for chunky flared silhouette)
  const cloakPoints = [
    new THREE.Vector2(0.46, 0.14),
    new THREE.Vector2(0.42, 0.55),
    new THREE.Vector2(0.32, 1.05),
    new THREE.Vector2(0.36, 1.38),
    new THREE.Vector2(0.24, 1.46),
  ];
  addPart(root, new THREE.LatheGeometry(cloakPoints, 8), cloakMat);

  // Broad shoulder mantle / pauldrons (bright contrast for ASCII upper silhouette)
  addPart(root, new THREE.BoxGeometry(0.92, 0.22, 0.44), mantleMat, [0, 1.34, 0]);
  const pauldronGeo = new THREE.DodecahedronGeometry(0.2, 0);
  addPart(root, pauldronGeo, mantleMat, [-0.42, 1.32, 0.02]);
  addPart(root, pauldronGeo, mantleMat, [0.42, 1.32, 0.02]);

  // Chunky arms tucked near cloak
  const armGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.62, 6);
  addPart(root, armGeo, cloakMat, [-0.42, 0.96, 0.06], [0.12, 0, 0.14]);
  addPart(root, armGeo, cloakMat, [0.42, 0.96, 0.06], [0.18, 0, -0.14]);

  // Shadowed face recess + oversized pointed hood
  addPart(root, new THREE.SphereGeometry(0.18, 7, 6), darkMat, [0, 1.56, 0.08]);
  addPart(root, new THREE.ConeGeometry(0.32, 0.54, 7), cloakMat, [0, 1.66, -0.04], [-0.28, 0, 0]);
  addPart(root, new THREE.CylinderGeometry(0.24, 0.3, 0.24, 7), cloakMat, [0, 1.5, 0.02]);

  // Thick waist belt
  addPart(root, new THREE.CylinderGeometry(0.35, 0.36, 0.14, 8), leatherMat, [0, 0.88, 0]);

  // Belt satchel on left hip (-X)
  addPart(root, new THREE.BoxGeometry(0.22, 0.28, 0.26), leatherMat, [-0.38, 0.78, 0.06], [0, 0, 0.12]);
  addPart(root, new THREE.BoxGeometry(0.24, 0.12, 0.28), mantleMat, [-0.39, 0.88, 0.06], [0, 0, 0.12]);

  // Hip lantern on right hip (+X, forward +Z)
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(0.38, 0.74, 0.16);
  addPart(lanternGroup, new THREE.CylinderGeometry(0.08, 0.11, 0.08, 6), darkMat, [0, 0.11, 0]);
  addPart(lanternGroup, new THREE.CylinderGeometry(0.1, 0.09, 0.08, 6), darkMat, [0, -0.11, 0]);
  addPart(lanternGroup, new THREE.DodecahedronGeometry(0.1, 0), lanternGlowMat, [0, 0, 0], [0, 0, 0], true);
  root.add(lanternGroup);

  return root;
}

/**
 * npc_sibling
 * Height: ~1.58 (staff to ~1.96) | Shorter cloak/scarf silhouette, tall staff with warm tip light.
 */
export function createSiblingModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'npc_sibling';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const cloakMat = createFlatMaterial(PALETTE.midSlate);
  const scarfMat = createFlatMaterial(PALETTE.warmIvory);
  const woodMat = createFlatMaterial(PALETTE.warmUmber);
  const staffGlowMat = createEmissiveMaterial(PALETTE.staffWarm, PALETTE.staffWarm);

  // Visible chunky legs & boots (shorter cloak exposes lower legs)
  const legGeo = new THREE.CylinderGeometry(0.085, 0.09, 0.56, 6);
  addPart(root, legGeo, darkMat, [-0.14, 0.28, 0]);
  addPart(root, legGeo, darkMat, [0.14, 0.28, 0]);

  // Short flared cloak stopping mid-thigh
  addPart(root, new THREE.CylinderGeometry(0.22, 0.42, 0.72, 8), cloakMat, [0, 0.84, 0]);

  // Arms (right arm extended forward to hold tall staff)
  addPart(root, new THREE.CylinderGeometry(0.08, 0.075, 0.48, 6), cloakMat, [-0.32, 0.94, 0.02], [0, 0, 0.22]);
  addPart(root, new THREE.CylinderGeometry(0.08, 0.075, 0.52, 6), cloakMat, [0.32, 0.96, 0.16], [0.65, 0, -0.18]);

  // Oversized wrapped scarf collar + trailing tail (ExtrudeGeometry)
  addPart(root, new THREE.CylinderGeometry(0.27, 0.3, 0.2, 8), scarfMat, [0, 1.22, 0.02]);

  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(0.22, 0);
  tailShape.lineTo(0.18, -0.58);
  tailShape.lineTo(-0.04, -0.52);
  tailShape.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.12, bevelEnabled: false });
  addPart(root, tailGeo, scarfMat, [-0.18, 1.2, -0.22], [0.35, 0.18, -0.15]);

  // Head + windswept hair cap
  addPart(root, new THREE.DodecahedronGeometry(0.2, 0), darkMat, [0, 1.42, 0.03]);
  addPart(root, new THREE.SphereGeometry(0.22, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), cloakMat, [0, 1.44, 0], [-0.25, 0, 0]);

  // Tall staff on right side (+X, +Z) with glowing tip
  const staffGroup = new THREE.Group();
  staffGroup.position.set(0.42, 0, 0.28);
  addPart(staffGroup, new THREE.CylinderGeometry(0.065, 0.07, 1.82, 6), woodMat, [0, 0.91, 0]);
  // Chunky wooden cradle framing the glowing orb
  addPart(staffGroup, new THREE.BoxGeometry(0.26, 0.12, 0.14), woodMat, [0, 1.78, 0]);
  addPart(staffGroup, new THREE.DodecahedronGeometry(0.13, 0), staffGlowMat, [0, 1.94, 0], [0, 0, 0], true);
  root.add(staffGroup);

  return root;
}

/**
 * npc_ferryman
 * Height: ~1.88 (oar to ~2.18) | Wide-brimmed fisherman hat, heavy coat, holding an oar. No emissives.
 */
export function createFerrymanModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'npc_ferryman';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const coatMat = createFlatMaterial(PALETTE.deepSlate);
  const oilskinMat = createFlatMaterial(PALETTE.weatheredOchre);
  const paleMat = createFlatMaterial(PALETTE.paleStone);
  const woodMat = createFlatMaterial(PALETTE.warmUmber);

  // Heavy sea boots in wide dock stance
  const bootGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.34, 6);
  addPart(root, bootGeo, darkMat, [-0.2, 0.17, 0.02]);
  addPart(root, bootGeo, darkMat, [0.2, 0.17, 0.02]);

  // Bulky heavy coat (boxy lower skirt + wide torso)
  const coatPoints = [
    new THREE.Vector2(0.48, 0.22),
    new THREE.Vector2(0.45, 0.8),
    new THREE.Vector2(0.42, 1.38),
    new THREE.Vector2(0.32, 1.5),
  ];
  addPart(root, new THREE.LatheGeometry(coatPoints, 8), coatMat);

  // High-contrast rain capelet / collar over shoulders
  addPart(root, new THREE.CylinderGeometry(0.28, 0.52, 0.34, 8), oilskinMat, [0, 1.34, 0]);

  // Chunky arms
  addPart(root, new THREE.CylinderGeometry(0.11, 0.1, 0.64, 6), coatMat, [-0.46, 1.0, 0.04], [0.1, 0, 0.16]);
  addPart(root, new THREE.CylinderGeometry(0.11, 0.1, 0.64, 6), coatMat, [0.46, 1.04, 0.18], [0.55, 0, -0.14]);

  // Shadowed head
  addPart(root, new THREE.DodecahedronGeometry(0.2, 0), darkMat, [0, 1.56, 0.04]);

  // Oversized wide-brimmed sou'wester / fisherman hat (solid thick LatheGeometry brim)
  const hatPoints = [
    new THREE.Vector2(0.52, 0.0),
    new THREE.Vector2(0.5, 0.12),
    new THREE.Vector2(0.26, 0.18),
    new THREE.Vector2(0.24, 0.36),
    new THREE.Vector2(0.14, 0.42),
    new THREE.Vector2(0.0, 0.42),
  ];
  addPart(root, new THREE.LatheGeometry(hatPoints, 9), paleMat, [0, 1.58, 0.02], [0.12, 0, 0]);

  // Heavy upright wooden oar held on right side (+X, +Z)
  const oarGroup = new THREE.Group();
  oarGroup.position.set(0.54, 0, 0.28);
  oarGroup.rotation.set(-0.08, 0, -0.05);
  addPart(oarGroup, new THREE.CylinderGeometry(0.065, 0.065, 1.54, 6), woodMat, [0, 0.77, 0]);
  // Wide paddle blade at top for unmistakable silhouette
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.07, 0);
  bladeShape.lineTo(0.07, 0);
  bladeShape.lineTo(0.2, 0.56);
  bladeShape.lineTo(0.14, 0.72);
  bladeShape.lineTo(-0.14, 0.72);
  bladeShape.lineTo(-0.2, 0.56);
  bladeShape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.12, bevelEnabled: false });
  addPart(oarGroup, bladeGeo, paleMat, [0, 1.48, -0.06]);
  root.add(oarGroup);

  return root;
}

/**
 * npc_lantern_keeper
 * Height: ~1.92 (pole to ~2.36) | Tall coat, hooked pole with bright hanging lantern (#FF9900).
 */
export function createLanternKeeperModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'npc_lantern_keeper';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const coatMat = createFlatMaterial(PALETTE.deepSlate);
  const trimMat = createFlatMaterial(PALETTE.paleStone);
  const metalMat = createFlatMaterial(PALETTE.midSlate, 0.55);
  const lanternGlowMat = createEmissiveMaterial(PALETTE.lanternWarm, PALETTE.lanternWarm);

  // Boots at y = 0
  const bootGeo = new THREE.BoxGeometry(0.18, 0.22, 0.28);
  addPart(root, bootGeo, darkMat, [-0.14, 0.11, 0.04]);
  addPart(root, bootGeo, darkMat, [0.14, 0.11, 0.04]);

  // Tall, narrow dramatic trench coat
  const coatPoints = [
    new THREE.Vector2(0.42, 0.12),
    new THREE.Vector2(0.32, 0.72),
    new THREE.Vector2(0.28, 1.18),
    new THREE.Vector2(0.36, 1.52),
    new THREE.Vector2(0.24, 1.6),
  ];
  addPart(root, new THREE.LatheGeometry(coatPoints, 8), coatMat);

  // High upturned coat collar
  addPart(root, new THREE.CylinderGeometry(0.28, 0.24, 0.26, 7), trimMat, [0, 1.56, -0.02]);

  // Arms (right arm raised to grip tall hooked pole)
  addPart(root, new THREE.CylinderGeometry(0.095, 0.085, 0.66, 6), coatMat, [-0.38, 1.12, 0.02], [0.06, 0, 0.12]);
  addPart(root, new THREE.CylinderGeometry(0.095, 0.085, 0.64, 6), coatMat, [0.38, 1.24, 0.18], [0.85, 0, -0.1]);

  // Head + tall keeper cap
  addPart(root, new THREE.SphereGeometry(0.18, 7, 6), darkMat, [0, 1.68, 0.04]);
  addPart(root, new THREE.CylinderGeometry(0.22, 0.2, 0.28, 8), darkMat, [0, 1.84, 0.02]);
  addPart(root, new THREE.BoxGeometry(0.32, 0.12, 0.24), trimMat, [0, 1.74, 0.14]);

  // Hooked pole held on right side (+X) extending forward (+Z)
  const poleGroup = new THREE.Group();
  poleGroup.position.set(0.44, 0, 0.24);
  // Main vertical shaft
  addPart(poleGroup, new THREE.CylinderGeometry(0.065, 0.07, 2.26, 6), metalMat, [0, 1.13, 0]);
  // Chunky upper hook arm jutting forward (+Z)
  addPart(poleGroup, new THREE.BoxGeometry(0.13, 0.13, 0.56), metalMat, [0, 2.26, 0.24]);
  // Downward hook tip
  addPart(poleGroup, new THREE.BoxGeometry(0.13, 0.22, 0.13), metalMat, [0, 2.12, 0.48]);

  // Large bright hanging lantern suspended from hook tip
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(0, 1.84, 0.48);
  addPart(lanternGroup, new THREE.ConeGeometry(0.18, 0.16, 6), darkMat, [0, 0.22, 0]);
  addPart(lanternGroup, new THREE.CylinderGeometry(0.15, 0.12, 0.12, 6), darkMat, [0, -0.2, 0]);
  addPart(lanternGroup, new THREE.DodecahedronGeometry(0.15, 0), lanternGlowMat, [0, 0.02, 0], [0, 0, 0], true);
  poleGroup.add(lanternGroup);

  root.add(poleGroup);

  return root;
}

/**
 * npc_herbalist
 * Height: ~1.62 | Hunched silhouette, woven backpack basket, wide hood, faint green herb accents.
 */
export function createHerbalistModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'npc_herbalist';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const robeMat = createFlatMaterial(PALETTE.deepSlate);
  const hoodMat = createFlatMaterial(PALETTE.paleStone);
  const basketMat = createFlatMaterial(PALETTE.weatheredOchre);
  const herbGlowMat = createEmissiveMaterial(PALETTE.herbGreen, PALETTE.herbGreen);

  // Grounded boots & lower robe
  addPart(root, new THREE.CylinderGeometry(0.32, 0.44, 0.68, 8), robeMat, [0, 0.34, 0]);
  addPart(root, new THREE.BoxGeometry(0.18, 0.18, 0.26), darkMat, [-0.15, 0.09, 0.1]);
  addPart(root, new THREE.BoxGeometry(0.18, 0.18, 0.26), darkMat, [0.15, 0.09, 0.1]);

  // Hunched upper torso group pitched forward (+X rotation)
  const hunchGroup = new THREE.Group();
  hunchGroup.position.set(0, 0.66, 0.04);
  hunchGroup.rotation.set(0.38, 0, 0);

  // Rounded hunched back & shoulders
  addPart(hunchGroup, new THREE.DodecahedronGeometry(0.38, 0), robeMat, [0, 0.32, 0]);

  // Arms clasping forward
  const armGeo = new THREE.CylinderGeometry(0.095, 0.085, 0.52, 6);
  addPart(hunchGroup, armGeo, robeMat, [-0.34, 0.2, 0.18], [0.45, 0, 0.25]);
  addPart(hunchGroup, armGeo, robeMat, [0.34, 0.2, 0.18], [0.45, 0, -0.25]);

  // Wide flared hood pitched forward over shadowed face
  addPart(hunchGroup, new THREE.SphereGeometry(0.18, 7, 6), darkMat, [0, 0.62, 0.14]);
  addPart(hunchGroup, new THREE.ConeGeometry(0.38, 0.52, 7), hoodMat, [0, 0.66, 0.02], [-1.05, 0, 0]);
  addPart(hunchGroup, new THREE.CylinderGeometry(0.34, 0.38, 0.24, 7), hoodMat, [0, 0.58, 0.08], [0.25, 0, 0]);

  // Oversized woven backpack basket on the back (-Z)
  const basketGroup = new THREE.Group();
  basketGroup.position.set(0, 0.36, -0.42);
  basketGroup.rotation.set(-0.22, 0, 0);
  addPart(basketGroup, new THREE.CylinderGeometry(0.34, 0.24, 0.64, 8), basketMat, [0, 0, 0]);
  // Thick woven rim
  addPart(basketGroup, new THREE.CylinderGeometry(0.37, 0.35, 0.12, 8), darkMat, [0, 0.3, 0]);

  // Chunky glowing reed / herb stalks poking out of the basket
  addPart(basketGroup, new THREE.ConeGeometry(0.09, 0.42, 5), herbGlowMat, [-0.14, 0.48, -0.04], [-0.18, 0, 0.22], true);
  addPart(basketGroup, new THREE.ConeGeometry(0.1, 0.48, 5), herbGlowMat, [0.06, 0.52, 0.04], [0.12, 0, -0.14], true);
  addPart(basketGroup, new THREE.ConeGeometry(0.08, 0.36, 5), herbGlowMat, [0.18, 0.44, -0.08], [-0.2, 0, -0.28], true);

  hunchGroup.add(basketGroup);
  root.add(hunchGroup);

  return root;
}

/**
 * npc_elder
 * Height: ~1.68 | Draped shawl, slightly stooped posture, walking cane. No emissives.
 */
export function createElderModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'npc_elder';

  const darkMat = createFlatMaterial(PALETTE.charcoal);
  const robeMat = createFlatMaterial(PALETTE.deepSlate);
  const shawlMat = createFlatMaterial(PALETTE.brightHighlight);
  const woodMat = createFlatMaterial(PALETTE.warmUmber);

  // Full grounded robe base reaching y = 0
  const robePoints = [
    new THREE.Vector2(0.44, 0.0),
    new THREE.Vector2(0.4, 0.45),
    new THREE.Vector2(0.32, 0.92),
    new THREE.Vector2(0.28, 1.15),
  ];
  addPart(root, new THREE.LatheGeometry(robePoints, 8), robeMat);

  // Slightly stooped upper body
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, 0.96, 0.02);
  upperGroup.rotation.set(0.24, 0, 0);

  // Broad draped shawl (high-value ivory/pale highlight for strong ASCII contrast)
  const shawlPoints = [
    new THREE.Vector2(0.46, -0.16),
    new THREE.Vector2(0.44, 0.14),
    new THREE.Vector2(0.36, 0.36),
    new THREE.Vector2(0.22, 0.44),
  ];
  addPart(upperGroup, new THREE.LatheGeometry(shawlPoints, 8), shawlMat);
  // Asymmetrical front drape fold
  addPart(upperGroup, new THREE.BoxGeometry(0.34, 0.48, 0.16), shawlMat, [-0.14, 0.04, 0.32], [0.1, 0.18, 0.08]);

  // Arms tucked under shawl / reaching for cane
  addPart(upperGroup, new THREE.CylinderGeometry(0.09, 0.08, 0.46, 6), robeMat, [-0.34, 0.06, 0.14], [0.35, 0, 0.18]);
  addPart(upperGroup, new THREE.CylinderGeometry(0.09, 0.08, 0.48, 6), robeMat, [0.34, 0.06, 0.2], [0.55, 0, -0.12]);

  // Bowed head with soft kerchief / bun
  addPart(upperGroup, new THREE.DodecahedronGeometry(0.19, 0), darkMat, [0, 0.54, 0.06]);
  addPart(upperGroup, new THREE.SphereGeometry(0.21, 7, 6), shawlMat, [0, 0.56, -0.02]);
  addPart(upperGroup, new THREE.DodecahedronGeometry(0.12, 0), shawlMat, [0, 0.54, -0.2]);

  root.add(upperGroup);

  // Chunky walking cane planted firmly at y = 0 on right side (+X, +Z)
  const caneGroup = new THREE.Group();
  caneGroup.position.set(0.38, 0, 0.34);
  addPart(caneGroup, new THREE.CylinderGeometry(0.065, 0.065, 1.04, 6), woodMat, [0, 0.52, 0]);
  // Curved crook handle (thick segments >= 0.12)
  addPart(caneGroup, new THREE.BoxGeometry(0.13, 0.13, 0.24), woodMat, [0, 1.06, -0.06]);
  addPart(caneGroup, new THREE.BoxGeometry(0.13, 0.18, 0.13), woodMat, [0, 0.96, -0.14]);
  root.add(caneGroup);

  return root;
}

export const CHARACTER_MODEL_FACTORIES: Record<CharacterAssetId, () => THREE.Group> = {
  player_traveler: createPlayerTravelerModel,
  npc_sibling: createSiblingModel,
  npc_ferryman: createFerrymanModel,
  npc_lantern_keeper: createLanternKeeperModel,
  npc_herbalist: createHerbalistModel,
  npc_elder: createElderModel,
};