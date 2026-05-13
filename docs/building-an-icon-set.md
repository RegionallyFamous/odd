# Building an ODD Icon Set

> One of four ODD author guides. Siblings: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building a Widget](building-a-widget.md).

An icon set re-skins the WP Desktop dock and the desktop shortcuts
with a themed pack of SVGs. Drop a `.wp` on the ODD Shop and ODD
scans the manifest, scrubs every SVG, copies the set into
`wp-content/uploads/odd/icon-sets/`, and makes it selectable from the Icon
Sets department — no WordPress plugin, no custom PHP.

Icon sets ship **no JavaScript**, so they install without a consent
prompt.

---

## Anatomy

```
my-icons.wp
├── manifest.json
├── preview.svg            ← optional — 480×270 hero shown on the Shop card
└── icons/
    ├── dashboard.svg
    ├── posts.svg
    ├── pages.svg
    ├── media.svg
    ├── comments.svg
    ├── appearance.svg
    ├── plugins.svg
    ├── users.svg
    ├── tools.svg
    ├── settings.svg
    ├── profile.svg            ← optional enhanced ODD key
    ├── links.svg              ← optional enhanced ODD key
    ├── recycle-bin.svg        ← optional enhanced ODD key
    └── fallback.svg
```

Paths inside `icons/` can be anything — the manifest maps the
required minimum keys to paths of your choosing. First-party ODD sets
also ship the enhanced keys `profile`, `links`, and `recycle-bin`;
third-party sets can omit those and ODD will fall back gracefully.

## Manifest

```json
{
    "type":        "icon-set",
    "slug":        "my-icons",
    "name":        "My Icons",
    "label":       "My Icons",
    "version":     "1.0.0",
    "franchise":   "My Icons",
    "accent":      "#ff7a3c",
    "description": "Warm hand-drawn icons with a coffee-stained palette.",
    "preview":     "preview.svg",
    "icons": {
        "dashboard":  "icons/dashboard.svg",
        "posts":      "icons/posts.svg",
        "pages":      "icons/pages.svg",
        "media":      "icons/media.svg",
        "comments":   "icons/comments.svg",
        "appearance": "icons/appearance.svg",
        "plugins":    "icons/plugins.svg",
        "users":      "icons/users.svg",
        "tools":      "icons/tools.svg",
        "settings":   "icons/settings.svg",
        "profile":    "icons/profile.svg",
        "links":      "icons/links.svg",
        "recycle-bin": "icons/recycle-bin.svg",
        "fallback":   "icons/fallback.svg"
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
| `franchise`   | no       | Soft historical label. Shelves are categorized by slug — the field is retained for third-party tooling that may still read it. |
| `accent`      | yes      | `#hex` used for Shop accents, catalog previews, and hover states.|
| `description` | no       | Longer copy shown on the detail sheet.                                     |
| `preview`     | no       | Relative path to an SVG/PNG/WebP hero (falls back to the `dashboard` icon).|
| `icons`       | yes      | Map of required minimum keys, plus optional enhanced ODD keys, to relative SVG paths. |

### Why these keys?

The dock + desktop-shortcut filters map every WordPress menu slug to
stable logical keys via `oddout_icons_slug_to_key()`:

| Key           | Required | Maps to                                   |
|---------------|----------|-------------------------------------------|
| `dashboard`   | yes      | Dashboard, Home                           |
| `posts`       | yes      | Posts, `edit.php`                         |
| `pages`       | yes      | Pages, `edit.php?post_type=page`          |
| `media`       | yes      | Media, Uploads                            |
| `comments`    | yes      | Comments, `edit-comments.php`             |
| `appearance`  | yes      | Themes, Customize, Widgets, Menus         |
| `plugins`     | yes      | Plugins, `plugins.php`                    |
| `users`       | yes      | Users, Profile (when listing other users) |
| `tools`       | yes      | Tools, Import / Export, Code editor       |
| `settings`    | yes      | Settings, Options                         |
| `fallback`    | yes      | Anything unmapped                         |
| `profile`     | no       | Your own profile tile                     |
| `links`       | no       | Legacy Links, any URL-browsing tool       |
| `recycle-bin` | no       | WP Desktop Mode Recycle Bin (`desktop-mode-recycle-bin`) |

