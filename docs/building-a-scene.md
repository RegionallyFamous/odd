# Building an ODD Scene

> One of four ODD author guides. Siblings: [Building an App](building-an-app.md), [Building an Icon Set](building-an-icon-set.md), [Building a Widget](building-a-widget.md).

A scene is a generative wallpaper that paints the ODD desktop. It's a
single JavaScript file that self-registers with ODD, plus a painted
backdrop (still WebP, 1920×1080) and a preview thumbnail (WebP,
~640×360). Zip them together with a `manifest.json` and drop the `.wp`
on the ODD Shop — ODD picks it up, enqueues the JS on every admin
page, and surfaces your scene in the Wallpapers department.

You don't touch WordPress, REST, or PHP.

---

## Anatomy

```
my-scene.wp
├── manifest.json
├── scene.js                ← self-registers into window.__odd.scenes[slug]
├── preview.webp            ← ~640×360, shows up on the Shop card
└── wallpaper.webp          ← 1920×1080, painted backdrop beneath the scene
```

Every file except the manifest is addressable from the manifest — you
can rename them and point `entry` / `preview` / `wallpaper` at the new
paths. The tree above is the convention ODD's first-party catalog
scenes follow.

## Manifest

```json
{
    "type":          "scene",
    "slug":          "my-scene",
    "name":          "My Scene",
    "label":         "My Scene",
    "version":       "1.0.0",
    "category":     "Generative",
    "tags":          [ "blue", "slow", "particles" ],
    "fallbackColor": "#112233",
    "added":         "2026-04-26",
    "entry":         "scene.js",
    "preview":       "preview.webp",
    "wallpaper":     "wallpaper.webp",
    "description":   "A quiet drift of blue particles over a painted haze."
}
```

| Field           | Required | Purpose                                                                        |
|-----------------|----------|--------------------------------------------------------------------------------|
| `type`          | yes      | Must be `"scene"`.                                                             |
| `slug`          | yes      | `^[a-z0-9-]+$`, globally unique across apps / icon sets / scenes / widgets.    |
| `name`          | yes      | Display name in the Shop quilt + hero.                                         |
| `label`         | no       | Falls back to `name` when absent.                                              |
| `version`       | yes      | Semver-ish string; shown in the tile + debug inspector.                        |
| `category`     | no       | Optional grouping label for Shop shelves and catalog tooling. |
| `tags`          | yes      | Array of short strings; used for search + muse mood.                           |
| `fallbackColor` | yes      | `#hex` painted behind the canvas before the first frame draws.                 |
| `added`         | yes      | `YYYY-MM-DD`; used for "new" badges and sort-by-freshness.                     |
| `entry`         | yes      | Relative path to your JS file (`^[a-zA-Z0-9._/-]+$`, no `..`).                 |
| `preview`       | yes      | Relative path to the 640×360-ish WebP that drives Shop cards.                  |
| `wallpaper`     | yes      | Relative path to the 1920×1080 WebP painted behind the canvas.                 |
| `description`   | no       | Longer copy shown on the detail sheet.                                         |

## scene.js — the runtime contract

Your entry JS is enqueued on every admin page with `odd` as a
dependency, so `window.__odd` and `PIXI` exist by the time your file
runs. Self-register into `window.__odd.scenes` and do nothing else at
load time:

