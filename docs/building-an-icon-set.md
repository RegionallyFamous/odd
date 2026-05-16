# Building an ODD Icon Set

> One of four ODD author guides. Siblings: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building a Widget](building-a-widget.md).

An icon set is a native Desktop Mode raster image URL feed: a themed
set of PNG/WebP files for desktop shortcuts, the desktop Recycle Bin,
and file shortcut previews. Drop a `.wp` on the ODD Shop
and ODD validates the manifest, verifies each image, copies the set into
`wp-content/uploads/odd/icon-sets/`, and makes it selectable from the Icon
Sets department - no WordPress plugin, no custom PHP.

ODD does not replace Desktop Mode's rail, dock, or renderer implementations.
It saves the user's selected set and gives Desktop Mode themed image URLs for
desktop shortcuts, file shortcut previews, and the ODD Shop native-window
launcher. The rail, dock, and Desktop Mode system actions stay on host-default
icons.

Icon sets ship **no JavaScript**, so they install without a consent
prompt.

---

## Anatomy

```
my-icons.wp
├── manifest.json
├── preview.webp           ← optional - 480x270 hero shown on the Shop card
└── icons/
    ├── odd.webp
    ├── my-wordpress.webp
    ├── content-graph.webp
    ├── recycle-bin.webp
    └── fallback.webp
```

Paths inside `icons/` can be anything — the manifest maps the
required semantic keys to paths of your choosing. ODD requires the visible
Desktop Mode desktop shortcut keys: ODD, My WordPress, Content Graph, Recycle
Bin, plus a generic fallback. Compact rail/system action icons are not part of
ODD icon sets.

Icon files must be PNG or WebP images. Use PNG when you need crisp
transparency; use WebP when the art is painted, textured, or otherwise
benefits from better compression.

## Manifest

```json
{
    "type":        "icon-set",
    "slug":        "my-icons",
    "name":        "My Icons",
    "label":       "My Icons",
    "version":     "1.0.0",
    "category":   "My Icons",
    "accent":      "#ff7a3c",
    "description": "Warm hand-drawn icons with a coffee-stained palette.",
    "preview":     "preview.webp",
    "icons": {
        "odd":           "icons/odd.webp",
        "my-wordpress":  "icons/my-wordpress.webp",
        "content-graph": "icons/content-graph.webp",
        "recycle-bin": "icons/recycle-bin.webp",
        "fallback":   "icons/fallback.webp"
    }
}
```

| Field         | Required | Purpose                                                                    |
|---------------|----------|----------------------------------------------------------------------------|
| `type`        | yes      | Must be `"icon-set"`.                                                      |
| `slug`        | yes      | `^[a-z0-9-]+$`, globally unique across all bundle types.                   |
| `name`        | yes      | Display name in the Shop quilt + hero.                                     |
| `label`       | no       | Falls back to `name`.                                                      |
| `version`     | yes      | Semver-ish string.                                                         |
| `category`   | no       | Optional grouping label for Shop shelves and catalog tooling. |
| `accent`      | yes      | `#hex` used for Shop accents and catalog previews.|
| `description` | no       | Longer copy shown on the detail sheet.                                     |
| `preview`     | no       | Relative path to a PNG/WebP hero (falls back to the first declared icon).|
| `icons`       | yes      | Map of all required visible desktop shortcut keys to relative PNG/WebP paths. |

### Why these keys?

The native Desktop Mode icon filters map Desktop Mode's visible desktop
shortcut ids, window ids, and titles to stable logical keys via
`oddout_icons_slug_to_key()`:

| Key           | Required | Maps to                                   |
|---------------|----------|-------------------------------------------|
| `odd` | yes | ODD Shop launcher (`odd`), usually animated and recolored per set |
| `my-wordpress` | yes     | My WordPress (`desktop-mode-my-wordpress`) |
| `content-graph` | yes   | Content Graph (`desktop-mode-content-graph`) |
| `recycle-bin` | yes      | WP Desktop Mode Recycle Bin (`desktop-mode-recycle-bin`) |
| `fallback`    | yes      | Anything unmapped                         |

If the active set can't provide one of the logical keys, ODD reaches
for the set's own `fallback`, then for whatever WP Desktop Mode served
before icon swapping kicked in. There is no plugin-bundled "Default"
set any more; ODD 1.0 installs visual content from the catalog.

## Image rules

Every icon image is validated at install time. An image is rejected if
any of the following fail:

- Extension is `.png` or `.webp`.
- File bytes parse as the same image type declared by the extension.
- Image is square.
- Dimensions are between 64x64 and 2048x2048 px.
- File size is 768 KB or smaller.
- Animated WebP is allowed for desktop icon keys; keep motion subtle, looping,
  and readable from the first frame. First-party defaults animate every icon so
  the set feels like one matching ODD logo family.
- The visible alpha footprint fills at least 80% of one canvas axis, measured
  after ignoring near-transparent pixels, so icons cannot ship tiny inside a
  large transparent square.
- Path stays inside the archive and does not contain path traversal.

ODD stores the image paths and turns them into normal upload URLs. Desktop
Mode consumes those URLs directly; there is no CSS icon backplate, live DOM
rewrite, or ODD-owned renderer in between.

### Size + density

