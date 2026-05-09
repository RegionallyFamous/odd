=== ODD — Outlandish Desktop Decorator ===
Contributors: regionallyfamous
Tags: wp-desktop-mode, desktop, wallpaper, widgets, apps
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.5
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Install living wallpapers, icon sets, cursors, widgets, and tiny desktop apps for WP Desktop Mode from a safe remote catalog.

== Description ==

ODD (Outlandish Desktop Decorator) layers on top of [WP Desktop Mode](https://github.com/WordPress/desktop-mode). Once both plugins are active, the WordPress admin becomes a desktop with a polished shop for visual themes, desktop widgets, and small tools.

ODD ships as a lightweight runtime. The content lives in a remote catalog at [odd.regionallyfamous.com/catalog/v1/](https://odd.regionallyfamous.com/catalog/v1/registry.json), installs as universal `.wp` bundles, and can be updated without shipping a new plugin zip.

ODD manages five content types:

* **Canvas wallpapers** — living PixiJS scenes painted on top of desktop backdrops.
* **Icon sets** — themed SVG costume packs for dock and desktop shortcuts.
* **Cursor sets** — pointer themes for Desktop Mode and classic wp-admin.
* **Desktop widgets** — draggable desk companions like Sticky Note, Magic 8-Ball, and Spotify Embed.
* **Apps** — sandboxed HTML/CSS/JS tools that open in their own Desktop Mode windows.

Fresh installs get a starter pack so the desktop looks complete immediately. Everything else is one click away in the ODD Shop, with responsive light/dark chrome, global search, editorial shelves, reversible previews, compact preferences, and just enough Oddling weirdness to make the admin feel alive.

== Installation ==

1. Install and activate [WP Desktop Mode](https://github.com/WordPress/desktop-mode) v0.8.0 or newer (WordPress.org distribution recommended).
2. Upload and activate ODD from the Plugins screen, or install the release zip.
3. Enable desktop mode for your user.
4. Open the ODD Shop from its desktop icon, taskbar icon, or `/odd-panel` command.

== Frequently Asked Questions ==

= Does ODD work without WP Desktop Mode? =

No. ODD is a decorator and app-store layer for WP Desktop Mode. If Desktop Mode is missing or out of date, ODD shows an admin notice and pauses desktop integrations.

= Does ODD call home? =

ODD fetches the remote content catalog and downloads bundles only when you install content. It does not send telemetry, analytics, or error reports. Copy Diagnostics is local-only and user initiated.

= Can I install third-party content? =

Yes. Apps, scenes, icon sets, cursor sets, and widgets can be packaged as `.wp` bundles. ODD validates archives before install, and app/widget JavaScript requires administrator capability.

= Can the store update without a plugin release? =

Yes. Catalog entries, card art, bundles, and starter content publish through the remote catalog. Plugin releases are reserved for runtime, security, and API changes.

= How do I report bugs? =

Open ODD Shop → About → Copy diagnostics, then paste the markdown into a GitHub issue. Nothing is sent anywhere unless you choose to share it.

== Screenshots ==

1. ODD Shop with unified catalog cards.
2. Wallpaper department with preview/apply controls.
3. Apps department with install/open cards.
4. Desktop with themed wallpaper, icons, cursors, and widgets.

== Changelog ==

= 1.0.5 =

Fixes Desktop Mode dock rail horizontal drift, clamps ODD Shop horizontal overflow, keeps the Shop rendering when a live wallpaper hero scene asset is missing, and ships the polished Magic 8-Ball widget refresh. Pins the public Playground blueprints to ODD 1.0.5 plus WP Desktop Mode 0.8.0.

= 1.0.4 =

Fixes Playground app loading by preserving scoped app/runtime/REST URLs, mounting app iframes from the live Desktop Mode window payload, and keeping the iframe visible inside native windows. Adds local app-loading diagnostics and pins the public Playground blueprints to ODD 1.0.4 plus WP Desktop Mode 0.8.0.

= 1.0.3 =

Fixes PHPUnit coverage for native-window icons vs themed desktop shortcuts (`desktop_mode_shell_config`) so **GitHub Actions can publish `odd.zip` again** — the v1.0.1 and v1.0.2 release workflows stopped in CI for the same reason. Dev Playground blueprint (latest Desktop Mode + `main`), `/go` short redirects, stricter blueprint validation, and Playground commit-pin tooling.

= 1.0.2 =

Reliable wallpaper scene swaps from the Shop (early hook bridge + prefs confirm path). Vertical dock rails scroll instead of clipping when many menu icons are visible. Wallpapers honor `desktop-mode.wallpaper.visibility` during Pixi bootstrap. Screensaver/API/panel dual-emit the legacy `odd/pickScene` hook. WordPress Playground installs pin the peeled git **commit** for this release tag (avoids flaky tag archive fetches).

= 1.0.1 =

Shop Luxe + Weird overhaul, Shop theme/chaos prefs, Desktop Mode **v0.7.2+** integration (`desktop-mode.*` hooks and globals), install-smoke/E2E on wordpress.org Desktop Mode, and Playground opens the wp-admin desktop portal.

= 1.0.0 =

The clean public baseline for ODD: a catalog-driven app store and decorator layer for WP Desktop Mode v0.7.2+, with unified store cards, hardened bundle installs, local-only diagnostics, starter content, and release-quality CI gates.

== Upgrade Notice ==

= 1.0.5 =

Fixes horizontal dock/Shop drift and hardens the Shop against missing live hero scene assets.

= 1.0.4 =

Updates the Desktop Mode host baseline to v0.8.0+ and fixes blank Playground app windows.

= 1.0.3 =

Use this build if you relied on GitHub **Releases** for **1.0.1** or **1.0.2** — those tags did not finish uploading `odd.zip` because CI failed.

= 1.0.2 =

Fixes dock overflow with long menus and unreliable wallpaper swaps triggered from the ODD Shop during shell boot.

= 1.0.1 =

**Requires WP Desktop Mode v0.7.2 or newer.** Upgrade Desktop Mode first if you are still on an older shell.

= 1.0.0 =

ODD now targets WP Desktop Mode v0.7.2+ and resets the public release line to a clean 1.0 baseline. Fresh installs are recommended for sites that were testing earlier development releases.
