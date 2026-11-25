import * as THREE from 'three';

export type EnemyAssetId = 'blight_stalker' | 'spore_spitter' | 'blight_sentinel';

// High-contrast palette tuned for luminance-to-ASCII glyph ramps
const PALETTE = {
  charcoal: 0x181c22,
  deepSlate: 0x262d36,
  barkUmber: 0x3b302a,
  midAsh: 0x525c68,
  deadwoodPale: 0xc9d1d9,
  fungalIvory: 0xe4dfd5,
  toxicGreen: 0x44ff66,
  blightViolet: 0xaa44ff,
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

/**
 * blight_stalker
 * Height: ~1.22 | Low, hunched quadruped hound with jagged pale spine ridges
 * and toxic green/violet glowing eyes (#44FF66 / #AA44FF).
 */
export function createBlightStalkerModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'blight_stalker';

  const hideMat = createFlatMaterial(PALETTE.charcoal);
  const muscleMat = createFlatMaterial(PALETTE.deepSlate);
  const boneMat = createFlatMaterial(PALETTE.deadwoodPale);
  const greenGlowMat = createEmissiveMaterial(PALETTE.toxicGreen, PALETTE.toxicGreen);
  const violetGlowMat = createEmissiveMaterial(PALETTE.blightViolet, PALETTE.blightViolet);

  // Four chunky legs planted at y = 0 (prowling stance)
  const pawGeo = new THREE.BoxGeometry(0.18, 0.14, 0.24);
  const frontLegGeo = new THREE.CylinderGeometry(0.09, 0.075, 0.56, 6);
  const rearShinGeo = new THREE.CylinderGeometry(0.085, 0.075, 0.44, 6);
  const haunchGeo = new THREE.DodecahedronGeometry(0.22, 0);

  // Front legs (+Z)
  addPart(root, pawGeo, hideMat, [-0.3, 0.07, 0.48]);
  addPart(root, frontLegGeo, muscleMat, [-0.28, 0.36, 0.42], [-0.18, 0, -0.08]);
  addPart(root, pawGeo, hideMat, [0.3, 0.07, 0.48]);
  addPart(root, frontLegGeo, muscleMat, [0.28, 0.36, 0.42], [-0.18, 0, 0.08]);

  // Rear haunches & legs (-Z)
  addPart(root, pawGeo, hideMat, [-0.32, 0.07, -0.5]);
  addPart(root, rearShinGeo, muscleMat, [-0.3, 0.28, -0.48], [0.22, 0, 0]);
  addPart(root, haunchGeo, hideMat, [-0.26, 0.54, -0.34]);

  addPart(root, pawGeo, hideMat, [0.32, 0.07, -0.5]);
  addPart(root, rearShinGeo, muscleMat, [0.3, 0.28, -0.48], [0.22, 0, 0]);
  addPart(root, haunchGeo, hideMat, [0.26, 0.54, -0.34]);

  // Hunched torso: massive forward shoulders tapering to a lean waist
  addPart(root, new THREE.DodecahedronGeometry(0.38, 0), hideMat, [0, 0.66, 0.26]);
  addPart(
    root,
    new THREE.CylinderGeometry(0.28, 0.2, 0.72, 7),
    muscleMat,
    [0, 0.56, -0.18],
    [Math.PI / 2 - 0.14, 0, 0],
  );

  // Oversized jagged spine ridges running from shoulders to rump (high-contrast silhouette)
  const ridgeShape = new THREE.Shape();
  ridgeShape.moveTo(-0.16, 0);
  ridgeShape.lineTo(0.14, 0);
  ridgeShape.lineTo(-0.08, 0.36);
  ridgeShape.closePath();
  const ridgeGeo = new THREE.ExtrudeGeometry(ridgeShape, {
    depth: 0.14,
    bevelEnabled: false,
  });

  // Rotated so the ridge runs along the Z-axis with tips swept backward (-Z)
  addPart(root, ridgeGeo, boneMat, [-0.07, 0.88, 0.34], [0, Math.PI / 2, 0]);
  addPart(root, ridgeGeo, boneMat, [-0.07, 0.82, 0.04], [0, Math.PI / 2, 0]);
  addPart(root, ridgeGeo, boneMat, [-0.07, 0.72, -0.24], [0, Math.PI / 2, 0]);

  // Thick barbed tail swept backward (-Z)
  addPart(root, new THREE.ConeGeometry(0.11, 0.58, 6), muscleMat, [0, 0.62, -0.74], [-1.25, 0, 0]);

  // Low, forward-jutting skull facing +Z
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.62, 0.72);
  headGroup.rotation.set(0.16, 0, 0);

  addPart(headGroup, new THREE.BoxGeometry(0.36, 0.28, 0.44), hideMat, [0, 0.06, 0]);
  // Snout + bright pale lower jaw/fangs for crisp facial contrast
  addPart(headGroup, new THREE.BoxGeometry(0.24, 0.16, 0.28), muscleMat, [0, 0.02, 0.26]);
  addPart(headGroup, new THREE.BoxGeometry(0.22, 0.12, 0.26), boneMat, [0, -0.1, 0.22], [0.22, 0, 0]);
  // Swept-back cranial horns
  const earGeo = new THREE.ConeGeometry(0.08, 0.26, 5);
  addPart(headGroup, earGeo, boneMat, [-0.16, 0.22, -0.12], [-0.65, 0, 0.3]);
  addPart(headGroup, earGeo, boneMat, [0.16, 0.22, -0.12], [-0.65, 0, -0.3]);

  // Toxic green main eyes + violet outer eye-cluster nodes (>= 0.13 diameter)
  const mainEyeGeo = new THREE.DodecahedronGeometry(0.075, 0);
  const subEyeGeo = new THREE.DodecahedronGeometry(0.065, 0);
  addPart(headGroup, mainEyeGeo, greenGlowMat, [-0.14, 0.1, 0.2], [0, 0, 0], true);
  addPart(headGroup, mainEyeGeo, greenGlowMat, [0.14, 0.1, 0.2], [0, 0, 0], true);
  addPart(headGroup, subEyeGeo, violetGlowMat, [-0.19, 0.14, 0.08], [0, 0, 0], true);
  addPart(headGroup, subEyeGeo, violetGlowMat, [0.19, 0.14, 0.08], [0, 0, 0], true);

  root.add(headGroup);

  return root;
}

