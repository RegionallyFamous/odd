# ODD REST API

> Status: v1.0.0. Covers the `/apps/*`, `/bundles/*`, and `/starter/*` surfaces.
> Mirrored to the
> [Apps REST API](https://github.com/RegionallyFamous/odd/wiki/Apps-REST-API)
> wiki page.

All ODD endpoints live under the `odd/v1` namespace.

Base URL: `https://your-site.com/wp-json/odd/v1/`

---

## Authentication

| Context             | Method                                                                        |
|---------------------|-------------------------------------------------------------------------------|
| Browser (wp-admin)  | Cookie auth + `X-WP-Nonce` header. `@wordpress/api-fetch` attaches it for you.|
| Inside an app iframe| ODD passes the nonce as `?_wpnonce=…` on the iframe URL — read it with `new URLSearchParams(window.location.search).get('_wpnonce')`.|
| External clients    | [Application Passwords](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/#application-passwords) via HTTP Basic auth. |

Permission shorthand used below:

- **admin** — logged-in user with `manage_options`.
- **login** — any logged-in user (`read`).
- **public** — no auth required.

---

## Endpoint index

| Method   | Path                                         | Auth          | Purpose                                    |
|----------|----------------------------------------------|---------------|--------------------------------------------|
| `GET`    | `/apps`                                      | login         | List installed apps.                       |
| `GET`    | `/apps/{slug}`                               | login         | Full manifest for one app.                 |
| `POST`   | `/apps/upload`                               | admin         | App bundle upload endpoint for `.wp` archives. |
| `DELETE` | `/apps/{slug}`                               | admin         | Uninstall an app and delete its files.     |
| `POST`   | `/apps/{slug}/toggle`                        | admin         | Enable/disable an installed app or update its desktop/taskbar surfaces. |
| `GET`    | `/apps/serve/{slug}/{path...}`               | per-app cap   | Serve a file from the app bundle.          |
| `GET`    | `/apps/icon/{slug}`                          | public        | Serve the app's declared icon file.        |
| `POST`   | `/bundles/upload`                            | admin         | Install any `.wp` bundle (app, icon set, cursor set, scene, widget). |
| `DELETE` | `/bundles/{slug}`                            | admin         | Uninstall any bundle regardless of type.   |
| `GET`    | `/bundles/catalog`                           | login         | Browse the remote catalog (installer fields redacted for non-admins). |
| `POST`   | `/bundles/install-from-catalog`              | admin         | Install a catalog bundle by slug, verified via SHA256. |
| `POST`   | `/bundles/refresh`                           | admin         | Force-refresh the remote catalog transient. |
| `GET`    | `/bundles/catalog-meta`                      | admin         | Read local catalog source, hash, and failure diagnostics. |
| `GET`    | `/starter`                                   | login         | Read the starter-pack runner state.        |
| `POST`   | `/starter/retry`                             | admin         | Force a synchronous starter-pack retry.    |

---

## Endpoints

### `GET /apps`

List all installed apps.

**Auth:** login

**Response** — `200 OK`:

```json
{
    "apps": [
        {
            "slug":        "ledger",
            "name":        "Ledger",
            "version":     "1.0.0",
            "enabled":     true,
            "icon":        "icon.svg",
            "description": "Get paid. Track clients, generate invoices.",
            "capability":  "manage_options",
            "installed":   1713996000
        }
    ]
}
```

Apps are sorted alphabetically by `name`.

---

### `GET /apps/{slug}`

Return the full stored manifest for one installed app.

**Auth:** login

**Path params:**

| Param | Type   | Description                      |
|-------|--------|----------------------------------|
| `slug`| string | The app slug (`[a-z0-9-]+`).     |

**Response** — `200 OK`: the full manifest object, identical to what
was packaged plus the runtime fields `enabled`, `installed`, and
(if applicable) `builtin`.

**Errors:**

| Status | Code        | Meaning                                 |
|--------|-------------|-----------------------------------------|
| 404    | `not_found` | No app with that slug is installed.     |

---

### `POST /apps/upload`

Install an app from a `.wp` archive.

**Auth:** admin
**Content-Type:** `multipart/form-data`

**Request body:** `file` field containing the archive.

**JavaScript example:**

```js
import apiFetch from '@wordpress/api-fetch';

const fd = new FormData();
fd.append( 'file', fileInput.files[ 0 ] );

const result = await apiFetch( {
    path:   '/odd/v1/apps/upload',
    method: 'POST',
    body:   fd,
} );
```

**curl example:**

```bash
NONCE=$(wp eval 'echo wp_create_nonce("wp_rest");')
SITE=$(wp option get siteurl)

curl -X POST "${SITE}/wp-json/odd/v1/apps/upload" \
    -H "X-WP-Nonce: ${NONCE}" \
    -b cookie-jar.txt \
    -F "file=@my-app.wp"
```

**Response** — `200 OK`:

```json
{
    "installed": true,
    "manifest": {
        "slug":    "my-app",
        "name":    "My App",
        "version": "1.0.0",
        "enabled": true,
        "installed": 1714000000
    }
}
```

**Error codes:**

| Status | Code                     | Meaning                                                   |
|--------|--------------------------|-----------------------------------------------------------|
| 400    | `no_file`                | No `file` field present in the multipart body.            |
| 400    | `invalid_extension`      | Filename does not end in `.wp`.                           |
| 400    | `zip_unavailable`        | PHP `ZipArchive` extension not installed.                 |
| 400    | `invalid_zip`            | File is not a valid ZIP archive.                          |
| 400    | `too_many_files`         | Archive exceeds 2,000 files.                              |
| 400    | `corrupt_archive`        | An entry failed `ZipArchive::statIndex`.                  |
| 400    | `path_traversal`         | An entry contained `..` or a leading `/`.                 |
| 400    | `symlink_in_archive`     | An entry was a symbolic link.                             |
| 400    | `forbidden_file_type`    | Archive contains an executable extension (`.php` etc.).   |
| 400    | `zip_bomb`               | Per-file compression ratio exceeded 100:1.                |
| 400    | `too_large`              | Uncompressed total exceeded 25 MB (filterable).           |
| 400    | `missing_manifest`       | `manifest.json` not at archive root.                      |
| 400    | `invalid_manifest`       | `manifest.json` is not valid JSON.                        |
| 400    | `missing_manifest_field` | Required `name` / `slug` / `version` missing.             |
| 400    | `invalid_slug`           | Slug contains invalid characters.                         |
| 400    | `slug_exists`            | A different app with that slug is already installed.      |
| 400    | `invalid_entry`          | `entry` path invalid.                                     |
| 400    | `missing_entry`          | `entry` file absent from archive.                         |
| 400    | `install_in_progress`    | Another upload of the same slug is mid-extraction.        |
| 500    | `extract_mkdir_failed`   | Could not create the staging directory.                   |
| 500    | `extract_rename_failed`  | Could not promote staged files into final location.       |

---

### `DELETE /apps/{slug}`

Uninstall an app. Removes its directory, per-slug option, and index
entry. Idempotent — returns `200` for unknown slugs.

**Auth:** admin

**Response** — `200 OK`:

```json
{ "uninstalled": true }
```

**Errors:**

| Status | Code            | Meaning                         |
|--------|-----------------|---------------------------------|
| 400    | `invalid_slug`  | Slug parameter was empty.       |

---

### `POST /apps/{slug}/toggle`

Enable or disable an installed app, or update where it appears in WP
Desktop Mode. Disabled apps keep their files and manifest; their
desktop icon, taskbar item, native window, and serve endpoint stop
working until re-enabled. Surface changes are stored even while an app
is disabled and take effect on the next Desktop Mode registration pass.

**Auth:** admin
**Content-Type:** `application/json`

**Request body (at least one field required):**

```json
{
    "enabled": true,
    "surfaces": { "desktop": true, "taskbar": false }
}
```

Send `enabled`, `surfaces`, or both. Empty requests are rejected with
`missing_toggle_fields`; the endpoint never flips state implicitly. If
`surfaces` is present, only the provided keys are changed; missing keys
keep their current values. Both keys are booleans.

**Response** — `200 OK`:

```json
{
    "enabled": false,
    "surfaces": { "desktop": true, "taskbar": false }
}
```

**Errors:**

| Status | Code             | Meaning                    |
|--------|------------------|----------------------------|
| 400    | `invalid_slug`   | Slug parameter was empty.  |
| 400    | `missing_toggle_fields` | Request did not include `enabled` or `surfaces`. |
| 404    | `not_installed`  | No app with that slug.     |

---

### `GET /apps/serve/{slug}/{path...}`

Serve a static file from an installed, enabled app's bundle. This is
the REST fallback for app serving; the normal iframe path is
`/odd-app/<slug>/...` so relative assets can load with cookie auth.
Direct requests to `wp-content/uploads/odd/apps/` are blocked by an `.htaccess`
that ODD writes on first install.

**Auth:** logged-in + the app's normalized `capability` (default
`manage_options`). Manifest capabilities cannot lower the access floor
unless the site deliberately opts in with filters.

**Path params:**

| Param   | Type   | Description                                              |
|---------|--------|----------------------------------------------------------|
| `slug`  | string | App slug.                                                |
| `path`  | string | File path inside the bundle. Optional — defaults to the manifest's `entry`. |

**Headers set on the response:**

| Header                       | Value                                  |
|------------------------------|----------------------------------------|
| `Content-Type`               | Guessed from extension; fallback `application/octet-stream`. |
| `X-Content-Type-Options`     | `nosniff`                              |
| `X-Frame-Options`            | `SAMEORIGIN`                           |
| `Referrer-Policy`            | `no-referrer`                          |
| `Cache-Control`              | Driven by `nocache_headers()`.         |
| `Content-Length`             | Set when `zlib.output_compression` is off. |

**Errors:**

| Status | Code         | Meaning                                                |
|--------|--------------|--------------------------------------------------------|
| 400    | `bad_path`   | Path contained `..`, a leading `/`, NUL bytes, or other invalid chars. |
| 403    | `forbidden`  | Extension is on the forbidden list.                    |
| 404    | `not_found`  | Path resolved outside the app's realpath, or file missing. |

---

### `GET /apps/icon/{slug}`

Serve the app's declared `icon` file. **Public endpoint** — no nonce
required, because `<img src>` tags can't send an `X-WP-Nonce` header,
and icons are already public branding (every enabled app's tile shows
on the desktop).

**Path params:**

| Param  | Type   | Description   |
|--------|--------|---------------|
| `slug` | string | App slug.     |

The endpoint only serves the single path recorded in the manifest's
`icon` field (default `icon.svg`). Client-supplied path segments are
never honored, so there's no traversal surface.

**Response headers:**

| Header                       | Value                              |
|------------------------------|------------------------------------|
| `Cache-Control`              | `public, max-age=86400`            |
| `Content-Type`               | Guessed from the icon file's extension. |

**Errors:**

| Status | Code         | Meaning                                                  |
|--------|--------------|----------------------------------------------------------|
| 404    | `not_found`  | Slug unknown, app disabled, icon path invalid, or file missing. |

---

The 1.0 baseline removes the old app-specific catalog and install routes.
Catalog browsing and installs for every content type use `/bundles/catalog`
and `/bundles/install-from-catalog`.

### `GET /bundles/catalog`

Browse the remote catalog. Optional `type` filters to one of `scene`,
`icon-set`, `cursor-set`, `widget`, or `app`. Non-admin users can browse
catalog cards, but installer-only fields (`download_url`, `sha256`) are
redacted.

The server validates remote registries before caching them: registry URLs
must be HTTPS, response bodies are capped, slugs must be unique, hashes must
be valid sha256 values, and bundle/icon/card URLs must stay under the
configured catalog base unless a private mirror filter explicitly allows
otherwise.

### `POST /bundles/install-from-catalog`

Install or update a catalog row by `slug`. Pass `allow_update=true` when
reinstalling a newer catalog version over an installed row.

### `GET /bundles/catalog-meta`

Admin-only diagnostics for the current catalog source, HTTP status, bundle
count, registry body hash, body byte count, stale/fallback availability, and
the last fetch failure.

---

### `POST /bundles/refresh`

Force-refresh the remote-catalog transient. Use after publishing a
new bundle to skip the 12-hour cache. Returns refresh status, bundle
count, and catalog health metadata.

**Auth:** admin

**Response** — `200 OK`:

```json
{
    "refreshed": true,
    "count":     49,
    "meta":      { "source": "remote", "bundle_count": 49 }
}
```

**Errors:**

| Status | Code                   | Meaning                                                   |
|--------|------------------------|-----------------------------------------------------------|
| 502    | `catalog_fetch_failed` | `wp_remote_get` failed and no cached copy was available.  |

---

### `GET /starter`

Return the current state of the starter-pack runner. Useful for the
Shop to show "installing starter pack…" / "retry after backoff" states.

**Auth:** login

**Response** — `200 OK`:

```json
{
    "status":          "installed",
    "attempts":        1,
    "last_attempt":    1766428800,
    "last_error":      "",
    "installed":       [ "oddling-desktop", "odd-default-icons" ],
    "prefs_set":       true
}
```

Possible `status` values: `"pending"`, `"running"`, `"installed"`,
`"failed"`. Failed states retry from the `init` safety net after the
backoff window, or immediately when an admin calls `/starter/retry`.

---

### `POST /starter/retry`

Force a synchronous retry of the starter-pack install. Bypasses the
exponential backoff schedule. Useful for admins triggering a manual
retry from the Shop's About panel after a catalog outage.

**Auth:** admin

**Response** — `200 OK` mirrors `GET /starter` after the run.

---

## From PHP

The same operations are available as procedural PHP helpers, safe to
call from a companion plugin, theme, or `mu-plugin`:

```php
// Install
$result = oddout_apps_install( $tmp_path, $filename );
if ( is_wp_error( $result ) ) {
    // Handle error.
}

// Uninstall
oddout_apps_uninstall( 'my-app' );

// Enable / disable
oddout_apps_set_enabled( 'my-app', false );

// Read
$rows     = oddout_apps_list();
$manifest = oddout_apps_get( 'my-app' );
$exists   = oddout_apps_exists( 'my-app' );
```

All write helpers fire lifecycle `do_action( 'oddout_app_*' )` hooks —
see [Building on ODD](building-on-odd.md#canonical-events) for the bus
equivalents.

---

## See also

- [Building an App](building-an-app.md) — authoring guide.
- [`.wp` Manifest Reference](wp-manifest.md) — every `manifest.json` field across every bundle type.
- [Building on ODD](building-on-odd.md) — the extension API apps can tap via `manifest.extensions`.
