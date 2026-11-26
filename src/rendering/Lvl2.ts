import * as THREE from 'three';

export type Lvl2AssetId = 'great_sunset_tree' | 'boss_ronin' | 'stone_lantern';

type Vec3Tuple = readonly [number, number, number];

/** Warm rim colour for the Ronin's Fresnel highlights (sunset gold-white). */
const RIM_COLOR = new THREE.Color(0.95, 0.8, 0.55);

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
  if (isEmissive) mesh.userData.isEmissive = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Injects a clean Fresnel rim highlight into a Phong material so the Ronin's
 * outer silhouette gleams against the sunset earth (mirrors the player rig).
 */
function addFresnelRim(material: THREE.MeshPhongMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: RIM_COLOR.clone() };
    shader.fragmentShader = 'uniform vec3 uRimColor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalEmissiveRadiance = emissive;',
      'vec3 totalEmissiveRadiance = emissive;\n'
        + 'totalEmissiveRadiance += pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), 2.2) * uRimColor;',
    );
  };
}

function createRimPhong(color: number, specular: number, shininess: number): THREE.MeshPhongMaterial {
  const material = new THREE.MeshPhongMaterial({
    color,
    specular,
    shininess,
    flatShading: false,
  });
  addFresnelRim(material);
  return material;
}

/** A translucent autumn canopy/bough material for the see-through branches. */
function createCanopyMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0.0,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    flatShading: true,
  });
}

// ============================================================================
// THE GREAT SUNSET TREE
// ============================================================================

/**
 * great_sunset_tree
 * Height: ~12.5 | A monumental ancient tree with a gnarled wide trunk + flared
 * roots and sprawling upper boughs. Everything above y = 2.6 is a translucent
 * ghost canopy flagged `skipDepthPrepass` so the camera sees straight through
 * the overhanging branches down onto the duel beneath.
 */
