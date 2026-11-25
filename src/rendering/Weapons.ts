import * as THREE from 'three';

export type WeaponAssetId = 'weapon_iron_sword' | 'weapon_lantern_blade';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x1c2026,
  deepSlate: 0x2b323c,
  ironMid: 0x46505e,
  warmUmber: 0x5c4433,
  weatheredGold: 0xb08b4f,
  paleSteel: 0xdbe2ea,
  edgeHighlight: 0xf4f7fa,
  lanternGold: 0xffa61a,
} as const;

type Vec3Tuple = readonly [number, number, number];

function createFlatMaterial(
  color: number,
  roughness = 0.8,
  metalness = 0.15,
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
 * weapon_iron_sword
 * Height: ~1.48 | Chunky broad-bladed sword with heavy crossguard (top-down readable)
 * and a high-value bright edge highlight contrasting against a dark iron fuller.
 */
export function createIronSwordModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'weapon_iron_sword';

  const darkIronMat = createFlatMaterial(PALETTE.charcoal, 0.75, 0.25);
  const fullerMat = createFlatMaterial(PALETTE.ironMid, 0.65, 0.3);
  const gripMat = createFlatMaterial(PALETTE.warmUmber, 0.9, 0.05);
  const edgeHighlightMat = createFlatMaterial(PALETTE.edgeHighlight, 0.35, 0.25);

  // Heavy faceted pommel resting at y = 0
  addPart(root, new THREE.DodecahedronGeometry(0.11, 0), darkIronMat, [0, 0.11, 0]);

  // Chunky wrapped grip
  addPart(root, new THREE.CylinderGeometry(0.068, 0.072, 0.28, 6), gripMat, [0, 0.31, 0]);

  // Wide, thick crossguard with flared end caps for crisp top-down & side silhouettes
  addPart(root, new THREE.BoxGeometry(0.62, 0.14, 0.2), darkIronMat, [0, 0.48, 0]);
  const capGeo = new THREE.BoxGeometry(0.14, 0.18, 0.22);
  addPart(root, capGeo, fullerMat, [-0.32, 0.48, 0]);
  addPart(root, capGeo, fullerMat, [0.32, 0.48, 0]);

  // Broad outer blade silhouette rendered in bright steel for subtle edge highlight
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.17, 0);
  bladeShape.lineTo(0.17, 0);
  bladeShape.lineTo(0.15, 0.7);
  bladeShape.lineTo(0, 0.94);
  bladeShape.lineTo(-0.15, 0.7);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.12,
    bevelEnabled: false,
  });
  addPart(root, bladeGeo, edgeHighlightMat, [0, 0.54, -0.06]);

  // Recessed-width, thicker central iron spine so bright edges frame both sides cleanly
  addPart(root, new THREE.BoxGeometry(0.18, 0.68, 0.14), fullerMat, [0, 0.89, 0]);
  addPart(
    root,
    new THREE.ConeGeometry(0.11, 0.22, 4),
    fullerMat,
    [0, 1.32, 0],
    [0, Math.PI / 4, 0],
  );

  return root;
}

/**
 * weapon_lantern_blade
 * Height: ~1.60 | Upgraded Light-path broadsword with winged guard, hanging hilt
 * lantern charm, and a warm golden emissive blade core.
 */
export function createLanternBladeModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'weapon_lantern_blade';

  const darkIronMat = createFlatMaterial(PALETTE.charcoal, 0.7, 0.3);
  const goldTrimMat = createFlatMaterial(PALETTE.weatheredGold, 0.55, 0.35);
  const gripMat = createFlatMaterial(PALETTE.warmUmber, 0.88, 0.05);
  const paleBladeMat = createFlatMaterial(PALETTE.paleSteel, 0.4, 0.25);
  const goldenGlowMat = createEmissiveMaterial(PALETTE.lanternGold, PALETTE.lanternGold);

  // Heavy hex pommel resting at y = 0
  addPart(root, new THREE.CylinderGeometry(0.11, 0.09, 0.14, 6), goldTrimMat, [0, 0.07, 0]);

  // Chunky grip
  addPart(root, new THREE.CylinderGeometry(0.07, 0.075, 0.28, 6), gripMat, [0, 0.26, 0]);

  // Central lantern-housing guard block with glowing hearth core
  addPart(root, new THREE.BoxGeometry(0.24, 0.22, 0.24), darkIronMat, [0, 0.48, 0]);
  addPart(root, new THREE.BoxGeometry(0.14, 0.14, 0.28), goldenGlowMat, [0, 0.48, 0], [0, 0, 0], true);

  // Swept winged crossguard arms
  const wingGeo = new THREE.BoxGeometry(0.32, 0.14, 0.18);
  addPart(root, wingGeo, goldTrimMat, [-0.26, 0.52, 0], [0, 0, -0.24]);
  addPart(root, wingGeo, goldTrimMat, [0.26, 0.52, 0], [0, 0, 0.24]);

  // Lantern-infused charm hanging beneath the right guard wing (+X)
  const charmGroup = new THREE.Group();
  charmGroup.position.set(0.38, 0.3, 0);
  addPart(charmGroup, new THREE.ConeGeometry(0.11, 0.12, 6), darkIronMat, [0, 0.14, 0]);
  addPart(charmGroup, new THREE.CylinderGeometry(0.09, 0.08, 0.12, 6), darkIronMat, [0, -0.14, 0]);
  addPart(charmGroup, new THREE.DodecahedronGeometry(0.095, 0), goldenGlowMat, [0, 0, 0], [0, 0, 0], true);
  root.add(charmGroup);

  // Upgraded broad pale-steel blade silhouette
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.2, 0);
  bladeShape.lineTo(0.2, 0);
  bladeShape.lineTo(0.18, 0.76);
  bladeShape.lineTo(0, 1.04);
  bladeShape.lineTo(-0.18, 0.76);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.12,
    bevelEnabled: false,
  });
  addPart(root, bladeGeo, paleBladeMat, [0, 0.56, -0.06]);

  // Warm golden emissive core running up the blade center (protrudes on Z to prevent Z-fighting)
  addPart(root, new THREE.BoxGeometry(0.14, 0.74, 0.15), goldenGlowMat, [0, 0.94, 0], [0, 0, 0], true);
  addPart(
    root,
    new THREE.ConeGeometry(0.1, 0.24, 4),
    goldenGlowMat,
    [0, 1.4, 0],
    [0, Math.PI / 4, 0],
    true,
  );

  return root;
}

export const WEAPON_MODEL_FACTORIES: Record<WeaponAssetId, () => THREE.Group> = {
  weapon_iron_sword: createIronSwordModel,
  weapon_lantern_blade: createLanternBladeModel,
};