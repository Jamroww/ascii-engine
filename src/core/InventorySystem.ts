import { getItem } from '../data/items';
import type { ArmorItemDef, WeaponItemDef } from '../data/items';

/** Combat numbers derived from the currently equipped weapon + armor. */
export interface CombatStats {
  swordDamage: number;
  damageReduction: number;
  bonusMaxHp: number;
  bonusMaxStamina: number;
  speedMultiplier: number;
  reach: number;
  arcHalfAngle: number;
  weaponTint: { r: number; g: number; b: number };
}

const STARTER_WEAPON = 'iron_sword';
const STARTER_ARMOR = 'traveler_cloak';

/**
 * Owns the player's equipped weapon/armor and bag. Pure state: it reads item
 * definitions from `data/items.ts` and exposes `getCombatStats()` so the engine
 * can wire live numbers into PlayerStats, the sword and EnemyManager.
 */
export class InventorySystem {
  equippedWeaponId = STARTER_WEAPON;
  equippedArmorId = STARTER_ARMOR;
  /** Item ids currently carried in the bag (available to equip). */
  bag: string[] = ['lantern_blade', 'river_leather', 'blight_weave'];

  get equippedWeapon(): WeaponItemDef {
    const item = getItem(this.equippedWeaponId);
    return (item ?? getItem(STARTER_WEAPON)) as WeaponItemDef;
  }

  get equippedArmor(): ArmorItemDef {
    const item = getItem(this.equippedArmorId);
    return (item ?? getItem(STARTER_ARMOR)) as ArmorItemDef;
  }

  /** Equip a weapon or armor from the bag, moving the current one back to the bag. */
  equip(itemId: string): void {
    const item = getItem(itemId);
    if (!item) return;

    if (item.kind === 'weapon') {
      if (this.equippedWeaponId === itemId) return;
      this.bag = this.bag.filter((id) => id !== itemId);
      this.bag.push(this.equippedWeaponId);
      this.equippedWeaponId = itemId;
    } else if (item.kind === 'armor') {
      if (this.equippedArmorId === itemId) return;
      this.bag = this.bag.filter((id) => id !== itemId);
      this.bag.push(this.equippedArmorId);
      this.equippedArmorId = itemId;
    }
  }

  getCombatStats(): CombatStats {
    const weapon = this.equippedWeapon;
    const armor = this.equippedArmor;
    return {
      swordDamage: weapon.damage,
      damageReduction: armor.damageReduction,
      bonusMaxHp: armor.bonusMaxHp,
      bonusMaxStamina: armor.bonusMaxStamina,
      speedMultiplier: armor.speedMultiplier,
      reach: weapon.reach,
      arcHalfAngle: weapon.arcHalfAngle,
      weaponTint: { ...weapon.tint },
    };
  }
}
