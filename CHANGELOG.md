# Changelog

All notable changes to ODD are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<a id="unreleased"></a>
## [Unreleased]

<a id="v1.1.11"></a>
## [1.1.11] — 2026-08-17

### Added
- Added a frozen, scoped browser API for catalog apps to make authenticated
  WordPress requests, store private per-user data, and open permitted admin
  destinations without exposing host internals.
- Added ODD Pantry and end-to-end coverage for creating, organizing,
  favoriting, duplicating, persisting, and removing synced patterns.
- Added project-scoped Codex feature agents and a deterministic per-app
  verification command for future functionality.

### Changed
- Catalog installs, updates, repairs, rollback, recovery, and per-user storage
  now use owner-fenced leases around shared filesystem and database state.
- Manifest, archive, and serving validation now share the same path, type,
  native-asset, and executable-file rules.
- Release workflows now test and publish one reproducible, checksummed plugin
  archive across installation smoke, browser E2E, and Plugin Check.
- Incompatible catalog apps now show a disabled update-required state instead
  of offering an install or update that the server would reject.

### Fixed
- Prevented interrupted or concurrent app operations from losing registry,
  catalog, repair, or per-user storage changes.
- Preserved installed app placement and manifest state across updates and
  recovery.
- Prevented existing GitHub releases and their assets from being overwritten
  by a force-moved or rerun tag workflow.

<a id="v1.1.10"></a>
## [1.1.10] — 2026-08-17

### Changed
- ODD Shop now uses compact responsive multi-column app cards that scale to a
  much larger catalog.
- The public app shelf uses the same scalable layout, with constant-time hover
  handling and automated layout guardrails.
- Shop copy now describes a growing catalog instead of marking every app as
  featured.

### Fixed
- WordPress and OpenStation catalog tags use their official capitalization.

<a id="v1.1.9"></a>
## [1.1.9] — 2026-08-17

### Changed
- The signed, Apps-only catalog is now the authority for app slugs, allowing
  future apps to ship without hard-coded plugin allowlist updates.
- Catalog publishing no longer rewrites the plugin's frozen offline fallback;
  that snapshot is refreshed only during deliberate plugin releases.
- Hosts can still narrow allowed catalog slugs through an explicit filter.
- ODD Shop and all catalog apps now use the same simple neutral launcher-icon
  style.

<a id="v1.1.8"></a>
## [1.1.8] — 2026-08-16

### Changed
- App installation now updates OpenStation launcher placement and refreshes its
  menu in the same browser session.
- App launch retries once after an OpenStation refresh and reports a visible
  error when the window still cannot register.
- Bundle validation, packaging, catalog generation, and CI now enforce the
  Apps-only product boundary.

### Fixed
- Newly installed apps and ODD Notes appear without reloading the desktop.
- ODD Workbench survives OpenStation template escaping, fills its bounded,
  resizable window, and no longer opens blank or full screen.

<a id="v1.1.7"></a>
## [1.1.7] — 2026-08-16

### Added
- Added ODD Workbench with six local-first utilities: Text Cleaner, Markdown
  Preview, Slug Maker, JSON Formatter, Diff Checker, and Encoder / Decoder.

### Changed
- Installed catalog apps can register OpenStation windows and launchers.
- Workbench uses a bounded floating window and simple monochrome icons.

<a id="v1.1.6"></a>
## [1.1.6] — 2026-08-16

### Changed
- Renamed the product to **ODD — Apps for OpenStation** across the plugin,
  listing, repository, website, wiki, and social metadata.

<a id="v1.1.5"></a>
## [1.1.5] — 2026-08-15

### Added
- Added ODD Notes with private WordPress storage, search, tags, favorites,
  archives, desktop pinning, optional sharing, autosave, and revision restore.
- Added focused unit coverage and a WordPress/OpenStation browser test for note
  creation, editing, save retries, and refreshes.

### Changed
- ODD now targets OpenStation 1.1.0 and the `openstation_*`, `wp.os`, and
  `os.*` public contracts.
- Focused the product, catalog, and distributable package exclusively on apps.
- Redesigned ODD Shop and ODD Notes around a compact native-feeling interface.

### Fixed
- Preserved JSON request bodies in WordPress Playground and other bridged
  environments.
- Preserved server concurrency tokens during autosave and accepted idempotent
  stale retries.
- Isolated recovery journals by WordPress installation and user.
