# ODD — Outlandish Desktop Decorator

ODD is a focused app store for [OpenStation](https://github.com/WordPress/openstation). The WordPress.org dependency slug remains [`desktop-mode`](https://wordpress.org/plugins/desktop-mode/), while ODD targets OpenStation 1.1.0's current `openstation_*`, `wp.os`, and `os.*` public APIs.

The production catalog currently contains one app: **ODD Notes**.

**Requires:** WordPress 6.8+ · PHP 8.1+ · OpenStation 1.1.0+

- [Try the current `main` branch in Playground](https://odd.regionallyfamous.com/go/dev/)
- [Open the stable WordPress.org demo](https://odd.regionallyfamous.com/go/)
- [Browse the production catalog](https://odd.regionallyfamous.com/catalog/v1/registry.json)

## What ODD owns

- **ODD Shop** — a native OpenStation window with one Apps section and a verified remote catalog.
- **ODD Notes** — an installable native OpenStation app backed by WordPress content.

OpenStation continues to own windows, desktop and dock placement, launcher visibility, and the surrounding operating-system UI. ODD registers through the host's public APIs instead of replacing those surfaces.

Legacy wallpaper, icon-set, cursor, widget, shuffle, and custom-placement systems are not loaded or published. Their historical source directories remain in the repository for reference; `_tools/catalog-sources/catalog.json` is the production catalog allowlist.

## ODD Notes 1.3

ODD Notes is adapted from the latest Notes work in the OpenStation repository. It stores notes using OpenStation's existing `wpd_note` data model, so notes remain WordPress content rather than opaque browser data.

Features include:

- Search, tags, favorites, archives, sharing, and desktop pinning.
- Autosave, WordPress revisions, and revision restore.
- Local-first draft recovery, isolated by WordPress installation and user.
- Optimistic concurrency that preserves server-issued version tokens and only prompts for genuine competing edits.
- Idempotent retry handling for saves whose first response was interrupted.

Browser journals are a recovery layer only. WordPress remains the primary store.

## Development

Install dependencies and rebuild the maintainable ODD Notes source:

```sh
npm ci
npm run build:notes
```

Build and validate the production catalog:

```sh
python3 _tools/build-catalog.py
ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog
odd/bin/validate-blueprint
```

Run the focused tests and package checks:

```sh
npm test
composer phpcs
odd/bin/check-version
odd/bin/check-plugin-metadata
odd/bin/build-zip
odd/bin/check-zip-contents
```

Run the real WordPress/OpenStation browser smoke test locally with Docker:

```sh
bash bin/e2e-local.sh all e2e/panel.spec.ts
```

The browser test installs the freshly built local catalog fixture, opens ODD Notes, writes and saves a note, exercises an idempotent stale retry, refreshes the library, and confirms that no false conflict prompt appears.

## Source layout

```text
odd/                                         WordPress plugin runtime
odd/includes/notes/                          WordPress note storage and REST API
_tools/catalog-sources/apps/odd-notes/src/  Maintainable ODD Notes TypeScript
_tools/catalog-sources/apps/odd-notes/       App manifest, assets, and generated bundle source
site/catalog/v1/                             Generated production catalog
e2e/panel.spec.ts                            Real WordPress/OpenStation browser smoke
```

`npm run build:notes` compiles the TypeScript runtime and joins it to the pinned OpenStation component snapshot. Do not hand-edit `bundle-src/assets/js/odd-notes.min.js`; CI and the pre-commit hook reject source/bundle drift.

## Release boundaries

- **Preview catalog:** non-live QA through [`/go/preview/`](https://odd.regionallyfamous.com/go/preview/).
- **Production catalog:** app sources plus generated `site/catalog/v1/` artifacts pushed to `main`.
- **Plugin runtime:** versioned GitHub and WordPress.org release when PHP/runtime code changes must reach stable installs.

A catalog deploy does not create a plugin release, move a tag, or publish WordPress.org SVN.

## Documentation

The [GitHub wiki](https://github.com/RegionallyFamous/odd/wiki) covers the current architecture, ODD Notes reliability model, development workflow, and release lanes.

## License

GPLv2 or later. See [LICENSE](LICENSE).
