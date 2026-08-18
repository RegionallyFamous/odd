# REST API

All routes are under `/wp-json/odd/v1` and use WordPress cookie authentication.
Mutating management routes require `manage_options`. App data routes require
the named app to be installed and enabled, and the current user must have that
app's normalized capability (normally `manage_options`; ODD Notes is the
intentional `read` exception).

## Catalog and installation

- `GET /bundles/catalog`
- `POST /bundles/install-from-catalog`
- `POST /bundles/refresh`
- `POST /bundles/upload`
- `DELETE /bundles/{slug}`
- `POST /bundles/reconcile`
- `POST /bundles/repair-app`

`allow_update=1` means update, not arbitrary replacement: the incoming version
must be newer. Repair is explicit, catalog-owned, digest-verified, and must use
the exact installed version. All three operations preserve app enablement,
surface preferences, and OpenStation placement. Asset GET routes never repair.

## Installed apps

- `GET /apps`
- `GET /apps/{slug}`
- `POST /apps/{slug}/toggle`
- `POST /apps/{slug}/repair` (`manage_options`, explicit catalog repair)
- `GET /apps/serve/{slug}/{path}`
- `GET /apps/icon/{slug}`
- `GET|POST|PUT|DELETE /apps/store/{slug}[/{segment}]`

Per-user app storage accepts JSON values and enforces 64-byte segment names,
32 segments per app, 64 KiB per value, 256 KiB per app bucket, 1 MiB per user
tree, depth/node limits, and a per-user mutation rate limit. Quota failures use
HTTP 413 and throttling uses HTTP 429.

## ODD Notes

ODD Notes uses `/wp-json/odd-notes/v1`. Its collection, item, revision, and
public-share routes are registered in
`odd/includes/notes/class-notes-rest-controller.php`; that controller is the
source of truth for methods and permissions.

Clients must send the REST nonce. Browser apps should use the boot data ODD
injects into their document rather than hard-coding site or Playground paths.
`window.oddApp.request()` supplies that nonce and rejects cross-origin URLs or
same-origin URLs outside the injected REST root.
