# Building a Cursor Set

Cursor sets are `.wp` bundles that theme the pointer across ODD Desktop Mode surfaces, ODD app frames, and classic wp-admin chrome for the current user. They behave like wallpapers and icon sets in the Shop: install from a catalog card, preview, then keep or roll back.

## Manifest

Create `_tools/catalog-sources/cursor-sets/<slug>/manifest.json`:

```json
{
  "type": "cursor-set",
  "slug": "example-cursors",
  "name": "Example Cursors",
  "label": "Example Cursors",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "A short sentence for the ODD Shop.",
  "category": "Example",
  "accent": "#38e8ff",
  "preview": "preview.svg",
  "cursors": {
    "default": { "file": "default.svg", "hotspot": [2, 2] },
    "pointer": { "file": "pointer.svg", "hotspot": [9, 3] },
    "text": { "file": "text.svg", "hotspot": [16, 16] }
  }
}
```

`default` is required. Supported cursor kinds are `default`, `pointer`, `text`, `grab`, `grabbing`, `crosshair`, `not-allowed`, `wait`, `help`, and `progress`.

## Asset Rules

- Cursor files must be passive SVG files next to `manifest.json`.
- Hotspots are `[x, y]` integer pairs, measured from the SVG's top-left corner.
- Use intrinsic `width` and `height` attributes as well as a `viewBox`; browsers are picky about SVG cursors.
- Keep each cursor simple. Small SVGs feel better and load faster.
- Do not include scripts, external images, `foreignObject`, event attributes, external `href` references, or scriptable URL values. Runtime install and catalog validation reject active SVG surfaces.
- Always provide a precise `text` cursor if your theme changes the default pointer heavily.

## Build And Validate

```bash
python3 _tools/build-catalog.py
odd/bin/validate-catalog
```

The builder emits `site/catalog/v1/bundles/cursor-set-<slug>.wp`, a Shop tile under `site/catalog/v1/icons/`, and the corresponding registry entry.