If the active set can't provide one of the logical keys, ODD reaches
for the set's own `fallback`, then for whatever WP Desktop Mode served
before icon swapping kicked in. There is no plugin-bundled "Default"
set any more; ODD 1.0 installs visual content from the catalog.

## SVG rules

Every SVG is scrubbed at install time. An SVG is rejected if any of
the following fail:

- Parses as well-formed XML.
- Contains a `viewBox` attribute (or explicit `width` + `height`).
- No `<script>` elements anywhere in the tree.
- No `on*` event handler attributes (`onclick`, `onload`, …).
- No external `xlink:href` / `href` values that escape the archive.
- No control bytes outside `\t`, `\n`, `\r` (byte < `0x20`).
- File size ≤ 64 KB (well above what any reasonable icon needs).

### Color conventions

**Tintable sets** (recommended) paint in `currentColor`, so the dock's
active / hover / disabled states pick up cleanly. ODD's tinted-SVG
endpoint serves any icon in a tint by URL when a consumer asks for one;
`currentColor` lets that work without search-and-replace:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
    <path d="M4 6h16M4 12h10M4 18h16"/>
</svg>
```

**Fixed-color sets** paint explicit fills / strokes. That's fine, but
you lose the hover + active tint hooks and icons render identically in
every state. Use fixed color when the palette is the point (enamel pins,
pixel art) and use `currentColor` everywhere else.

### Size + density

- Canvas: `viewBox="0 0 24 24"` is the ODD default; 20 or 28 work too.
- Aim for ~1–2 KB per icon after minification. Heavy clipPaths /
  filters can slow the dock paint on low-tier devices.
- Keep stroke widths consistent across the set — the dock lays them
  out at the same px size and mismatched weights read as sloppiness.

First-party catalog sets currently use a larger standalone-glyph source
canvas (`viewBox="0 0 1024 1024"`) with the continuous squircle clipPath
baked in for catalog compatibility. The visible art is transparent, not
a tile or backplate. Third-party sets do **not** have to copy that
treatment, but if you want the same direction see
[`_tools/icon-style-guide.md`](../_tools/icon-style-guide.md) and keep
every SVG below the 64 KB install limit.

## preview.svg (optional)

If present, the Shop card uses it for the hero thumbnail — otherwise
the `dashboard` icon stands in. A preview image usually works best as:

- SVG or WebP, 480×270 (16:9).
- A composition of 6–9 icons from the set, not the whole alphabet.
- On a soft accent-tinted background that matches `manifest.accent`.

## Ship it

1. Zip the folder:

    ```bash
    cd my-icons/
    zip -r ../my-icons.wp manifest.json preview.svg icons/
    ```

2. Open the ODD Shop → **Upload** (or drop the `.wp` anywhere on the
   Shop). Or submit it to the first-party catalog by opening a PR
   that drops your source folder into
   `_tools/catalog-sources/icon-sets/<slug>/` — the next Pages deploy
   publishes it to `https://odd.regionallyfamous.com/catalog/v1/`
   where every ODD install can install it from Discover.
3. The Shop jumps to Icon Sets and flashes your new set's tile.
   Click **Preview** on the tile — the dock swaps in place. Click
   **Keep** to commit; ODD does a 180 ms fade and reloads so the
   server-side dock filter renders with your set applied.

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

- If the tinted-SVG endpoint 404s on one of your icons, double-check
  that the path in `manifest.icons` matches the actual file name
  (case-sensitive on Linux) and that the SVG is well-formed.

## See also

- [`.wp` Manifest Reference](wp-manifest.md) — full icon-set manifest schema.
- [Building on ODD](building-on-odd.md) — icon registry internals, slug-to-key mapping.
- Sibling author guides: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building a Widget](building-a-widget.md).
