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
asset. Archive extraction is staged and promoted atomically.

## Catalog

`_tools/catalog-sources/catalog.json` is an explicit slug allowlist.
`_tools/build-catalog.py` validates each selected source, creates deterministic
archives, writes `site/catalog/v1/`, and refreshes the plugin fallback registry.
Registry signatures and archive SHA-256 values are checked before install.

## Same-session correctness

An install is not complete from the user's perspective until both systems agree:

1. ODD has committed the app archive and index.
2. OpenStation's live `itemVisibility` includes the app placement.
3. `wp.os.refreshMenu()` has refreshed the native window registry.

The Shop preserves the committed install if step 2 or 3 fails, reports the
partial failure, and retries registration before opening a window.
