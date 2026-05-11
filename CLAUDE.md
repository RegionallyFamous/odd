# ODD — project notes for agents

> Auto-loaded by Claude Code / Cursor. Exists so any new session can pick
> up work without re-deriving the architecture.

## What this is

ODD (**Outlandish Desktop Decorator**) is a WordPress plugin that layers on top of [WP Desktop Mode](https://github.com/WordPress/desktop-mode). **As of the 1.0 baseline the plugin runtime stays lightweight** — visual content is pulled on demand from a remote catalog. The plugin owns five surfaces:

1. **A canvas wallpaper engine** — a single `registerWallpaper('odd', …)` that hosts generative PixiJS scenes painted on top of 1920×1080 WebP backdrops. Scenes install as `.wp` bundles.
2. **Icon sets** — themed SVG packs that re-skin the WP Desktop Mode dock and desktop-shortcut icons via the `desktop_mode_dock_item` + `desktop_mode_icons` filters. Install as `.wp` bundles.
3. **Desktop widgets** — tiles like Sticky Note, Magic 8-Ball, and Spotify Embed that live on the desktop surface. Install as `.wp` bundles.
4. **Cursor sets** — themed SVG cursor packs that can theme Desktop Mode and classic wp-admin. Install as `.wp` bundles.
5. **Apps** — self-contained sandboxed HTML/CSS/JS bundles that open in their own native window. Each app can surface as a desktop icon, a Desktop Mode taskbar icon, both, or neither — per-user preference in the ODD Shop. Install as `.wp` bundles.

All four are managed from a single native WP Desktop Mode window (the **ODD Shop** — a Mac App Store-style browsing surface) opened from the desktop shortcut icon, the `/odd-panel` slash command, or any widget that routes through `api.openPanel()`. Internally the window id stays `odd` — tests, commands, and the WP Desktop Mode session state still reference it by that id.

- **Repo:** `RegionallyFamous/odd`
- **Live demo (stable, ODD 1.0.6):** Hosted blueprint [`site/playground/blueprint.json`](https://odd.regionallyfamous.com/playground/blueprint.json?oddbp=v2-1.0.6) or short redirect [`/go/`](https://odd.regionallyfamous.com/go/) → Playground — pins Desktop Mode **0.8.2** zip + ODD **v1.0.6** release ref (`?oddbp=` avoids stale blueprint caching). Raw GitHub: [`blueprint.json`](https://raw.githubusercontent.com/RegionallyFamous/odd/main/blueprint.json?oddbp=v2-1.0.6). **Dev / trunk (bleeding edge, not release-track):** [`blueprint-dev.json`](https://github.com/RegionallyFamous/odd/blob/main/blueprint-dev.json) / hosted [`blueprint-dev.json`](https://odd.regionallyfamous.com/playground/blueprint-dev.json?oddbp=dev-dm-0.8.2) — Desktop Mode **0.8.2** from WP.org (pinned zip) + ODD **`main`** from GitHub; short redirect [`/go/dev`](https://odd.regionallyfamous.com/go/dev/) and launcher [`/playground/dev/`](https://odd.regionallyfamous.com/playground/dev/).
- **Remote catalog:** https://odd.regionallyfamous.com/catalog/v1/registry.json
- **Host plugin (required at runtime):** WP Desktop Mode v0.8.0+ (wordpress.org/plugins/desktop-mode)

## Architecture at a glance

```
odd/
├── odd.php bootstrap: ODD_VERSION + require_once list
├── includes/
│ ├── enqueue.php odd-api, odd, odd-panel, odd-commands script handles
│ ├── rest.php /odd/v1/prefs (GET+POST)
│ ├── native-window.php desktop_mode_register_window('odd', …)
│ ├── starter-pack.php inline starter install + retry REST
│ ├── content/
│ │ ├── catalog.php wp_remote_get(registry.json) + 12h transient cache
│ │ ├── scenes.php odd_scene_registry filter from installed bundles
│ │ ├── iconsets.php odd_icon_sets filter from installed bundles
│ │ ├── widgets.php widget self-enqueue from installed bundles
│ │ └── apps.php app registration from installed bundles
│ ├── wallpaper/
│ │ ├── registry.php filter-driven odd_wallpaper_scenes()
│ │ └── prefs.php odd_wallpaper_* user-meta helpers
│ └── icons/
│ ├── registry.php scans wp-content/odd-icon-sets/*/manifest.json
│ └── dock-filter.php desktop_mode_dock_item + desktop_mode_icons @ priority 20
├── src/
│ ├── shared/
│ │ └── api.js window.__odd.api — setScene / setIconSet / shuffle / openPanel / toast
│ ├── commands/
│ │ └── index.js registerCommand × 4 (/odd, /odd-icons, /shuffle, /odd-panel)
│ ├── panel/
│ │ └── index.js native-window render callback (ODD Shop)
│ └── wallpaper/
│ ├── index.js registerWallpaper('odd', …) + scene mount runner + odd-pending fallback
│ └── picker.js legacy in-canvas picker (hidden; kept for fallback)
└── bin/
 ├── build-zip → dist/odd.zip (2 MB budget)
 ├── validate-catalog assert site/catalog/v1/ schema + hashes + starter-pack
 └── check-version

_tools/
├── catalog-sources/ source of truth for every bundle
│ ├── scenes/{slug}/ scene.js + meta.json + preview.webp + wallpaper.webp
│ ├── icon-sets/{slug}/ manifest.json + SVGs
│ ├── widgets/{slug}/ widget.js + widget.css + manifest.json
│ ├── apps/{slug}/ bundle.wp (pre-built) or manifest.json + assets
│ └── starter-pack.json slugs to auto-install on activation
└── build-catalog.py deterministic .wp + registry.json + icons builder

site/
├── index.html / styles.css / wild.js marketing site
└── catalog/v1/ published to odd.regionallyfamous.com by pages.yml
    ├── registry.json
    ├── registry.schema.json
    ├── bundles/{type}-{slug}.wp
    └── icons/{slug}.svg

ci/smoke/
└── odd-smoke-fixture.php MU-plugin: pre_http_request → local fixture
```

### Single-window contract

The desktop icon registered in `includes/native-window.php` and the `/odd-panel` slash command both call `wp.desktop.registerWindow({ id: 'odd', … })` (via `window.__odd.api.openPanel()`). WP Desktop Mode's window manager reuses any window with a matching `baseId`, so there's always at most one ODD Shop instance on screen.

The panel body is rendered by `window.desktop_mode_native_windows.odd = body => { … }` in `src/panel/index.js`. Layout is a fixed-width sidebar (Wallpapers / Icons / Widgets / Apps / About) plus a scrollable content pane. All state flows through REST. Empty-state messaging covers the window between activation and the first starter-pack install.

### Single REST namespace

`POST /wp-json/odd/v1/prefs` accepts any subset of:
- `wallpaper` — scene slug; validated against `odd_wallpaper_scene_slugs()`; written to `odd_wallpaper`.
- `favorites` — slug[] capped to 50; written to `odd_favorites`.
- `recents` — slug[] capped to 12; written to `odd_recents`.
- `shuffle` — `{ enabled: bool, minutes: int 1..240 }`; written to `odd_shuffle`.
- `audioReactive` — bool; written to `odd_audio_reactive`.
- `iconSet` — set slug (or `"none"`); written to `odd_icon_set`.
- `theme` — `light|dark|auto`; written to `odd_shop_theme` and applied as `data-odd-theme` on the Shop root.
- `chaosMode` — bool; written to `odd_chaos` and applied as `data-odd-chaos` on the Shop root.

`GET /wp-json/odd/v1/prefs` returns the current user's prefs plus the registry of installed scenes and icon sets.

### ODD Shop v2 chrome

The Shop redesign is gated by the `odd_shop_v2` filter (default `true`). The root keeps the existing `odd-panel odd-shop` classes and data hooks, plus `data-odd-shop-v2`, `data-odd-theme`, and `data-odd-chaos`.

Shop-only assets live in `odd/assets/shop/`:
- `brand-mark.svg` — animated iris topbar mark.
- `glyphs.svg` — 24px department glyph sprite.
- `oddling-a.svg` / `oddling-b.svg` — chaos-cast sprites used by `odd/src/shop/cast.js`.

The CSS token layer lives in `odd/src/panel/styles.css` as `--odd-shop-*` variables for surfaces, ink, type, radius, elevation, motion, and department tints. New Shop UI should consume those tokens and honor `prefers-reduced-motion`.

Bundle endpoints (`/odd/v1/bundles/*`):
- `GET /bundles/catalog` — remote registry contents (cached 12h + stale-on-failure).
- `POST /bundles/install-from-catalog` — download + SHA256-verify + install.
- `POST /bundles/upload` — multipart upload for sideloaded `.wp`.
- `POST /bundles/refresh` — force re-fetch of remote registry.

Starter-pack endpoints (`/odd/v1/starter/*`):
- `GET /starter` — installer state (`pending` | `installed` | `failed`, attempts, last error).
- `POST /starter/retry` — clear backoff and re-run immediately.

Permission callbacks are `is_user_logged_in`. The panel also ships the same state inlined via `wp_localize_script( 'odd-panel', 'odd', … )` so first paint doesn't wait on a round-trip.

### Remote catalog fetch

`includes/content/catalog.php` defines `ODD_CATALOG_URL` (default: `https://odd.regionallyfamous.com/catalog/v1/registry.json`, filterable via `odd_catalog_url`). `odd_catalog_load()` fetches it with `wp_remote_get()` and caches the payload in the `odd_catalog` transient for 12h. On fetch failure it returns the stale transient so the Shop stays usable offline. Downloads verify `sha256` from the registry before calling `odd_bundle_install()`.

### Starter pack

`register_activation_hook` runs `odd_starter_ensure_installed( true )` inline. No cron — the activating admin is already on a privileged page, so the installer downloads + extracts the starter-pack bundles right there. The runner loads the remote catalog, resolves the slugs listed in the catalog's top-level `starter_pack` (currently `{ scenes: ['oddling-desktop'], iconSets: ['oddlings'], widgets: [], apps: [] }`), calls `odd_catalog_install_entry()` for each, and writes initial per-user preferences. State lives in the `odd_starter_state` option. If activation fails (catalog down, loopback blocked), a safety-net hook on `init` runs the installer inline on the next privileged page load — gated by exponential backoff (0s → 30s → 2 min → 10 min → 1 h → 6 h) against `last_attempt` so it doesn't thrash a chronically-failing catalog. The running state acts as a lock (auto-expires after 240 s) so concurrent admin tabs don't double-install.

### Live scene swaps

Panel clicks fire `wp.hooks.doAction( 'odd/pickScene', slug )` in parallel with the REST POST. The wallpaper engine subscribes to this hook (`odd/wallpaper` namespace) and swaps the scene immediately through its `swap()` path — no reload needed.

The wallpaper runtime also exposes `window.__odd.mountSceneInto(container, slug, opts)` for the Shop hero. It creates a low-power Pixi v8 app for a single scene and returns `{ app, env, state, destroy }`; the desktop wallpaper path still owns the full `registerWallpaper('odd', …)` runner. Scene manifests can set `heroSafe:false` when they require desktop-only APIs like `wp.desktop.getWallpaperSurfaces()`.

### Icons swap → soft reload

Icon-set changes trigger a 180 ms fade + `window.location.reload()` after the POST succeeds. Re-render happens server-side through the two filters in `includes/icons/dock-filter.php`:

- `desktop_mode_dock_item` priority 20, two-arg: per-tile swap keyed by `odd_icons_slug_to_key( $menu_slug )` (e.g. `edit.php` → `posts`). Falls back to the set's `fallback` icon when a set ships no specific match.
- `desktop_mode_icons` priority 20: re-skins desktop shortcuts by the same key logic, but **skips** the ODD Shop icon itself so it stays recognizable regardless of the active set.

Server-side mapping is canonical; client-side live-swap via JS DOM surgery proved unreliable in earlier iterations and shouldn't be revisited.

## Scene file contract

Every `_tools/catalog-sources/scenes/<slug>/scene.js` self-registers:

```javascript
( function () {
 'use strict';
 window.__odd = window.__odd || {};
 window.__odd.scenes = window.__odd.scenes || {};
 var h = window.__odd.helpers;

 window.__odd.scenes[ '<slug>' ] = {
 setup: function ( env ) { /* required */ },
 tick: function ( state, env ) { /* required; env.dt clamped to 2.5 */ },
 onResize: function ( state, env ) { /* optional */ },
 cleanup: function ( state, env ) { /* optional */ },
 stillFrame: function ( state, env ) { /* optional — reduced-motion pose */ },
 transitionOut: function ( state, env, done ) { /* optional */ },
 transitionIn: function ( state, env ) { /* optional */ },
 onAudio: function ( state, env ) { /* optional — only when env.audio.enabled */ },
 onEgg: function ( name, state, env ) { /* 'festival' | 'reveal' | 'peek' */ },
 };
} )();
```

Scenes should read their wallpaper URL from `window.odd.sceneMap[slug].wallpaperUrl` so installed bundles can point at their own URL. `env` carries `{ app, PIXI, ctx, helpers, dt, parallax: {x,y}, reducedMotion, tod, todPhase, season, audio: {enabled, level, bass, mid, high}, perfTier: 'high'|'normal'|'low' }`. Scenes that ignore the new fields are unaffected.

The shared mount runner in `src/wallpaper/index.js` owns Pixi app creation (`await app.init`, `app.canvas`), the visibility hook (`desktop-mode.wallpaper.visibility`), the `document.visibilitychange` pause, per-minute `env.tod` recompute, the rolling-FPS `env.perfTier` sampler, the shuffle scheduler (every `odd_shuffle.minutes`), and audio analyser sampling. The runner also registers a built-in `odd-pending` gradient scene so the desktop has something to paint between activation and first starter-pack install.

**Swap-in-place** — the same `PIXI.Application` is reused across scene swaps. `app.stage.removeChildren()` runs between swaps; scenes must tolerate a fresh-but-reused app. Anything allocated outside the Pixi scene graph (timers, `window` listeners) belongs in `cleanup`.

## Pixi v8 conventions

- `new PIXI.Application()` + `await app.init({ … })` — v7 constructor options don't work.
- `app.canvas`, not `app.view`.
- Fluent Graphics: `g.rect(…).fill({…})`, `g.moveTo().lineTo().stroke({…})`.
- `app.ticker.add( ticker => { const dt = ticker.deltaTime } )` — callback receives a `Ticker`, not a number.
- Bloom layers: `h.makeBloomLayer(PIXI, strength)` returns a `Container` with `blendMode='add'` + `BlurFilter`.
- Teardown: `app.destroy(true, { children: true, texture: true })` — the shared runner does this.

`ticker.deltaTime` after a backgrounded tab can be huge. The runner clamps it to 2.5 before `tick` receives it.

## Extending ODD

ODD has a documented extension API (filters, events, registries,
lifecycle phases, error boundaries, debug inspector). Agents
adding features should prefer the extension API over monkey-patching
core files — see [docs/building-on-odd.md](docs/building-on-odd.md).

## Adding content

All new scenes / icon sets / widgets / apps land in `_tools/catalog-sources/` and ship via the remote catalog — **no plugin release required**. `pages.yml` rebuilds + publishes on every push to `main` that touches `_tools/catalog-sources/` or the builder.

### A new scene

1. Create `_tools/catalog-sources/scenes/<slug>/`.
2. Add `meta.json` with `{ slug, label, franchise, tags, fallbackColor, previewUrl, wallpaperUrl }` (URLs default to `site/catalog/v1/bundles/<slug>/...` if omitted — the builder fills them in).
3. Add `scene.js` (self-registering; see above).
4. Add `preview.webp` (~640×360, WebP q80) and `wallpaper.webp` (1920×1080, WebP q82).
5. `python3 _tools/build-catalog.py && odd/bin/validate-catalog` locally to confirm it builds.

### A new icon set

1. Create `_tools/catalog-sources/icon-sets/<slug>/`.
2. Add `manifest.json` with `{ slug, label, franchise, accent (#hex), description?, preview?, icons: { dashboard, posts, pages, media, comments, appearance, plugins, users, tools, settings, profile, links, fallback } }`.
3. Add SVGs named in `manifest.icons`, dropped next to the manifest.
4. Each SVG must parse as well-formed XML, have a `viewBox` or `width+height`, and contain no control bytes outside `\t\n\r`.
5. `odd/bin/validate-catalog` checks all of this.

### Including in the starter pack

Edit `_tools/catalog-sources/starter-pack.json`:

```json
{ "scenes": ["oddling-desktop"], "iconSets": ["oddlings"], "widgets": [], "apps": [] }
```

Slugs here must resolve to a catalog entry — the validator refuses to ship a starter pack that references missing bundles.

## Workflows

### Local iteration

1. `git clone` into `wp-content/plugins/odd/` (or symlink).
2. Activate ODD alongside WP Desktop Mode. The starter pack installs inline during the activation hook (no cron); if it failed you can force a retry with `wp eval 'odd_starter_ensure_installed( true );'`.
3. Plugin itself is no-build — plain JS loaded via `wp_enqueue_script`. Content bundles are built with `python3 _tools/build-catalog.py`.
4. For a full validation pass: `odd/bin/check-version && odd/bin/check-plugin-metadata && python3 _tools/build-catalog.py && ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog && npm test && odd/bin/build-zip && odd/bin/check-zip-contents`.

### Cut a release

1. Bump `Version:` header + `ODD_VERSION` constant in `odd/odd.php`.
2. `odd/bin/check-version --expect X.Y.Z && odd/bin/check-plugin-metadata` to confirm metadata matches.
3. Commit, push, tag: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. `.github/workflows/release-odd.yml` fires on the tag: reusable CI gates, catalog build + validate, Plugin Check, `odd/bin/build-zip`, zip contents check, `gh release create … --latest=true`, and the install-smoke suite against a hermetic MU-plugin fixture.

### Publishing new content

1. Add/modify files in `_tools/catalog-sources/`.
2. Optionally update `_tools/catalog-sources/starter-pack.json`.
3. `python3 _tools/build-catalog.py && odd/bin/validate-catalog` to confirm it builds.
4. Commit + push to `main`. `pages.yml` rebuilds the catalog and publishes to `odd.regionallyfamous.com/catalog/v1/`. No plugin release needed.

### CI

`.github/workflows/ci.yml` runs on every PR + push to `main`:
- `catalog-build-and-validate` — runs `_tools/build-catalog.py` then validates with `ODD_VALIDATE_REBUILD=1` for determinism.
- `check-version` — header + constant in `odd.php` agree; `check-plugin-metadata` keeps readme/changelog/minimums aligned.
- `json-valid` — `blueprint.json` + every `manifest.json` / `meta.json` under `_tools/catalog-sources/` parses.
- `vitest` — `npm test`.
- `phpcs` — WPCS.
- `phpunit` — PHP unit matrix.
- `zip-budget` — `odd/bin/build-zip` with a 2 MB cap plus `odd/bin/check-zip-contents`.
- `plugin-check` — official WordPress Plugin Check against the expanded release package.
- `site-lint` — `html-validate` over `site/index.html`.

`install-smoke.yml` boots real WordPress, activates ODD + WP Desktop Mode, serves a local catalog via the `ci/smoke/odd-smoke-fixture.php` MU-plugin, runs the starter-pack installer synchronously, and asserts the registries populate.

## Versioning

Version lives in two places inside `odd/odd.php` — keep them in sync on release:
- the `Version:` header (`* Version: X.Y.Z`)
- the `ODD_VERSION` constant (`define( 'ODD_VERSION', 'X.Y.Z' );`)

All other script/style/REST calls compute their cache-busting version from `ODD_VERSION` at runtime.

## Gotchas

- **SVG control bytes.** The icon-set validator scans for bytes `< 0x20` outside `\t\n\r`; an em-dash with a stray `\x14` once broke XML parsing in a prior release.
- **Client-side icon live-swap is a rabbit hole.** `data-menu-slug` on dock DOM is the *sanitized CSS ID* (e.g. `menu-posts`), not the raw menu slug (`edit.php`). The fix is going server-canonical via `desktop_mode_dock_item` + a reload; don't regress.
- **Catalog determinism.** `_tools/build-catalog.py` must produce byte-identical output on repeat runs. `ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog` enforces this in CI. Non-determinism usually comes from mtimes in zip entries or unsorted iteration.
- **GitHub release asset uploads** sometimes 409 "Error creating policy" right after release creation. The release workflow retries once after a 3 s pause.
- **Playground + CORS.** `raw.githubusercontent.com` and `github.com/*/releases/download/…` both serve with `access-control-allow-origin: *`. Other hosts usually don't — check with `curl -H "Origin: https://playground.wordpress.net" -I <url>` before pointing a blueprint at a new URL. `odd.regionallyfamous.com/catalog/v1/` (GitHub Pages) does serve `*`, which is why the remote catalog works from Playground.
- **Starter-pack retry backoff.** The starter install is inline and cron-free, but failed catalog fetches back off before retrying. Use `POST /odd/v1/starter/retry` or `wp eval 'odd_starter_ensure_installed( true );'` to force an immediate retry while debugging.
- **`desktop-mode.wallpaper.visibility` payload shape** is `{ id, state: 'hidden' | 'visible' }` per the recipe example. The `onVis` handler silently no-ops on anything else.

## File layout

```
.
├── odd/ plugin (see tree above)
├── _tools/catalog-sources/ source of truth for remote catalog
├── site/ GitHub Pages root (marketing + /catalog/v1/)
├── .github/workflows/
│ ├── ci.yml catalog-build-and-validate + tests
│ ├── pages.yml build + publish catalog to odd.regionallyfamous.com
│ ├── install-smoke.yml hermetic starter-pack install against fixture
│ └── release-odd.yml v* tag → build odd.zip → release (latest=true)
├── ci/smoke/odd-smoke-fixture.php MU-plugin for hermetic CI tests
├── blueprint.json Playground blueprint
├── README.md user-facing docs
├── CLAUDE.md this file
├── LICENSE GPLv2
└── dist/ build output (gitignored)
```
