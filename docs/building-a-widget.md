# Building an ODD Widget

> One of four ODD author guides. Siblings: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building an Icon Set](building-an-icon-set.md).

A widget is a small, self-contained card that lives on the ODD
desktop — not inside the ODD Shop. It ships a single JavaScript file
that exposes a mount callback at `window.desktopModeWidgets[id]`.
ODD registers the widget metadata with Desktop Mode's native
`desktop_mode_register_widget()` helper, so Desktop Mode owns the
picker, dragging, resizing, local persistence, and lifecycle hooks.
Zip it with a `manifest.json`, drop the `.wp` on the ODD Shop, and the
widget appears in the Widgets department where users can add it to
their desktop.

Widgets ship JavaScript that runs in your admin session, so ODD asks
once per session before installing a widget or scene. Consent is
remembered on `window.__odd.store`.

---

## Anatomy

```
my-widget.wp
├── manifest.json
├── widget.js               ← sets window.desktopModeWidgets[id]
├── icon.svg                ← optional — shown on the Shop tile
└── preview.webp            ← optional — hero shot on the detail sheet
```

## Manifest

```json
{
    "type":        "widget",
    "slug":        "pomodoro",
    "name":        "Pomodoro",
    "label":       "Pomodoro",
    "version":     "1.0.0",
    "description": "25/5 focus timer that lives on the desktop.",
    "entry":       "widget.js",
    "icon":        "dashicons-clock",
    "preview":     "preview.webp",
    "movable":     true,
    "resizable":   true,
    "minWidth":    220,
    "minHeight":   160,
    "maxWidth":    520,
    "maxHeight":   420,
    "defaultWidth": 260,
    "defaultHeight": 200
}
```

| Field         | Required | Purpose                                                               |
|---------------|----------|-----------------------------------------------------------------------|
| `type`        | yes      | Must be `"widget"`.                                                   |
| `slug`        | yes      | `^[a-z0-9-]+$`, globally unique across all bundle types.              |
| `name`        | yes      | Display name.                                                         |
| `label`       | no       | Falls back to `name`. Used in the dock context-menu.                  |
| `version`     | yes      | Semver-ish string; drives cache-busting on the enqueued JS.           |
| `description` | no       | Longer copy on the detail sheet + accessibility description.          |
| `entry`       | yes      | Relative path to the JS (`^[a-zA-Z0-9._/-]+$`, no `..`).              |
| `icon`        | no       | Dashicon class for Desktop Mode's native widget picker. Falls back to a generic glyph. |
| `preview`     | no       | Hero WebP shown on the detail sheet.                                  |
| `movable`     | no       | Whether Desktop Mode can drag the widget out of the widget column. Defaults to `true`. |
| `resizable`   | no       | Whether Desktop Mode can resize the widget. Defaults to `true`.       |
| `minWidth` / `minHeight` | no | Minimum native widget dimensions in CSS px.                      |
| `maxWidth` / `maxHeight` | no | Optional maximum native widget dimensions in CSS px.              |
| `defaultWidth` / `defaultHeight` | no | First-mount native widget dimensions in CSS px.              |
| `capabilities` | no      | Optional WordPress capabilities Desktop Mode must see before registering the widget. |

## widget.js — the runtime contract

ODD registers installed widgets with Desktop Mode's native widget
registry and enqueues your entry JS with `desktop-mode` and `odd-api`
as dependencies. Your entry should define the mount callback and do
nothing else expensive at load time:

```js
( function () {
    'use strict';

    function mount( container, ctx ) {
        container.innerHTML = '<button data-start>Start 25:00</button><p data-display>25:00</p>';
        var display = container.querySelector( '[data-display]' );
        var start   = container.querySelector( '[data-start]' );
        var saved   = ctx.storage && ctx.storage.get( 'timer' );
        var remaining = saved && saved.remaining || 25 * 60;
        var timer     = null;

        function format( s ) {
            var m = Math.floor( s / 60 ), r = s % 60;
            return ( m < 10 ? '0' : '' ) + m + ':' + ( r < 10 ? '0' : '' ) + r;
        }

        function render() {
            display.textContent = format( remaining );
            if ( ctx.storage ) ctx.storage.set( 'timer', { remaining: remaining } );
        }

        start.addEventListener( 'click', function () {
            if ( timer ) return;
            timer = setInterval( function () {
                remaining -= 1;
                if ( remaining <= 0 ) {
                    clearInterval( timer );
                    timer = null;
                    remaining = 25 * 60;
                    if ( window.__odd && window.__odd.api ) {
                        window.__odd.api.toast( 'Break time!' );
                    }
                }
                render();
            }, 1000 );
        } );

        render();
        return function unmount() {
            if ( timer ) clearInterval( timer );
        };
    }

    window.desktopModeWidgets = window.desktopModeWidgets || {};
    window.desktopModeWidgets[ 'odd/pomodoro' ] = mount;
} )();
```

