# `.wp` Manifest Reference

Every ODD bundle — app, icon set, cursor set, scene, or widget — ships a
`manifest.json` at the root of its `.wp` archive. The manifest
carries a shared header (identity, versioning, type) and a per-type
body (entry points, icons, preview assets).

`.wp` is the installable content archive format. `.odd` is a separate
workspace-preset format for sharing a desktop arrangement; it does not
contain a manifest or executable bundle files.

> **JSON Schema.** A machine-readable schema lives at
> [`docs/schemas/manifest.schema.json`][schema]. Add
> `"$schema": "https://raw.githubusercontent.com/RegionallyFamous/odd/main/docs/schemas/manifest.schema.json"`
> to your `manifest.json` to get completion + inline validation in
> VS Code, or run `odd/bin/validate-manifest path/to/manifest.json`
> locally (set `ODD_REQUIRE_JSONSCHEMA=1` after `pip install jsonschema`
> for the full ruleset). CI runs this validator against the fixtures
> in `tests/fixtures/manifests/` on every PR.
>
> [schema]: schemas/manifest.schema.json

This page is the canonical field reference. Author guides live
alongside:

- [Building an App](building-an-app.md)
- [Building a Scene](building-a-scene.md)
- [Building an Icon Set](building-an-icon-set.md)
- [Building a Cursor Set](building-a-cursor-set.md)
- [Building a Widget](building-a-widget.md)

---

## Shared header — every type uses this

```json
{
    "type":        "app",
    "slug":        "my-bundle",
    "name":        "My Bundle",
    "version":     "1.0.0",
    "author":      "Your Name",
    "description": "A short sentence for Shop cards.",
    "icon":        "icon.svg"
}
```

| Field         | Required | Pattern / Type                              | Notes                                                                  |
|---------------|----------|---------------------------------------------|------------------------------------------------------------------------|
| `type`        | yes      | `"app" \| "icon-set" \| "cursor-set" \| "scene" \| "widget"` | Public v1 bundles must declare the canonical type explicitly.          |
| `slug`        | yes      | `^[a-z0-9-]+$`, 1–64 chars                  | Globally unique across **all** installed bundles (any type).           |
| `name`        | yes      | non-empty string                            | Display name on Shop cards + native window titles.                     |
| `version`     | yes      | non-empty string                            | Semver recommended. Drives the `ver` query on every enqueued asset.    |
| `author`      | no       | string                                      | Shown on the detail sheet.                                             |
| `description` | no       | string                                      | One or two sentences. Shown on the tile + the detail sheet.            |
| `icon`        | no       | relative path or absolute URL               | Fallbacks: apps use a cog, icon sets use the dashboard icon, scenes use their preview, widgets use a generic glyph. |

### Global slug uniqueness

A slug identifies a bundle across every type. You **cannot** install
`my-thing` as an icon set if `my-thing` is already an app. The Shop
rejects the second upload with `slug_exists`. The same rule applies
when an author tries to reuse a slug that already exists in the
user's installed set (e.g. `oddling-desktop` once the starter pack has
pulled it in) or in the remote catalog.

---

## Per-type fields

### Type: `app`

Covered in full by the [Building an App](building-an-app.md) guide.

```json
{
    "type":        "app",
    "slug":        "ledger",
    "name":        "Ledger",
    "version":     "1.0.0",
    "entry":       "index.html",
    "capability":  "manage_options",
    "window":      { "width": 720, "height": 520, "min_width": 420, "min_height": 320 },
    "desktopIcon": { "title": "Ledger", "position": 300 },
    "surfaces":    { "desktop": true, "taskbar": false },
    "extensions":  { "muses": [], "commands": [], "widgets": [], "rituals": [], "motionPrimitives": [] }
}
```

| Field         | Required | Notes                                                                        |
|---------------|----------|------------------------------------------------------------------------------|
| `entry`       | no       | Defaults to `"index.html"`. Path relative to archive root, no `..`.          |
| `capability`  | no       | Defaults to `"manage_options"`. Checked on every serve request. Manifest values are normalized against ODD's capability floor, so bundles cannot broaden access to all logged-in users by declaring `"read"` unless a site deliberately opts in with filters. |
| `window`      | no       | `{ width, height, min_width, min_height, title }`.                           |
| `desktopIcon` | no       | `{ title, position }`. Position is an ordering hint (lower = earlier).       |
| `surfaces`    | no       | `{ desktop: bool, taskbar: bool }`. Install-time defaults for the app's two visible launch surfaces — desktop icon and Desktop Mode taskbar icon. Missing keys default to `{ desktop: true, taskbar: false }`. Users can override each independently from the ODD Shop. |
| `extensions`  | no       | Declarative registrations against the ODD extension registries.              |

