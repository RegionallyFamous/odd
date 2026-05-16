# Building on ODD

> This page documents ODD's filter, event, registry, and lifecycle surface.
> Target audience: integrators and plugin authors who want to wire ODD into
> a larger system (theme, mu-plugin, companion plugin).
>
> **If you just want to ship a scene, icon set, widget, or app, don't read this page.**
> The four author guides — [Building an App](building-an-app.md),
> [Building a Scene](building-a-scene.md),
> [Building an Icon Set](building-an-icon-set.md),
> [Building a Widget](building-a-widget.md) — cover the `.wp` authoring
> path end-to-end. No filters, no PHP.

ODD is a WordPress plugin layered on top of [WP Desktop Mode](https://github.com/WordPress/desktop-mode).
Its content — scenes, icon sets, widgets, apps — is authored through
the universal `.wp` format and installed via the ODD Shop. The PHP
and JS registries on this page are the plumbing that makes that format
work, exposed so integrators can read from (and, in advanced cases,
write to) the same registries from their own plugins or themes.

All extension points follow WordPress conventions:

- **PHP surfaces** use `apply_filters` with well-defined registry shapes.
- **JS surfaces** use `@wordpress/hooks` actions/filters using
  dot-separated names (`odd.*`), matching WP Desktop Mode's `desktop-mode.*`
  convention.

Everything below is part of the 1.0 contract. Event names and filter
slugs are stable; the store shape is considered public.

## Registries (internal)

> These are how the `.wp` format is built. The four author guides are
> the recommended path for shipping content — you should only reach
> for the PHP registries below if you're integrating ODD into a larger
> system (a theme that paints its own scenes, a migration tool that
> back-fills icon sets, etc.).

Example — registering a scene directly in PHP (for reference only; the
`.wp` flow is strongly preferred):

```php
add_action( 'plugins_loaded', function () {
    if ( ! function_exists( 'oddout_register_scene' ) ) return;
    oddout_register_scene( [
        'slug'          => 'my-scene',
        'label'         => 'My Scene',
        'category'     => 'Mine',
        'tags'          => [ 'custom' ],
        'fallbackColor' => '#111827',
        'added'         => '2026-05-01',
    ] );
} );
```

Ship the matching `my-scene.js` + preview/wallpaper assets from your
own plugin, point `previewUrl` / `wallpaperUrl` in the descriptor at
URLs you serve, enqueue the scene module after `odd` using
`wp_enqueue_script`, and ODD will pick it up on the next page load.
The preferred authoring path is still a `.wp` bundle installed from
the remote catalog or sideloaded on the Shop page — see
[building-a-scene.md](building-a-scene.md).

## Lifecycle phases

Phases are monotonic — they never go backward — and each phase fires
exactly one event on `window.__odd.events`.

| Phase                  | Event name              | Fires when                                              |
|------------------------|-------------------------|---------------------------------------------------------|
| `boot`                 | `odd.boot`              | Shared modules loaded, store allocated.                 |
| `configured`           | `odd.configured`        | `window.odd` hydrated into the store.                   |
| `registries-ready`     | `odd.registries-ready`  | All JS registries populated (scenes, icon sets, etc.).  |
| `mounted`              | `odd.mounted`           | First scene painted by the wallpaper runtime.           |
| `ready`                | `odd.ready`             | Every enqueued subsystem reported in.                   |
| `teardown`             | `odd.teardown`          | Page unload / plugin shutdown.                          |

Use `window.__odd.lifecycle.whenPhase( 'ready' )` to await a phase:

```js
window.__odd.lifecycle.whenPhase( 'ready' ).then( () => {
    // Safe to touch any subsystem.
} );
```

`window.__odd.lifecycle.phase()` returns the current phase string.

## JavaScript SDK

`window.__odd.sdk` is the preferred browser entry point for companion
plugins and themes that need to read ODD state without coupling to each
individual module. It is a facade over the existing store, lifecycle,
diagnostics, and `window.__odd.api` helpers; `window.__odd.api` remains
available and unchanged for code that already uses it.

```js
var sdk = window.__odd && window.__odd.sdk;
if ( sdk ) {
    var prefs = sdk.preferences.get();
    sdk.preferences.save( { wallpaper: 'oddling-desktop' } );
    sdk.theme.set( 'dark' );
    sdk.toast( 'ODD is ready.' );

    var wallpaper = sdk.storage.get( 'user.wallpaper' );
    var off = sdk.onTeardown( function () {
        // Release timers, observers, or DOM nodes.
    } );

    var health = sdk.diagnostics.summary();
    // → { status: 'ok'|'warn'|'problems', ok: [], warn: [], problems: [] }
}
```

The SDK intentionally stays local. `sdk.diagnostics.summary()` and
`sdk.diagnostics.collect()` assemble browser-local state for UI and
bug reports; they do not send telemetry. Preference writes go through
the same `/odd/v1/prefs` cookie-auth endpoint used by the Shop.

For a tiny working reference, see
[`examples/build-for-desktop-mode`](../examples/build-for-desktop-mode/).
It includes one widget and one app that use Desktop Mode registration
contracts plus `window.__odd.sdk` without patching host DOM.

Useful groups:

| Group / method            | Purpose                                                       |
|---------------------------|---------------------------------------------------------------|
| `sdk.storage`             | Safe wrappers for `store.get`, `store.set`, `getState`, and subscriptions. |
| `sdk.preferences`         | Read the current user preference snapshot and save partial patches. |
| `sdk.theme`               | Get or save the ODD Shop theme (`light`, `dark`, `auto`).     |
| `sdk.capabilities()`      | Read localized install, Desktop Mode, toast, diagnostics, and storage capabilities. |
| `sdk.diagnostics.summary()` | Small health object for Shop/UI status chips and troubleshooting affordances. |
| `sdk.onTeardown()`        | Subscribe to the ODD teardown lifecycle.                      |

## Event bus

All events live on `window.__odd.events`, a typed wrapper around
`wp.hooks`. Use the constants on `window.__odd.events.NAMES` or subscribe
by string.

```js
const off = window.__odd.events.on( 'odd.scene-changed', ( p ) => {
    console.log( 'scene', p.from, '→', p.to );
} );
// off() to unsubscribe.
```

### Canonical events

| Name                          | Payload                                    |
|-------------------------------|--------------------------------------------|
| `odd.boot`                    | `{ from, to }`                             |
| `odd.configured`              | `{ from, to }`                             |
| `odd.registries-ready`        | `{ from, to }`                             |
| `odd.mounted`                 | `{ from, to }`                             |
| `odd.ready`                   | `{ from, to }`                             |
| `odd.teardown`                | `{ from, to }`                             |
| `odd.scene-changed`           | `{ from, to }`                             |
| `odd.scene-swap-started`      | `{ from, to }`                             |
| `odd.scene-swap-completed`    | `{ from, to, ms }`                         |
| `odd.scene-mount-failed`      | `{ slug, err }`                            |
| `odd.icon-set-changed`        | `{ from, to }`                             |
| `odd.shuffle-tick`            | `{ slug }`                                 |
| `odd.window-opened`           | `{ id, bounds }`                           |
| `odd.window-reopened`         | `{ id, windowId, ... }`                    |
| `odd.window-content-loading`  | `{ id, windowId }`                         |
| `odd.window-content-loaded`   | `{ id, windowId }`                         |
| `odd.window-closing`          | `{ id, windowId, ... }`                    |
| `odd.window-closed`           | `{ id }`                                   |
| `odd.window-focused`          | `{ id, bounds }`                           |
| `odd.window-blurred`          | `{ id, focusedTo }`                        |
| `odd.window-changed`          | `{ id, windowId, ... }`                    |
| `odd.window-detached`         | `{ id, url }`                              |
| `odd.window-bounds-changed`   | `{ id, windowId, bounds }`                 |
| `odd.window-body-resized`     | `{ id, windowId, width, height }`          |
| `odd.native-window-after-render` | `{ windowId, body, config }`             |
| `odd.native-window-before-close` | `{ windowId, config }`                   |
| `odd.desktop-layout-changed`  | `{ layout, primary, side }`                |
| `odd.shell-error`             | `{ message, err }`                         |
| `odd.iframe-error`            | `{ message, err }`                         |
| `odd.visibility-changed`      | `{ state: 'hidden' \| 'visible' }`         |
| `odd.error`                   | `{ source, err, severity, message, stack }`|
| `odd.app-installed`           | `{ slug, manifest }`                       |
| `odd.app-uninstalled`         | `{ slug }`                                 |
| `odd.app-enabled`             | `{ slug }`                                 |
| `odd.app-disabled`            | `{ slug }`                                 |
| `odd.app-opened`              | `{ slug, windowId, bounds }`               |
| `odd.app-closed`              | `{ slug, windowId }`                       |
| `odd.app-focused`             | `{ slug, windowId, bounds }`               |

Emitting a custom event is fine — prefix with your plugin's slug
(`myplugin.*`) rather than `odd.*` to avoid collision.

## Registries (extension API)

Each registry is a list that ODD reads at runtime through both a PHP
filter and a JS filter. Third parties add to the list via a filter
callback; ODD never exposes a mutable global to mutate directly.

| Registry          | PHP filter                | JS filter            | Helper (PHP)              |
|-------------------|---------------------------|----------------------|---------------------------|
| Scenes            | `oddout_scene_registry`      | `odd.scenes`         | `oddout_register_scene`      |
| Icon sets         | `oddout_icon_set_registry`   | `odd.iconSets`       | `oddout_register_icon_set`   |
| Muses             | `oddout_muse_registry`       | `odd.muses`          | `oddout_register_muse`       |
| Commands          | `oddout_command_registry`    | `odd.commands`       | `oddout_register_command`    |
| Widgets           | `oddout_widget_registry`     | `odd.widgets`        | `oddout_register_widget`     |
| Rituals           | `oddout_ritual_registry`     | `odd.rituals`        | `oddout_register_ritual`     |
| Motion primitives | `oddout_motion_primitive_registry` | `odd.motionPrimitives` | `oddout_register_motion_primitive` |
| Apps              | `oddout_app_registry`        | `odd.apps`           | `oddout_register_app`        |

### PHP example

```php
add_filter( 'oddout_scene_registry', function ( $scenes ) {
    $scenes[] = [
        'slug'          => 'my-scene',
        'label'         => 'My Scene',
        'category'     => 'Mine',
        'fallbackColor' => '#111827',
    ];
    return $scenes;
} );
```

The helper `oddout_register_scene( $scene )` is a thin wrapper that wires
the filter for you. It upserts on `slug` — passing the same slug twice
updates the existing row rather than duplicating it.

### JS example

```js
wp.hooks.addFilter( 'odd.scenes', 'myplugin/extra-scene', ( scenes ) => {
    return scenes.concat( [
        {
            slug: 'my-scene',
            label: 'My Scene',
            category: 'Mine',
            fallbackColor: '#111827',
        },
    ] );
} );
```

Reads go through `window.__odd.registries` (`readScenes`, `readIconSets`,
`findScene`, `findIconSet`, etc.), which call `applyFilters` on every
read so late-registered callbacks are picked up.

## State store

`window.__odd.store` is the single source of truth. It's a plain object
with a typed shape:

```js
{
    user: {
        wallpaper, favorites, recents, shuffle, audioReactive, iconSet,
        schemaVersion,
    },
    registries: {
        scenes, iconSets, muses, commands, widgets, rituals,
        motionPrimitives,
    },
    runtime: {
        phase, tod, season, perfTier, reducedMotion, debug,
    },
}
```

API:

```js
window.__odd.store.get( 'user.wallpaper' );           // any path, dotted
window.__odd.store.set( 'runtime.tod', 'night' );     // emits odd.store.updated
window.__odd.store.subscribe( 'user', ( next ) => … );// path-scoped
window.__odd.store.persistUser( { wallpaper: 'x' } ); // POST /odd/v1/prefs
```

Writes are shallow + depth-2 merged. Subscribers fire after the merge.

## Error boundaries

Every public surface inside ODD is wrapped in `window.__odd.safeCall`.
If your extension throws, ODD swallows the exception, logs it, and
emits `odd.error`:

```js
window.__odd.events.on( 'odd.error', ( { source, err, severity } ) => {
    // Ship to your own telemetry, or inspect in devtools.
} );
```

The wrapper is available to your own code too:

```js
const tick = window.__odd.safeCall.wrapMethod( scene, 'tick', 'myplugin.tick' );
```

Severity is `'warn'` by default; pass `'error'` for unrecoverable
failures.

## Debug inspector

Enable debug mode one of two ways:

- Set `desktopModeConfig.debug = true` (WP Desktop Mode exposes this).
- Append `?odd-debug=1` to any URL that loads the Desktop shell.

Then in devtools:

```js
window.__odd.debug.state();       // deep snapshot of the store
window.__odd.debug.events( 50 );  // last 50 bus events
window.__odd.debug.registries();  // filtered registry contents
window.__odd.debug.timings();     // boot/phase timings in ms
window.__odd.debug.dump();        // everything, formatted
```

In production (debug off) the inspector installs a no-op stub, so
there's no memory cost.

## Migrations

ODD runs versioned one-shot migrations on `admin_init`. Each migration
gets a single schema version bump via `oddout_schema_version` user meta.

Add your own migration by hooking `oddout_migrations`:

```php
add_filter( 'oddout_migrations', function ( $list ) {
    $list[] = [
        'version' => 2,
        'name'    => 'my-migration',
        'run'     => 'myplugin_migration_2',
    ];
    return $list;
} );

function myplugin_migration_2( $user_id ) {
    // Idempotent! Runs once per user.
}
```

Migrations must be idempotent — ODD records completion *after* they run,
so a crashed migration re-runs on next load.

## Iris — the default muse, motion vocabulary, and rituals

Iris is a personality layer built entirely on the Cut 1 extension
surface. Nothing about her is special-cased in core; she's six small
modules that register the default muse, five motion primitives, three
rituals, a reactivity shim, a floating eye overlay, and the first-run
onboarding card. A third-party plugin can replace any of them by
adding a filter with a higher priority, or register an additional muse
to play alongside her.

### Muses

```javascript
wp.hooks.addFilter( 'odd.muses', 'my-plugin/anya', function ( muses ) {
    muses.push( {
        slug:  'anya',
        label: 'Anya',
        voice: {
            boot: [ 'Boot complete.' ],
            sceneOpen: { 'oddling-desktop': [ 'Something blinked.' ] },
        },
    } );
    return muses;
} );
```

`window.__odd.iris.say( 'bucket' )` routes through the currently-active
muse (Iris, unless another is installed) and honors the user's
`mascotQuiet` preference.

### Motion primitives

The registry `odd.motionPrimitives` defines five named motions:
`blink`, `wink`, `glance`, `glitch`, `ripple`. Each entry has a
`run(opts)` method. When `run` fires, it:

1. Emits `odd.motion.<slug>` on the event bus.
2. Calls the matching optional hook on the active scene
   (`onRipple`, `onGlitch`, `onGlance`) if one is registered.

Scenes opt in by implementing any subset of the hooks. Reduced-motion
short-circuits everything except `glance` so focus tracking still
works for keyboard users.

### Rituals

The `odd.rituals` registry lists three built-ins:

| Slug       | Trigger                                                           |
| ---------- | ----------------------------------------------------------------- |
| `festival` | Konami code (↑↑↓↓←→←→BA) on the window                            |
| `dream`    | 120 s of no `pointermove` / `keydown` / `wheel` / `touchstart`    |
| `seven`    | Seven rapid pointerdown→pointerup pairs on the ODD desktop icon   |

Each ritual fires `odd.ritual.<slug>` on the bus. Third parties add
their own via the same filter, or hook the built-ins by subscribing.

### Iris prefs slice

Three new booleans live under `store.user`, written via
`/odd/v1/prefs` and mirrored on the REST GET response:

- `initiated` — onboarding card dismissed
- `mascotQuiet` — Iris toasts suppressed (motion still plays)
- `winkUnlocked` — The Seven has been found

## Apps

ODD apps are self-contained static bundles (HTML + CSS + JS + assets)
that run inside a sandboxed iframe, get their own desktop icon, and
appear in their own WP Desktop Mode native window. Every app looks
the same to the host whether it arrives from the remote catalog
(`https://odd.regionallyfamous.com/catalog/v1/`), is sideloaded as a
`.wp` archive, or is registered programmatically by a companion plugin.

The plugin ships **zero** built-in apps. Apps install from the catalog
on demand via `POST /odd/v1/bundles/install-from-catalog`, the same
bundle endpoint used by scenes, widgets, icon sets, and cursor sets.

App authoring is documented in three dedicated pages:

- **[Building an App](building-an-app.md)** — the authoring walkthrough:
  archive anatomy, vanilla + React quickstarts, WordPress REST
  communication, sandbox capabilities, debugging.
- **[App Manifest Reference](app-manifest.md)** — every `manifest.json`
  field with types, defaults, and validation rules.
- **[Apps REST API](app-rest-api.md)** — every endpoint with
  request / response shapes and error codes.

This section covers only the extension-author surface: the app
registry, the JS lifecycle events, and how apps plug into the same
registries (`muses`, `commands`, `widgets`, `rituals`,
`motionPrimitives`) that plugin authors use directly.

### Where apps live

| Option                   | Purpose                                                   |
|--------------------------|-----------------------------------------------------------|
| `oddout_apps_index`         | Flat `{ slug => index_row }` map. Autoloaded.             |
| `oddout_app_<slug>`         | Full manifest + runtime fields for one app. Lazy-loaded.  |
| `oddout_apps_shared_secret` | Optional shared secret for catalog auth (future use).     |

Extracted bundles live in `wp-content/uploads/odd/apps/<slug>/`. A
`.htaccess` in that directory blocks direct HTTP access — every file
is served through `GET /odd/v1/apps/serve/<slug>/<path>`, which
re-runs capability and forbidden-extension checks on every request.
The extraction pipeline is atomic (stage + rename), so a crashed
install never leaves a half-extracted app visible to the server.

### `manifest.extensions` — apps that extend ODD

Any of the registries listed [above](#registries-extension-api) can be
pre-populated from an app's manifest:

```json
{
    "slug":    "ledger",
    "name":    "Ledger",
    "version": "1.0.0",
    "extensions": {
        "muses":            [ { "slug": "ledger", "voice": { … } } ],
        "commands":         [ { "slug": "open-ledger", "label": "Open Ledger", "run": "odd.apps.open:ledger" } ],
        "widgets":          [],
        "rituals":          [],
        "motionPrimitives": []
    }
}
```

Entries are forwarded to the matching `oddout_register_*` helper on
install and re-applied on every pageload (at `init` priority 6), so an
app's registrations stay in effect without a companion PHP plugin.
Supported registries today: `muses`, `commands`, `widgets`, `rituals`,
`motionPrimitives`. Each entry must have a `slug`; invalid entries are
skipped silently so a malformed manifest never crashes the admin. ODD
tags each registration with `source: "app:<slug>"` so the debug
inspector can tell app-contributed entries from core / plugin ones.

### Lifecycle events

App lifecycle fires on `window.__odd.events`:

| Name                  | Payload                     |
|-----------------------|-----------------------------|
| `odd.app-installed`   | `{ slug, manifest }`        |
| `odd.app-uninstalled` | `{ slug }`                  |
| `odd.app-enabled`     | `{ slug }`                  |
| `odd.app-disabled`    | `{ slug }`                  |
| `odd.app-opened`      | `{ slug, windowId, bounds }`|
| `odd.app-closed`      | `{ slug, windowId }`        |
| `odd.app-focused`     | `{ slug, windowId, bounds }`|

The `odd-apps` JS module watches `odd.window-opened` for windows whose
id matches `odd-app-<slug>`, injects the sandboxed iframe into the
server-rendered mount point, and re-emits the `odd.app-*` events. Iris
listens to `odd.app-opened` and fires a `wink` motion primitive plus
an `appOpen.<slug>` voice line — per-slug overrides live in the app's
`manifest.extensions.muses` entry.

### PHP helpers

```php
$result  = oddout_apps_install( $tmp_path, $filename );       // array|WP_Error
$done    = oddout_apps_uninstall( $slug );                    // true|WP_Error
$ok      = oddout_apps_set_enabled( $slug, $bool );           // true|WP_Error
$ok      = oddout_apps_set_surfaces( $slug, $surfaces );      // true|WP_Error
$s       = oddout_apps_row_surfaces( $row );                  // { desktop: bool, taskbar: bool }
$rows    = oddout_apps_list();                                // array of index rows (surfaces backfilled)
$m       = oddout_apps_get( $slug );                          // full manifest|[]
$is      = oddout_apps_exists( $slug );                       // bool
```

All writers fire the matching `oddout_app_*` WP action (`oddout_app_installed`,
`oddout_app_uninstalled`, `oddout_app_enabled`, `oddout_app_disabled`,
`oddout_app_surfaces_changed`) in addition to the JS bus events above.
Third-party registrations can also be injected directly via the
`oddout_app_registry` filter.

### App surfaces

Each installed app has two **visible** launch surfaces — the desktop
shortcut icon and the Desktop Mode taskbar icon — plus an always-on
**invisible** surface (the registered native window, reachable from
`wp.desktop.openWindow( 'odd-app-<slug>' )` regardless of the two
visible ones).

The visible pair is controlled by a per-app `surfaces` object on each
index row:

```php
array(
    'desktop' => true,   // render a desktop icon
    'taskbar' => false,  // pin a taskbar icon
)
```

Manifest authors set the install-time defaults via
`manifest.surfaces.{desktop,taskbar}`; users override per install from
the **ODD Shop → Apps** card. Missing keys default to
`{ desktop: true, taskbar: false }` so rows without explicit surface
metadata remain usable.

Under the hood this forwards into Desktop Mode's stable
`desktop_mode_register_window( id, [ 'placement' =>
'taskbar'|'none', ... ] )` argument and conditionally skips
`desktop_mode_register_icon()` when `surfaces.desktop` is false. ODD
registers no custom dock filters and no click handlers — Desktop Mode
paints the pill and wires its `onOpen` call to the window manager.

`oddout_app_surfaces_changed` fires after a successful
`oddout_apps_set_surfaces()` call. Handlers receive
`( string $slug, array $surfaces )` where `$surfaces` is the clean,
normalized `{ desktop: bool, taskbar: bool }` shape. The REST route
that the Shop calls (`POST /odd/v1/apps/{slug}/toggle` with a
`surfaces` body) goes through the same helper, so PHP listeners see
both user edits and direct helper calls on the same hook.

### Sandboxing

Apps run in an `<iframe>` with `sandbox="allow-scripts allow-forms
allow-popups allow-same-origin allow-downloads"`. The host never
exposes ODD's store, events, or lifecycle to the iframe directly —
cross-frame communication is your choice (`postMessage` is the
recommended pattern). The iframe's `src` is
`/odd-app/<slug>/?_wpnonce=<fresh-nonce>` so relative app assets load
through the cookie-auth serve path and apps can authenticate REST calls
on their own (see the
[authentication section](app-rest-api.md#authentication) of the REST
API page).

### Debug helpers

```js
window.__odd.debug.apps();
// → { installed: [...], pinned: [...], enabled: [...], open: [...] }
```

## Testing

ODD ships a Vitest + jsdom harness under `tests/integration/`. To
add a test for your extension:

1. Install ODD locally and `npm install`.
2. Add a `*.test.js` next to the existing harness.
3. `npm test`.

The harness provides `resetOdd`, `seedConfig`, `loadFoundation`, and
`sleep` helpers under `tests/integration/harness.js`.

The public creator mini-site lives at [`site/build/`](../site/build/).
It mirrors the high-level path for people who want the shape of the
platform before opening the repo or the example pack.

## Versioning and stability

- Event names, filter slugs, and registry keys listed here are part of
  ODD's 1.x contract. Breaking changes land on major bumps only.
- Store shape is considered public — additions are fine, removals
  require a major.
- PHP helper function names (`oddout_register_*`) are stable and callable
  from any WordPress context (plugins, themes, `mu-plugins`).

If you ship an ODD extension, please drop an issue in
[RegionallyFamous/odd](https://github.com/RegionallyFamous/odd) so we
can link it from this page.
