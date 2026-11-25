import * as THREE from 'three';

export type ProgressionAssetId = 'poison_node' | 'light_shrine';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x181c22,
  deepSlate: 0x262e3a,
  coldStoneDark: 0x2c3644,
  coldStoneMid: 0x526070,
  coldStoneLight: 0x9aa9b8,
  warmStoneMid: 0x7c766b,
  warmStoneLight: 0xe6dfd0,
  obsidianCrystal: 0x1d1b26,
  crystalHighlight: 0x625a78,
  toxicGreen: 0x44ff66,
  blightViolet: 0xaa44ff,
  purifiedGold: 0xffa61a,
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

/**
 * poison_node
 * Height: ~2.90 | Jagged organic/crystalline spire jutting from a cracked mound
 * with bright toxic neon green (#44FF66) and violet (#AA44FF) emissive veins.
 */
export function createPoisonNodeModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'poison_node';

  const crustMat = createFlatMaterial(PALETTE.charcoal, 0.92, 0.05);
  const obsidianMat = createFlatMaterial(PALETTE.obsidianCrystal, 0.45, 0.25);
  const facetMat = createFlatMaterial(PALETTE.crystalHighlight, 0.4, 0.25);
  const greenGlowMat = createEmissiveMaterial(PALETTE.toxicGreen, PALETTE.toxicGreen);
  const violetGlowMat = createEmissiveMaterial(PALETTE.blightViolet, PALETTE.blightViolet);

  // Cracked organic/blight ground mound anchored at y = 0
  addPart(root, new THREE.CylinderGeometry(0.92, 1.32, 0.44, 7), crustMat, [0, 0.22, 0]);
  addPart(root, new THREE.DodecahedronGeometry(0.54, 0), crustMat, [-0.62, 0.24, 0.48], [0.2, 0.4, 0.1]);
  addPart(root, new THREE.DodecahedronGeometry(0.48, 0), crustMat, [0.68, 0.22, -0.34], [0.1, 0.9, 0.3]);

  // Primary jagged crystalline spire jutting upward at a menacing tilt
  const mainSpire = new THREE.Group();
  mainSpire.position.set(0, 0.25, 0);
  mainSpire.rotation.set(0.08, 0.2, -0.1);

  // Lower faceted column + tall sharp spire tip
  addPart(mainSpire, new THREE.CylinderGeometry(0.46, 0.64, 1.15, 5), obsidianMat, [0, 0.575, 0]);
  addPart(mainSpire, new THREE.ConeGeometry(0.48, 1.55, 5), facetMat, [0, 1.92, 0]);

  // Thick neon green & violet glowing veins climbing the main spire (>= 0.14 thick)
  addPart(mainSpire, new THREE.BoxGeometry(0.15, 1.48, 0.16), greenGlowMat, [0.06, 0.96, 0.44], [0.12, 0, -0.14], true);
  addPart(mainSpire, new THREE.BoxGeometry(0.14, 1.35, 0.15), violetGlowMat, [-0.36, 0.88, -0.22], [-0.1, 0.5, 0.16], true);
  addPart(mainSpire, new THREE.BoxGeometry(0.14, 1.24, 0.15), greenGlowMat, [0.38, 0.82, -0.18], [-0.08, -0.4, -0.14], true);

  // Exposed pulsing blight core cluster bursting from the front (+Z)
  addPart(mainSpire, new THREE.DodecahedronGeometry(0.24, 0), violetGlowMat, [0.02, 0.68, 0.48], [0, 0, 0], true);
  addPart(mainSpire, new THREE.DodecahedronGeometry(0.16, 0), greenGlowMat, [-0.22, 0.52, 0.52], [0, 0, 0], true);

  root.add(mainSpire);

  // Secondary flanking jagged crystal shards angled outward for bold silhouette
  const leftShard = new THREE.Group();
  leftShard.position.set(-0.62, 0.22, 0.22);
  leftShard.rotation.set(0.24, 0.3, 0.46);
  addPart(leftShard, new THREE.ConeGeometry(0.32, 1.42, 5), obsidianMat, [0, 0.71, 0]);
  addPart(leftShard, new THREE.BoxGeometry(0.14, 0.82, 0.14), violetGlowMat, [0, 0.46, 0.22], [0.16, 0, 0], true);
  root.add(leftShard);

  const rightShard = new THREE.Group();
  rightShard.position.set(0.66, 0.2, 0.18);
  rightShard.rotation.set(0.18, -0.4, -0.48);
  addPart(rightShard, new THREE.ConeGeometry(0.28, 1.26, 5), facetMat, [0, 0.63, 0]);
  addPart(rightShard, new THREE.BoxGeometry(0.13, 0.74, 0.13), greenGlowMat, [0, 0.42, 0.2], [0.16, 0, 0], true);
  root.add(rightShard);

  const rearShard = new THREE.Group();
  rearShard.position.set(-0.08, 0.24, -0.58);
  rearShard.rotation.set(-0.42, 0.1, 0.12);
  addPart(rearShard, new THREE.ConeGeometry(0.34, 1.56, 5), obsidianMat, [0, 0.78, 0]);
  addPart(rearShard, new THREE.BoxGeometry(0.14, 0.88, 0.14), greenGlowMat, [0, 0.52, -0.22], [-0.14, 0, 0], true);
  root.add(rearShard);

  // Radiating ground blight veins crawling out of the base crust
  const veinAngles = [0.4, 2.0, 3.6, 5.2];
  for (let i = 0; i < veinAngles.length; i += 1) {
    const angle = veinAngles[i];
    const vx = Math.sin(angle) * 0.96;
    const vz = Math.cos(angle) * 0.96;
    const veinMat = i % 2 === 0 ? greenGlowMat : violetGlowMat;
    const vein = addPart(
      root,
      new THREE.BoxGeometry(0.14, 0.14, 0.68),
      veinMat,
      [vx, 0.16, vz],
      [0, 0, 0],
      true,
    );
    vein.lookAt(vx * 2.2, 0.04, vz * 2.2);
  }

  return root;
}

