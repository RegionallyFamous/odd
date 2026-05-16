# ODD Shop State Machine

> Status: 1.0.0 baseline. Mirrored to the wiki after release.

The ODD Shop treats every catalog item as one durable store card, regardless
of content type. Wallpapers, icon sets, cursor sets, widgets, and apps use the
same card shell and the same server-authoritative install/update identity.
Only the primary action changes by content type.

## Canonical States

| State | Server-owned fields | Primary action | Recovery path |
|-------|---------------------|----------------|---------------|
| `available` | catalog row exists, `installed: false` | Install | Retry install; copy diagnostics on failure. |
| `installing` | client optimistic only | Installing... | Button is disabled until request settles. |
| `installed` | installed registry row exists | Type action | Scene/icon/cursor preview, widget add, app open. |
| `updateAvailable` | installed row or catalog overlay declares `update_available` / `updateAvailable` | Update | Reinstall from catalog with `allow_update=1`. |
| `requiresReload` | installed row declares `requiresReload` after a runtime-only change | Reload / Reload to apply | Reload the page so Desktop Mode re-registers surfaces. |
| `broken` | installed row declares `broken` or `state: broken` | Repair | Reinstall from catalog with `allow_update=1`; diagnostics remain visible. |
| `incompatible` | catalog or installed row declares `incompatible` or `state: incompatible` | Incompatible | Disabled until a compatible plugin/Desktop Mode version is installed. |

`uninstalling` is a request state rather than a persistent card state. The
server remains authoritative: paths, bundle identity, installed status,
capabilities, hashes, and manifest fields are never trusted from the browser.

## Content Type Actions

| Type | Installed action | Notes |
|------|------------------|-------|
| `scene` | Preview | Preview calls `odd.pickScene` and persists through preferences. |
| `icon-set` | Preview | Preview opens the bar; applying triggers the server-side icon filter path. |
| `cursor-set` | Preview | Preview injects a temporary cursor style before apply. |
| `widget` | Add | Adds the widget to the Desktop Mode widget layer. |
| `app` | Open | Opens the registered Desktop Mode native window. Surface changes set `requiresReload`. |

## Trust Labels

Every card also carries a plain-language trust label:

| Type | Label | Meaning |
|------|-------|---------|
| `icon-set` | Static images | PNG/WebP assets validated by ODD and rendered through Desktop Mode. |
| `cursor-set` | Pointer assets | Cursor assets plus generated CSS; paths, sizes, and formats are validated before install. |
| `scene` | Runs locally | JavaScript runs locally in the admin session to animate the wallpaper canvas. |
| `widget` | Runs locally | JavaScript runs locally and cleans up through Desktop Mode widget teardown. |
| `app` | Sandboxed app | Opens in a Desktop Mode window through ODD file serving, CSP, and local diagnostics. |

## Store Contract

- Catalog rows come from `/odd/v1/bundles/catalog`, cached server-side with a
  stale fallback. The remote registry must be HTTPS, fit inside the response
  size cap, use unique slugs, provide valid sha256 hashes, and keep bundle,
  icon, and card URLs under the configured catalog base unless a site owner
  explicitly filters that policy for a private mirror.
- Install/update/repair calls use `/odd/v1/bundles/install-from-catalog`.
- Uploads use `/odd/v1/bundles/upload` and then enter the same installed-row
  model.
- New first-party store items do not require a plugin release when older
  clients already understand the row schema: edit `_tools/catalog-sources/`,
  run `python3 _tools/build-catalog.py`, run
  `ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog`, then push `main` so
  GitHub Pages publishes `site/catalog/v1/`.
- The old app-specific catalog/install REST routes are removed in the 1.0
  baseline. Apps still keep app-specific open/toggle/delete routes because
  those operate on installed app runtime state, not catalog install state.
- A card must never show `Open`, `Add`, `Preview`, or `Active` until the
  server says the bundle is installed and usable.
- Every failed card action must leave a visible message, a retry/repair path,
  or diagnostics guidance.

## Tests

`tests/integration/shop-card.test.js` owns the card state-machine coverage:

- available → Install
- incompatible → disabled Incompatible
- broken → Repair
- updateAvailable → Update
- requiresReload → Reload / Reload to apply
- installed scene/icon/cursor → Preview
- installed widget → Add / Active
- installed app → Open

`tests/integration/apps-surfaces.test.js` covers the Apps department using
the unified bundle catalog/install endpoints plus app-specific surface toggles.
