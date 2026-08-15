# ODD — Outlandish Desktop Decorator

ODD is a focused app store for [OpenStation](https://github.com/WordPress/openstation). The WordPress.org dependency slug remains [`desktop-mode`](https://wordpress.org/plugins/desktop-mode/), but ODD targets OpenStation 1.1.0’s current `openstation_*`, `wp.os`, and `os.*` public APIs.

The production catalog currently contains one app: **ODD Notes**.

**Requires:** WordPress 6.8+ · PHP 8.1+ · OpenStation 1.1.0+

## ODD Notes

ODD Notes is adapted from the latest Notes app in the OpenStation repository. It opens as a native OpenStation window and stores notes as private WordPress content using the existing `wpd_note` data model. That keeps it compatible with notes created by the OpenStation Notes prototype.

Features include search, tags, favorites, desktop placement, sharing, archives, local-first draft recovery, revisions, and restore.

## Scope

The plugin runtime now owns two surfaces:

- **ODD Shop** — a native, Apps-only storefront.
- **ODD Notes** — installed on demand from the signed remote catalog.

Legacy wallpaper, icon-set, cursor, widget, shuffle, and custom placement systems are not loaded or shipped. Their historical source directories remain in the repository for preservation, while `_tools/catalog-sources/catalog.json` explicitly controls the production catalog.

OpenStation owns desktop/taskbar/hidden launcher placement through `itemVisibility`.

## Development

```sh
python3 _tools/build-catalog.py
ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog
npm test
odd/bin/check-version
odd/bin/check-plugin-metadata
odd/bin/build-zip
odd/bin/check-zip-contents
```

The catalog builder produces a deterministic `odd-notes.wp` bundle from `_tools/catalog-sources/apps/odd-notes/bundle-src/`.

Runtime plugin files live in `odd/`; the production catalog is generated into `site/catalog/v1/`.

## Release boundaries

- App/catalog changes publish through the catalog lane after explicit approval.
- Plugin runtime changes require a versioned WordPress.org plugin release.
- Building and validation do not publish, bump versions, tag commits, or push repositories.

## License

GPLv2 or later. See [LICENSE](LICENSE).
