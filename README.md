# ascii-engine

A lightweight browser ASCII-game engine built on **Three.js** and **Vite** (TypeScript).
The 3D world is rendered with a tilted camera and then re-quantized by a screen-space ASCII
pass into a grid of glyphs from a single character atlas, with a moody, moonlit "wilted
forest" aesthetic: the whole viewport stays crisp and readable (no flashlight circle). The
river reads as a smooth high-res mirror — a reflected cratered moon, drifting clouds and
player wading ripples — that the ASCII pass sculpts into crisp glyphs, while razor-sharp,
depth-tested 3D grass is composited on top.

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
   `CanvasTexture` — white glyphs on transparent, tinted later in shaders.
2. **The 3D world** is a real `THREE.Scene`: 3D models (player, NPCs, enemies, buildings,
   shrines, nodes, trees, boulders) as `MeshStandardMaterial` meshes, plus shader-driven
   `GroundLayer` / `WaterLayer` planes. A tilted 3/4 orthographic camera renders the whole
   scene into an offscreen target (`sceneRT`) each frame.
3. **`AsciiPostProcess`** re-quantizes `sceneRT` into a uniform 7×10-pixel glyph grid. It
   first applies an exposure + soft tone map + **Linear→sRGB** curve, then maps perceptual
   luminance onto the glyph ramp and tints each glyph with a hue-preserving chroma. It then
   composites the post-ASCII passes on top of that result:
   - a **depth-only prepass** writes the opaque world's hardware Z-buffer, so
     **`GrassLayer`** renders as razor-sharp, depth-tested 3D blades that hide behind trees,
     buildings and the player;
   - **`WeatherLayer`** (rain / fireflies / blight spores) and the editor's collider overlay
     are drawn last, cleanly above the composite.

There is no per-pixel "text" — everything is glyph quads drawn with custom shaders, plus the
raw 3D grass blades and weather sprites composited on top.

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
    │   ├── world.ts        # World bounds, player radius, boulders
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
    │   ├── AsciiPostProcess.ts # Screen-space quantizer (sRGB curve) + depth/grass/weather compositing
    │   ├── GroundLayer.ts  # Forest-floor shader (warm earth path, slate contours, moss)
    │   ├── WaterLayer.ts   # High-res mirror water: reflected moon/clouds, wading ripples, blight
    │   ├── GrassLayer.ts   # Razor-sharp depth-tested 3D blades + wildflower specks
    │   ├── ForestLayer.ts  # Procedural 3D trees + wind sway + trunk colliders
    │   ├── BuildingLayer.ts # Legacy ASCII building sprites with emissive windows
    │   ├── WorldModelsLayer.ts # Unified 3D models (buildings/NPCs/shrines/nodes/props) + lights
    │   ├── WeatherLayer.ts # Rain, fireflies/spores, drifting petals (post-composite overlay)
    │   ├── Player3D.ts     # 3D traveler model + offscreen HUD portrait
    │   ├── EnemyLayer.ts   # 3D enemies + glowing projectile spheres
    │   ├── Weapon.ts       # 3D sword attached to the player's hand pivot
    │   ├── Characters.ts   # 3D character model factories (player + NPCs)
    │   ├── Enemies.ts      # 3D enemy model factories (stalker / spitter / sentinel)
    │   ├── Weapons.ts      # 3D weapon model factories (iron sword / lantern blade)
    │   ├── Buildings.ts    # 3D building model factories
    │   ├── Nature.ts       # 3D nature-prop model factories (trees/boulders/clutter)
    │   ├── Progression.ts  # 3D progression model factories (poison node / light shrine)
    │   └── modelUtils.ts   # Dispose / shadow-flag helpers for model subtrees
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
- Tilted 3/4 **orthographic** camera, high above and to the south, looking down-north
  (`CAMERA_HEIGHT` / `CAMERA_BACK` in `Engine.ts`). `Engine.viewHeight` (default 26) is the
  world-space height; scroll-zoom clamps it to `[18, 36]`.
