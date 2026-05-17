# Serve paths — security audit

> Scope: every code path that returns file bytes from `wp-content/uploads/odd/`
> on an authenticated or public request. Last reviewed for the 1.0.0
> reliability/security hardening pass.

The universal `.wp` installer populates five per-type subtrees under
`wp-content/uploads/odd/`:

| Subtree                          | Source              | Contents                       |
|----------------------------------|---------------------|--------------------------------|
| `wp-content/uploads/odd/apps/<slug>/`    | pre-public app loader | HTML/JS/CSS bundle + manifest |
| `wp-content/uploads/odd/icon-sets/<slug>/` | 1.0 baseline      | PNG/WebP icons + `manifest.json` |
| `wp-content/uploads/odd/cursor-sets/<slug>/` | 1.0 baseline    | living-layer preview art + `manifest.json` |
| `wp-content/uploads/odd/scenes/<slug>/`  | 1.0 baseline        | JS scene + preview + wallpaper |
| `wp-content/uploads/odd/widgets/<slug>/` | 1.0 baseline        | JS/CSS widget + `manifest.json`|

Under the 1.0 baseline every bundle that lands in these subtrees is either (a)
uploaded by a logged-in admin through `POST /odd/v1/bundles/upload`
or (b) downloaded from the remote catalog at
`https://odd.regionallyfamous.com/catalog/v1/`. The first-party registry
must verify against the bundled Ed25519 public key via `registry.json.sig`,
then each downloaded archive must match the signed row's SHA256 before
extraction. The downloaded archive manifest must also match the catalog
row's `slug` and `type`. A mismatch aborts the install — the archive is
never written to the final content directory. The bundled fallback is a
full registry snapshot only; ODD does not splice individual fallback rows
into an accepted remote registry.

Only `uploads/odd/apps/` has a bespoke serve endpoint (`serve-cookieauth.php`).
The other four are served through standard WordPress infrastructure —
upload URLs derived from `wp_upload_dir()` point at public files, the underlying HTTP server hands
bytes back directly, and no ODD code ever opens those files in response
to a per-request user input.

## Audit results

### `uploads/odd/apps/` — custom serve path

**File:** [`odd/includes/apps/serve-cookieauth.php`](../../odd/includes/apps/serve-cookieauth.php)

- [x] **Auth.** `wp_validate_auth_cookie` re-verifies the HMAC; no
      bare-cookie trust. `user_can( user_id, normalized app capability )`
      enforces per-app capability without switching the global current user, which
      defaults to `manage_options` and cannot be lowered by a bundle
      manifest unless the site opts in with filters.
- [x] **Path traversal.** The path component is regex-constrained to
      `[a-zA-Z0-9._/-]+`, `..` is rejected explicitly, leading `/` is
      rejected, backslashes are rejected, and null bytes are rejected.
      `realpath()` then anchors the resolved path under the app's own
      directory with a boundary-aware helper so sibling paths such as
      `demo-copy/` cannot satisfy a string-prefix check.
- [x] **Scope.** `oddout_apps_dir_for( $slug )` points exclusively into
      `wp-content/uploads/odd/apps/`, so even a hypothetical slug-level escape
      cannot reach `icon-sets/`, `scenes/`, or `widgets/`.
- [x] **Content-type confusion.** `oddout_apps_mime_for()` picks MIME
      from extension; `X-Content-Type-Options: nosniff` is set. The
      forbidden-extension blocklist
      (`oddout_apps_forbidden_extensions()`) rejects `php`, `phtml`,
      `phar`, `htaccess`, etc.
- [x] **Debug envelope leak.** `oddout_apps_serve_cookieauth()` takes an
      explicit `null` default so stray callers can't accidentally
      trigger JSON output; it also re-checks `$_GET['oddout_debug']
      === '1'` and `manage_options` before emitting.
- [x] **CSP.** HTML responses include a compatibility-safe CSP with
      `object-src 'none'`, same-origin framing, and explicit allowances
      for the static app patterns ODD supports.
- [x] **Raw output exceptions.** App HTML/JS/CSS/image responses and
      cursor CSS/SVG responses are the only intentional raw-byte outputs.
      They use `oddout_emit_raw_response()` after capability, path,
      MIME, and header checks because HTML/JS/CSS escaping would corrupt
      installed app bundles and generated stylesheets.

### `uploads/odd/icon-sets/` and `uploads/odd/cursor-sets/` — static visual assets

**Files:**
[`odd/includes/content/iconsets.php`](../../odd/includes/content/iconsets.php),
[`odd/includes/content/cursor-sets.php`](../../odd/includes/content/cursor-sets.php),
[`odd/includes/icons/registry.php`](../../odd/includes/icons/registry.php),
and the cursor CSS endpoint.

