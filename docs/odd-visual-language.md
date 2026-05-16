# ODD Visual Language

ODD graphics should feel like small collectible portals from the same strange desktop universe: handmade, luminous, slightly mischievous, and clearly useful.

## Core Style

- **Name:** ODD Diorama System
- **Mood:** cozy weird, polished toy-like, desktop surrealism, curious but not creepy
- **Shape language:** rounded squircle windows, soft bevels, layered paper/cardboard depth, tiny desktop props, subtle eye/portal motifs
- **Lighting:** dark plum base, warm peach highlights, cyan/magenta glow accents, rim-lit objects
- **Texture:** painted WebP card art with tactile grain, screen-glow bloom, soft shadows
- **Composition:** one central readable subject on a staged mini diorama, no literal UI chrome, no text inside images
- **Palette anchors:** ink plum `#12051f`, iris violet `#7a4cff`, electric cyan `#64f4ff`, peach `#ffb86b`, acid green `#b6ff6a`, paper cream `#fff4dc`

## Shop Chrome Tokens

The ODD Shop uses a layered token set under `.odd-panel.odd-shop`:

- **Surfaces:** `--odd-shop-surface-0..3` run from app background to elevated card.
- **Ink:** `--odd-shop-ink-0..3` run from hairline/border to primary text.
- **Type:** `--odd-shop-t-xxs..3xl` uses `clamp()` so headings and cards scale from the native-window minimum to XL desktop widths.
- **Radius/elevation:** `--odd-shop-r-s..xl` and `--odd-shop-e-1..3` keep cards, heroes, and modals consistent.
- **Motion:** `--odd-shop-dur-xs..l`, `--odd-shop-ease-out`, and `--odd-shop-ease-spring` are the only timing primitives new Shop chrome should use.
- **Department tints:** wallpaper `#ff3d9a`, icon sets `#00d1b2`, cursors `#ffd23f`, widgets `#6a5cff`, apps `#ff6d00`. Tints accent rails, heroes, focus rings, and editorial moments; neutral chrome stays neutral.

Dark mode is token-driven via `prefers-color-scheme` and the `data-odd-theme="light|dark|auto"` root attribute.

## Shop Glyph System

Rail icons live in `odd/assets/shop/glyphs.svg` as 24px line-art symbols (`g-wallpaper`, `g-icons`, `g-cursors`, `g-widgets`, `g-apps`, `g-install`, `g-settings`, `g-about`). Use `<svg><use href="...#symbol"></use></svg>` with an accessible label. Do not reintroduce emoji rail glyphs.

## Card Rules

Every catalog item gets a generated `card.webp` in its source folder. The catalog builder publishes these as `site/catalog/v1/cards/<type>-<slug>.webp` and exposes `card_url` in `registry.json`.

- **Scenes:** show the world as a destination poster without text. Keep the wallpaper subject recognizable, but frame it as a miniature desktop environment.
- **Icon sets:** show four or five physical icon tiles in that set's theme, staged on the same dark ODD surface.
- **Cursor sets:** show the native cursor with a living aura, motion wake, role-state sparks, and eye-dot personality. Do not imply the pack replaces the system cursor image.
- **Widgets:** show the widget as a tactile desktop object with one exaggerated feature.
- **Apps:** show the app's job as an object-based metaphor, not a screenshot.

## Negative Prompt

No text, no letters, no readable UI, no logos, no WordPress marks, no browser chrome, no photorealistic people, no horror, no gore, no weapons, no cluttered collage, no flat generic SaaS illustration, no off-brand pastel corporate gradients.
