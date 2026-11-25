# ascii-engine

A lightweight browser ASCII-game engine built on **Three.js** and **Vite** (TypeScript).
Everything on screen — ground, grass, water, forest, buildings, characters, enemies, the
weather — is rendered as a grid of glyphs from a single character atlas, with a moody,
moonlit "wilted forest" aesthetic: the whole viewport stays crisp and readable (no
flashlight circle), while the river reads as a pure-black mirror reflecting a rippling
ASCII moon and drifting clouds.

The current scene is a **Riverside Village** in a top-down clearing: a dense swaying forest
framing a village clearing, cottages with glowing windows, a winding river that carries an
upstream **Blight** (a toxic zone to the north), a hooded traveler who fights **blighted
enemies** with a sword, and a dual **Corruption / Virtue** alignment that drives the Act 1
quest, *The Tainted Catch*.

---

## Running

```bash
npm install        # install dependencies
npm run dev        # start the Vite dev server (no type-checking)
npm run build      # tsc --noEmit + vite build  (type-checks, then bundles)
npm run preview    # serve the production build
```

The build step runs `tsc`, so `npm run build` is the quickest way to catch type errors.

---

## Controls

| Input                 | Action                                                            |
| --------------------- | ----------------------------------------------------------------- |
| WASD / arrows         | Move                                                              |
| Shift                 | Sprint (drains stamina)                                           |
| Mouse                 | Aim — the character and sword face the cursor                     |
| Left-click            | Swing the sword                                                   |
| Space                 | Dash (becomes **Blight Dash** once Corruption ≥ 25)               |
| Q                     | **Radiant Burst** — heal + stun/damage nearby (Virtue ≥ 25)        |
| E                     | Interact — talk to NPCs, absorb Poison Nodes, purify Light Shrines |
| I / Tab               | Open/close the **Gear & Quests** screen                           |
| Esc                   | Close the dialogue or Gear & Quests screen                        |
| Scroll wheel          | Zoom camera in / out                                              |

Walking into the river slows you down and drains health (cold water); solid ground
regenerates it. Sprinting drains stamina; standing still or walking regenerates it.

---

## Gear, Quests & Alignment

### Inventory (`I` / `Tab`)

The **Gear & Bag** tab shows the equipped weapon/armor, a live stat summary, and any bag
items (click to equip/swap). Equipping pauses the world (same as dialogue) and rewires the
stats immediately.

| Item             | Kind   | Stats                                                                 |
| ---------------- | ------ | --------------------------------------------------------------------- |
| Iron Sword       | weapon | 20 DMG, standard reach (equipped by default)                          |
| Lantern Blade    | weapon | 24 DMG, wider swing arc, warm-gold blade tint                         |
| Traveler Cloak   | armor  | no bonuses (equipped by default)                                      |
| River Leather    | armor  | +20% damage reduction, +20 max HP                                     |
| Blight Weave     | armor  | +12% move speed, +25 max stamina, −10% defense                        |

The extra starter items (Lantern Blade, River Leather, Blight Weave) begin in the bag so
swapping is testable immediately. Definitions live in `src/data/items.ts`; live combat
numbers are computed by `src/core/InventorySystem.ts` (`getCombatStats()`) and wired into
`PlayerStats`, `Engine` and `EnemyManager` each gameplay frame.

### Quests & alignment

The **Quests** tab tracks *The Tainted Catch* (its current step + an alignment note). Quest
updates surface only as brief fading toasts, plus the sidebar `[I]` button flashes when a
step changes. Corruption comes from absorbing **Poison Nodes**, Virtue from purifying **Light
Shrines** — each feeds the dual meter and unlocks Blight Dash / Radiant Burst respectively.

---

## The ASCII rendering pipeline

This is the core idea, and worth understanding before touching any layer.

1. **`GlyphAtlas`** bakes a charset (ordered roughly by visual density) into a
   `CanvasTexture` — white glyphs on transparent, tinted later in shaders. Every layer
   asks it for an index via `atlas.getIndex(char)`.
2. **Most layers** (`GroundLayer`, `GrassLayer`, `ForestLayer`, `Weapon`, `EnemyLayer`,
   `WeatherLayer`) are `THREE.InstancedMesh`es. Each instance carries per-cell attributes
   (`aGlyphIndex`, `aColor`, and sometimes extra like `aSwayWeight` / `aEmissive`); the
   fragment shader quantizes world/UV coordinates into a crisp glyph grid and samples the
   atlas cell for that glyph.