/**
 * Updates a light_shrine instance between dormant cold stone and purified warm gold
 * without recreating geometry.
 */
export function setLightShrinePurified(shrine: THREE.Group, purified: boolean): void {
  shrine.userData.isPurified = purified;

  shrine.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }

    const mat = obj.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) {
      return;
    }

    const role = obj.userData.shrineRole as string | undefined;
    if (role === 'hearth' || role === 'rune') {
      if (purified) {
        mat.color.setHex(PALETTE.purifiedGold);
        mat.emissive.setHex(PALETTE.purifiedGold);
        mat.emissiveIntensity = 1.5;
        mat.roughness = 0.35;
        obj.userData.isEmissive = true;
      } else {
        mat.color.setHex(PALETTE.coldStoneDark);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mat.roughness = 0.92;
        obj.userData.isEmissive = false;
      }
    } else if (role === 'stone_mid') {
      mat.color.setHex(purified ? PALETTE.warmStoneMid : PALETTE.coldStoneMid);
    } else if (role === 'stone_light') {
      mat.color.setHex(purified ? PALETTE.warmStoneLight : PALETTE.coldStoneLight);
    }
  });
}

/**
 * light_shrine
 * Height: ~3.28 | Carved stone obelisk with a deep recessed lantern basin facing +Z.
 * Defaults to dormant cold stone; pass `purified = true` or call `setLightShrinePurified()`
 * to transition to warm golden emissive light.
 */