- [x] **Icon static URL = `oddout_storage_url( 'icon-sets' ) . '<slug>/<file>'`.**
      No PHP handler; the web server serves PNG/WebP icon files directly.
      The universal archive validator rejects server-executable files and
      path traversal before extraction.
- [x] **Raster image validation.** Installed icon images are parsed with
      server image metadata, must match their PNG/WebP extension, must be
      square, and must stay within the icon-set size limits.
- [x] **Passive cursor preview validation.** Installed cursor effect
      preview SVGs are parsed and rejected if they contain scriptable elements,
      `foreignObject`, embedded images, event handlers, external
      references, or scriptable URL values.
- [x] **No cross-subtree reads.** The registry only walks
      `wp-content/uploads/odd/icon-sets/<slug>/<file>`; `realpath()` confines
      the read.

### `uploads/odd/scenes/` — enqueue-only

**File:** [`odd/includes/content/scenes.php`](../../odd/includes/content/scenes.php)

- [x] **No serve path.** Scenes are registered via `wp_enqueue_script`
      pointing at `oddout_storage_url('scenes') . '<slug>/<entry>')`. The web
      server returns the JS; no PHP handler takes a per-request slug.
- [x] **Install-time scrubbing.** The archive installer validates
      `manifest.entry`, rejects symlinks, and rejects any file
      extension outside the scene allowlist
      (`js / css / webp / jpg / png / svg / json / md`).
- [x] **Runtime registration.** Scene JS registers onto
      `window.__odd.scenes` in an IIFE. No server-rendered markup.

### `uploads/odd/widgets/` — enqueue-only

**File:** [`odd/includes/content/widgets.php`](../../odd/includes/content/widgets.php)

- [x] **No serve path.** Same shape as scenes — `wp_enqueue_script`
      targets `oddout_storage_url('widgets') . '<slug>/<entry>')`, no PHP
      handler reads from the subtree.
- [x] **Admin-trust model.** Widget JS can't be installed without
      `manage_options` + the one-time "trust this JS" confirmation
      (`confirmJavaScriptInline()` in the Shop panel).
- [x] **Slug uniqueness.** Enforced globally across all content
      subtrees at install time, so a widget can't shadow an app slug
      (which could otherwise be routed via the cookie-auth endpoint).

## Conclusion

The universal `.wp` refactor and cursor-set work did **not** expand the
app serve attack surface. Icon sets, cursor sets, scenes, and widgets
are served by uploads-derived URLs + the HTTP server and carry no custom PHP
handler that joins a slug into a filesystem path. Apps are the only
subtree with a bespoke serve endpoint, and that endpoint is scoped to
`uploads/odd/apps/` via `oddout_apps_dir_for()` + `realpath()` plus a
directory-boundary confinement check.

REST permissions are mixed deliberately: public static endpoints only serve
non-sensitive generated assets, user-local state routes require
`current_user_can( 'read' )`, and installs, catalog refresh/metadata,
diagnostics, reconciliation, and other privileged actions require
`current_user_can( 'manage_options' )`.

## REST access model

| Route family | Access | Notes |
|--------------|--------|-------|
| `/odd/v1/prefs` | logged-in users with `read` | User-local wallpaper, icon, cursor, Shop, and app-pinned preferences. |
| `/odd/v1/bundles/catalog` | logged-in users with `read` | Redacts installer-only fields for non-admins. |
| `/odd/v1/bundles/install-from-catalog`, `/catalog-check`, `/refresh`, `/catalog-meta`, `/catalog-rollback` | admins with `manage_options` | Installs files, checks or refreshes remote state, or exposes catalog diagnostics. |
| `/odd/v1/apps`, `/apps/{slug}`, `/apps/store/*`, `/apps/runtime/errors` | logged-in users with `read` | User-local app listing and app storage. |
| `/odd/v1/apps/upload`, `/apps/{slug}/toggle`, `/apps/{slug}` DELETE, `/apps/diag/{slug}` | admins with `manage_options` | Mutates app installs or exposes diagnostic filesystem context. |
| `/odd/v1/apps/serve/{slug}/{path}` | logged-in users with the app capability | Serves confined app bundle files. |
| `/odd/v1/apps/icon/{slug}`, `/cursors/active.css`, `/cursors/asset/{slug}` | public static assets | Path/MIME confined and non-sensitive. |
| `/odd/v1/content/*`, `/reconcile/*`, `/starter/activate`, `/e2e-diagnostics` | admins with `manage_options` | File mutation, reconciliation, starter mutation, and privileged diagnostics. |
| `/odd/v1/starter` | logged-in users with `read` | Read-only starter state for the current user/session. |

## Follow-ups

- [x] Cursor-set install validation rejects deliberately hostile SVG
      payloads.
- [x] Document that apps are trusted first-party code after install; the
      iframe sandbox and CSP are defense in depth, not hostile-code
      isolation.
