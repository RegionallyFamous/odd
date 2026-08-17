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
python3 _tools/build-catalog.py
python3 _tools/check-app-docs.py
odd/bin/validate-catalog
```

Use `window.oddApp` boot data for the REST root, nonce, app slug, and per-user
storage. Use OpenStation only through its current public APIs. App windows must
fit a 320×240 viewport, remain usable with keyboard and touch, and report
errors visibly instead of silently failing.

See [App manifest](app-manifest.md) and [Security](security/serve-paths.md).