/**
 * spore_spitter
 * Height: ~1.54 | Bulbous rooted fungal sac with oversized flared cap/mouth
 * and a pulsing violet/green inner core.
 */
export function createSporeSpitterModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'spore_spitter';

  const rootMat = createFlatMaterial(PALETTE.charcoal);
  const sacMat = createFlatMaterial(PALETTE.deepSlate);
  const capMat = createFlatMaterial(PALETTE.fungalIvory);
  const throatMat = createFlatMaterial(PALETTE.charcoal);
  const violetGlowMat = createEmissiveMaterial(PALETTE.blightViolet, PALETTE.blightViolet);
  const greenGlowMat = createEmissiveMaterial(PALETTE.toxicGreen, PALETTE.toxicGreen);

  // Five chunky splayed roots anchored cleanly at y = 0
  const rootGeo = new THREE.ConeGeometry(0.14, 0.56, 6);
  const rootAngles = [0, 1.25, 2.51, 3.77, 5.03];
  for (const angle of rootAngles) {
    const rx = Math.sin(angle) * 0.44;
    const rz = Math.cos(angle) * 0.44;
    const mesh = addPart(root, rootGeo, rootMat, [rx, 0.14, rz]);
    mesh.lookAt(rx * 2.2, 0.02, rz * 2.2);
    mesh.rotateX(Math.PI / 2);
  }

  // Bulbous fungal sac body (LatheGeometry)
  const sacPoints = [
    new THREE.Vector2(0.32, 0.06),
    new THREE.Vector2(0.56, 0.34),
    new THREE.Vector2(0.58, 0.64),
    new THREE.Vector2(0.38, 0.96),
    new THREE.Vector2(0.28, 1.08),
  ];
  addPart(root, new THREE.LatheGeometry(sacPoints, 9), sacMat);

  // Chunky exterior fungal pustules on the sac for silhouette break-up
  const sacNodeGeo = new THREE.DodecahedronGeometry(0.13, 0);
  addPart(root, sacNodeGeo, capMat, [-0.48, 0.52, 0.24]);
  addPart(root, sacNodeGeo, capMat, [0.5, 0.44, 0.16]);
  addPart(root, sacNodeGeo, greenGlowMat, [0.34, 0.64, 0.44], [0, 0, 0], true);
  addPart(root, sacNodeGeo, violetGlowMat, [-0.36, 0.38, 0.44], [0, 0, 0], true);

  // Oversized flared cap / spitter mouth tilted forward toward +Z
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, 1.04, 0.04);
  mouthGroup.rotation.set(0.42, 0, 0);

  // Thick, flared pale cap rim (LatheGeometry with inner wall thickness >= 0.14)
  const capPoints = [
    new THREE.Vector2(0.26, 0.0),
    new THREE.Vector2(0.54, 0.16),
    new THREE.Vector2(0.76, 0.36),
    new THREE.Vector2(0.72, 0.48),
    new THREE.Vector2(0.52, 0.46),
    new THREE.Vector2(0.36, 0.2),
    new THREE.Vector2(0.16, 0.14),
  ];
  addPart(mouthGroup, new THREE.LatheGeometry(capPoints, 9), capMat);

  // Dark inner throat recess so the glowing core pops with maximum contrast
  addPart(mouthGroup, new THREE.CylinderGeometry(0.34, 0.18, 0.22, 8), throatMat, [0, 0.24, 0]);

  // Pulsing violet + toxic green inner spore core
  const coreGroup = new THREE.Group();
  coreGroup.name = 'spore_core';
  coreGroup.position.set(0, 0.32, 0);
  addPart(coreGroup, new THREE.DodecahedronGeometry(0.24, 0), violetGlowMat, [0, 0.04, 0], [0, 0, 0], true);
  const podGeo = new THREE.DodecahedronGeometry(0.11, 0);
  addPart(coreGroup, podGeo, greenGlowMat, [-0.22, 0.08, 0.14], [0, 0, 0], true);
  addPart(coreGroup, podGeo, greenGlowMat, [0.22, 0.08, 0.14], [0, 0, 0], true);
  addPart(coreGroup, podGeo, greenGlowMat, [0, 0.12, -0.22], [0, 0, 0], true);
  mouthGroup.add(coreGroup);

  root.add(mouthGroup);

  return root;
}