- Author source art at 512x512 or 1024x1024, then export the smallest
  PNG/WebP that still looks sharp at Desktop Mode sizes.
- Preserve transparency around standalone glyphs unless the icon's tile
  shape is part of the artwork. The current ODD default deliberately uses the
  ODD logo's rounded gradient tile as the shared icon body.
- Keep silhouette weight, lighting, and perspective consistent across the
  set. Desktop Mode lays every icon into the same native surfaces, so
  mismatched density is easy to spot.
- Normalize transparent padding before export. As a quick local check, the
  visible glyph should span roughly 80-90% of the square canvas on its longest
  axis without clipping shadows or glow.
- Avoid baking in UI chrome from the host desktop. The icon file should be
  the desktop shortcut icon, not a replacement dock/taskbar/rail tile.

First-party catalog sets are source-owned raster icon packs. Each pack should
ship its own finished icon files; pack identity belongs in the raster art
itself, not in an extra runtime effect layer:

- `odd-default-icons` stores the custom ODD baseline for the visible
  Desktop Mode desktop shortcuts.
- Every other first-party set may have distinct raster art for those same
  desktop shortcut keys.
- `_tools/compose-icon-set.py --all` refreshes the default set and validates
  that non-default source rasters exist without overwriting them.

`odd-default-icons` is special: its masks are generated from
`_tools/compose-icon-set.py`, then ODD glow/rim effects are applied. Do not
scale up an already rendered default WebP to fix size; if that WebP was cropped
or padded incorrectly, scaling only makes the damage larger.

This keeps ODD, My WordPress, Content Graph, Recycle Bin, and the fallback
glyph recognizable while still letting each pack have its own material,
silhouette language, and color system. The public `.wp` bundle contains plain
PNG/WebP files only.

Third-party sets do not have to use ODD's compositor, but they should follow
the same principle: preserve clear Desktop Mode / WordPress metaphors and vary
material, color, and atmosphere around them.

## Shop Card Art

The icon files stay unboxed and untouched at runtime. Shop cards should preview
the actual raster language directly, usually as a five-icon grid of ODD,
My WordPress, Content Graph, Recycle Bin, and fallback icons on the shared dark
ODD card surface.
- Use `accent`, `secondary`, and `spark` to echo the set's material, not to
  repaint the icons.
- Regenerate first-party source cards with:

    ```bash
    python3 _tools/gen-shop-card-art.py icon-sets
    ```

## preview.webp (optional)

If present, the Shop card uses it for the hero thumbnail — otherwise
the first declared icon stands in. A preview image usually works best as:

- PNG or WebP, 480x270 (16:9).
- A composition of 6–9 icons from the set, not the whole alphabet.
- On a soft accent-colored background that matches `manifest.accent`.

## Ship it

1. Zip the folder:

    ```bash
    cd my-icons/
    zip -r ../my-icons.wp manifest.json preview.webp icons/
    ```

2. Open the ODD Shop → **Upload** (or drop the `.wp` anywhere on the
   Shop). Or submit it to the first-party catalog by opening a PR
   that drops your source folder into
   `_tools/catalog-sources/icon-sets/<slug>/` — the next Pages deploy
   publishes it to `https://odd.regionallyfamous.com/catalog/v1/`
   where every ODD install can install it from Discover.
3. The Shop jumps to Icon Sets and flashes your new set's tile.
   Click **Apply** on the tile to activate it.
   ODD saves the preference and lets Desktop Mode rebuild every native
   icon surface from its own server-side payload.

## First-party rebuild workflow

Use Image Gen for style exploration and complete source-owned raster packs.
The default set is generated from ODD's desktop shortcut masks; every
other first-party set should ship its own final PNG/WebP files rather than
borrowing default glyph exports or runtime effects.

```bash
python3 _tools/compose-icon-set.py --all
python3 _tools/gen-shop-card-art.py icon-sets
python3 _tools/build-catalog.py
ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog
```

To validate one source-owned set while designing:

```bash
python3 _tools/compose-icon-set.py --set <slug>
python3 _tools/gen-shop-card-art.py icon-sets
```

If a default glyph itself needs to change, update `odd-default-icons`, refresh
`_tools/icon-glyphs/manifest.json` with `--extract-base`, and rebuild the
default set. Non-default packs should keep their own source contact sheets and
final raster exports.

## Debugging

- The icon registry is cached in a transient; installing or
  uninstalling a set busts the cache automatically. If the Shop shelf
  doesn't show your new set, re-open the panel — stale page-load data
  can hang around for one cycle.
- Inspect the stored manifest:

    ```bash
    wp option get oddout_icon_set_my-icons
    ```

- List installed files on disk:

    ```bash
    find "$(wp eval '$u = wp_upload_dir( null, false ); echo $u[\"basedir\"];')/odd/icon-sets/my-icons/" -type f
    ```

- If an icon falls back to Desktop Mode's original art, double-check
  that the path in `manifest.icons` matches the actual file name
  (case-sensitive on Linux), that the file is PNG/WebP, and that the
  logical key matches the surface you expected.

## See also

- [`.wp` Manifest Reference](wp-manifest.md) — full icon-set manifest schema.
- [Building on ODD](building-on-odd.md) — icon registry internals, slug-to-key mapping.
- Sibling author guides: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building a Widget](building-a-widget.md).
