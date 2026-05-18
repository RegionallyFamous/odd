# Changelog

All notable changes to ODD are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release section includes an `<a id="vX.Y.Z"></a>` anchor so
`odd/bin/release-notes <version>` can publish the same customer-facing
notes to GitHub Releases.

<a id="unreleased"></a>
## [Unreleased]

Nothing yet.

<a id="v1.1.2"></a>
## [1.1.2] — 2026-05-18

### Fixed
- First installs now apply the ODD starter Desktop Mode experience without
  requiring a browser refresh. ODD registers its wallpaper and Shop through a
  small live bootstrap handle that can load the full ODD runtime during
  Desktop Mode's mid-session refresh.
- The live bootstrap applies the starter wallpaper, large dock, and ODD
  launcher visibility through Desktop Mode's native settings API when the
  current desktop is still on the default wallpaper.
- The ODD Shop native window now advertises its stylesheet to Desktop Mode's
  lazy loader, so mid-session activation gets styled Shop chrome immediately.

<a id="v1.1.1"></a>
## [1.1.1] — 2026-05-17

### Changed
- Refreshed the bundled catalog snapshot and first-party catalog metadata so
  fallback/offline installs match the current Shop content more closely.
- Updated the stable Playground/readme links for the next pinned WordPress.org
  release package.

### Fixed
- Catalog refreshes now invalidate the runtime catalog cache immediately, so
  the Shop stops showing old rows after a successful remote refresh or repair.
- The Shop highlight timer is guarded during teardown, fixing the lingering
  async handle that was making CI report Vitest cleanup failures.
- First-party app/widget catalog polish from the post-1.1.0 catalog updates is
  included in the release baseline, including Tiny Aquarium sizing and refreshed
  game app card/icon presentation.

<a id="v1.1.0"></a>
## [1.1.0] — 2026-05-16

### Added
- **ODD feels much more like part of the desktop now.** Apps, widgets, taskbar
  entries, desktop shortcuts, wallpaper controls, and decoration reset actions
  are wired through Desktop Mode's native window, file, and surface APIs. The
  practical win: installing or changing something in the Shop shows up where
  people expect it, without a reload scavenger hunt.
- **A real tiny game joins the catalog.** _Don't Read the Comments_ is a
  Minesweeper-style desktop app with first-click-safe boards, flags, chording,
  timers, local scores, responsive difficulties, and silly fictional
  comment-bomb reveals. It is a proper puzzle game first and the joke rides on
  top.
- **Living cursor effect packs.** Cursor themes can now be lightweight effect
  recipes instead of a pile of cursor image files, which makes pointer themes
  smaller, safer, and livelier.
- **A companion-plugin SDK facade.** `window.__odd.sdk` gives extension authors
  a cleaner way to read storage, save preferences, inspect capabilities, show
  toasts, collect diagnostics, and register teardown handlers. The lower-level
  `window.__odd.api` remains available and now reports API version **2.4.0**.

### Changed
- **The Shop is easier to scan.** Catalog cards now share a consistent footprint
  across departments, with cleaner install/open/apply states, tighter controls,
  and new generated card art sized for the new grid.
- **Default desktop icons got a glow-up.** ODD now ships a focused raster icon
  set for desktop shortcuts, including the custom recycle-bin treatment, while
  leaving Desktop Mode's native rails and taskbar behavior intact.
- **App catalog presentation is sharper.** First-party apps have matching card
  art, app icons, native-window metadata, and catalog bundles so they look and
  open like real desktop software instead of loose web toys.
- **The catalog health view is more useful.** The Shop now explains signed
  catalog status, cached snapshots, fallback behavior, and recovery actions in
  one place so site owners can see why the store is safe instead of guessing.

### Fixed
- **Desktop app shortcuts appear immediately after install.** ODD now refreshes
  Desktop Mode's root file placements after app installs or surface changes, so
  newly installed app icons can appear on the desktop right away.
- **Taskbar and desktop placement settings are more reliable.** App surface
  toggles, the ODD taskbar setting, and the wallpaper shortcut setting now save
  through the native Desktop Mode contracts and refresh the visible desktop
  state cleanly.
- **The Shop opens in a saner place.** Saved native-window geometry is nudged
  back near the top of the desktop when needed, avoiding the awkward "where did
  the store go?" moment after resizing or moving windows.
- **Playground and catalog installs are sturdier.** App loading, widget CSS
  delivery, stale-catalog fallback, and catalog repair flows all got another
  round of hardening for scoped Playground URLs and temporary catalog outages.
- **Desktop Mode integration got quieter.** Several old hook aliases and noisy
  shell issue toasts were removed or softened now that ODD relies on the current
  Desktop Mode surface.

### Security
- **Signed catalog checks are now part of the product experience.** Catalog
  rows are verified with trusted signing keys, SHA256 hashes, expected sizes,
  version compatibility, and same-base HTTPS URL checks before install.
