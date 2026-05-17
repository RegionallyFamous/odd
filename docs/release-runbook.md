# ODD Release Runbook

> Status: 1.0.0 baseline. Mirrored to the wiki after release.

## Cut A Plugin Release

1. Update `odd/odd.php`, `odd/readme.txt`, `CHANGELOG.md`, and package metadata.
2. Run `odd/bin/check-version --expect <version>` and `odd/bin/check-plugin-metadata`.
3. Run the validation suite listed below.
4. Commit with a release-focused message.
5. Tag `v<version>` and push `main` plus the tag.
6. Confirm `.github/workflows/release-odd.yml` passes `quality-gates`, install smoke, Plugin Check, and publish.
7. Verify `https://github.com/RegionallyFamous/odd/releases/latest/download/odd.zip` resolves to the new release.
8. After the WordPress.org SVN tag exists and `https://downloads.wordpress.org/plugin/odd-outlandish-desktop-decorator.<version>.zip` returns 200, update the public stable Playground blueprint/cache-busting links from the previous public version to `<version>`.

## Validation Suite

Run locally before tagging:

```sh
odd/bin/check-version --expect <version>
odd/bin/check-plugin-metadata
python3 _tools/build-catalog.py
ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog
odd/bin/validate-blueprint
npm test -- --run
composer phpcs
odd/bin/check-licenses
odd/bin/make-pot --out odd/languages/odd-outlandish-desktop-decorator.pot
odd/bin/build-zip
odd/bin/check-zip-contents --list
```

Run PHPUnit locally when the WordPress test environment is configured.
Otherwise, the release workflow must keep PHPUnit and install-smoke as blocking
checks before publishing.

## Plugin Check

CI runs the official `WordPress/plugin-check-action` against the expanded
contents of `dist/odd.zip`. To run the same shape locally, build the zip,
expand it into a temporary plugin directory, and run Plugin Check against that
directory from a WordPress test install.

Plugin Check errors block release. Warnings block release unless the warning is
documented in the release issue with a concrete reason it is acceptable.

## Catalog-Only Updates

Use a catalog-only update when the change is limited to first-party content
under `_tools/catalog-sources/` or generated files under `site/catalog/v1/`.

1. Edit catalog source files.
2. Run `python3 _tools/build-catalog.py`.
3. Run `ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog`.
4. Commit and push to `main`.
5. Confirm `.github/workflows/pages.yml` publishes the catalog.

`validate-catalog` also checks that every bundle has a published `card_url` and
that card assets stay small enough for Shop use. If it fails on card size,
recompress the source `card.webp` files under `_tools/catalog-sources/` and
rebuild instead of raising the limit.

Do not bump `ODDOUT_VERSION`, tag a GitHub release, or edit `CHANGELOG.md` for
catalog-only changes.

## Playground Smoke

1. Open `https://odd.regionallyfamous.com/go/` (stable: newest approved ODD + Desktop Mode releases from WordPress.org). For trunk, use [`/go/dev/`](https://odd.regionallyfamous.com/go/dev/) instead — **do not** use the stable URL to validate `main`.
2. Confirm WordPress Playground loads Desktop Mode v0.8.5+ and ODD.
3. Confirm the ODD Shop opens.
4. Confirm the starter wallpaper, icon set, and cursor set install or show a
   visible retry state.
5. Install one app, one widget, one wallpaper, one icon set, and one cursor set.
6. Open the app, add the widget, apply the visual content, then copy
   diagnostics from About.

## Security And Privacy Signoff

- Mutating REST routes use capability checks and nonces/cookie-auth explicitly.
- Bundle extraction blocks traversal, symlinks, unexpected file types, and slug
  or type mismatches.
- Catalog downloads verify SHA256 before install.
- Remote catalog fetches reject non-HTTPS registries, oversized bodies,
  malformed rows, duplicate slugs, bad hashes, and bundle/icon/card URLs
  outside the configured catalog base.
- Catalog refresh, catalog install, bundle upload, and starter retry routes are
  rate-limited per user.
- App iframe serving sends `nosniff`, `noindex`, `no-referrer`, `SAMEORIGIN`,
  and a restrictive permissions policy.
- SVG and cursor assets are passive and validated.
- Diagnostics are local-only, user initiated, and redact secrets/nonces.
- ODD makes no telemetry, analytics, beacon, or remote error-reporting calls.
- `odd/uninstall.php` clearly controls which options, user meta, and content
  folders are removed.

## Accessibility And Performance Signoff

- Shop cards, dialogs, controls, and settings are keyboard reachable with
  visible focus.
- Buttons and inputs have accessible names.
- Status changes use visible text and `aria-live` where appropriate.
- Reduced-motion preferences are respected by scenes and UI transitions.
- `dist/odd.zip` stays below the 2 MB budget.
- The Shop first paint uses localized state and does not block on remote
  catalog refresh.
- Shop diagnostics include local-only render, catalog fetch/install, iframe
  load, and wallpaper scene-swap timing counters. Use them for regressions, but
  do not add remote telemetry.
- Shop card art uses `card_url` when present and lazy/async image loading.
- Scenes, widgets, apps, and iframes clean up timers, listeners, and resources.
- The static marketing site remains low-dependency and passes `site-lint`.

## Troubleshooting And Recovery

### Catalog Unavailable

1. Open ODD Shop → Settings and check the System Health card.
2. Click **Refresh catalog** once. If it rate-limits, wait for the retry window.
3. If `source` is `stale_option`, the Shop is using the last known good catalog.
4. If `source` is `fallback_file`, the bundled fallback registry is active.
5. Run `ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog` before publishing a
   catalog fix.

### Starter Pack Stuck

1. Copy diagnostics from ODD Shop.
2. Use the starter retry action in the Shop or call `POST /odd/v1/starter/retry`
   as an admin.
3. If retry reports missing starter slugs, rebuild the catalog and confirm
   `starter_pack` entries resolve to real bundle rows.

### App Opens Blank

1. Confirm the app iframe shows an ODD diagnostic card instead of a blank frame.
2. Copy diagnostics; check local metrics for `app.iframe.load`,
   `app.iframe.emptyRoot`, or `app.iframe.skipped`.
3. Reinstall or update the app from the catalog if the serve URL is missing.
4. Inspect the iframe console only after the visible diagnostic confirms the
   host path loaded.

### Broken Bundle Install

1. Trust the first `WP_Error` code: `sha256_mismatch`, `path_traversal`,
   `forbidden_file_type`, `catalog_slug_mismatch`, and `catalog_type_mismatch`
   are security blockers, not retry noise.
2. Check that no partial bundle directory remains under `wp-content/uploads/odd/*`.
3. Rebuild the bundle from `_tools/catalog-sources/` and rerun catalog
   validation.

## Rollback

The 1.0 reset backup lives outside the plugin tree in the local release backup
created before pruning superseded tags/releases. To recover a deleted tag:

```sh
git tag <old-tag> <recorded-sha>
git push origin <old-tag>
gh release create <old-tag> --generate-notes
```

For a bad public release, prefer a quick patch hotfix:

1. Branch from the current release tag.
2. Apply the fix and regression test.
3. Run the validation suite.
4. Commit, tag the next patch version, push, and verify the latest download URL.

## Wiki Sync

After release, mirror these repo docs into the GitHub wiki:

- `docs/architecture.md`
- `docs/building-on-odd.md`
- `docs/store-state-machine.md`
- `docs/release-policy.md`
- `docs/release-runbook.md`
- `docs/security/serve-paths.md`
