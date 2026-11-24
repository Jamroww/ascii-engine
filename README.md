# ascii-engine

A lightweight browser ASCII-game engine built on **Three.js** and **Vite** (TypeScript).
Everything on screen — ground, grass, water, forest, buildings, the player, weather — is
rendered as a grid of glyphs from a single character atlas, with a dark "wilted forest"
aesthetic.

The current scene is a **Riverside Village** in a top-down clearing: a dense swaying forest
framing a village clearing, a cottage with glowing windows, a winding river that carries an
upstream **Blight** (a toxic, glitching zone to the north), and a hooded traveler holding a
sword that aims at the mouse.

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

| Input           | Action                                             |
| --------------- | -------------------------------------------------- |
| WASD / arrows   | Move                                               |
| Shift           | Sprint (drains stamina)                            |
| Mouse           | Aim — the character and sword face the cursor      |
| Left-click / Space | Swing the sword                                  |
| Scroll wheel    | Zoom camera in / out                               |

Walking into the river slows you down and drains health (cold water); solid ground
regenerates it. Sprinting drains stamina; standing still or walking regenerates it.

---

## The ASCII rendering pipeline

This is the core idea, and worth understanding before touching any layer.

1. **`GlyphAtlas`** bakes a charset (ordered roughly by visual density) into a
   `CanvasTexture` — white glyphs on transparent, tinted later in shaders. Every layer
   asks it for an index via `atlas.getIndex(char)`.
2. **Most layers** (`GroundLayer`, `GrassLayer`, `ForestLayer`, `BuildingLayer`, `Weapon`,
   `WeatherLayer`) are `THREE.InstancedMesh`es. Each instance carries per-cell attributes
   (`aGlyphIndex`, `aColor`, and sometimes extra like `aSwayWeight` / `aEmissive`); the
   fragment shader quantizes world/UV coordinates into a crisp glyph grid and samples the
   atlas cell for that glyph.
3. **The character** (`AsciiCharPass`) is different: a procedural 3D rig is rendered
   offscreen to a 128×128 render target, then a billboard shader quantizes that texture
   into an 18×22 glyph grid and maps **luminance → density ramp**, so the traveler is a
   shaded ASCII figure rather than flat glyphs. The same render target is read back each
   frame for the HUD portrait.

There is no per-pixel "text" — everything is glyph quads drawn with custom shaders.

---

## Directory map

```
ascii-engine/
├── index.html              # Vite entry; mounts #app, loads /src/main.ts
├── package.json            # deps (three) + scripts; @types/three & @types/node are devDeps
├── tsconfig.json           # strict flags — see "TypeScript gotchas" below
├── public/                 # favicon.svg, icons.svg (static assets)
└── src/
    ├── main.ts             # App entry: builds the Riverside Village scene + layers
    ├── style.css           # page chrome + the HUD styles
    ├── counter.ts          # UNUSED — leftover Vite template demo (safe to delete)
    ├── assets/             # UNUSED — Vite template images (safe to delete)
    │
    ├── core/               # Engine, input, collision, stats, shared world layout
    │   ├── Engine.ts       # Game loop, camera (follow + zoom), player movement,
    │   │                   #   collision resolution, wading, aim, layer orchestration
    │   ├── InputManager.ts # Keyboard/mouse/wheel state; one-shot attack + wheel-delta APIs
    │   ├── CollisionSystem.ts # Circle-collider resolve (push player out of overlaps)
    │   ├── PlayerStats.ts  # Health + stamina (sprint drains stamina, river drains health)
    │   ├── world.ts        # ★ River SDF + boulders (CPU side), world bounds, player radius
    │   └── types.ts        # Shared types (IRenderLayer, FrameContext, InputState, ...)
    │
    ├── rendering/          # All visual layers + shaders
    │   ├── GlyphAtlas.ts   # Character atlas texture + getIndex()
    │   ├── GroundLayer.ts  # Forest-floor grid: dirt footpath, fallen leaves, moss variation
    │   ├── GrassLayer.ts   # Swaying grass blades (wind + player push); clears the footpath
    │   ├── WaterLayer.ts   # ★ River shader: flow, boulders+wakes, Blight, reflections
    │   ├── ForestLayer.ts  # ★ Procedural trees (pine/oak/wilted) + wind sway + shadows
    │   ├── BuildingLayer.ts# ★ Building sprites with emissive windows + light spill
    │   ├── WeatherLayer.ts # Rain, fireflies/spores, drifting petals (instanced particles)
    │   ├── AtmosphereLayer.ts # Screen-space-ish vignette + distance fog overlay
    │   ├── AsciiCharPass.ts # ★ Offscreen 3D character → ASCII billboard + portrait read-back
    │   └── Weapon.ts       # Top-down sword sprite that aims at the mouse and swings
    │
    ├── ui/
    │   └── Hud.ts          # DOM HUD: live portrait + health/stamina bars
    │
    └── tools/
        └── pngToAscii.ts   # CLI: convert a PNG → ASCII-prop JSON (uses sharp)
```