- **Bundle validation is stricter.** ODD rejects path traversal, symlinks,
  executable files, suspicious compression ratios, malformed manifests,
  mismatched slugs/types/versions, and incompatible runtime requirements before
  content reaches the uploads directory.
- **Icon and cursor assets are safer.** Icon sets now use bounded raster assets,
  cursor effect packs avoid raw cursor images, and SVG previews are scrubbed for
  scripts, event handlers, external references, and control bytes.
- **Diagnostics remain local-only.** The expanded health and diagnostics
  surfaces still copy data only when the administrator asks; ODD does not add
  telemetry, analytics, license checks, or remote error reporting.

### Compatibility
- Requires WordPress 6.8+, PHP 8.1+, and WP Desktop Mode 0.8.5+.
- `window.__odd.api.version` is **2.4.0**. The 2.3 line added native helpers
  for cursor sets, widgets, apps, shuffle/audio preferences, and decoration
  reset; the 2.4 line adds the preferred `window.__odd.sdk` facade.
- Public Playground installs continue to follow the approved WordPress.org ODD
  release, while dev Playground links are isolated and cache-busted for testing
  the current `main` branch.

<a id="v1.0.0"></a>
## [1.0.0] — 2026-05-15

### Added
- **A complete desktop shop for WordPress.** ODD gives WP Desktop Mode a
  catalog-driven shop for wallpapers, icon sets, cursor sets, widgets, and
  small apps. New content ships through the remote catalog, so the store can
  be refreshed without a plugin release.
- **Unified store cards.** Catalog cards behave like durable product cards:
  install, preview, apply, add, open, reload, repair, and diagnostics all flow
  from the same surface instead of separate one-off screens.
- **Starter content out of the box.** Fresh installs start with matching
  Oddling wallpaper, icons, and cursors so the desktop feels intentional
  immediately.

### Fixed
- **WordPress.org review readiness.** The plugin uses the WordPress.org slug
  text domain, documents its external catalog service and generated React
  runtime source, stores installed content under uploads, avoids global PHP
  limit/user switching, and keeps development-only files out of the release
  zip.
- **Playground app loading.** Scoped app iframe, runtime import-map, rewritten
  React runtime, REST root, icon, and diagnostic URLs keep the active
  `/scope:<id>/` prefix so app requests stay inside the running Playground
  instance.
- **Custom cursors.** Installed cursor-set CSS uses a public ODD REST asset
  endpoint, wins against Desktop Mode's global cursor reset, and preserves
  themed pointer cursors when hovering desktop icons, icon children, dock
  items, and window controls.
- **Desktop rails and Shop layout.** Left/right Desktop Mode rails no longer
  pan sideways, vertical icon access remains available, and the ODD Shop clamps
  horizontal overflow.
- **Wallpaper lifecycle teardown.** Wallpaper swaps, Desktop Mode wallpaper
  unmounts, page teardown, Shop hero previews, audio hooks, and Iris observers
  now release Pixi apps, tickers, timers, canvases, and listeners cleanly.

### Changed
- **Magic 8-Ball widget.** The live widget skin has a polished abstract oracle
  texture, bundled widget assets, and updated widget packaging.
- **Stable Playground.** The public blueprint installs ODD **1.0.0** with WP
  Desktop Mode pinned to the official **0.8.5** release zip.
- **Catalog baseline.** First-party store downloads are normalized to version
  **1.0.0** so WordPress.org, GitHub, and the in-app Shop share one clean public
  baseline.
- **ODD Shop native window sizing.** The Shop preserves Desktop Mode's
  remembered native-window size while still enforcing minimum dimensions.

### Security
- **Hardened bundle installs.** Remote and uploaded `.wp` bundles are validated
  before extraction, checked against catalog identity and SHA256 data, and kept
  behind capability checks.
- **Safer SVG and cursor assets.** Icon and cursor bundles are limited to
  passive SVG assets with validation in both author tooling and install-time
  paths.
- **Local-only diagnostics.** Copy Diagnostics assembles support information
  locally and only copies it when the user asks. ODD does not send telemetry,
  analytics, or error reports.
- **Remote catalog hardening.** Catalog fetches reject non-HTTPS registries,
  oversized bodies, malformed rows, duplicate slugs, bad hashes, and
  bundle/icon/card URLs outside the configured catalog base by default.

### Compatibility
- Requires WordPress 6.8+, PHP 8.1+, and WP Desktop Mode 0.8.5+.
- Playground blueprints, redirects, smoke workflows, and docs pin WP Desktop
  Mode to the official 0.8.5 release zip.
- Desktop Mode 0.8.5 diagnostics/cursor coverage includes host widgets,
  desktop files, shared folders, presence, heartbeat, and arrange-menu
  surfaces.