export function createLightShrineModel(purified = false): THREE.Group {
  const root = new THREE.Group();
  root.name = 'light_shrine';

  // Dedicated per-instance materials so toggling one shrine does not mutate others
  const baseDarkMat = createFlatMaterial(PALETTE.charcoal, 0.92, 0.05);
  const stoneMidMat = createFlatMaterial(PALETTE.coldStoneMid, 0.88, 0.05);
  const stoneLightMat = createFlatMaterial(PALETTE.coldStoneLight, 0.84, 0.05);
  const hearthMat = createFlatMaterial(PALETTE.coldStoneDark, 0.92, 0.05);
  const runeMat = createFlatMaterial(PALETTE.coldStoneDark, 0.92, 0.05);

  const tagRole = (mesh: THREE.Mesh, role: 'stone_mid' | 'stone_light' | 'hearth' | 'rune'): void => {
    mesh.userData.shrineRole = role;
  };

  // Stepped carved stone foundation plinth grounded at y = 0
  addPart(root, new THREE.BoxGeometry(1.72, 0.26, 1.72), baseDarkMat, [0, 0.13, 0]);
  tagRole(addPart(root, new THREE.BoxGeometry(1.38, 0.28, 1.38), stoneMidMat, [0, 0.4, 0]), 'stone_mid');

  // Lower monolithic pedestal supporting the basin
  tagRole(addPart(root, new THREE.BoxGeometry(1.06, 0.68, 1.06), stoneLightMat, [0, 0.88, 0]), 'stone_light');

  // Projecting carved basin sill/altar ledge facing +Z
  tagRole(addPart(root, new THREE.BoxGeometry(1.18, 0.22, 0.42), stoneMidMat, [0, 1.18, 0.56]), 'stone_mid');

  // Recessed lantern alcove chamber (thick rear wall + left/right framing pillars)
  tagRole(addPart(root, new THREE.BoxGeometry(0.98, 0.88, 0.34), stoneMidMat, [0, 1.66, -0.32]), 'stone_mid');
  tagRole(addPart(root, new THREE.BoxGeometry(0.26, 0.88, 0.96), stoneLightMat, [-0.36, 1.66, 0]), 'stone_light');
  tagRole(addPart(root, new THREE.BoxGeometry(0.26, 0.88, 0.96), stoneLightMat, [0.36, 1.66, 0]), 'stone_light');
  // Deep charcoal inner recess backing so the lantern core pops when purified
  addPart(root, new THREE.BoxGeometry(0.46, 0.78, 0.16), baseDarkMat, [0, 1.64, -0.1]);

  // Carved stone bowl + faceted lantern hearth seated inside the recessed basin
  addPart(root, new THREE.CylinderGeometry(0.24, 0.16, 0.16, 6), baseDarkMat, [0, 1.32, 0.14]);
  const hearthOrb = addPart(root, new THREE.DodecahedronGeometry(0.21, 0), hearthMat, [0, 1.6, 0.14]);
  tagRole(hearthOrb, 'hearth');

  // Heavy overhanging carved cornice above the basin
  tagRole(addPart(root, new THREE.BoxGeometry(1.16, 0.22, 1.16), stoneMidMat, [0, 2.21, 0]), 'stone_mid');

  // Tapered upper obelisk spire + pyramidion crown reaching ~3.28
  tagRole(
    addPart(root, new THREE.CylinderGeometry(0.38, 0.62, 0.64, 4), stoneLightMat, [0, 2.64, 0], [0, Math.PI / 4, 0]),
    'stone_light',
  );
  tagRole(
    addPart(root, new THREE.ConeGeometry(0.4, 0.38, 4), stoneMidMat, [0, 3.15, 0], [0, Math.PI / 4, 0]),
    'stone_mid',
  );

  // Vertical carved rune strips on front, sides, and back (>= 0.14 wide) that ignite on purification
  const frontRune = addPart(root, new THREE.BoxGeometry(0.14, 0.48, 0.14), runeMat, [0, 2.62, 0.34]);
  tagRole(frontRune, 'rune');

  const leftRune = addPart(root, new THREE.BoxGeometry(0.14, 0.56, 0.14), runeMat, [-0.5, 1.66, 0]);
  tagRole(leftRune, 'rune');

  const rightRune = addPart(root, new THREE.BoxGeometry(0.14, 0.56, 0.14), runeMat, [0.5, 1.66, 0]);
  tagRole(rightRune, 'rune');

  const backRune = addPart(root, new THREE.BoxGeometry(0.16, 0.66, 0.14), runeMat, [0, 1.66, -0.5]);
  tagRole(backRune, 'rune');

  // Apply initial dormant or purified state
  setLightShrinePurified(root, purified);

  return root;
}

export const PROGRESSION_MODEL_FACTORIES: Record<ProgressionAssetId, () => THREE.Group> = {
  poison_node: createPoisonNodeModel,
  light_shrine: createLightShrineModel,
};