export function createGreatSunsetTree(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'great_sunset_tree';

  const trunkDark = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.94, flatShading: true });
  const trunkMid = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.92, flatShading: true });
  const canopyCrimson = createCanopyMaterial(0x7a2418);
  const canopyGold = createCanopyMaterial(0xa8641c);
  const canopyAmber = createCanopyMaterial(0xc8802a);

  // --- Flared gnarled trunk (solid, collider ~1.7 via AssetRegistry) ---
  const trunkPoints = [
    new THREE.Vector2(1.7, 0.0),
    new THREE.Vector2(1.35, 0.6),
    new THREE.Vector2(1.0, 1.5),
    new THREE.Vector2(0.82, 2.6),
    new THREE.Vector2(0.72, 3.4),
    new THREE.Vector2(0.6, 4.1),
  ];
  addPart(root, new THREE.LatheGeometry(trunkPoints, 8), trunkMid);

  // Root buttresses flaring outward at the base.
  const rootAngles = [0.25, 1.6, 3.0, 4.4, 5.8];
  for (const angle of rootAngles) {
    const rx = Math.sin(angle) * 1.2;
    const rz = Math.cos(angle) * 1.2;
    const rootMesh = addPart(root, new THREE.ConeGeometry(0.42, 1.6, 5), trunkDark, [rx, 0.4, rz]);
    rootMesh.lookAt(rx * 2.4, 0.05, rz * 2.4);
    rootMesh.rotateX(Math.PI / 2);
  }

  // --- Ghostly upper boughs + canopy (all skipDepthPrepass, translucent) ---
  const boughs = new THREE.Group();
  boughs.position.set(0, 3.4, 0);

  const boughGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.6, 6);
  const boughSpecs: readonly { pos: Vec3Tuple; rot: Vec3Tuple }[] = [
    { pos: [-1.6, 0.6, 0.4], rot: [0.2, 0, 0.8] },
    { pos: [1.6, 0.5, -0.3], rot: [-0.18, 0, -0.8] },
    { pos: [0.2, 0.6, 1.5], rot: [0.75, 0, 0.05] },
    { pos: [-0.3, 0.55, -1.6], rot: [-0.7, 0, -0.08] },
    { pos: [-2.2, 1.6, 1.3], rot: [0.3, 0, 0.55] },
    { pos: [2.2, 1.5, -1.2], rot: [-0.3, 0, -0.55] },
    { pos: [1.2, 1.4, 2.0], rot: [0.5, 0, -0.2] },
    { pos: [-1.4, 1.3, -2.0], rot: [-0.5, 0, 0.2] },
  ];
  for (const spec of boughSpecs) {
    const mesh = addPart(boughs, boughGeo, canopyCrimson, spec.pos, spec.rot);
    mesh.userData.skipDepthPrepass = true;
  }

  const canopyGeo = new THREE.DodecahedronGeometry(1.7, 0);
  const canopySpecs: readonly { pos: Vec3Tuple; mat: THREE.Material }[] = [
    { pos: [-2.6, 2.3, 0.9], mat: canopyCrimson },
    { pos: [2.6, 2.2, -0.9], mat: canopyGold },
    { pos: [0.4, 2.4, 2.6], mat: canopyAmber },
    { pos: [-0.6, 2.3, -2.7], mat: canopyCrimson },
    { pos: [-1.4, 3.4, 2.4], mat: canopyGold },
    { pos: [1.6, 3.3, -2.4], mat: canopyAmber },
    { pos: [0.0, 4.4, 0.3], mat: canopyGold },
    { pos: [-3.1, 3.0, -1.2], mat: canopyAmber },
    { pos: [3.0, 3.1, 1.2], mat: canopyCrimson },
  ];
  for (const spec of canopySpecs) {
    const mesh = addPart(boughs, canopyGeo, spec.mat, spec.pos);
    mesh.userData.skipDepthPrepass = true;
  }

  // A tall golden crown dome at the apex.
  const crown = addPart(boughs, new THREE.DodecahedronGeometry(1.9, 0), canopyGold, [0, 4.9, 0]);
  crown.userData.skipDepthPrepass = true;

  root.add(boughs);
  root.userData.swayGroup = boughs;
  root.userData.swayAmp = 0.035;
  root.userData.swaySpeed = 0.7;

  return root;
}

// ============================================================================
// THE RONIN — articulated katana / odachi boss
// ============================================================================

export interface RoninRig {
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hat: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
  weaponPivot: THREE.Group;
}

interface LegParts {
  thigh: THREE.Group;
  knee: THREE.Group;
}

interface ArmParts {
  upperArm: THREE.Group;
  elbow: THREE.Group;
}

function buildRoninLeg(side: number, cloth: THREE.Material, boot: THREE.Material): LegParts {
  const thigh = new THREE.Group();
  thigh.position.set(side * 0.17, 0, 0);
  addPart(thigh, new THREE.CapsuleGeometry(0.075, 0.26, 6, 10), cloth, [0, -0.22, 0]);

  const knee = new THREE.Group();
  knee.position.set(0, -0.42, 0);
  addPart(knee, new THREE.CapsuleGeometry(0.055, 0.26, 6, 10), boot, [0, -0.18, 0]);
  addPart(knee, new THREE.BoxGeometry(0.11, 0.16, 0.2), boot, [0, -0.4, 0.05]);
  thigh.add(knee);

  return { thigh, knee };
}

function buildRoninArm(side: number, cloth: THREE.Material, hand: THREE.Material): ArmParts {
  const upperArm = new THREE.Group();
  upperArm.position.set(side * 0.34, 0.39, 0);
  addPart(upperArm, new THREE.CapsuleGeometry(0.06, 0.18, 6, 10), cloth, [0, -0.16, 0]);

  const elbow = new THREE.Group();
  elbow.position.set(0, -0.31, 0);
  addPart(elbow, new THREE.CapsuleGeometry(0.05, 0.2, 6, 10), cloth, [0, -0.15, 0]);
  addPart(elbow, new THREE.SphereGeometry(0.055, 8, 6), hand, [0, -0.31, 0.06]);
  upperArm.add(elbow);

  return { upperArm, elbow };
}