3. **3D-baked billboards** (`AsciiModelBaker` → `AsciiBillboardMaterial`) render a small 3D
   model once into a transparent render target, then a billboard shader quantizes that
   texture into a glyph grid and maps **luminance → density ramp** (`.,:;-=+*#%@`). This
   drives the player (`AsciiCharPass`), NPCs, buildings, shrines and enemies. The same
   character render target is read back each frame for the HUD portrait.

There is no per-pixel "text" — everything is glyph quads drawn with custom shaders.

---

## Directory map

```
ascii-engine/
├── index.html              # Vite entry; mounts #app, loads /src/main.ts
├── package.json            # deps (three) + scripts; @types/three & @types/node are devDeps
├── tsconfig.json           # strict flags — see "TypeScript gotchas" below
├── vite.config.ts
├── public/                 # favicon.svg, icons.svg (static assets)
└── src/
    ├── main.ts             # App entry: Engine + LevelManager + WeatherLayer
    ├── style.css           # page chrome, HUD + inventory modal styles
    │
    ├── core/               # Simulation: engine, input, combat, stats, terrain, levels
    │   ├── Engine.ts       # Game loop, camera, player movement, sword/dash/abilities,
    │   │                   #   dialogue + inventory routing, quest hooks
    │   ├── InputManager.ts # Keyboard/mouse/wheel state + one-shot "consume" APIs
    │   ├── CollisionSystem.ts  # Circle-collider resolve (push out of overlaps)
    │   ├── PlayerStats.ts  # Health/stamina, dash, damage mitigation + equipment bonuses
    │   ├── EnemyManager.ts # Live enemies + projectiles: AI, sword hits, player damage
    │   ├── InventorySystem.ts # Equipped weapon/armor + bag; getCombatStats()
    │   ├── ProgressionSystem.ts # Corruption/Virtue alignment + "The Tainted Catch" quest
    │   ├── LevelManager.ts # Builds terrain/layers/entities from serialized LevelData
    │   ├── TerrainGrid.ts  # CPU+GPU source of truth for river/blight/footpath terrain
    │   ├── world.ts        # World bounds, player radius, boulders, yToZ depth mapping
    │   └── types.ts        # Shared types (IRenderLayer, FrameContext, InputState, ...)
    │
    ├── data/               # Static data + asset registry
    │   ├── AssetRegistry.ts # Enemy archetypes + unified 3D model factories/radius/colliders
    │   ├── items.ts         # Weapon/armor item definitions (InventorySystem reads these)
    │   ├── levelTypes.ts    # Serialization types (LevelData, PlacedEntity, EntityKind)
    │   └── dialogue.json    # NPC dialogue buckets (quest/alignment-driven)
    │
    ├── rendering/          # All visual layers + shaders
    │   ├── GlyphAtlas.ts   # Character atlas texture + getIndex()
    │   ├── GroundLayer.ts  # Forest-floor grid (warm earth path, slate contours, moss)
    │   ├── GrassLayer.ts   # Swaying emerald grass + sparse wildflower/dewdrop pinpoints
    │   ├── WaterLayer.ts   # River shader: obsidian mirror, reflected moon/clouds/shore, blight
    │   ├── ForestLayer.ts  # Procedural trees + wind sway + trunk colliders + grounding shadows
    │   ├── BuildingLayer.ts # Legacy ASCII building sprites with emissive windows
    │   ├── WeatherLayer.ts # Rain, fireflies/spores, drifting petals
    │   ├── AtmosphereLayer.ts # Moonlit full-screen tint: soft edge vignette + blight haze
    │   ├── AsciiCharPass.ts # Offscreen 3D traveler → ASCII billboard + HUD portrait
    │   ├── AsciiModelBaker.ts # Shared offscreen bake rig (3D models → ASCII sprites)
    │   ├── AsciiBillboardMaterial.ts # ASCII billboard shader (luminance → glyph ramp)
    │   ├── ModelBillboardLayer.ts # Placed 3D-baked entities (buildings/NPCs/shrines/nodes)
    │   ├── EnemyLayer.ts   # Baked enemy billboards + projectile glyph cluster + health bars
    │   ├── Weapon.ts       # Top-down sword sprite (aims at mouse, swings)
    │   ├── Characters.ts   # 3D character model factories (player + NPCs)
    │   ├── Enemies.ts      # 3D enemy model factories (stalker / spitter / sentinel)
    │   ├── Weapons.ts      # 3D weapon model factories (iron sword / lantern blade)
    │   ├── Buildings.ts    # 3D building model factories
    │   ├── Nature.ts       # 3D nature-prop model factories (trees/boulders/clutter)
    │   └── Progression.ts  # 3D progression model factories (poison node / light shrine)
    │
    ├── ui/
    │   ├── Hud.ts          # Sidebar: portrait, vitals, abilities, [I] button, toasts
    │   ├── DialogueBox.ts  # Bottom-center dialogue overlay
    │   └── InventoryModal.ts # Gear & Bag + Quests overlay (toggled with I / Tab)
    │
    ├── editor/             # Dev-only level editor (tree-shaken out of prod by Vite)
    │   ├── EditorController.ts
    │   ├── EditorPanel.ts
    │   └── editorTypes.ts
    │
    └── tools/
        └── pngToAscii.ts   # CLI: PNG → ASCII-prop JSON (uses sharp)
```