### Desktop Mode Metadata

Widget metadata comes from `manifest.json`. ODD validates and stores
that metadata, then passes it to Desktop Mode via
`desktop_mode_register_widget( 'odd/<slug>', ... )`. The widget entry
file should only expose `window.desktopModeWidgets['odd/<slug>']`; for
same-page installs, ODD reads that mount function and updates Desktop
Mode after the script finishes loading.

### The `ctx` helper bag

The widget layer passes your `mount` a `ctx` object with the bits you
need to integrate cleanly:

| Method            | Purpose                                                                         |
|-------------------|---------------------------------------------------------------------------------|
| `ctx.id`          | The widget id.                                                                  |
| `ctx.pluginUrl`   | Absolute Desktop Mode plugin URL, useful for host-owned assets.                 |
| `ctx.storage.get(k)` | Read a JSON-serialisable value from this widget's namespaced storage.        |
| `ctx.storage.set(k, v)` | Save a value in this widget's namespaced storage.                         |
| `ctx.storage.remove(k)` / `ctx.storage.clear()` | Remove one key, or clear this widget's storage namespace.  |

## Mounting, unmounting, and state

- `mount` runs every time the widget is added to the desktop, or every
  time the admin page reloads with the widget already enabled.
- If you return a function from `mount`, the widget layer treats it as
  the unmount handler — called when the widget is removed, the window
  closes, or `ctx.close()` fires. Tear down timers, event listeners,
  `AudioContext` nodes, and any DOM you injected outside `container`.
- `ctx.storage` is synchronous and namespaced per widget id. Call it
  whenever state that should survive a reload changes; don't call it
  on every animation frame.
- The widget is rendered inside a WP Desktop Mode surface. You own
  `container.innerHTML`; don't reach outside it unless you really need
  to (e.g. a menu that should escape the card).

## Styling

- Keep CSS scoped. Either use a unique class prefix or attach styles
  directly to the `container` element.
- If you ship a `<style>` block in your JS, inject it into
  `container`, not `document.head`, so two copies of the widget can
  co-exist without leaks.
- Reduced-motion: check
  `window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches` and
  downgrade animations accordingly.

## Ship it

1. Zip the folder:

    ```bash
    cd my-widget/
    zip -r ../my-widget.wp manifest.json widget.js icon.svg preview.webp
    ```

2. Open the ODD Shop → **Upload** (or drop the `.wp` anywhere on the
   Shop). To ship it to every ODD install world-wide, open a PR that
   adds your source folder at
   `_tools/catalog-sources/widgets/<slug>/` — the next Pages deploy
   publishes the bundle at
   `https://odd.regionallyfamous.com/catalog/v1/`, where the Widgets
   department picks it up on next refresh.
3. Confirm the JavaScript-execution prompt on the first widget or
   scene install of the session.
4. On success, the Shop jumps to Widgets and flashes your widget's
   tile. Click **Add to desktop** to pin it on the right rail.

## Debugging

- DevTools work normally. Your `widget.js` is enqueued as
  `odd-widget-<slug>` with `version` pinned to `manifest.version`.
- Inspect the stored manifest:

    ```bash
    wp option get oddout_widgets_index
    ```

- If the widget doesn't show up in the Widgets department after
  install, your script probably did not define
  `window.desktopModeWidgets['odd/<slug>']`.
  Open the console — ODD logs the error with
  `source: 'widget.<slug>'`.
- Persisted widget enablement aggregates under `desktop-mode-widgets` in localStorage,
  alongside any per-widget transient keys Desktop Mode uses for sizing or state.

## See also

- [`.wp` Manifest Reference](wp-manifest.md) — full widget manifest schema.
- [Building on ODD](building-on-odd.md) — extension registries + debug inspector.
- Sibling author guides: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building an Icon Set](building-an-icon-set.md).
