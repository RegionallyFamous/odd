# Building A Cursor Set

Cursor sets are `.wp` bundles that theme ODD's living cursor layer. They do **not** replace the browser cursor image. The real cursor stays native (`default`, `pointer`, `text`, `grab`, and friends), while ODD draws a lightweight, pointer-events-none aura above Desktop Mode, ODD app frames, and classic wp-admin chrome.

## Manifest

Create `_tools/catalog-sources/cursor-sets/<slug>/manifest.json`:

```json
{
  "type": "cursor-set",
  "slug": "example-cursors",
  "name": "Example Cursor Effects",
  "label": "Example Effects",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "A short sentence for the ODD Shop.",
  "category": "Example",
  "accent": "#38e8ff",
  "preview": "preview.svg",
  "effects": {
    "accent": "#38e8ff",
    "spark": "#ff4f8b",
    "warm": "#f6b73c",
    "ink": "#19091f",
    "recipe": "gel-pop"
  },
  "cursors": {}
}
```

`cursors` is kept as an empty compatibility field. Do not include cursor image files, hotspots, or `url(...)` cursor metadata.

## Effect Tokens

| Field | Required | Notes |
|-------|----------|-------|
| `accent` | no | Primary aura, wake, text vein, and catalog accent color. Falls back to the top-level `accent`. |
| `spark` | no | Pointer sparkle, not-allowed slash, and high-energy states. |
| `warm` | no | Busy orbit, grab/grabbing warmth, and pressure states. |
| `ink` | no | Tiny eye/pupil dot in the aura layer. |
| `recipe` | no | One of `signal-bloom`, `gel-pop`, `paper-sparks`, `solar-orbit`, or `moonlight-focus`. Chooses the aura shape/motion treatment. |

Color token values must be `#hex`. Keep the palette legible over light and dark admin surfaces; the layer is intentionally small and translucent.

## Asset Rules

- `preview.svg` is catalog preview art only. It should show the native pointer with the living aura/effects, not a sheet of SVG cursor replacements.
- Preview SVGs must be passive XML: no scripts, event attributes, external images, `foreignObject`, external `href` references, external `url(...)`, or embedded media.
- Optional `card.webp` can provide richer Shop art. It should feature the living layer states included in the pack.
- Do not ship `default.svg`, `pointer.svg`, hotspot metadata, or any other cursor image files.

## Build And Validate

```bash
odd/bin/validate-cursor-sets
python3 _tools/build-catalog.py
odd/bin/validate-catalog
```

The builder emits `site/catalog/v1/bundles/cursor-set-<slug>.wp`, a Shop tile under `site/catalog/v1/icons/`, and the corresponding registry entry.
