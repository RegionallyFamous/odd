# Building an ODD Widget

> One of four ODD author guides. Siblings: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building an Icon Set](building-an-icon-set.md).

A widget is a small, self-contained card that lives on the ODD
desktop — not inside the ODD Shop. It's a single JavaScript file
that calls `wp.desktop.registerWidget()` at load. Zip it with a
`manifest.json`, drop the `.wp` on the ODD Shop, and the widget
appears in the Widgets department where users can toggle it onto their
desktop.

Widgets ship JavaScript that runs in your admin session, so ODD asks
once per session before installing a widget or scene. Consent is
remembered on `window.__odd.store`.

---

## Anatomy

```
my-widget.wp
├── manifest.json
├── widget.js               ← calls wp.desktop.registerWidget()
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
    "icon":        "icon.svg",
    "preview":     "preview.webp",
    "defaultSize": { "width": 220, "height": 180 }
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
| `icon`        | no       | SVG/PNG/WebP shown on the Shop tile. Falls back to a generic glyph.   |
| `preview`     | no       | Hero WebP shown on the detail sheet.                                  |
| `defaultSize` | no       | `{ width, height }` in CSS px for the widget's first paint.           |

## widget.js — the runtime contract

ODD enqueues your entry JS on every admin page with `desktop-mode` and
`odd-api` as dependencies, so `wp.desktop.registerWidget` and
`window.__odd.api` are guaranteed to exist by the time your file runs.
Self-register and do nothing else at load time:

```js
( function () {
    'use strict';

    if ( ! ( window.wp && window.wp.desktop && typeof window.wp.desktop.registerWidget === 'function' ) ) {
        return;
    }

    window.wp.desktop.registerWidget( {
        id:    'pomodoro/pomodoro',
        label: 'Pomodoro',
        defaultSize: { width: 220, height: 180 },

        mount: function ( container, ctx ) {
            // container is a DOM element the widget layer gives you.
            // ctx.persist / ctx.restore hand you any saved state.
            container.innerHTML = '<button data-start>Start 25:00</button><p data-display>25:00</p>';
            var display = container.querySelector( '[data-display]' );
            var start   = container.querySelector( '[data-start]' );

            var remaining = ( ctx.restore && ctx.restore().remaining ) || 25 * 60;
            var timer     = null;

            start.addEventListener( 'click', function () {
                if ( timer ) return;
                timer = setInterval( function () {
                    remaining -= 1;
                    if ( remaining <= 0 ) {
                        clearInterval( timer );
                        timer = null;
                        remaining = 25 * 60;
                        ctx.toast && ctx.toast( 'Break time!' );
                    }
                    display.textContent = format( remaining );
                    ctx.persist && ctx.persist( { remaining: remaining } );
                }, 1000 );
            } );

            function format( s ) {
                var m = Math.floor( s / 60 ), r = s % 60;
                return ( m < 10 ? '0' : '' ) + m + ':' + ( r < 10 ? '0' : '' ) + r;
            }

            return function unmount() {
                if ( timer ) clearInterval( timer );
            };
        },
    } );
} )();
```

### Registration contract

`wp.desktop.registerWidget( descriptor )` takes:

| Field          | Required | Meaning                                                              |
|----------------|----------|----------------------------------------------------------------------|
| `id`           | yes      | `namespace/slug` form; namespace is your author or widget slug.      |
| `label`        | yes      | Display name in the dock + Shop.                                     |
| `defaultSize`  | no       | `{ width, height }` used on first mount.                             |
| `mount`        | yes      | `mount( container, ctx )` → optional `unmount` function.             |
| `icon`         | no       | SVG string or URL. The Shop already renders `manifest.icon`.         |

### The `ctx` helper bag

The widget layer passes your `mount` a `ctx` object with the bits you
need to integrate cleanly:

| Method            | Purpose                                                                         |
|-------------------|---------------------------------------------------------------------------------|
| `ctx.persist(s)`  | Save a JSON-serialisable snapshot. Next mount will see it via `ctx.restore()`.  |
| `ctx.restore()`   | Return the last persisted snapshot (or `undefined` if none).                    |
| `ctx.toast(msg)`  | Surface a toast via the shared ODD muse-routing pipeline.                       |
| `ctx.close()`     | Programmatically remove the widget from the desktop.                            |

## Mounting, unmounting, and state

- `mount` runs every time the widget is added to the desktop, or every
  time the admin page reloads with the widget already enabled.
- If you return a function from `mount`, the widget layer treats it as
  the unmount handler — called when the widget is removed, the window
  closes, or `ctx.close()` fires. Tear down timers, event listeners,
  `AudioContext` nodes, and any DOM you injected outside `container`.
- `ctx.persist` is synchronous and debounced inside the layer. Call it
  whenever state that should survive a reload changes; don't call it
  on every keystroke — once per user action is the right rhythm.
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
    wp option get oddout_widget_my-widget
    ```

- If the widget doesn't show up in the Widgets department after
  install, your `registerWidget` call probably threw during page load.
  Open the console — ODD logs the error with
  `source: 'widget.<slug>'`.
- Persisted widget enablement aggregates under `desktop-mode.widgets` in localStorage,
  alongside any per-widget transient keys Desktop Mode uses for sizing or state.

## See also

- [`.wp` Manifest Reference](wp-manifest.md) — full widget manifest schema.
- [Building on ODD](building-on-odd.md) — extension registries + debug inspector.
- Sibling author guides: [Building an App](building-an-app.md), [Building a Scene](building-a-scene.md), [Building an Icon Set](building-an-icon-set.md).
