# Architecture

ODD is an Apps-only WordPress plugin for OpenStation.

```text
ODD Shop
  -> signed catalog registry
  -> validated .wp app archive
  -> uploads/odd/apps/<slug>/
  -> OpenStation native window + optional desktop/taskbar placement
```

The plugin registers the `odd` Shop window and one window per enabled app via
OpenStation's public `openstation_*` APIs. Browser coordination goes through
`wp.os`. The Shop never edits OpenStation DOM or private state.

## Runtime

- `odd/includes/content/` fetches, verifies, installs, removes, reconciles, and
  repairs catalog apps.
- `odd/includes/apps/` validates manifests and archives, stores the installed
  app index, serves authenticated app files, and registers OpenStation surfaces.
- `odd/includes/notes/` owns ODD Notes' private WordPress data and REST API.
- `odd/src/panel/` renders the Shop and coordinates install/open/remove actions.
- `odd/includes/playground-compat.php` retains active Playground scope prefixes
  and disables OpenStation PWA behavior only inside Playground.

App files are denied direct web access and served through ODD's authenticated
cookie route or REST asset route. Icons are the only intentionally public app
asset. Browser apps are administrator-approved, trusted same-origin code; the
iframe/CSP policy is defense in depth, not an untrusted-code sandbox.

Install, update, and repair use one operation-aware transaction. The new app is
fully validated and staged before the current directory is renamed to a backup;
filesystem and registry changes are rolled back together on failure. No update
or repair uninstalls first. Updates require a newer version, repairs require the
exact installed version, and existing enablement, surfaces, and OpenStation
placement survive replacement. GET asset paths are read-only.

Before a browser entry script runs, ODD injects the frozen version-1
`window.oddApp` adapter. It confines requests to the server-generated REST
root, owns nonce/cookie transport, scopes storage to the installed app, and
delegates confirmations to public `wp.os` APIs. Both cookie-auth and REST HTML
serve paths use the same idempotent injection. The adapter exposes no raw host
object or unrestricted parent helper.

## Catalog

`_tools/catalog-sources/catalog.json` is the signed first-party app list.
`_tools/build-catalog.py` validates each selected source, creates deterministic
archives, and writes `site/catalog/v1/`. Registry signatures and archive
SHA-256 values are checked before install. The plugin does not hard-code app
slugs, so new valid apps can publish through the catalog without a plugin
release. A frozen fallback registry is refreshed only when the plugin itself
is released.

## Same-session correctness

An install is not complete from the user's perspective until both systems agree:

1. ODD has committed the app archive and index.
2. OpenStation's live `itemVisibility` includes the app placement.
3. `wp.os.refreshMenu()` has refreshed the native window registry.

The Shop preserves the committed install if step 2 or 3 fails, reports the
partial failure, and retries registration before opening a window.
