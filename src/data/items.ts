// Typed item definitions for the player inventory. Items are pure data: the
// `InventorySystem` turns them into live combat stats, and `InventoryModal`
// renders them in the Gear & Bag screen.

export type ItemKind = 'weapon' | 'armor' | 'trinket';

/** Shared fields every item carries. */
interface ItemDef {
  id: string;
  kind: ItemKind;
  name: string;
  description: string;
}

export interface WeaponItemDef extends ItemDef {
  kind: 'weapon';
  /** Damage dealt per connecting sword swing. */
  damage: number;
  /** Blade reach from the traveler's centre, in world units. */
  reach: number;
  /** Half the angular width of the swing arc, in radians. */
  arcHalfAngle: number;
  /** Multiplicative tint applied to the rendered blade (1 = neutral). */
  tint: { r: number; g: number; b: number };
}

export interface ArmorItemDef extends ItemDef {
  kind: 'armor';
  /** Signed damage-reduction fraction (0.2 = take 80% damage, -0.1 = take 110%). */
  damageReduction: number;
  /** Flat bonus added to maximum health. */
  bonusMaxHp: number;
  /** Flat bonus added to maximum stamina. */
  bonusMaxStamina: number;
  /** Movement-speed multiplier (1 = base, 1.12 = +12%). */
  speedMultiplier: number;
}

export type EquippableItem = WeaponItemDef | ArmorItemDef;

export const ITEMS: Record<string, EquippableItem> = {
  // --- Weapons ---------------------------------------------------------------
  iron_sword: {
    id: 'iron_sword',
    kind: 'weapon',
    name: 'Iron Sword',
    description: 'A plain, reliable blade. 20 DMG, standard reach.',
    damage: 20,
    reach: 1.9,
    arcHalfAngle: Math.PI / 2.4,
    tint: { r: 1, g: 1, b: 1 },
  },
  lantern_blade: {
    id: 'lantern_blade',
    kind: 'weapon',
    name: 'Lantern Blade',
    description: 'A Light-blessed blade with a warm gold glow. 24 DMG, wider arc.',
    damage: 24,
    reach: 1.9,
    arcHalfAngle: Math.PI / 2.15,
    tint: { r: 1.0, g: 0.86, b: 0.52 },
  },

  // --- Armor ---------------------------------------------------------------
  traveler_cloak: {
    id: 'traveler_cloak',
    kind: 'armor',
    name: 'Traveler Cloak',
    description: 'Worn but familiar. No combat bonuses.',
    damageReduction: 0,
    bonusMaxHp: 0,
    bonusMaxStamina: 0,
    speedMultiplier: 1,
  },
  river_leather: {
    id: 'river_leather',
    kind: 'armor',
    name: 'River Leather',
    description: 'Cured hide. +20% damage reduction, +20 max HP.',
    damageReduction: 0.2,
    bonusMaxHp: 20,
    bonusMaxStamina: 0,
    speedMultiplier: 1,
  },
  blight_weave: {
    id: 'blight_weave',
    kind: 'armor',
    name: 'Blight Weave',
    description: 'Corrupted fibers. +12% move speed, +25 max ST, -10% DEF.',
    damageReduction: -0.1,
    bonusMaxHp: 0,
    bonusMaxStamina: 25,
    speedMultiplier: 1.12,
  },
};

export function getItem(id: string): EquippableItem | undefined {
  return ITEMS[id];
}