- The ground is a ±30-unit square; the playable clearing is clamped to a ~19-unit radius
  (`WORLD_BOUNDS` in `world.ts`). The player's collision radius is `PLAYER_RADIUS = 0.42`.
- **Depth is real hardware Z**, not a hand-sorted band. Gameplay `(x, y)` maps to 3D
  `(x, 0, -y)`, and the tilted camera + depth buffer make trees, buildings and the player
  occlude each other and the grass correctly. The composite order each frame is:
  ASCII-quantized world → depth-tested grass → weather → editor overlay.

### Terrain is a single source of truth
The river, blight and footpath/clearing fields live in **`TerrainGrid`** (the single CPU + GPU
source of truth). `LevelManager` serializes it as base64 in `LevelData` and rebuilds the
ground/grass/water layers and colliders from it, so reshaping terrain no longer requires
hand-syncing multiple copies.

### Entities & colliders
`LevelManager.buildWorldModelPlacements()` turns every non-enemy `PlacedEntity` that is a 3D
model asset into a `WorldModelPlacement` (a `THREE.Group` + colliders from `AssetRegistry`),
and `rebuildColliders()` wires tree/building/model/boulder colliders into `CollisionSystem`.
Enemies are owned separately by `EnemyManager` (spawned from placed `enemy` entities).

### Combat & enemies
`EnemyManager` owns every live enemy and projectile and reads the player position from the
engine. Enemy archetypes (`blight_stalker` melee, `spore_spitter` ranged, `blight_sentinel`
mini-boss) are defined in `AssetRegistry`; their 3D models come from `Enemies.ts` and are
rendered directly by `EnemyLayer` (with emissive hit-flash/telegraph pulses and glowing
projectile spheres). Sword damage, reach and arc come from the equipped weapon
(`InventorySystem.getCombatStats()`), and `EnemyLayer` scales the Blight Stalker up.

### The character is two separate things
- **Body/aim** — `Player3D` places the 3D traveler model at `(x, 0, -y)` and rotates it to
  face the cursor (`atan2(aimX, -aimY)`).
- **Sword** — `Weapon` attaches a 3D sword model to the player's raised `handPivot`; it lays
  flat (`rotation.x = -PI/2`) and sweeps around Y on a swing. The sword's combat aim angle
  uses the `atan2(aimX, aimY)` convention, so it and the body use different negations.

### HUD portrait read-back
`Player3D.renderPortrait()` renders a second traveler rig into a 64×64 offscreen target and
reads it back with `readRenderTargetPixels`. `gl.readPixels` is **bottom-up** while
`putImageData` is **top-down**, so `Hud.drawPortrait` flips the rows. There is an intentional
1-frame lag (the portrait shows the previous frame's render).

### Multi-pass rendering (don't regress the clear order)
`AsciiPostProcess.render` draws several passes into one frame with `renderer.autoClear`
disabled and every clear explicit. Two things are easy to get wrong:
- **Clear order matters.** `sceneRT` and the screen are cleared with `clear(true, true, true)`
  before the ASCII pass; the depth prepass clears depth **only** (`clearDepth()`), and the
  grass/weather/overlay passes clear nothing.
- **`scene.background` as a `Color` forces a clear.** three.js sets `forceClear` for a Color
  background, so re-rendering `worldScene` (whose background is black) would wipe the colour
  buffer even with `autoClear = false`. The depth prepass temporarily nulls
  `worldScene.background` so the ASCII result survives underneath the grass/weather overlays.

### TypeScript gotchas (this repo is strict)
- `noUnusedLocals` / `noUnusedParameters` — dead code fails `tsc`.
- `verbatimModuleSyntax` — type-only imports **must** use `import type { ... }`.
- `erasableSyntaxOnly` — **no** enums, namespaces, or constructor parameter properties.
  Declare class fields, then assign them in the constructor (as the existing code does).

### The `pngToAscii` tool
`npx tsx src/tools/pngToAscii.ts <input.png> <out.json> [targetWidth]` converts an image to
an ASCII-prop JSON. It needs `sharp` (already a devDependency).
