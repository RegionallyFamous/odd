# Contributing to ODD

ODD is an Apps-only catalog and installer for OpenStation. The only supported
content type is `app`; all other manifest types are rejected.

## Local checks

```sh
npm ci
npm run build:openstation-components -- .e2e/openstation-1.1.0
npm run build:notes
npm test
python3 _tools/build-catalog.py
python3 _tools/check-app-docs.py
odd/bin/validate-catalog
odd/bin/check-apps-only
odd/bin/check-upstream-versions --require-checkout
odd/bin/build-zip
odd/bin/check-zip-contents
composer phpcs
composer phpunit
```

The browser gate uses the current WordPress release and the pinned current
OpenStation release. Run `bash bin/e2e-local.sh provision` before Playwright
tests. Never overwrite a modified OpenStation checkout to update the test host;
use a clean release worktree or the official WordPress.org ZIP.

## App changes

- App sources live under `_tools/catalog-sources/apps/<slug>/bundle-src/`.
- `catalog.json` is the complete allowlist. Unlisted app directories are not a
  staging area and should not be committed.
- Every archive is local-only static browser code with a strict app manifest.
- Rebuild the catalog after any source or metadata change and commit its
  generated registry, card, icon, and bundle updates. The plugin's frozen
  fallback registry changes only during a plugin release.
- Add one `data-odd-app="<slug>"` card to `site/index.html` whenever an app is
  added. Keep `README.md` evergreen instead of duplicating the app inventory.
- Give first-party apps an `ODD ` name and the shared neutral monochrome icon
  style enforced by the catalog builder.
- Do not edit `bundle.wp` or generated ODD Notes JavaScript directly.

Before handing off a first-party app change, run its isolated verification
gate. It validates the source manifest and clean catalog rebuild, compares the
committed generated output, smoke-tests desktop and mobile packages, and saves
screenshots for independent review:

```sh
npm run verify:app -- <slug>
```

This is the normal catalog-only release lane. Keep the plugin version and
runtime source unchanged unless an app genuinely needs a new host capability.
Catalog app versions move independently, and merging to `main` publishes their
rebuilt bundles through Pages without creating a WordPress.org plugin release.

See [Building an app](docs/building-an-app.md), the
[manifest reference](docs/app-manifest.md), and the
[release runbook](docs/release-runbook.md).
