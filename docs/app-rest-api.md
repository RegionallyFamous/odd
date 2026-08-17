# REST API

All routes are under `/wp-json/odd/v1` and use WordPress cookie authentication.
Mutating management routes require `manage_options`; app data routes require a
logged-in user with `read`.

## Catalog and installation

- `GET /bundles/catalog`
- `POST /bundles/install-from-catalog`
- `POST /bundles/refresh`
- `POST /bundles/upload`
- `DELETE /bundles/{slug}`
- `POST /bundles/reconcile`
- `POST /bundles/repair-app`

## Installed apps

- `GET /apps`
- `GET /apps/{slug}`
- `POST /apps/{slug}/toggle`
- `GET /apps/serve/{slug}/{path}`
- `GET /apps/icon/{slug}`
- `GET|POST|PUT|DELETE /apps/store/{slug}[/{segment}]`

## ODD Notes

ODD Notes uses `/wp-json/odd-notes/v1`. Its collection, item, revision, and
public-share routes are registered in
`odd/includes/notes/class-notes-rest-controller.php`; that controller is the
source of truth for methods and permissions.

Clients must send the REST nonce. Browser apps should use the boot data ODD
injects into their document rather than hard-coding site or Playground paths.
