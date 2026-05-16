# Architecture

> Status: v1.0.0. Mirrored to the
> [Architecture](https://github.com/RegionallyFamous/odd/wiki/Architecture)
> wiki page. For the agent-focused overview see
> [`CLAUDE.md`](../CLAUDE.md).

## The one-line summary

ODD 1.0 is a lightweight WordPress plugin whose content (wallpapers, icon
sets, cursor sets, widgets, apps) lives in a remote catalog at
`https://odd.regionallyfamous.com/catalog/v1/`. On activation the
plugin reads the catalog's `starter_pack`, pulls the starter scene,
icon set, and cursor set as universal `.wp` bundles, and verifies their
SHA256 before extracting. The starter path is synchronous with an
inline safety net; it does not depend on WP-Cron. Everything else
installs on demand from the ODD Shop.

## File tree

```
odd/                                the plugin — JS/PHP/CSS only, no bundled content
├── odd.php                         bootstrap + ODDOUT_VERSION constant
├── includes/
│   ├── enqueue.php                 odd-api / odd / odd-panel / odd-commands / odd-desktop-hooks handles
│   ├── rest.php                    /odd/v1/prefs (GET+POST)
│   ├── migrations.php              current v1 schema marker (oddout_schema_version)
│   ├── native-window.php           desktop_mode_register_window('odd', ...)
│   ├── starter-pack.php            inline starter install + backoff + retry REST
│   ├── content/
│   │   ├── catalog.php             remote registry fetch + transient cache + install-from-catalog REST
│   │   ├── scenes.php              installed-scene bundle loader (filter → oddout_scene_registry)
│   │   ├── iconsets.php            installed-icon-set bundle loader
│   │   ├── cursor-sets.php         installed-cursor-set bundle loader
│   │   ├── widgets.php             installed-widget bundle loader + enqueue
│   │   └── bundle.php              universal .wp installer (validate + extract + register)
│   ├── wallpaper/
│   │   ├── registry.php            filter-driven oddout_wallpaper_scenes()
│   │   └── prefs.php               per-user pref getters (oddout_wallpaper_*)
│   ├── icons/
│   │   ├── registry.php            installed-icon-set manifest reader + raster URL registry
│   │   └── dock-filter.php         Desktop Mode dock/icon filters @ priority 20
│   └── apps/
│       ├── bootstrap.php           feature flag + require_once list
│       ├── storage.php             oddout_apps_index + oddout_app_{slug} + .htaccess
│       ├── loader.php              zip validate + extract pipeline
│       ├── registry.php            install / uninstall / enable / list + oddout_app_registry filter
│       ├── rest.php                installed app /odd/v1/apps/* routes
│       ├── native-surfaces.php     per-app desktop icon + native window registration
└── src/
    ├── shared/api.js               window.__odd.api — prefs, Shop, toast, settings, badge, diagnostics helpers
    ├── shared/desktop-hooks.js     WP Desktop Mode hook bridge + ODD Settings tab
    ├── panel/index.js              Shop native-window render callback (unified catalog/installed cards)
    ├── cursors/index.js            active cursor stylesheet + pointer bridge runtime
    ├── wallpaper/
    │   ├── index.js                registerWallpaper('odd') + shared mount runner + 'odd-pending' fallback
    │   ├── picker.js               in-canvas picker module
    │   └── audio.js  easter-eggs.js
    └── apps/window-host.js         iframe injector + odd.app-* event re-emitter

_tools/                             author-side content, never shipped to users
├── catalog-sources/                source of truth for every bundle
│   ├── starter-pack.json           { scenes:[…], iconSets:[…], cursorSets:[…], widgets:[…], apps:[…] }
│   ├── scenes/<slug>/              scene.js + meta.json + preview.webp + wallpaper.webp
│   ├── icon-sets/<slug>/           manifest.json + PNG/WebP icons
│   ├── cursor-sets/<slug>/         manifest.json + living-layer preview.svg
│   ├── widgets/<slug>/             widget.js + widget.css? + manifest.json + preview.svg?
│   └── apps/<slug>/                prebuilt bundle.wp + icon.svg + meta.json
├── build-catalog.py                deterministic builder → site/catalog/v1/
└── helper scripts for catalog art, screenshots, and build checks

site/                               GitHub Pages deploy target
├── index.html  styles.css  wild.js marketing site
├── catalog/v1/
│   ├── registry.json               remote catalog manifest (consumed by oddout_catalog_load())
│   ├── registry.schema.json
│   ├── bundles/<type>-<slug>.wp    deterministic ZIP archives
│   └── icons/<slug>.*              tile-sized catalog preview icons
└── playground/                     WordPress Playground embed + blueprint

ci/smoke/
└── odd-smoke-fixture.php           MU-plugin that intercepts /catalog/v1/* HTTP calls
                                    with pre_http_request, serving local fixtures

odd/bin/
├── build-zip                       → dist/odd.zip (2 MB budget)
├── check-plugin-metadata           header/readme/changelog/minimum-version consistency
├── check-zip-contents              release package required/forbidden file checks
├── validate-catalog                schema + SHA256 + determinism + starter-pack resolution
├── build-previews                  reads _tools/catalog-sources/scenes/**, writes preview.webp
├── make-pot                        regenerates odd/languages/odd-outlandish-desktop-decorator.pot
└── check-version                   asserts Version: header == ODDOUT_VERSION constant
```

Extracted bundles (installed by users) live **outside** the plugin at
`wp-content/uploads/odd/apps/<slug>/`, `wp-content/uploads/odd/scenes/<slug>/`,
`wp-content/uploads/odd/icon-sets/<slug>/`, `wp-content/uploads/odd/cursor-sets/<slug>/`,
`wp-content/uploads/odd/widgets/<slug>/`.
They survive plugin reinstalls.

## Single-window contract

The registered desktop icon (`includes/native-window.php`), the
`/odd-panel` command, and `window.__odd.api.openPanel()` all call
`wp.desktop.registerWindow({ id: 'odd', baseId: 'odd', ... })`.
WP Desktop Mode's window manager reuses any window with a matching
`baseId`, so there's always at most one Shop window on screen.

The Shop body renders from `window.desktopModeNativeWindows.odd = body
=> { … }` in `src/panel/index.js`. The layout is the Mac App
Store-style design: top search bar, sidebar (Wallpapers / Icon Sets /
Cursors / Widgets / Apps / Install / Settings / About), content pane, and detail
or preview surfaces where needed.

Apps break the single-window rule intentionally: each installed app
registers its own `baseId: 'odd-app-<slug>'` window, so users can
have the Shop plus any number of app windows open simultaneously
(still capped to one window per app).

ODD targets WP Desktop Mode v0.8.5+ as its host baseline. It declares
command, settings-tab, and title-bar button scripts through Desktop
Mode's registration APIs, then uses `src/shared/desktop-hooks.js` as the
single bridge for window, iframe, widget, wallpaper, dock, command,
layout, loading, activity, devtools, and broad diagnostics coverage. The
bridge adds an ODD tab to OS Settings, decorates ODD dock tiles without
replacing the user's rail renderer, and adds a Copy Diagnostics title-bar
button to ODD windows.

## REST surface

`odd/v1` hosts four groups of endpoints:

| Group       | Base path                         | Purpose                                                     |
|-------------|-----------------------------------|-------------------------------------------------------------|
| Prefs       | `/odd/v1/prefs`                   | GET + POST user prefs (wallpaper, icon set, shuffle, …)     |
| Bundles     | `/odd/v1/bundles/*`               | Universal .wp catalog + upload + install                    |
| Starter     | `/odd/v1/starter`, `/starter/retry` | Read starter-pack state + force a retry                   |
| Apps        | `/odd/v1/apps/*`                | App management surface — forwards uploads to /bundles/* + serves files |

`POST /wp-json/odd/v1/prefs` accepts any subset of:

| Key             | Shape                                                       | Written to           |
|-----------------|-------------------------------------------------------------|----------------------|
| `wallpaper`     | scene slug, validated against `oddout_wallpaper_scene_slugs()` | `oddout_wallpaper`      |
| `favorites`     | `slug[]` capped to 50                                       | `oddout_favorites`      |
| `recents`       | `slug[]` capped to 12                                       | `oddout_recents`        |
| `shuffle`       | `{ enabled: bool, minutes: 1..240 }`                        | `oddout_shuffle`        |
| `audioReactive` | bool                                                        | `oddout_audio_reactive` |
| `iconSet`       | set slug or `"none"`                                        | `oddout_icon_set`       |
| `cursorSet`     | set slug or `"none"`                                        | `oddout_cursor_set`     |

Permissions are explicit per route: user-local reads and preference writes
require `current_user_can( 'read' )`, while installs, uploads, refreshes, and
diagnostics require `current_user_can( 'manage_options' )`. Public routes are
reserved for static generated assets such as cursor CSS and app icons, and must
stay path/MIME confined.

## Remote catalog

`includes/content/catalog.php`:

```php
oddout_catalog_load();          // wp_remote_get(ODDOUT_CATALOG_URL) + transient cache (12h, stale/fallback-on-fail)
oddout_catalog_starter_pack();  // reads starter_pack block from the registry
oddout_catalog_install_entry( $row ); // download_url() + SHA256 + catalog/manifest match + oddout_bundle_install()
```

| Constant             | Default                                                     | Override via             |
|----------------------|-------------------------------------------------------------|--------------------------|
| `ODDOUT_CATALOG_URL`    | `https://odd.regionallyfamous.com/catalog/v1/registry.json` | `oddout_catalog_url` filter |
| `oddout_catalog` transient | 12 hours                                                 | `delete_transient('oddout_catalog')` or `POST /odd/v1/bundles/refresh` |

Downloads are HTTPS-only by default; SHA256 is compared against the
registry entry before extraction, and the downloaded archive manifest
must match the catalog row's `slug` and `type`. A mismatch aborts the
install and never touches the final filesystem. Non-admin catalog
responses are redacted so installer-only fields stay behind the same
capability boundary as install actions.

## Starter pack

`includes/starter-pack.php` — **no cron, install inline**:

```php
register_activation_hook( ODD_PLUGIN_FILE, 'oddout_activate_install_starter' );
// ↓ synchronously runs oddout_starter_ensure_installed( force=true )

add_action( 'init', 'oddout_starter_safety_net', 20 );
// ↓ on every request, privileged users retry pending installs inline

function oddout_starter_ensure_installed( $force = false ) {
    // No-op fast if: already installed, another request is running
    // (lock auto-expires after 240 s), or we're inside the backoff
    // window ($force=true skips the last check).
    // Otherwise: take the lock, run oddout_starter_install_now(),
    // persist state=installed|failed, release the lock.
}
```

Retry is inline, not scheduled. State lives in `oddout_starter_state`:
`{ status, attempts, last_attempt, last_error, installed, prefs_set }`.
Backoff on failure (attempts 1→6): immediate, 30 s, 2 min, 10 min, 1 h,
6 h — enforced against `last_attempt` at the start of each safety-net
run. `GET /odd/v1/starter` exposes the current state; `POST
/starter/retry` forces a synchronous re-run that bypasses backoff.

Why no cron: WP-Cron only ticks when someone hits the site, and
`DISABLE_WP_CRON` is common in production. A freshly-activated site
whose admin lands straight on the frontend desktop could sit
`pending` forever. The inline model runs during activation (the admin
is already there) and on any subsequent privileged page load, so the
install heals itself without depending on external schedulers.

## Live scene swaps

Panel clicks fire `wp.hooks.doAction( 'odd.pickScene', slug )` in
parallel with the REST POST. The wallpaper engine subscribes under the
`odd.wallpaper` namespace and swaps the scene immediately — no reload.

## Icon swaps (server-canonical)

Icon-set changes save via the normal preferences endpoint and schedule a
short reload so Desktop Mode can rebuild its native icon payloads. Re-render
happens server-side through filters in `includes/icons/dock-filter.php`:

- `desktop_mode_dock_item` / `wp_desktop_dock_item` (priority 20, 2-arg):
  swaps dock/taskbar item `icon` values keyed by
  `oddout_icons_slug_to_key( $menu_slug )`, e.g. `edit.php` → `posts`.
- `desktop_mode_icons` / `wp_desktop_icons` (priority 20): re-skins desktop
  shortcuts by the same key logic, but skips ODD-owned launchers so apps
  keep their own art.
- `desktop_mode_shell_config` / `wp_desktop_shell_config` (priority 18):
  aligns matching native-window taskbar icons with their themed desktop
  shortcut icon when Desktop Mode exposes both shapes.

No CSS backplates or live DOM rewriting are involved; ODD only feeds
Desktop Mode the icon values it already asks plugins to provide. For
ODD icon sets, those values are normal PNG/WebP image URLs from the
active set, not inline image markup or recolored data URIs. Desktop Mode stays
responsible for placing, sizing, and rendering the dock, taskbar, desktop,
recycle bin, and file-layer shortcut surfaces.

## Icon raster feed

Every icon set declares an `icons` map whose values are relative PNG/WebP
paths. The installed-set registry resolves those paths against either the
plugin assets tree or `uploads/odd/icon-sets/<slug>/`, then returns a
single public URL per logical key:

1. `oddout_icons_get_sets()` scans icon-set manifests and converts each
   valid relative path into an upload/plugin asset URL.
2. Dock, taskbar, desktop-icon, recycle-bin, and file-layer filters
   all consume that same URL map.
3. The Shop uses the same registry for thumbnails, so the image shown in
   the panel is the image Desktop Mode receives after apply/reload.

The manifest `accent` remains Shop/catalog metadata. It does not recolor
icon images at runtime; the raster file owns its pixels.

## Scene module API

Every installed scene ships a single `scene.js` that self-registers:

```js
( function () {
    'use strict';
    window.__odd = window.__odd || {};
    window.__odd.scenes = window.__odd.scenes || {};
    var h = window.__odd.helpers;

    window.__odd.scenes[ '<slug>' ] = {
        setup:         function ( env ) {},               // required
        tick:          function ( state, env ) {},        // required; env.dt clamped to 2.5
        onResize:      function ( state, env ) {},        // optional
        cleanup:       function ( state, env ) {},        // optional
        stillFrame:    function ( state, env ) {},        // optional — reduced-motion pose
        transitionOut: function ( state, env, done ) {},  // optional
        transitionIn:  function ( state, env ) {},        // optional
        onAudio:       function ( state, env ) {},        // optional — only when env.audio.enabled
        onEgg:         function ( name, state, env ) {},  // 'festival' | 'reveal' | 'peek'
    };
} )();
```

`env` carries `{ app, PIXI, ctx, helpers, dt, parallax: {x,y},
reducedMotion, tod, todPhase, season, audio: {enabled, level, bass,
mid, high}, perfTier: 'high'|'normal'|'low' }`. Scenes that ignore new
fields are unaffected.

The shared mount runner in `src/wallpaper/index.js` owns:

- Pixi app creation (`await app.init`, `app.canvas`)
- The `desktop-mode.wallpaper.visibility` subscription +
  `document.visibilitychange` pause
- Per-minute `env.tod` recompute, rolling-FPS `env.perfTier` sampler
- The shuffle scheduler (every `oddout_shuffle.minutes`)
- Audio analyser sampling
- The built-in `odd-pending` gradient fallback scene — painted in the
  window between activation and the starter pack completing, so a
  fresh desktop is never blank.

Swap-in-place: the same `PIXI.Application` is reused across scene
swaps. `app.stage.removeChildren()` runs between swaps; scenes must
tolerate a fresh-but-reused app. Anything allocated outside the Pixi
scene graph (timers, `window` listeners) belongs in `cleanup`.

## Pixi v8 conventions

- `new PIXI.Application()` + `await app.init({ … })` — v7 constructor
  options don't work.
- `app.canvas`, not `app.view`.
- Fluent Graphics: `g.rect(…).fill({…})`,
  `g.moveTo().lineTo().stroke({…})`.
- `app.ticker.add( ticker => { const dt = ticker.deltaTime } )` —
  callback receives a `Ticker`, not a number.
- Bloom layers: `h.makeBloomLayer(PIXI, strength)` returns a
  `Container` with `blendMode='add'` + `BlurFilter`.
- Teardown: `app.destroy(true, { children: true, texture: true })` —
  the shared runner does this.

`ticker.deltaTime` after a backgrounded tab can be huge. The runner
clamps it to 2.5 before `tick` receives it.

## Apps subsystem

> App-authoring pages:
> [Building an App](building-an-app.md),
> [App Manifest Reference](app-manifest.md),
> [Apps REST API](app-rest-api.md).

### High-level flow

```
ODD Shop → Install (remote catalog)
  → POST /odd/v1/bundles/install-from-catalog
  → oddout_catalog_install_entry( $row )
       download_url() → SHA256 verify + catalog/manifest slug/type match
       → oddout_apps_validate_archive()  ZIP integrity, limits, forbidden exts,
                                      path traversal, symlinks, manifest shape
       → oddout_apps_extract_archive()   unzip to .tmp-<slug>-<rand>/, symlink sweep,
                                      atomic rename into wp-content/uploads/odd/apps/<slug>/
       → oddout_apps_install()           write oddout_apps_index + oddout_app_<slug>,
                                      fire oddout_app_installed action,
                                      re-apply manifest.extensions
  → native-surfaces.php (init)        desktop_mode_register_window('odd-app-<slug>'),
                                      desktop_mode_register_icon('odd-app-<slug>')

User double-clicks the desktop icon
  → WP Desktop Mode opens odd-app-<slug> window
  → native-surfaces renders a <div class="odd-app-host"
     data-odd-app-src="/odd-app/<slug>/?_wpnonce=<fresh>">
  → src/apps/window-host.js sees odd.window-opened with a matching id,
     injects an <iframe sandbox="allow-scripts allow-forms allow-popups
     allow-same-origin allow-downloads"> pointing at the serve URL,
     re-emits odd.app-opened
```

Uploads go through `POST /odd/v1/bundles/upload` instead and skip the
catalog fetch, but hit exactly the same install pipeline after
validation.

### Storage model

| Option                    | Autoload | Purpose                                                |
|---------------------------|----------|--------------------------------------------------------|
| `oddout_apps_index`          | no       | Flat `{ slug => index_row }`. Fast path for listing.   |
| `oddout_app_<slug>`          | no       | Full manifest + runtime fields for one app.            |
| `oddout_apps_shared_secret`  | no       | Optional shared secret for signed app URLs. |
| `oddout_apps_install_lock_<slug>` | no  | Transient lock — `add_option` guard against concurrent installs. |
| `oddout_catalog`             | yes      | 12-hour transient cache of the remote registry.        |
| `oddout_starter_state`       | yes      | Starter-pack runner state + last error + attempt count. |

No custom tables. Migrations are per-user, run via the
`oddout_migrations` filter → `includes/migrations.php` pipeline.

### File layout on disk

```
wp-content/
└── uploads/odd/
    ├── apps/
    │   ├── .htaccess                "Require all denied" / "Deny from all"
    │   ├── <slug>/                  extracted bundle — manifest.json + assets
    │   └── .tmp-<slug>-<rand>/      transient staging dir (removed after extract)
    ├── scenes/<slug>/               scene.js + preview.webp + wallpaper.webp + manifest.json
    ├── icon-sets/<slug>/            manifest.json + PNG/WebP icons
    ├── cursor-sets/<slug>/          manifest.json + living-layer preview art
    └── widgets/<slug>/              widget.js + widget.css + manifest.json
```

`.htaccess` is written on first app install and blocks direct HTTP
access to the `uploads/odd/apps/` tree. App files are served through the
cookie-auth `/odd-app/<slug>/...` path, with `/apps/serve/...` kept as
the REST fallback/diagnostic path, so capability and forbidden-extension
checks apply per request. Scenes, icon sets, cursor sets, and widgets
are served from URLs derived from `wp_upload_dir()` directly — they ship no PHP and their
public visibility is equivalent to any other `wp-content/` asset.

### File serving (apps only)

`/odd-app/<slug>/<path>` from `serve-cookieauth.php` is the primary app
serve path. `GET /odd/v1/apps/serve/<slug>/<path>` remains available
for REST callers and diagnostics (see
[Apps REST API](app-rest-api.md#get-appsserveslugpath)).

1. Permission callback: logged-in + app exists + app enabled +
   `current_user_can( normalized app capability )`. Manifest
   capabilities cannot broaden access below the configured floor by
   default.
2. Path validation: reject `..`, leading `/`, NUL bytes, and anything
   outside `[a-zA-Z0-9._/-]`.
3. Extension re-check against the forbidden list (belt-and-braces;
   the manifest can't sneak a `.php` entry past validation).
4. `realpath()` confinement to the app's own base directory.
5. `readfile()` with headers: `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`,
   `Cache-Control` via `nocache_headers()`, `Content-Type` from a
   small MIME table.

Output buffers are drained before `readfile()` so a stray debug notice
or `admin_head` echo never corrupts the response body.

### Icon endpoint

`GET /odd/v1/apps/icon/<slug>` is the **only public Apps endpoint** —
intentionally, because `<img src>` tags cannot send an `X-WP-Nonce`
header, and dock / desktop icons are already public branding. Only
the manifest's declared icon path is served (no client-supplied path
is ever honored), with a long public cache header.

### Iframe nonce handoff

`native-surfaces.php` points app iframes at `/odd-app/<slug>/` and
appends a fresh `?_wpnonce=<wp_rest_nonce>` to the iframe's `src`.
Apps read it once with
`new URLSearchParams( window.location.search ).get( '_wpnonce' )` and
include it as `X-WP-Nonce` on outgoing `fetch()` calls to
`/wp-json/...`. App assets rely on cookie auth at `/odd-app/<slug>/...`;
REST writes still need the nonce. Nonces are user-scoped and expire
after 12 hours.

### `manifest.extensions` re-application

On every pageload (`init` priority 6), `oddout_apps_apply_manifest_extensions`
walks every enabled app's manifest and forwards each
`extensions.<registry>[]` entry to the matching `oddout_register_*()`
helper (`muses`, `commands`, `widgets`, `rituals`, `motionPrimitives`).
Each registration is tagged `source: "app:<slug>"`; malformed entries
are skipped silently.

### Sandbox details

Every app iframe is sandboxed with:

```
sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads"
referrerpolicy="no-referrer"
allow="clipboard-read; clipboard-write; fullscreen"
```

`allow-top-navigation` and `allow-modals` are **intentionally
excluded** — apps can't redirect the parent page, and
`alert()`/`confirm()`/`prompt()` are no-ops. Build your own modal UI
in-app.

`allow-same-origin` is required for cookie auth on REST calls, but it
means apps are not fully isolated from the host origin. Install apps
only from sources you trust, the same way you would a WordPress
plugin.

## CI hermetic testing

`ci/smoke/odd-smoke-fixture.php` is an MU-plugin loaded only by
`.github/workflows/install-smoke.yml`. It hooks `pre_http_request`
and, when ODD calls `wp_remote_get( ODDOUT_CATALOG_URL )` or tries to
download a bundle, serves a locally-built fixture from
`ODD_SMOKE_FIXTURE_ROOT` instead of reaching the live GitHub Pages
deploy.

Activation itself runs `oddout_starter_ensure_installed( true )` inline,
so by the time `wp plugin activate odd` returns the starter pack is
already installed. The workflow then reads `oddout_starter_get_state()`
and asserts `status === 'installed'`. Determinism of the catalog
build is enforced by `ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog`.

## v1 Data Baseline

ODD v1 starts from a clean public baseline. User content lives in the
database and `wp-content/uploads/odd/`; plugin runtime code lives in
the plugin directory; catalog content comes from the current remote
registry plus the bundled full-registry fallback.