---

## Key concepts & gotchas (for future sessions)

### Coordinate system & layering
- Top-down **orthographic** camera. `Engine.viewHeight = 28` world units tall (scroll-zoom
  clamps it to `[22, 38]`).
- The ground is a ±30-unit square; the playable clearing is clamped to a ~19-unit radius
  (`WORLD_BOUNDS` in `world.ts`). The player's collision radius is `PLAYER_RADIUS = 0.42`.
- **Z-order is Y-sorted**, not a fixed table. `yToZ(worldY)` (in `world.ts`) maps a world Y
  into the foreground band `[Y_TO_Z_MIN, Y_TO_Z_MAX] = [0.85, 1.95]` — smaller Y (further
  south, toward the bottom of the screen) gets a *higher* z and is drawn in front, so walking
  north of a tree hides the player behind it and walking south brings them in front. The
  character, sword, enemies, NPCs, trees and buildings all live in this band. Background
  layers (ground, grass, water, grounding shadows) sit below it; weather and atmosphere
  render above it.

### Terrain is a single source of truth
The river, blight and footpath/clearing fields live in **`TerrainGrid`** (the single CPU + GPU
source of truth). `LevelManager` serializes it as base64 in `LevelData` and rebuilds the
ground/grass/water layers and colliders from it, so reshaping terrain no longer requires
hand-syncing multiple copies.

### Entities & colliders
`LevelManager.buildBillboardPlacements()` turns every non-enemy `PlacedEntity` into a
`ModelBillboardPlacement` (baked 3D billboard + colliders from `AssetRegistry`), and
`rebuildColliders()` wires tree/building/billboard/boulder colliders into `CollisionSystem`.
Enemies are owned separately by `EnemyManager` (spawned from placed `enemy` entities).

### Combat & enemies
`EnemyManager` owns every live enemy and projectile and reads the player position from the
engine. Enemy archetypes (`blight_stalker` melee, `spore_spitter` ranged, `blight_sentinel`
mini-boss) are defined in `AssetRegistry`; their 3D models come from `Enemies.ts` and bake
into billboards via `EnemyLayer`. Sword damage, reach and arc come from the equipped weapon
(`InventorySystem.getCombatStats()`), and the `EnemyLayer` scales the Blight Stalker up and
renders Spore Spitter projectiles as a multi-glyph toxic orb.

### The character is two separate things
- **Body/aim** — `AsciiCharPass` renders a 3D traveler model (`player_traveler` from
  `Characters.ts`) offscreen into a `192×192` target, then a billboard shader quantizes it
  into a `34×42` glyph grid. Its facing formula is `atan2(aimX, -aimY)`.
- **Sword** — `Weapon` is a flat top-down sprite (not part of the rig). Its pivot is raised
  `+0.75` world units to hand/torso height, with an `orbitRadius` of ~0.5 so the hilt reads
  as held. Its rotation is `atan2(aimX, aimY)` (no negation). Both point at the same cursor;
  they use different conventions because one is a 3/4 billboard and the other a true
  top-down plane.

### HUD portrait read-back
`AsciiCharPass.render()` calls `readRenderTargetPixels` into a reusable buffer.
`gl.readPixels` is **bottom-up** while `putImageData` is **top-down**, so `Hud.drawPortrait`
flips the rows. There is an intentional 1-frame lag (the portrait shows the previous frame's
render).

### TypeScript gotchas (this repo is strict)
- `noUnusedLocals` / `noUnusedParameters` — dead code fails `tsc`.
- `verbatimModuleSyntax` — type-only imports **must** use `import type { ... }`.
- `erasableSyntaxOnly` — **no** enums, namespaces, or constructor parameter properties.
  Declare class fields, then assign them in the constructor (as the existing code does).

### The `pngToAscii` tool
`npx tsx src/tools/pngToAscii.ts <input.png> <out.json> [targetWidth]` converts an image to
an ASCII-prop JSON. It needs `sharp` (already a devDependency).
