# Building an ODD App

> One of four ODD author guides. Siblings: [Building a Scene](building-a-scene.md), [Building an Icon Set](building-an-icon-set.md), [Building a Widget](building-a-widget.md).

An ODD app is any static web app — HTML, CSS, JS, assets — packaged as a
`.wp` archive with a `manifest.json`. Drop the `.wp` on the ODD Shop and
you get a desktop icon, a native WP Desktop Mode window, and a sandboxed
iframe that serves every file in the bundle.

Your app never touches WordPress internals and never needs a companion
plugin. If it runs as a static site, it runs as an ODD app.

---

## Table of contents

1. [The mental model](#the-mental-model)
2. [Anatomy of an app](#anatomy-of-an-app)
3. [Quickstart: vanilla JS (no build step)](#quickstart-vanilla-js-no-build-step)
4. [Building with React (Vite)](#building-with-react-vite)
5. [Communicating with WordPress](#communicating-with-wordpress)
6. [Iframe sandbox capabilities](#iframe-sandbox-capabilities)
7. [manifest.extensions — apps that extend ODD](#manifestextensions--apps-that-extend-odd)
8. [App lifecycle events](#app-lifecycle-events)
9. [Installing, updating, and uninstalling](#installing-updating-and-uninstalling)
10. [Testing app bundles](#testing-app-bundles)
11. [Debugging](#debugging)
12. [Limits and validation](#limits-and-validation)

Reference material:

- [`.wp` Manifest Reference](wp-manifest.md) — every `manifest.json` field, every type.
- [Apps REST API](app-rest-api.md) — every endpoint (for tooling + CI).

---

## The mental model

Your app is just a website. ODD runs it in a sandboxed `<iframe>` that
lives inside a WP Desktop Mode native window. The iframe is on the same
origin as WordPress, so `fetch()` can hit the WP REST API with the
current user's cookies — no CORS setup, no external auth service.

```
┌─── wp-admin (WP Desktop Mode shell) ───────────────────┐
│                                                        │
│  ┌── Native window "My App" ───────────────────────┐   │
│  │  ┌─ sandboxed iframe ─────────────────────────┐ │   │
│  │  │                                            │ │   │
│  │  │   <your index.html>                        │ │   │
│  │  │                                            │ │   │
│  │  │   fetch('/wp-json/wp/v2/posts', …)         │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

The only ODD concept you need to learn is `manifest.json`, which tells
ODD what to call your app, which HTML file to load, and who's allowed
to open it.

---

## Anatomy of an app

```
my-app.wp                     ← renamed .zip
├── manifest.json             ← REQUIRED — metadata
├── index.html                ← REQUIRED — entry (path can be overridden)
├── icon.svg                  ← optional — dock + desktop icon
└── assets/
    ├── app.js
    ├── app.css
    └── logo.png
```

Important: `manifest.json` must sit at the root of the archive, not
inside a subdirectory. Same for the entry file (unless you override
`entry` in the manifest).

The minimum viable `manifest.json`:

```json
{
    "type":    "app",
    "slug":    "my-app",
    "name":    "My App",
    "version": "1.0.0"
}
```

`type` is required and must be `"app"`. Every other field is optional and has
sensible defaults — see [`.wp` Manifest Reference](wp-manifest.md).

---

## Quickstart: vanilla JS (no build step)

The fastest path to a working app. No tools, no npm, no bundler.

### 1. `manifest.json`

```json
{
    "type":        "app",
    "slug":        "hello-odd",
    "name":        "Hello ODD",
    "version":     "1.0.0",
    "author":      "Your Name",
    "description": "A tiny hello-world app.",
    "icon":        "icon.svg",
    "entry":       "index.html",
    "capability":  "manage_options",
    "window":      { "width": 520, "height": 360 },
    "surfaces":    { "desktop": true, "taskbar": false }
}
```

The `surfaces` object is optional. It sets the **install-time
defaults** for Desktop Mode's native `itemVisibility` placement for
your app launcher. The v1 default is `desktop: true` and
`taskbar: false`, so omitting the key is equivalent to "desktop icon
only." Users can flip either independently from the **ODD Shop → Apps**
card after install — the manifest value only controls what the app
looks like the moment it lands. Regardless of the visible placement, the app is always reachable via
`wp.desktop.openWindow( 'odd-app-{slug}' )`, the ODD Shop's **Open**
button, and slash commands.

### 2. `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hello ODD</title>
    <style>
        body {
            font-family: system-ui, sans-serif;
            display: grid;
            place-items: center;
            height: 100vh;
            margin: 0;
            background: #101014;
            color: #f5f5fa;
        }
        h1 { margin: 0; font-weight: 500; }
    </style>
</head>
<body>
    <h1>Hello from ODD</h1>
</body>
</html>
```

### 3. `icon.svg` (optional, 20×20)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="3"/>
</svg>
```

### 4. Package and install

```bash
zip hello-odd.wp manifest.json index.html icon.svg
```

Then open the ODD Shop (via the desktop shortcut or `/odd-panel`),
open **Install → Upload**, and pick `hello-odd.wp` — or drop it
anywhere on the Shop. A **Hello ODD** icon appears on the desktop.
Double-click to open.

If you want your app discoverable from every ODD install world-wide,
open a PR against the plugin repo with your source folder dropped
into `_tools/catalog-sources/apps/<slug>/` (plus a prebuilt `.wp`
committed into that folder). The next GitHub Pages deploy publishes
it at `https://odd.regionallyfamous.com/catalog/v1/` and the Shop's
Apps department lists it on next refresh — no plugin release required.

That's the whole workflow.

---

## Building with React (Vite)

Any framework that emits static HTML/CSS/JS works — React with Vite is
the most common path. ODD has no build-time integration: you hand it a
zip, it extracts and serves it.

### 1. Scaffold

```bash
npm create vite@latest my-app -- --template react
cd my-app
npm install
```

### 2. `vite.config.ts`

Keep Vite's default `dist/` output, but emit assets with relative paths
so they resolve under ODD's serve URL:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    base: './',
});
```

`base: './'` is the key line. Without it Vite emits absolute paths like
`/assets/index-abc.js`, which a sandboxed iframe will try to resolve
against the WordPress root instead of the serve endpoint. Relative
paths work because the iframe's `src` is
`/odd-app/<slug>/` — every `./assets/...` is resolved
against that.

### 3. `manifest.json` (lives in the project root, copied into `dist/` at package time)

```json
{
    "type":        "app",
    "slug":        "my-app",
    "name":        "My App",
    "version":     "1.0.0",
    "author":      "Your Name",
    "description": "My first ODD app, built with React.",
    "icon":        "icon.svg",
    "entry":       "index.html",
    "capability":  "manage_options",
    "window":      { "width": 720, "height": 520 }
}
```

### 4. `package.json` scripts

Add a one-liner that builds and zips in a single step:

```json
{
    "scripts": {
        "build":   "vite build",
        "package": "npm run build && cp manifest.json icon.svg dist/ && cd dist && zip -r ../$(node -p \"require('../manifest.json').slug\").wp ."
    }
}
```

### 5. Build and install

```bash
npm run package
# → my-app.wp in project root
```

Drag `my-app.wp` onto the ODD Shop (anywhere — the Shop-wide drop
overlay accepts any department).

### Dev workflow

There's no hot-reload proxy today. The fast loop is:

```bash
npm run package
# then re-upload, which triggers the panel to replace the old install
```

On a 30 KB React app this takes well under a second.

If you're iterating on pure UI, preview in the browser directly with
`npm run dev` — the REST calls won't work because Vite runs on a
different origin, but your layout and interactions render identically.

---

## Communicating with WordPress

Your app runs in a same-origin iframe served from
`/odd-app/<slug>/`. The WordPress session cookie is sent with app asset
requests, and ODD injects a fresh REST nonce into the iframe's URL as
`?_wpnonce=…` so your app can make authenticated WordPress REST writes.

### Reading the nonce

```js
const nonce = new URLSearchParams( window.location.search ).get( '_wpnonce' );
```

Read it once at startup and keep it around — it's valid for 12 hours
and you'll need it as the `X-WP-Nonce` header on every authenticated
REST call.

### GET requests (reading data)

```js
const posts = await fetch( '/wp-json/wp/v2/posts?per_page=5', {
    headers: { 'X-WP-Nonce': nonce },
    credentials: 'include',
} ).then( r => r.json() );
```

### POST/PUT/DELETE (writing data)

```js
await fetch( '/wp-json/wp/v2/posts', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce':   nonce,
    },
    credentials: 'include',
    body: JSON.stringify( { title: 'From my app', status: 'draft' } ),
} );
```

### Finding the REST root

Don't hardcode `/wp-json/` — WordPress can be installed in a subdirectory.
Derive it from the iframe's own location:

```js
const wpRoot   = window.location.href.split( '/wp-json/' )[ 0 ];
const restBase = wpRoot + '/wp-json';
```

### Refreshing the nonce

REST nonces expire after 12 hours. If your app is long-running (rare,
since users rarely leave a single iframe open that long), catch `403`
responses with `code: "rest_cookie_invalid_nonce"` and prompt the user
to reload the parent window. ODD does not currently expose a refresh
endpoint.

### A tiny helper

For anything beyond a couple of calls, wrap it:

```js
const nonce = new URLSearchParams( window.location.search ).get( '_wpnonce' );

async function wp( path, init = {} ) {
    const headers = new Headers( init.headers || {} );
    headers.set( 'X-WP-Nonce', nonce );
    if ( init.body && ! headers.has( 'Content-Type' ) ) {
        headers.set( 'Content-Type', 'application/json' );
    }
    const r = await fetch(
        '/wp-json' + ( path.startsWith( '/' ) ? path : '/' + path ),
        { ...init, headers, credentials: 'include' }
    );
    if ( ! r.ok ) throw new Error( `HTTP ${ r.status } ${ r.statusText }` );
    return r.json();
}

// Usage:
const me    = await wp( '/wp/v2/users/me' );
const posts = await wp( '/wp/v2/posts?per_page=5' );
await wp( '/wp/v2/posts', {
    method: 'POST',
    body: JSON.stringify( { title: 'Hi', status: 'draft' } ),
} );
```

---

## Iframe sandbox capabilities

Every app runs inside an `<iframe>` with a fixed sandbox attribute:

```
sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads"
```

Plus:

- `referrerpolicy="no-referrer"`
- `allow="clipboard-read; clipboard-write; fullscreen"`

What each token buys you:

| Permission           | What it enables                                                   |
|----------------------|-------------------------------------------------------------------|
| `allow-scripts`      | Run JavaScript.                                                   |
| `allow-forms`        | Submit HTML forms.                                                |
| `allow-popups`       | Open links / windows via `window.open()`.                         |
| `allow-same-origin`  | Share origin with WordPress, so cookie auth + session storage work.|
| `allow-downloads`    | Trigger file downloads from anchor tags or programmatic blobs.    |

What's deliberately not granted:

- **`allow-top-navigation`** — apps can't redirect the outer admin page.
- **`allow-modals`** — `alert()`, `confirm()`, and `prompt()` are no-ops.
  Build your own modal UI in-app.

These are fixed across all apps; there's no per-app trust level today.
The response headers added by the serve endpoint give you a second
layer of hardening:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `Cache-Control` driven by `nocache_headers()`
- `Content-Security-Policy` with `object-src 'none'`, same-origin framing,
  and compatibility allowances for inline bootstraps and HTTPS assets.

Apps are trusted first-party code once installed. The sandbox and CSP are
defense in depth, not a promise that hostile app code is isolated from the
WordPress origin.

---

## manifest.extensions — apps that extend ODD

An app can register entries in ODD's core extension registries
straight from its manifest. Add an `extensions` object:

```json
{
    "type":    "app",
    "slug":    "ledger",
    "name":    "Ledger",
    "version": "1.0.0",
    "extensions": {
        "muses": [
            {
                "slug":  "ledger",
                "voice": {
                    "appOpen": { "ledger": [ "Let's get paid." ] }
                }
            }
        ],
        "commands": [
            {
                "slug":  "open-ledger",
                "label": "Open Ledger",
                "run":   "odd.apps.open:ledger"
            }
        ],
        "widgets":          [],
        "rituals":          [],
        "motionPrimitives": []
    }
}
```

Supported registries: `muses`, `commands`, `widgets`, `rituals`,
`motionPrimitives`. Each entry needs at minimum a `slug`; invalid
entries are skipped silently so a malformed manifest never crashes the
admin. ODD re-applies the extensions on every pageload (at `init`
priority 6), so your registrations stay in effect without any custom
bootstrap.

Each entry gets tagged with `source: "app:<your-slug>"`, visible in the
debug inspector — see [Building on ODD](building-on-odd.md) for the
full registry contracts.

---

## App lifecycle events

Events fire on `window.__odd.events` in the parent frame. They're not
available inside the app iframe — use `window.postMessage()` if your app
needs to notify the host.

| Event                | Payload                              | Fires when                                 |
|----------------------|--------------------------------------|--------------------------------------------|
| `odd.app-installed`  | `{ slug, manifest }`                 | After upload / catalog install succeeds.   |
| `odd.app-uninstalled`| `{ slug }`                           | After `DELETE /odd/v1/bundles/{slug}`.     |
| `odd.app-enabled`    | `{ slug }`                           | After `POST /apps/{slug}/toggle { enabled: true }`. |
| `odd.app-disabled`   | `{ slug }`                           | Same as above with `false`.                |
| `odd.app-opened`     | `{ slug, windowId }`                 | User double-clicks the icon / opens window.|
| `odd.app-closed`     | `{ slug, windowId }`                 | User closes the window.                    |
| `odd.app-focused`    | `{ slug, windowId }`                 | User focuses an already-open window.       |

A broader `odd.bundle-installed` event (payload: `{ slug, type, manifest }`)
fires for every install regardless of type, in case you want one
subscription to cover apps + scenes + icon sets + widgets.

---

## Installing, updating, and uninstalling

### The ODD Shop (recommended)

Open the ODD Shop, use **Install → Upload** (or drop the `.wp`
anywhere on the Shop), and ODD handles the rest:

1. The Shop extracts + validates the archive.
2. On success, it jumps to the Apps department and flashes your new
   app's tile so you can see where it landed.
3. Desktop Mode places the app launcher on desktop, taskbar, both, or
   neither using its core `itemVisibility` setting.

To remove an app, click the × on its card.

### Advanced — from REST or PHP

See [Apps REST API](app-rest-api.md) for the full surface. The short
version:

```bash
# Upload (universal endpoint — accepts any .wp type)
curl -X POST https://example.com/wp-json/odd/v1/bundles/upload \
    -H "X-WP-Nonce: $NONCE" \
    -F "file=@my-app.wp"

# Uninstall (works for any bundle type by slug)
curl -X DELETE https://example.com/wp-json/odd/v1/bundles/my-app \
    -H "X-WP-Nonce: $NONCE"

# Toggle (apps-specific)
curl -X POST https://example.com/wp-json/odd/v1/apps/my-app/toggle \
    -H "X-WP-Nonce: $NONCE" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}'
```

From PHP:

```php
$result = oddout_bundle_install( $tmp_path, $filename );
if ( is_wp_error( $result ) ) {
    // Handle the error.
} else {
    // $result is [ 'slug' => ..., 'type' => 'app', 'manifest' => [...] ].
}

oddout_bundle_uninstall( 'my-app' );
oddout_apps_set_enabled( 'my-app', false );
```

### Updating an existing app

Uploads reject an archive whose slug is already installed — you'll see
a `slug_exists` error with HTTP 400. To upgrade:

1. Delete the existing app (× button in the Shop, or
   `DELETE /odd/v1/bundles/{slug}`).
2. Upload the new archive.

A future release will add a force-replace flag so updates become a
single call; for now, delete-then-upload is the way.

---

## Testing app bundles

Use the catalog app smoke tester before publishing a new app bundle:

```bash
odd/bin/smoke-catalog-apps my-app
```

For first-party catalog apps, pass one or more slugs from
`_tools/catalog-sources/apps/`:

```bash
odd/bin/smoke-catalog-apps plugin-panic four-oh-four-runner cache-invaders
```

With no slugs, it tests every catalog app source. The tester unpacks
each committed `.wp`, validates the bundled `manifest.json`, serves the
app through a local ODD-like static server, injects the same React
runtime import map/rewrite used by ODD's app serve path, loads desktop
and mobile Chromium viewports, exercises basic keyboard/button controls,
checks for console and network failures, samples canvases for nonblank
rendering, checks horizontal overflow, and flags non-namespaced
`localStorage` writes. Screenshots land in
`test-results/catalog-app-smoke/` unless `--no-screenshots` is passed.

---

## Debugging

DevTools work normally. The iframe is fully inspectable — set
breakpoints, watch network requests, read console output as you would
any web app.

Common HTTP status codes you'll see from the serve endpoint:

| Status | Meaning                                                       |
|--------|---------------------------------------------------------------|
| 401    | Not logged in.                                                |
| 403    | Missing the app's declared capability, or app is disabled.    |
| 404    | Slug or file not found.                                       |
| 400    | Path traversal / invalid path characters.                     |

Inspect the stored manifest for an installed app:

```bash
wp option get oddout_app_my-app
```

Inspect the index:

```bash
wp option get oddout_apps_index
```

List files on disk:

```bash
find "$(wp eval '$u = wp_upload_dir( null, false ); echo $u[\"basedir\"];')/odd/apps/my-app/" -type f
```

Host-side debug helper (debug mode on — see [Building on ODD](building-on-odd.md#debug-inspector)):

```js
window.__odd.debug.apps();
// → { installed: [...], enabled: [...], open: [...] }
```

---

## Limits and validation

ODD validates every archive on upload. An archive is rejected if any
of the following fail:

- File extension is `.wp`. The `.odd` extension is reserved for
  shareable workspace presets, not installable app bundles.
- File is a valid ZIP.
- Archive contains no more than **2,000 files**.
- Total uncompressed size is under **25 MB**.
- No per-file compression ratio exceeds **100:1** (zip-bomb guard).
- No symlinks.
- No path-traversal entries (`..` in file names).
- No server-executable extensions anywhere in the archive:
  `.php`, `.phtml`, `.phar`, `.php3` – `.php7`, `.phps`,
  `.cgi`, `.pl`, `.py`, `.rb`, `.sh`, `.bash`.
- `manifest.json` exists at the archive root.
- `manifest.json` is valid JSON.
- `name`, `slug`, and `version` are non-empty strings.
- `slug` matches `^[a-z0-9-]+$`.
- `slug` is not already installed — globally, across apps, icon sets,
  scenes, and widgets.
- `type` (if set) is one of `"app"`, `"icon-set"`, `"cursor-set"`, `"scene"`, `"widget"`.
- The `entry` file (default `index.html`) exists.
- The `entry` path doesn't contain `..`, leading `/`, or invalid
  characters.
- `capability` is normalized against ODD's app capability floor. By default,
  app bundles cannot make themselves available to all logged-in users by
  declaring `"read"`; site owners can opt into lower capabilities with filters.

---

## See also

- [`.wp` Manifest Reference](wp-manifest.md)
- [Apps REST API](app-rest-api.md)
- [Building on ODD](building-on-odd.md) — core registry internals.
- Sibling author guides: [Building a Scene](building-a-scene.md), [Building an Icon Set](building-an-icon-set.md), [Building a Widget](building-a-widget.md).