/**
 * blight_sentinel
 * Height: ~2.22 | Tall, asymmetrical twisted root-golem (upstream mini-boss)
 * with a glowing toxic chest fissure and uneven heavy limbs.
 */
export function createBlightSentinelModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'blight_sentinel';

  const darkBarkMat = createFlatMaterial(PALETTE.charcoal);
  const rootWoodMat = createFlatMaterial(PALETTE.barkUmber);
  const paleBarkMat = createFlatMaterial(PALETTE.deadwoodPale);
  const greenGlowMat = createEmissiveMaterial(PALETTE.toxicGreen, PALETTE.toxicGreen);
  const violetGlowMat = createEmissiveMaterial(PALETTE.blightViolet, PALETTE.blightViolet);

  // Thick asymmetrical root-trunk legs planted at y = 0
  // Left leg (-X): heavy planted pillar
  addPart(root, new THREE.CylinderGeometry(0.18, 0.26, 0.86, 7), darkBarkMat, [-0.34, 0.43, 0.06], [0, 0, 0.06]);
  addPart(root, new THREE.BoxGeometry(0.32, 0.18, 0.46), rootWoodMat, [-0.38, 0.09, 0.16]);

  // Right leg (+X): braced slightly back
  addPart(root, new THREE.CylinderGeometry(0.15, 0.22, 0.84, 7), rootWoodMat, [0.32, 0.42, -0.08], [0.12, 0, -0.08]);
  addPart(root, new THREE.BoxGeometry(0.28, 0.18, 0.42), darkBarkMat, [0.36, 0.09, 0.02]);

  // Gnarled pelvis core
  addPart(root, new THREE.DodecahedronGeometry(0.38, 0), darkBarkMat, [0, 0.84, 0]);

  // Twisted upper torso built as two split bark halves framing a deep glowing fissure
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 1.32, 0);
  torsoGroup.rotation.set(0.08, -0.1, 0.06);

  // Left chest/back trunk slab (larger, hunched higher)
  addPart(torsoGroup, new THREE.BoxGeometry(0.46, 0.84, 0.56), darkBarkMat, [-0.28, 0.08, -0.02], [0, 0.14, 0.08]);
  // Right chest/back trunk slab (lower, twisted)
  addPart(torsoGroup, new THREE.BoxGeometry(0.4, 0.72, 0.5), rootWoodMat, [0.28, -0.02, 0.02], [0, -0.18, -0.06]);
  // Rear spine column sealing the back
  addPart(torsoGroup, new THREE.CylinderGeometry(0.28, 0.24, 0.88, 7), darkBarkMat, [0, 0.04, -0.22]);

  // Glowing toxic chest fissure (protruding cleanly along +Z between the split bark halves)
  addPart(torsoGroup, new THREE.BoxGeometry(0.18, 0.64, 0.26), greenGlowMat, [0, 0.02, 0.2], [0, 0, -0.14], true);
  addPart(torsoGroup, new THREE.DodecahedronGeometry(0.16, 0), violetGlowMat, [-0.02, 0.06, 0.26], [0, 0, 0], true);
  addPart(torsoGroup, new THREE.BoxGeometry(0.32, 0.14, 0.2), greenGlowMat, [-0.06, 0.2, 0.22], [0, 0, 0.35], true);

  // High-contrast deadwood shoulder crests (asymmetrical height for boss silhouette)
  // Massive left shoulder (-X) with twisted antler-branch reaching ~2.22
  addPart(torsoGroup, new THREE.DodecahedronGeometry(0.34, 0), paleBarkMat, [-0.56, 0.42, 0]);
  addPart(torsoGroup, new THREE.ConeGeometry(0.14, 0.56, 6), paleBarkMat, [-0.64, 0.72, -0.08], [-0.2, 0, 0.34]);
  addPart(torsoGroup, new THREE.ConeGeometry(0.1, 0.38, 5), rootWoodMat, [-0.46, 0.68, 0.06], [0.2, 0, -0.15]);

  // Lower right shoulder (+X)
  addPart(torsoGroup, new THREE.DodecahedronGeometry(0.26, 0), paleBarkMat, [0.5, 0.24, 0.04]);

  // Sunken gnarled head nestled unevenly between shoulders
  addPart(torsoGroup, new THREE.DodecahedronGeometry(0.25, 0), darkBarkMat, [0.06, 0.52, 0.14]);
  addPart(torsoGroup, new THREE.BoxGeometry(0.34, 0.16, 0.22), paleBarkMat, [0.06, 0.62, 0.18], [0.15, 0, -0.08]);
  // Glowing eyes
  const eyeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  addPart(torsoGroup, eyeGeo, greenGlowMat, [-0.04, 0.52, 0.32], [0, 0, 0], true);
  addPart(torsoGroup, eyeGeo, greenGlowMat, [0.16, 0.5, 0.32], [0, 0, 0], true);

  // Left arm (-X): colossal club-like root-maul hanging low
  const leftArmGroup = new THREE.Group();
  leftArmGroup.position.set(-0.68, 0.26, 0.06);
  leftArmGroup.rotation.set(0.14, 0, 0.12);
  addPart(leftArmGroup, new THREE.CylinderGeometry(0.16, 0.14, 0.58, 6), rootWoodMat, [0, -0.24, 0]);
  addPart(leftArmGroup, new THREE.CylinderGeometry(0.18, 0.26, 0.68, 7), darkBarkMat, [0, -0.78, 0.08], [0.22, 0, 0]);
  addPart(leftArmGroup, new THREE.DodecahedronGeometry(0.28, 0), paleBarkMat, [0, -1.06, 0.14]);
  // Glowing blight vein embedded in the club forearm
  addPart(leftArmGroup, new THREE.BoxGeometry(0.14, 0.42, 0.14), greenGlowMat, [-0.14, -0.78, 0.2], [0.22, 0, 0.1], true);
  torsoGroup.add(leftArmGroup);

  // Right arm (+X): gnarled reaching branch-claw angled forward (+Z)
  const rightArmGroup = new THREE.Group();
  rightArmGroup.position.set(0.6, 0.16, 0.06);
  rightArmGroup.rotation.set(0.48, 0, -0.18);
  addPart(rightArmGroup, new THREE.CylinderGeometry(0.12, 0.11, 0.54, 6), darkBarkMat, [0, -0.24, 0]);
  addPart(rightArmGroup, new THREE.CylinderGeometry(0.13, 0.2, 0.56, 6), rootWoodMat, [0, -0.72, 0.04], [0.26, 0, 0]);
  addPart(rightArmGroup, new THREE.DodecahedronGeometry(0.22, 0), paleBarkMat, [0, -0.98, 0.16]);
  // Glowing blight vein embedded in the reaching claw forearm
  addPart(rightArmGroup, new THREE.BoxGeometry(0.13, 0.4, 0.13), violetGlowMat, [0.1, -0.68, 0.18], [0.2, 0, 0.08], true);
  torsoGroup.add(rightArmGroup);

  root.add(torsoGroup);

  return root;
}

export const ENEMY_MODEL_FACTORIES: Record<EnemyAssetId, () => THREE.Group> = {
  blight_stalker: createBlightStalkerModel,
  spore_spitter: createSporeSpitterModel,
  blight_sentinel: createBlightSentinelModel,
};