/**
 * boss_ronin
 * Height: ~2.05 | Sleek articulated humanoid in a wide woven kasa hat, dark
 * indigo/charcoal haori coat with crimson sash accents, and a long gleaming
 * odachi (~2.3 units) held by a dedicated `weaponPivot`. The root stores a typed
 * `RoninRig` on `userData.roninRig` so EnemyLayer can animate idle / draw-coil /
 * swings / stagger poses.
 */
export function createRoninModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'boss_ronin';

  const coatMat = createRimPhong(0x1c2130, 0x8890a8, 18);
  const indigoMat = createRimPhong(0x262d44, 0x9aa2c0, 22);
  const sashMat = new THREE.MeshStandardMaterial({
    color: 0x7a1f22,
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0x2a080a,
    emissiveIntensity: 0.6,
    flatShading: true,
  });
  const hatMat = createRimPhong(0x6b5430, 0x9a7f4c, 16);
  const bootMat = createRimPhong(0x0f1218, 0x505a6a, 12);
  const handMat = createRimPhong(0x2b2f3c, 0x707890, 14);
  // Gleaming silver-white odachi blade (Standard so EnemyLayer can flash it).
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xe8f0f8,
    roughness: 0.14,
    metalness: 0.9,
    emissive: 0xcfe0f4,
    emissiveIntensity: 0.35,
  });
  const tsubaMat = new THREE.MeshStandardMaterial({
    color: 0xb8862a,
    roughness: 0.35,
    metalness: 0.7,
    emissive: 0x3a2404,
    emissiveIntensity: 0.5,
  });
  const hiltMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.7, metalness: 0.1 });

  // --- Hips (pelvis + crimson sash), origin at y = 0.92 ---
  const hips = new THREE.Group();
  hips.position.set(0, 0.92, 0);
  addPart(hips, new THREE.CylinderGeometry(0.19, 0.22, 0.24, 10), coatMat, [0, 0.04, 0]);
  addPart(hips, new THREE.CylinderGeometry(0.225, 0.225, 0.1, 10), sashMat, [0, 0.17, 0]);
  root.add(hips);

  // --- Torso (layered haori coat), child of hips ---
  const torso = new THREE.Group();
  torso.position.set(0, 0.14, 0);
  addPart(torso, new THREE.CylinderGeometry(0.21, 0.16, 0.38, 10), indigoMat, [0, 0.19, 0]);
  addPart(torso, new THREE.SphereGeometry(0.17, 12, 10), indigoMat, [0, 0.22, 0.09]);
  // Flared haori shoulder/back panels.
  addPart(torso, new THREE.ConeGeometry(0.3, 0.5, 8), coatMat, [0, 0.34, -0.06], [0.5, 0, 0]);
  addPart(torso, new THREE.SphereGeometry(0.14, 12, 10), indigoMat, [-0.28, 0.39, 0.02]);
  addPart(torso, new THREE.SphereGeometry(0.14, 12, 10), indigoMat, [0.28, 0.39, 0.02]);
  // Crimson sash band across the chest.
  addPart(torso, new THREE.CylinderGeometry(0.215, 0.215, 0.09, 10), sashMat, [0, 0.16, 0]);
  hips.add(torso);

  // --- Head + wide woven kasa hat ---
  const head = new THREE.Group();
  head.position.set(0, 0.44, 0);
  addPart(head, new THREE.SphereGeometry(0.15, 12, 10), handMat, [0, 0.1, 0.05]);
  const hat = new THREE.Group();
  hat.position.set(0, 0.2, 0);
  addPart(hat, new THREE.ConeGeometry(0.62, 0.42, 8), hatMat, [0, 0.16, 0]);
  addPart(hat, new THREE.CylinderGeometry(0.1, 0.16, 0.18, 8), hatMat, [0, 0.34, 0]);
  head.add(hat);
  torso.add(head);

  // --- Legs ---
  const leftLeg = buildRoninLeg(-1, coatMat, bootMat);
  const rightLeg = buildRoninLeg(1, coatMat, bootMat);
  hips.add(leftLeg.thigh);
  hips.add(rightLeg.thigh);

  // --- Arms ---
  const leftArm = buildRoninArm(-1, coatMat, handMat);
  const rightArm = buildRoninArm(1, coatMat, handMat);
  torso.add(leftArm.upperArm);
  torso.add(rightArm.upperArm);

  // --- Odachi (dedicated weaponPivot on the right hand) ---
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.03, -0.31, 0.1);
  weaponPivot.rotation.x = Math.PI;
  rightArm.elbow.add(weaponPivot);

  const odachi = new THREE.Group();
  // Long thin curved-tip steel blade (blade + swept point, ~2.3 total).
  const bladeBody = addPart(odachi, new THREE.BoxGeometry(0.1, 0.025, 1.9), bladeMat, [0, 0, 0.95]);
  const bladeTip = addPart(odachi, new THREE.ConeGeometry(0.05, 0.42, 4), bladeMat, [0, 0, 2.1], [Math.PI / 2, 0, 0]);
  bladeBody.userData.isBlade = true;
  bladeTip.userData.isBlade = true;
  // Golden tsuba guard.
  addPart(odachi, new THREE.CylinderGeometry(0.17, 0.17, 0.035, 8), tsubaMat, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
  // Dark wrapped hilt behind the guard.
  addPart(odachi, new THREE.CylinderGeometry(0.05, 0.055, 0.44, 6), hiltMat, [0, 0, -0.2]);
  addPart(odachi, new THREE.CylinderGeometry(0.06, 0.06, 0.07, 6), hiltMat, [0, 0, -0.44]);
  weaponPivot.add(odachi);

  const rig: RoninRig = {
    hips,
    torso,
    head,
    hat,
    leftLeg: leftLeg.thigh,
    rightLeg: rightLeg.thigh,
    leftKnee: leftLeg.knee,
    rightKnee: rightLeg.knee,
    leftArm: leftArm.upperArm,
    rightArm: rightArm.upperArm,
    leftElbow: leftArm.elbow,
    rightElbow: rightArm.elbow,
    weaponPivot,
  };
  root.userData.roninRig = rig;

  return root;
}

