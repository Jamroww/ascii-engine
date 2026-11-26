import * as THREE from 'three';
import { createIronSwordModel, createLanternBladeModel, type WeaponAssetId } from './Weapons';
import { disposeModelTree, setCastShadow } from './modelUtils';

const SWING_DURATION = 0.22;
const PARRY_VISUAL_DURATION = 0.24;

interface SwordMatRef {
  mat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

/**
 * Live 3D sword attached to the player's right-hand pivot. The combat contract
 * (`isSwinging`, `swingId`, `aimAngle`, `reach`, `arcHalfAngle`) is unchanged so
 * `EnemyManager.resolveSwordHits` keeps working without touching gameplay math.
 */
export class Weapon {
  /** How far the blade reaches from the traveler's centre, in world units. */
  public reach = 1.9;
  /** Half the angular width of the swing arc, in radians. */
  public arcHalfAngle = Math.PI / 2.4;

  private readonly handPivot: THREE.Group;
  private swordModel: THREE.Group;
  private equippedAssetId: WeaponAssetId = 'weapon_iron_sword';

  private angle = 0;
  private swinging = false;
  private swingT = 0;
  private swingCount = 0;
  private parrying = false;
  private parryT = 0;
  private swordMatRefs: SwordMatRef[] = [];

  constructor(handPivot: THREE.Group) {
    this.handPivot = handPivot;
    this.swordModel = createIronSwordModel();
    // Lay the blade flat so its +Y "up" points forward (+Z) at hand height.
    this.swordModel.rotation.x = -Math.PI / 2;
    setCastShadow(this.swordModel, true);
    this.handPivot.add(this.swordModel);
    this.cacheSwordMaterials();
  }

  private cacheSwordMaterials(): void {
    this.swordMatRefs = [];
    this.swordModel.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const mat = node.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        this.swordMatRefs.push({
          mat,
          baseEmissive: mat.emissive.clone(),
          baseIntensity: mat.emissiveIntensity,
        });
      }
    });
  }

  public update(
    dt: number,
    aimX: number,
    aimY: number,
    _worldX: number,
    _worldY: number,
  ): void {
    let dirX = aimX;
    let dirY = aimY;
    const len = Math.hypot(dirX, dirY);
    if (len > 0.001) {
      dirX /= len;
      dirY /= len;
      this.angle = Math.atan2(dirX, dirY);
    }

    if (this.parrying) {
      this.parryT += dt;
      const p = Math.min(1, this.parryT / PARRY_VISUAL_DURATION);
      const sweep = -0.85 + 1.7 * (p < 0.5 ? p * 2 : 2 - p * 2);
      this.handPivot.rotation.y = sweep;
      const glint = p < 0.3 ? 1 - p / 0.3 : 0;
      for (const ref of this.swordMatRefs) {
        ref.mat.emissive.setRGB(1, 1, 1);
        ref.mat.emissiveIntensity = glint * 3.2;
      }
      if (p >= 1) {
        this.parrying = false;
        for (const ref of this.swordMatRefs) {
          ref.mat.emissive.copy(ref.baseEmissive);
          ref.mat.emissiveIntensity = ref.baseIntensity;
        }
      }
    } else if (this.swinging) {
      this.swingT += dt;
      const p = Math.min(1, this.swingT / SWING_DURATION);
      const ease = p * (2 - p); // ease-out
      const sweep = -1.2 + 2.4 * ease;
      this.handPivot.rotation.y = sweep;
      if (p >= 1) this.swinging = false;
    } else {
      this.handPivot.rotation.y = 0;
    }
  }

  /** Swap between the iron sword and the lantern blade models. */
  public setWeaponAsset(assetId: WeaponAssetId): void {
    if (assetId === this.equippedAssetId) return;
    this.equippedAssetId = assetId;
    this.handPivot.remove(this.swordModel);
    disposeModelTree(this.swordModel);
    this.swordModel =
      assetId === 'weapon_lantern_blade' ? createLanternBladeModel() : createIronSwordModel();
    this.swordModel.rotation.x = -Math.PI / 2;
    setCastShadow(this.swordModel, true);
    this.handPivot.add(this.swordModel);
    this.cacheSwordMaterials();
  }

  /** Update the combat reach / arc from the equipped weapon. */
  public setCombat(reach: number, arcHalfAngle: number): void {
    this.reach = reach;
    this.arcHalfAngle = arcHalfAngle;
  }

  /** Recolour hook kept for API compatibility (tints are baked into the models). */
  public setTint(_r: number, _g: number, _b: number): void {}

  public swing(): void {
    if (!this.swinging) {
      this.swinging = true;
      this.swingT = 0;
      this.swingCount += 1;
    }
  }

  /** Begin the brief horizontal guard sweep + blade glint. */
  public parry(): void {
    this.parrying = true;
    this.parryT = 0;
  }

  /** True while a swing is in flight. */
  public get isSwinging(): boolean {
    return this.swinging;
  }

  /** Increments once per new swing so the combat system can dedupe hits. */
  public get swingId(): number {
    return this.swingCount;
  }

  /** The aim direction (radians, atan2 convention) of the current or last swing. */
  public get aimAngle(): number {
    return this.angle;
  }

  public dispose(): void {
    this.handPivot.remove(this.swordModel);
    disposeModelTree(this.swordModel);
  }
}