### Type: `icon-set`

Covered in full by [Building an Icon Set](building-an-icon-set.md).

```json
{
    "type":      "icon-set",
    "slug":      "aurora",
    "name":      "Aurora",
    "version":   "1.0.0",
    "category": "Aurora",
    "accent":    "#7cc0ff",
    "preview":   "preview.webp",
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
        "fallback":   "icons/fallback.webp"
    }
}
```

| Field       | Required | Notes                                                                    |
|-------------|----------|--------------------------------------------------------------------------|
| `category` | no       | Optional grouping label for Shop shelves and catalog tooling. |
| `accent`    | yes      | `#hex`. Paints the Shop tile, quilt gradient, and catalog metadata.      |
| `preview`   | no       | Relative path to a hero PNG/WebP. Falls back to `icons.dashboard`.       |
| `icons`     | yes      | Map of all 14 semantic icon keys to relative PNG/WebP paths. |

Icon sets are native Desktop Mode raster image URL feeds. ODD validates
each declared icon as a PNG or WebP image, stores the set under
`wp-content/uploads/odd/icon-sets/<slug>/`, and passes the resulting
image URLs to Desktop Mode's own dock, taskbar, desktop, and file-layer
icon payloads. ODD does not recolor these images or render a replacement rail.
Each icon image must be square, 64-2048 px, 768 KB or smaller, and match
its declared extension.

### Type: `cursor-set`

Covered in full by [Building a Cursor Set](building-a-cursor-set.md).

```json
{
    "type":      "cursor-set",
    "slug":      "oddlings",
    "name":      "Oddlings Cursor Effects",
    "version":   "1.0.0",
    "category": "ODD Defaults",
    "accent":    "#38e8ff",
    "preview":   "preview.svg",
    "effects": {
        "accent": "#38e8ff",
        "spark":  "#ff4f8b",
        "warm":   "#f6b73c",
        "ink":    "#19091f",
        "recipe": "gel-pop"
    },
    "cursors": {}
}
```

| Field     | Required | Notes                                                                      |
|-----------|----------|----------------------------------------------------------------------------|
| `accent`  | no       | `#hex`. Paints the Shop tile fallback and catalog metadata.                |
| `preview` | no       | Relative path to passive SVG preview art.                                  |
| `effects` | no       | Living-layer tokens: `accent`, `spark`, `warm`, `ink`, and optional `recipe`. |
| `cursors` | no       | Compatibility field. Must be empty when present.                           |

Cursor sets keep the browser cursor native and theme ODD's top-level
living cursor layer. They must not include cursor SVG files, hotspot
metadata, or CSS cursor-image URLs.

### Type: `scene`

Covered in full by [Building a Scene](building-a-scene.md).

```json
{
    "type":          "scene",
    "slug":          "my-scene",
    "name":          "My Scene",
    "version":       "1.0.0",
    "category":     "Generative",
    "tags":          [ "blue", "slow" ],
    "fallbackColor": "#112233",
    "added":         "2026-04-26",
    "entry":         "scene.js",
    "preview":       "preview.webp",
    "wallpaper":     "wallpaper.webp"
}
```

| Field           | Required | Notes                                                                |
|-----------------|----------|----------------------------------------------------------------------|
| `category`     | no       | Optional grouping label for Shop shelves and catalog tooling. |
| `tags`          | yes      | Array of short strings. Drives search + muse tone selection.         |
| `fallbackColor` | yes      | `#hex` painted under the canvas before the first frame draws.        |
| `added`         | yes      | `YYYY-MM-DD`. Used for "new" badges + sort-by-freshness.             |
| `entry`         | yes      | Relative path to the self-registering `.js`, no `..`.                |
| `preview`       | yes      | Relative path to the ~640×360 WebP shown on the Shop card.           |
| `wallpaper`     | yes      | Relative path to the 1920×1080 WebP painted behind the canvas.       |

Scene JavaScript is enqueued on every admin page with `odd` as a
dependency, so `window.__odd`, `env`, and `PIXI` are available at
load time. Installing a scene triggers the one-time JS confirmation
prompt (admins only).

### Type: `widget`

Covered in full by [Building a Widget](building-a-widget.md).