```js
( function () {
    'use strict';
    window.__odd = window.__odd || {};
    window.__odd.scenes = window.__odd.scenes || {};

    window.__odd.scenes[ 'my-scene' ] = {
        setup:          function ( env ) {
            // Build Pixi display objects, attach them to env.app.stage.
            // Return a "state" blob you want tick / cleanup to see.
            var g = new env.PIXI.Graphics();
            env.app.stage.addChild( g );
            return { g: g, t: 0 };
        },

        tick:           function ( state, env ) {
            state.t += env.dt;       // env.dt is clamped to 2.5 after a backgrounded tab
            state.g.clear()
                .circle( env.app.screen.width / 2, env.app.screen.height / 2, 40 + Math.sin( state.t / 30 ) * 8 )
                .fill( { color: 0x88ccff, alpha: 0.7 } );
        },

        onResize:       function ( state, env ) { /* optional */ },
        cleanup:        function ( state, env ) { /* optional — free non-stage resources */ },
        stillFrame:     function ( state, env ) { /* optional — pose for prefers-reduced-motion */ },
        transitionOut:  function ( state, env, done ) { /* optional — call done() when finished */ },
        transitionIn:   function ( state, env ) { /* optional */ },
        onAudio:        function ( state, env ) { /* optional — only when env.audio.enabled */ },
        onEgg:          function ( name, state, env ) { /* 'festival' | 'reveal' | 'peek' */ },
    };
} )();
```

### `env` — what the shared runner hands you

| Field           | Meaning                                                                |
|-----------------|------------------------------------------------------------------------|
| `app`           | Shared Pixi v8 `Application`. Reused across scene swaps.               |
| `PIXI`          | Pixi v8 module; use `env.PIXI.Graphics()` rather than importing.       |
| `ctx`           | Per-scene bag you can read/write; survives swap-in-place.              |
| `helpers`       | `{ makeBloomLayer, lerp, clamp, rand, randInt, noise, … }`.            |
| `dt`            | Delta time for this tick; already clamped to ≤ 2.5 by the runner.      |
| `parallax`      | `{ x, y }` in `[-1, 1]`, driven by cursor / device tilt.               |
| `reducedMotion` | `true` when the user asks for reduced motion.                          |
| `tod`           | `"dawn" \| "day" \| "dusk" \| "night"` based on local time.            |
| `todPhase`      | `0..1` within the current tod band.                                    |
| `season`        | `"spring" \| "summer" \| "fall" \| "winter"`.                          |
| `audio`         | `{ enabled, level, bass, mid, high }` — `enabled` gates `onAudio`.     |
| `perfTier`      | `"high" \| "normal" \| "low"` from a rolling FPS sampler.              |

Scenes that ignore new fields keep working. If you branch on
`perfTier === 'low'`, downshift particle counts / shader cost; low-tier
devices run closer to 30 fps and `dt` is higher.

## Pixi v8 conventions

- `new PIXI.Application()` then `await app.init({ … })` — **do not**
  pass options to the constructor (v7 pattern).
- Use `app.canvas`, not `app.view`.
- Fluent `Graphics`: `g.rect( … ).fill( { color, alpha } )`,
  `g.moveTo( x, y ).lineTo( … ).stroke( { color, width } )`.
- Ticker callback receives a `Ticker`, not a number:
  `app.ticker.add( t => { const dt = t.deltaTime } )`. The shared
  runner already drives `tick`, so you typically don't add your own.
- Bloom: `env.helpers.makeBloomLayer( env.PIXI, strength )` returns a
  `Container` with `blendMode='add'` + `BlurFilter`.
- Never call `app.destroy()` yourself — the runner owns Pixi lifecycle.

## Swap-in-place rules

ODD reuses a single Pixi `Application` across scene swaps. Between
swaps the runner calls your `cleanup`, then `app.stage.removeChildren()`,
then hands the next scene a fresh-but-reused app.

That means:

- **Anything you add to `app.stage` is cleaned up for you.** Don't
  double-unparent in `cleanup`.
- **Anything outside the stage graph is your problem.** Timers
  (`setInterval`, `setTimeout`), `window` / `document` event listeners,
  `AudioContext` nodes, `ResizeObserver`s — tear them down in
  `cleanup`.
- **Global state survives.** If you cached a texture on `window` or
  stashed data on `env.ctx` and still want it next mount, re-check it
  in `setup` rather than rebuilding blindly.

## Reduced motion

If the user prefers reduced motion (`env.reducedMotion === true`), the
runner calls your `stillFrame` once and skips `tick`. Paint a pleasant
static composition — often a single hero shape over your wallpaper — and
return. If you omit `stillFrame`, the painted `wallpaper.webp` stays
visible on its own, which is almost always fine.

