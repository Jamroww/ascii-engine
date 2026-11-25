import * as THREE from 'three';
import { GlyphAtlas } from './GlyphAtlas';
import type { BakedAsciiSprite } from './AsciiModelBaker';

/**
 * World-space width of a single glyph cell. Keeping this constant means a small
 * boulder and a large cottage are quantized at the same world scale, so glyphs
 * never look chunky on one model and fine on another.
 */
export const GLYPH_WORLD_SIZE = 0.12;

const BILLBOARD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BILLBOARD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uBakedTex;
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  uniform vec2 uGlyphGrid;
  uniform float uFlash;
  uniform float uLumLift;
  uniform float uMinLuminance;
  uniform vec3 uTint;
  uniform float uTintStrength;
  uniform float uAlpha;

  varying vec2 vUv;

  void main() {
    // 1. Quantize UVs into a fine ASCII glyph grid.
    vec2 cellCoord = floor(vUv * uGlyphGrid);
    vec2 cellUv = fract(vUv * uGlyphGrid);
    vec2 sampleUv = (cellCoord + 0.5) / uGlyphGrid;

    // 2. Sample the baked offscreen 3D render.
    vec4 tex = texture2D(uBakedTex, sampleUv);
    if (tex.a < 0.1) discard;

    // 3. Map luminance to the density ramp (GlyphAtlas indices 1..11: .,:;-=+*#%@).
    //    uLumLift raises the floor so dark cloaks/coats quantize into legible
    //    silver-grey glyphs instead of crushing to black; uMinLuminance clamps
    //    the raw luminance floor outright so opaque pixels never fall below a
    //    mid-tone glyph.
    float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    lum = max(lum, uMinLuminance);
    lum = clamp((lum - 0.16 + uLumLift) * 1.7, 0.0, 1.0);
    float rampIndex = floor(lum * 10.0) + 1.0;

    float col = mod(rampIndex, uAtlasGrid.x);
    float row = floor(rampIndex / uAtlasGrid.x);
    vec2 atlasUv = vec2(
      (col + cellUv.x) / uAtlasGrid.x,
      1.0 - ((row + 1.0 - cellUv.y) / uAtlasGrid.y)
    );

    float glyphAlpha = texture2D(uAtlas, atlasUv).a;
    if (glyphAlpha < 0.15) {
      // Near-opaque dark silhouette backing behind non-transparent pixels so
      // grass and ground never bleed through the model.
      gl_FragColor = vec4(0.03, 0.04, 0.05, 0.92 * uAlpha);
      return;
    }

    // 4. Preserve the model's baked colour (warm windows/lanterns, toxic
    //    green/violet blight veins, golden shrines). A slight lift keeps the
    //    twilight palette legible against the dark ground.
    vec3 color = tex.rgb * 1.35;

    // White hit-flash.
    color = mix(color, vec3(1.0), uFlash);

    // Telegraph warning / corruption tint.
    color = mix(color, uTint, uTintStrength);

    gl_FragColor = vec4(color, uAlpha);
  }
`;

let placeholderTexture: THREE.Texture | null = null;

function getPlaceholderTexture(): THREE.Texture {
  if (!placeholderTexture) {
    const data = new Uint8Array([0, 0, 0, 0]);
    placeholderTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    placeholderTexture.needsUpdate = true;
  }
  return placeholderTexture;
}

/** Compute a `(cols, rows)` glyph grid that keeps glyph cells world-consistent. */
export function glyphGridFor(worldWidth: number, worldHeight: number): THREE.Vector2 {
  const cols = Math.max(2, Math.round(worldWidth / GLYPH_WORLD_SIZE));
  const rows = Math.max(2, Math.round(worldHeight / GLYPH_WORLD_SIZE));
  return new THREE.Vector2(cols, rows);
}

/**
 * Build a `THREE.ShaderMaterial` that turns a baked `BakedAsciiSprite` texture
 * into a shaded ASCII billboard. Every instance shares the same shader source,
 * so Three.js reuses the compiled program; only the uniforms differ per mesh.
 */
export function createBillboardMaterial(
  atlas: GlyphAtlas,
  sprite?: BakedAsciiSprite,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BILLBOARD_VERTEX_SHADER,
    fragmentShader: BILLBOARD_FRAGMENT_SHADER,
    uniforms: {
      uBakedTex: { value: sprite ? sprite.texture : getPlaceholderTexture() },
      uAtlas: { value: atlas.texture },
      uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      uGlyphGrid: {
        value: sprite ? glyphGridFor(sprite.worldWidth, sprite.worldHeight) : new THREE.Vector2(16, 16),
      },
      uFlash: { value: 0 },
      uLumLift: { value: 0 },
      uMinLuminance: { value: 0 },
      uTint: { value: new THREE.Color(1.0, 0.95, 0.55) },
      uTintStrength: { value: 0 },
      uAlpha: { value: 1 },
    },
    transparent: true,
    depthWrite: true,
  });
}