```json
{
    "type":        "widget",
    "slug":        "pomodoro",
    "name":        "Pomodoro",
    "version":     "1.0.0",
    "entry":       "widget.js",
    "icon":        "icon.svg",
    "preview":     "preview.svg",
    "defaultSize": { "width": 220, "height": 180 }
}
```

| Field         | Required | Notes                                                               |
|---------------|----------|---------------------------------------------------------------------|
| `entry`       | yes      | Relative path to the JS that calls `wp.desktop.registerWidget()`.   |
| `icon`        | no       | SVG/PNG/WebP shown on the Shop tile.                                |
| `preview`     | no       | Optional preview art. First-party catalog widgets prefer `preview.svg` for card art; older bundles can still rely on generated tiles. |
| `defaultSize` | no       | `{ width, height }` in CSS px.                                      |

Widget JavaScript is enqueued on every admin page with `desktop-mode`
and `odd-api` as dependencies. Installing a widget triggers the
one-time JS confirmation prompt (admins only).

---

## Runtime fields

ODD writes a couple of additional fields into the stored manifest
(e.g. `oddout_app_<slug>`, `oddout_scene_<slug>`) at install time. Do **not**
set these in your source `manifest.json` — they'll be overwritten:

| Field       | Added by                           | Meaning                                       |
|-------------|------------------------------------|-----------------------------------------------|
| `installed` | Per-type installer                 | Unix timestamp of the install.                |
| `enabled`   | Apps-only: `oddout_apps_set_enabled`  | Whether the app is available to open and serve. |
| `surfaces`  | Apps-only: `oddout_apps_set_surfaces` | User-overridden `{ desktop, taskbar }` launch surfaces. |

These are exposed on `GET /odd/v1/bundles/<slug>` (and the older
`GET /odd/v1/apps/<slug>`) so the Shop can flag state, but they're
not part of the authoring contract.

---

## Validation summary

Every bundle upload is validated against these checks. The relevant
error code is shown; they surface as `{ code, message }` in the REST
response and as friendly copy in the Shop topbar pill.

### Archive-level

| Check                                                     | Error code              |
|-----------------------------------------------------------|-------------------------|
| File extension is `.wp`                                   | `invalid_extension`     |
| File opens as a ZIP                                       | `invalid_zip`           |
| Archive contains ≤ 2,000 files                            | `too_many_files`        |
| No path-traversal (`..` or leading `/`) in any entry      | `path_traversal`        |
| No symlinks                                               | `symlink_in_archive`    |
| No forbidden extensions (`.php`, `.phtml`, `.phar`, `.cgi`, `.pl`, `.py`, `.rb`, `.sh`, `.bash`, etc.) | `forbidden_file_type` |
| Per-file compression ratio ≤ 100:1                        | `zip_bomb`              |
| Total uncompressed size ≤ 25 MB                           | `too_large`             |

### Shared header

| Check                                                     | Error code              |
|-----------------------------------------------------------|-------------------------|
| `manifest.json` exists at root                            | `missing_manifest`      |
| `manifest.json` parses as JSON                            | `invalid_manifest`      |
| `name` / `slug` / `version` present and non-empty         | `missing_manifest_field`|
| `slug` matches `^[a-z0-9-]+$`                             | `invalid_slug`          |
| `type`, if set, is one of the five supported values       | `unsupported_type`      |
| `slug` is not already installed (any type)                | `slug_exists`           |

### Per-type

| Type       | Extra checks                                                                                   |
|------------|------------------------------------------------------------------------------------------------|
| `app`      | `entry` matches the entry regex + file exists in the archive.                                  |
| `icon-set` | `icons` present, all 14 semantic keys mapped, each path is a real PNG/WebP image, each image is square, 64-2048 px, and at most 768 KB. |
| `cursor-set` | `cursors` absent or empty, `effects` tokens are valid hex colors, preview SVGs pass passive-SVG validation. |
| `scene`    | `entry`, `preview`, `wallpaper` all present in the archive; `fallbackColor` is a `#hex`.       |
| `widget`   | `entry` matches the entry regex + file exists in the archive.                                  |

---

## See also

- [Building an App](building-an-app.md)
- [Building a Scene](building-a-scene.md)
- [Building an Icon Set](building-an-icon-set.md)
- [Building a Widget](building-a-widget.md)
- [Building on ODD](building-on-odd.md) — extension registries + debug inspector (for integrators).
- [Apps REST API](app-rest-api.md) — endpoint reference.