// ============================================================================
// WEATHERED STONE LANTERN (boundary marker)
// ============================================================================

/**
 * stone_lantern
 * A low weathered stone lantern / boundary stone with a soft warm amber glow,
 * scattered around the dueling clearing's edge in Level 2.
 */
export function createStoneLanternModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'stone_lantern';

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3328, roughness: 0.95, flatShading: true });
  const stoneLite = new THREE.MeshStandardMaterial({ color: 0x57503f, roughness: 0.9, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x3a2412,
    emissive: 0xff9a30,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });

  addPart(root, new THREE.CylinderGeometry(0.42, 0.6, 0.24, 6), stoneMat, [0, 0.12, 0]);
  addPart(root, new THREE.CylinderGeometry(0.22, 0.26, 0.6, 6), stoneLite, [0, 0.54, 0]);
  addPart(root, new THREE.CylinderGeometry(0.34, 0.3, 0.22, 6), stoneMat, [0, 0.9, 0]);
  addPart(root, new THREE.BoxGeometry(0.3, 0.3, 0.3), glowMat, [0, 1.18, 0], [0, 0.4, 0], true);
  addPart(root, new THREE.ConeGeometry(0.4, 0.28, 6), stoneMat, [0, 1.46, 0]);

  return root;
}

export const LVL2_MODEL_FACTORIES: Record<Lvl2AssetId, () => THREE.Group> = {
  great_sunset_tree: createGreatSunsetTree,
  boss_ronin: createRoninModel,
  stone_lantern: createStoneLanternModel,
};