The `★` entries are the ones you'll touch most often when adding content.

---

## Key concepts & gotchas (for future sessions)

### Coordinate system & layering
- Top-down **orthographic** camera. `Engine.viewHeight = 20` world units tall
  (scroll-zoom clamps it to `[9, 30]`).
- The ground grid is `100×100` cells at `0.6` units → a ±30-unit square; the playable
  clearing is clamped to a ~19-unit radius (`WORLD_BOUNDS` in `world.ts`).
- **Z-order** (camera looks down −Z from z=10, higher z = drawn on top):

  | z          | layer                          |
  |------------|--------------------------------|
  | 0          | ground                         |
  | 0.2–0.5    | grass                          |
  | 0.51       | tree shadows                   |
  | 0.52       | building light-spill pools     |
  | 0.55       | water                          |
  | 0.92–1.12  | forest trees (sorted by Y)     |
  | 1.0        | buildings                      |
  | 1.2        | character                      |
  | 1.3        | weapon                         |
  | 2.5        | weather                        |
  | 5          | atmosphere (renderOrder 1000, depthTest off) |

  All materials are `transparent: true, depthWrite: false`, so three.js sorts them by z.

### The river is defined in THREE places — keep them in sync
The river channel (and its boulders) are duplicated, not shared:

1. **`src/core/world.ts`** — the CPU-side copy (`riverSDF`, `BOULDERS`, `isInRiver`), used
   by `Engine` for wading detection, boulder collision and world bounds.
2. **`WaterLayer`'s GLSL** — a hardcoded `riverSDF` + `rock1/rock2/rock3` for rendering.
3. **`ForestLayer.riverDistance()`** — a hardcoded mirror so trees don't spawn in the river.

If you reshape the river, change **all three** together. (`world.ts` still describes itself
as the single source of truth; that's aspirational — the shader no longer interpolates from
it after the village refactor.)

### Content layers (how to add stuff)
- **Trees** — `ForestLayer` builds one `InstancedMesh` from three procedural `TreeAsset`s
  (`createAncientPine`, `createGnarledOak`, `createWiltedTree`). Each cell carries a
  `swayWeight` (0 for trunk/roots, 0.15–1.0 for canopy) so the vertex shader only bends the
  crown. Placements come from `generateRiversideForest(seed)` — deterministic, ~220 trees,
  keeps the river + village clearing + northern trail clear. `getColliders()` exposes a
  trunk collider per tree.
- **Buildings** — `BuildingLayer` renders `BuildingAsset`s whose cells carry an `emissive`
  flag (glowing windows / lanterns) and a `lights` list that spawns additive light-spill
  pools onto the grass. See `createRiversideCottage()` for the layout-string convention.
- **Water lights** — `WaterLayer.setLights(WaterLight[])` feeds up to 8 world lights into
  the shader for extra reflections (e.g. cottage windows mirroring in the river).

### Collision is only partially wired
`Engine` owns a `CollisionSystem` and registers the **river boulders** (from `world.ts`).
`ForestLayer.getColliders()` and `BuildingLayer.getColliders()` exist, but **`main.ts` does
not currently call `engine.collision.addMany(...)`** for them — so trees and buildings don't
block movement yet. Wire them up when you want solid trunks/walls.

### The character is two separate things
- **Body/aim** — `AsciiCharPass` is a 3D rig rendered offscreen. It faces the mouse via
  `update(..., aimX, aimY, ...)`; its facing formula is `atan2(aimX, -aimY)` (note the
  negation — it matches the old movement-facing convention).
- **Sword** — `Weapon` is a flat top-down sprite (not part of the rig). Its rotation is
  `atan2(aimX, aimY)` (no negation). Both point at the same cursor; they just use different
  conventions because one is a 3/4 billboard and the other is a true top-down plane.

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

### Dead weight you can delete
- `src/counter.ts` and `src/assets/*` — unused Vite-template leftovers.
- The empty `mkdir` file at the repo root — stray.
