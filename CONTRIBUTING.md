# Contributing to ODD

Thanks for helping make ODD weirder. This file documents the
contribution workflow. If you're building a third-party scene, icon
set, widget, or app to ship as a `.wp` bundle, see
[docs/building-on-odd.md](docs/building-on-odd.md) instead.

## TL;DR

1. Fork the repo, branch from `main`.
2. Make your change and add tests (vitest for JS foundation/widget/scene logic, PHPUnit for server-side changes).
3. Run the local validation pass:
   ```sh
   odd/bin/check-version && \
     python3 _tools/build-catalog.py && \
     ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog && \
     npm test && \
     vendor/bin/phpunit
   ```
4. Open a PR. The CI matrix gates all of the above plus `install-smoke`, `e2e`, and the manifest schema check.
5. Reviewers aim for a first response within three working days.

## Local setup

```sh
# Clone into wp-content/plugins/ so WordPress picks the plugin up.
git clone https://github.com/RegionallyFamous/odd.git ~/your-wp/wp-content/plugins/odd
cd ~/your-wp/wp-content/plugins/odd

# PHP deps (PHPUnit + PHPCS)
composer install

# JS deps (vitest + playwright)
npm ci
```

Activate ODD alongside WP Desktop Mode (`v0.8.5+`). There's no build
step — plain JS, loaded via `wp_enqueue_script`.

## Testing

- **Vitest** (`npm test`): foundation modules, scene registration, widget registration, panel sanity, API surface guard, scene-perf baseline.
- **Perf sampler** (`ODD_WRITE_PERF_BASELINE=1 npm test -- scene-perf`): regenerates `odd/tests/integration/scene-perf-baseline.json` after intentional perf changes.
- **PHPUnit** (`vendor/bin/phpunit`): icons registry cache, bundle validators, REST endpoints.
- **Playwright e2e** (`npm run test:e2e` against a local WP): boots the panel and asserts the canvas renders.
- **install-smoke** (runs in CI only): full WP install + bundle install + registry assertions.

Adding a new scene? Create `_tools/catalog-sources/scenes/<slug>/` with `scene.js`, `meta.json`, a 640×360 `preview.webp`, and a 1920×1080 `wallpaper.webp`, then run `python3 _tools/build-catalog.py && odd/bin/validate-catalog`. New content ships through the remote catalog (GitHub Pages deploy on push to `main`) — no plugin release needed.

## Style

- PHP: WordPress Coding Standards. `vendor/bin/phpcs` / `phpcbf`. `phpcs -q` runs on every staged PHP file via `lint-staged`.
- JavaScript: @wordpress/prettier-config defaults (tab indent, trailing commas, spaces inside parens). No build step means no TS in `odd/src/` — classic IIFEs install onto `window.__odd`.
- CSS: scoped class prefixes (`odd-panel`, `odd-shop`, `odd-about`). Inline style strings in `src/panel/index.js` are no longer accepted; add new rules to `src/panel/styles.css`.

## API stability

The extension surface (`window.__odd.api`, PHP filters, REST endpoints, manifest shape) follows SemVer **as a separate version from plugin releases**. See [docs/api-versioning.md](docs/api-versioning.md) for the exact contract. If your PR touches anything on that list you must:

1. Bump the `API_VERSION` constant in `odd/src/shared/api.js` according to the rules in api-versioning.md.
2. Update `odd/tests/integration/api-surface.test.js` to assert the new surface.
3. Add an entry to the changelog.

## Architecture decisions

Non-trivial decisions get recorded as ADRs in [docs/adr/](docs/adr/). The bar for an ADR is anything that:

- Forecloses a future option (e.g. "we won't ship server-side telemetry" or "client-side live icon swap is a rabbit hole").
- Changes a file/directory convention (e.g. "icon sets live in `wp-content/odd-icon-sets/`").
- Trades simplicity for performance (or vice versa) in a way that would confuse a future reader.

Propose a new ADR by adding `docs/adr/NNNN-<slug>.md` in your PR. The current list of ADRs is browsed from the [index](docs/adr/README.md).

## Release process

See [docs/release-policy.md](docs/release-policy.md) for version-bump rules, when to fork a release branch, and how to cut hotfixes. In short: `odd/bin/bump-version <version>` → push tag → `release-odd.yml` handles the rest.

## Security

If you find a security issue, please don't open a public issue. Email the maintainer via the contact link on [RegionallyFamous/odd](https://github.com/RegionallyFamous/odd) instead. See [docs/security/serve-paths.md](docs/security/serve-paths.md) for the current sandboxing model.

## Code of conduct

Be kind. This is a hobby project that makes WordPress admin look like a haunted desktop. Don't be the reason someone stops finding that fun.
