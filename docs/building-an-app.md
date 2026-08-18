# Building an ODD app

Start with `examples/example-app/` or run:

```sh
npx create-odd-bundle my-app
```

An app is a `.wp` ZIP with a root `manifest.json`, local entry HTML, a local
icon, and any local CSS/JavaScript/assets it needs. It is browser code, not a
WordPress plugin: PHP, shell scripts, service workers, CDN imports, absolute
asset URLs, and unresolved package imports are rejected.

Validate a manifest:

```sh
odd/bin/validate-manifest path/to/manifest.json
```

For a first-party catalog app, create
`_tools/catalog-sources/apps/<slug>/{meta.json,card.webp,bundle-src/}`, add the
slug to `_tools/catalog-sources/catalog.json`, add its app card to
`site/index.html`, then run:

```sh
npm run verify:app -- <slug>
```

That command performs strict manifest validation, a clean isolated catalog
rebuild and generated-output comparison, desktop/mobile packaged-app smoke
tests with screenshots, and whitespace checks without overwriting generated
work. Inspect the screenshots before considering visible behavior complete.

ODD injects one frozen, versioned API before the entry document's own scripts:

```js
window.oddApp = {
  apiVersion: 1,
  slug,
  windowId,
  restRoot,
  restNonce,
  adminUrl,
  request(path, init),
  confirm(options),
  storage: { list(), get(segment), set(segment, value), remove(segment), clear() }
};
```

Use `request()` rather than discovering WordPress paths or reading nonce query
parameters. It accepts a REST-relative path or a same-origin URL beneath
`restRoot`, adds cookie credentials and the REST nonce, JSON-encodes plain
object bodies, and rejects other origins/paths. Storage is scoped server-side
to the current installed/enabled app and user. `confirm()` uses OpenStation's
public confirmation UI and rejects when that API is unavailable; never fall
back to `window.confirm()`. Do not probe `window.parent`, OpenStation config,
private host storage, or host DOM from app code.

Installed catalog apps are verified, trusted same-origin code—not hostile-code
sandboxes. Never render untrusted HTML directly in the app document. Use a
separate sandboxed preview iframe without scripts, same-origin, forms, popups,
downloads, or network access.

App windows must fit a 320×240 viewport, remain usable with keyboard and touch,
and report errors visibly instead of silently failing.

See [App manifest](app-manifest.md) and [Security](security/serve-paths.md).
