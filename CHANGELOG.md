# Changelog

All notable changes to ODD are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release section includes an `<a id="vX.Y.Z"></a>` anchor so
`odd/bin/release-notes <version>` can publish the same customer-facing
notes to GitHub Releases.

<a id="unreleased"></a>
## [Unreleased]

### Changed
- Playground deploys enforce pins: Desktop Mode via **downloads.wordpress.org** `plugin/desktop-mode.{ODD_DESKTOP_MODE_MIN_VERSION}.zip` (`resource: "url"`), ODD from git tag `v` + `ODD_VERSION`; `odd/bin/validate-blueprint` checks both against `odd/odd.php`. (Playground schema disallows `pluginData.version` on `wordpress.org/plugins`.)
- Playground demo links encode `blueprint.json?oddbp=v2-desktop-zip` on the blueprint URL passed to playground.wordpress.net so browsers don’t silently reuse an older cached blueprint payload.

<a id="v1.0.1"></a>
## [1.0.1] — 2026-05-07

### Added
- ODD Shop Luxe + Weird overhaul: tokenized light/dark chrome, responsive rail, SVG glyph system, animated iris brand mark, live wallpaper hero, editorial strip, motion polish, Chaos mode, and shop-local Oddling chaos cast.
- New Shop preferences for `theme` (`light|dark|auto`) and `chaosMode`, both persisted through `/odd/v1/prefs`.
- `window.__odd.mountSceneInto(container, slug, opts)` for low-power scene previews outside the desktop wallpaper runner.

### Changed
- **Requires WP Desktop Mode v0.7.2+.** Hooks use the `desktop-mode.*` namespace, the bundled script handle is `desktop-mode`, shell roots use `#desktop-mode-shell` / `body.desktop-mode-active`, native window renderers live on `desktopModeNativeWindows`, and host config/wallpapers use `desktopModeConfig` / `desktopModeWallpapers`. CI installs Desktop Mode from WordPress.org (legacy `wp-desktop` integration is removed).
- Public Playground blueprints open `/wp-admin/index.php?desktop_mode_portal=1`, pin wordpress.org Desktop Mode **0.7.2**, and install ODD **v1.0.1** from a `git:directory` semver tag (see `odd/bin/validate-blueprint`).
- `odd/bin/bump-version` bumps both blueprints’ ODD **`ref`** when cutting a semver release (`v` tag).
- Icon-set dock/desktop mapping targets the recycle bin slug `desktop-mode-recycle-bin` (WP Desktop Mode v0.7+).
- The ODD Shop native window now defaults to 1080x720 with a 720x520 minimum.
- Scene bundles can carry `heroSafe:false` to keep desktop-only scenes out of the Shop hero.

<a id="v1.0.0"></a>
## [1.0.0] — 2026-05-01

### Added
- **A complete desktop shop for WordPress.** ODD gives WP Desktop Mode a
  catalog-driven shop for wallpapers, icon sets, cursor sets, widgets, and
  small apps. New content ships through the remote catalog, so the store can
  be refreshed without a plugin release.
- **Unified store cards.** Catalog cards now behave like durable product
  cards: install, preview, apply, add, open, reload, repair, and diagnostics
  all flow from the same surface instead of separate one-off screens.
- **Starter content out of the box.** Fresh installs start with matching
  Oddling wallpaper, icons, and cursors so the desktop feels intentional
  immediately.
- **Desktop Mode v0.6 integration.** ODD targets WP Desktop Mode v0.6.0+ and
  integrates with its settings tab, command, title-bar, window, widget,
  iframe, dock, wallpaper, activity, and diagnostics hooks.

### Security
- **Hardened bundle installs.** Remote and uploaded `.wp` bundles are
  validated before extraction, checked against catalog identity and SHA256
  data, and kept behind capability checks.
- **Safer SVG and cursor assets.** Icon and cursor bundles are limited to
  passive SVG assets with validation in both author tooling and install-time
  paths.
- **Local-only diagnostics.** Copy Diagnostics assembles support information
  locally and only copies it when the user asks. ODD does not send telemetry,
  analytics, or error reports.

### Reliability
- **Visible recovery paths.** Shop, starter-pack, app, widget, and catalog
  failures surface actionable messages rather than silent blank states.
- **Catalog fallback and repair.** The Shop keeps a stale catalog available
  when the remote catalog cannot be reached, and diagnostics explain install
  or app drift clearly enough to repair.
- **Release-quality gates.** The 1.0 line is backed by catalog determinism,
  JavaScript integration tests, PHP coding standards, Plugin Check, zip
  contents checks, install smoke tests, blueprint validation, and docs/site
  validation.

### Compatibility
- Requires WordPress 6.0+, PHP 7.4+, and WP Desktop Mode 0.6.0+.

## Pre-1.0 History

Earlier public tags were development releases used to shape the catalog,
runtime, and Desktop Mode integration. They have been removed from the public
release line so `v1.0.0` is the clean baseline users should install and
reference going forward.