## Visibility + performance

The runner pauses `tick` when:

- The browser tab is hidden (`document.visibilitychange`).
- WP Desktop Mode's `desktop-mode.wallpaper.visibility` hook reports
  `{ id, state: 'hidden' }` — e.g. when the dock covers the desktop.

You don't need to subscribe to either. `dt` is already clamped to 2.5,
so the first tick after a pause won't jump.

## preview.webp + wallpaper.webp

- **preview.webp** — 640×360-ish, `q=80` is a good starting point.
  This is what the Shop cards paint. Aim for ≤ 80 KB.
- **wallpaper.webp** — 1920×1080, `q=82`. Painted backdrop beneath
  the canvas. Designed for subtlety — most of the motion should come
  from the scene, not the still layer.

Installed bundles live at `wp-content/uploads/odd/scenes/<slug>/` and are
served publicly via `content_url()` (no admin auth required for the
`.webp` files themselves). First-party scenes published through the
remote catalog live at `https://odd.regionallyfamous.com/catalog/v1/bundles/scene-<slug>.wp`;
when ODD installs one it extracts to the same `wp-content/uploads/odd/scenes/<slug>/`
path so runtime addressing is identical regardless of source.

### Regenerating previews automatically

If you're contributing a scene back to the first-party catalog, clone
this repo and drop your scene under `_tools/catalog-sources/scenes/<slug>/{scene.js,meta.json,wallpaper.webp}`.
Then `npm run build:previews` boots Chromium headless, evaluates your
scene against a real Pixi v8, samples a frame ~2 s in, and writes
`preview.webp` back into the same directory. For fully third-party
bundles, copy [`odd/bin/build-previews`](../odd/bin/build-previews)
into your own toolchain — it's a standalone Node script. Flags:

```sh
npm run build:previews                 # rebuild all previews
npm run build:previews -- --only flux  # one scene
npm run build:previews -- --diff       # only scenes whose scene.js is newer than preview.webp
```

## Ship it

1. Zip the folder:

    ```bash
    cd my-scene/
    zip -r ../my-scene.wp manifest.json scene.js preview.webp wallpaper.webp
    ```

2. Open the ODD Shop → **Upload** (or drop the `.wp` anywhere on the
   Shop). Alternatively, submit it to the first-party catalog by
   opening a PR that drops the source folder into
   `_tools/catalog-sources/scenes/<slug>/` — the next Pages deploy
   publishes it to `https://odd.regionallyfamous.com/catalog/v1/` and
   any ODD install world-wide can browse + install it from Discover.
3. Confirm the JavaScript-execution prompt. Scenes ship JS that runs
   in your admin session, so ODD asks once per session before
   installing a scene or widget. Consent is remembered on
   `window.__odd.store`.
4. On success, the Shop jumps to Wallpapers and flashes your new
   scene's tile. Click **Preview**, then **Keep** to commit.

## Debugging

- Sanity-check the manifest via the Shop tile + hero — a misnamed
  `preview` or `wallpaper` shows up as a dark card.
- Open DevTools — your `scene.js` is enqueued as `odd-scene-<slug>`
  with `version` pinned to `manifest.version`, so cache invalidation
  works automatically on upgrade.
- The debug inspector (see [Building on ODD](building-on-odd.md#debug-inspector))
  lists installed scenes under `window.__odd.debug.scenes()`.
- Console errors inside your scene propagate to the
  `odd.error` bus event with `source: 'scene.<slug>'`. Reduced-motion
  and audio-off errors are common — guard accesses to
  `env.audio.level` with `if ( env.audio.enabled )`.

## See also

- [`.wp` Manifest Reference](wp-manifest.md) — full scene manifest schema.
- [Building on ODD](building-on-odd.md) — registry internals + debug inspector.
- Sibling author guides: [Building an App](building-an-app.md), [Building an Icon Set](building-an-icon-set.md), [Building a Widget](building-a-widget.md).
