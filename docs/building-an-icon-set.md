# Building an ODD Icon Set

> One of four ODD author guides. Siblings: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building a Widget](building-a-widget.md).

An icon set is a native Desktop Mode raster image URL feed: a themed
set of PNG/WebP files for dock items, taskbar items, desktop shortcuts,
recycle bin, and file shortcut previews. Drop a `.wp` on the ODD Shop
and ODD validates the manifest, verifies each image, copies the set into
`wp-content/uploads/odd/icon-sets/`, and makes it selectable from the Icon
Sets department - no WordPress plugin, no custom PHP.

ODD does not replace Desktop Mode's rail, taskbar, desktop, or file-layer
renderers. It saves the user's selected set and then gives Desktop Mode
the image URLs Desktop Mode already asks plugins to provide.

Icon sets ship **no JavaScript**, so they install without a consent
prompt.

---

## Anatomy

```
my-icons.wp
├── manifest.json
├── preview.webp           ← optional - 480x270 hero shown on the Shop card
└── icons/
    ├── dashboard.webp
    ├── posts.webp
    ├── pages.webp
    ├── media.webp
    ├── comments.webp
    ├── appearance.webp
    ├── plugins.webp
    ├── users.webp
    ├── tools.webp
    ├── settings.webp
    ├── profile.webp
    ├── links.webp
    ├── recycle-bin.webp
    ├── fallback.webp
    ├── os-settings.webp
    ├── import.webp
    └── classic-admin.webp
```

Paths inside `icons/` can be anything — the manifest maps the
required semantic keys to paths of your choosing. ODD requires all
17 keys so Desktop Mode's dock, desktop, taskbar, file shortcut,
Recycle Bin, and compact rail action surfaces can all resolve through
one complete native feed. The compact rail/system actions map OS
Settings to `os-settings`, PWA install/import to `import`, Report a bug
to the bug-like `plugins` glyph, and Exit Desktop Mode to
`classic-admin`; `plugins` is also a core WordPress menu key.

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
    "funLayer": {
        "recipe": "paper-fold",
        "accent": "#ff7a3c",
        "secondary": "#ffd9a8",
        "spark": "#38e8ff"
    },
    "description": "Warm hand-drawn icons with a coffee-stained palette.",
    "preview":     "preview.webp",
    "icons": {
        "dashboard":  "icons/dashboard.webp",
        "posts":      "icons/posts.webp",
        "pages":      "icons/pages.webp",
        "media":      "icons/media.webp",
        "comments":   "icons/comments.webp",
        "appearance": "icons/appearance.webp",
        "plugins":    "icons/plugins.webp",
        "users":      "icons/users.webp",
        "tools":      "icons/tools.webp",
        "settings":   "icons/settings.webp",
        "profile":    "icons/profile.webp",
        "links":      "icons/links.webp",
        "recycle-bin": "icons/recycle-bin.webp",
        "fallback":   "icons/fallback.webp",
        "os-settings": "icons/os-settings.webp",
        "import":     "icons/import.webp",
        "classic-admin": "icons/classic-admin.webp"
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
| `funLayer`    | no       | Shop-card personality layer: `recipe`, `accent`, `secondary`, and `spark`. First-party sets must each use a distinct recipe. |
| `description` | no       | Longer copy shown on the detail sheet.                                     |
| `preview`     | no       | Relative path to a PNG/WebP hero (falls back to the `dashboard` icon).|
| `icons`       | yes      | Map of all 17 required semantic keys to relative PNG/WebP paths. |

### Why these keys?

The native Desktop Mode icon filters map every WordPress menu slug to
stable logical keys via `oddout_icons_slug_to_key()`:

| Key           | Required | Maps to                                   |
|---------------|----------|-------------------------------------------|
| `dashboard`   | yes      | Dashboard, Home                           |
| `posts`       | yes      | Posts, `edit.php`                         |
| `pages`       | yes      | Pages, `edit.php?post_type=page`          |
| `media`       | yes      | Media, Uploads                            |
| `comments`    | yes      | Comments, `edit-comments.php`             |
| `appearance`  | yes      | Themes, Customize, Widgets, Menus         |
| `plugins`     | yes      | Plugins, `plugins.php`; Report a bug system tile |
| `users`       | yes      | Users, Profile (when listing other users) |
| `tools`       | yes      | Tools, Import / Export, Code editor       |
| `settings`    | yes      | Settings, Options                         |
| `fallback`    | yes      | Anything unmapped                         |
| `profile`     | yes      | Your own profile tile                     |
| `links`       | yes      | WordPress Links menu, any URL-browsing tool |
| `recycle-bin` | yes      | WP Desktop Mode Recycle Bin (`desktop-mode-recycle-bin`) |
| `os-settings` | yes      | Desktop Mode OS Settings system tile      |
| `import`      | yes      | Import/PWA install/download-style rail action |
| `classic-admin` | yes    | Exit/classic-admin rail action            |

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
- Path stays inside the archive and does not contain path traversal.

ODD stores the image paths and turns them into normal upload URLs. Desktop
Mode consumes those URLs directly; there is no CSS icon backplate, live DOM
rewrite, or ODD-owned renderer in between.

### Size + density

- Author source art at 512x512 or 1024x1024, then export the smallest
  PNG/WebP that still looks sharp at Desktop Mode sizes.
- Preserve transparency around standalone glyphs unless the icon's tile
  shape is part of the artwork.
- Keep silhouette weight, lighting, and perspective consistent across the
  set. Desktop Mode lays every icon into the same native surfaces, so
  mismatched density is easy to spot.
- Avoid baking in UI chrome from the host desktop. The icon file should be
  the icon, not a replacement dock/taskbar tile.

First-party catalog sets start from Image Gen contact sheets and are sliced
into transparent raster exports. Third-party sets do not have to copy that
treatment, but all files in the manifest `icons` map must be PNG or WebP.

## Shop card layer

The icon files stay unboxed and untouched at runtime, but the Shop card can
carry more personality around them. First-party icon sets declare a `funLayer`
so the card renderer and catalog card generator can add a unique surface
effect without changing the actual glyph masks.

- Keep `recipe` unique across first-party sets so the shelf does not become a
  row of palette swaps.
- Use `accent`, `secondary`, and `spark` to echo the set's material, not to
  repaint the icons.
- Regenerate first-party source cards with:

    ```bash
    python3 _tools/gen-shop-card-art.py icon-sets
    ```

## preview.webp (optional)

If present, the Shop card uses it for the hero thumbnail — otherwise
the `dashboard` icon stands in. A preview image usually works best as:

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
   Click **Preview** on the tile, then **Apply & reload** to commit.
   ODD saves the preference and lets Desktop Mode rebuild every native
   icon surface from its own server-side payload.

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
