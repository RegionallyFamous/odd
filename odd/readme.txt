=== ODD — Outlandish Desktop Decorator ===
Contributors: nickhamze
Tags: openstation, desktop, apps, notes, productivity
Requires at least: 6.8
Tested up to: 7.0
Requires PHP: 8.1
Requires Plugins: desktop-mode
Stable tag: 1.1.5
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A focused app store for OpenStation, beginning with ODD Notes.

== Description ==

ODD adds a small, native app store to OpenStation. Its first app is ODD Notes: a local-first notes library and editor stored in WordPress.

The Shop is intentionally focused. It has one Apps department, one verified catalog, and one excellent app at a time. OpenStation continues to own windows, launchers, placement, and the surrounding desktop experience.

ODD Notes includes:

* A native OpenStation window and movable launcher.
* Search, tags, favorites, desktop notes, sharing, and archives.
* Local-first drafts and recovery when a connection is interrupted.
* WordPress revision history and restore controls.
* Reliable autosave with genuine multi-window conflict protection.
* Private WordPress content storage, with no third-party notes service.

ODD no longer installs wallpapers, icon sets, cursor effects, or desktop widgets. The Shop has one department—Apps—and OpenStation owns launcher placement through its normal desktop and taskbar settings.

== Installation ==

1. Install and activate [OpenStation](https://wordpress.org/plugins/desktop-mode/) 1.1.0 or newer. Its WordPress.org plugin slug is `desktop-mode`.
2. Install and activate ODD.
3. Enable OpenStation for your user.
4. Open ODD Shop from the OpenStation desktop.
5. Install ODD Notes.

== Frequently Asked Questions ==

= Does ODD change my public website? =

No. ODD and ODD Notes run inside the authenticated WordPress admin workspace.

= Where are notes stored? =

Notes are stored as private WordPress content. ODD Notes also keeps a local draft journal so interrupted edits can recover cleanly.

= Does this preserve notes created with the OpenStation Notes prototype? =

Yes. ODD Notes uses the same `wpd_note` content model and compatible metadata.

= Does ODD send analytics or notes to another service? =

No. ODD sends no telemetry or note content. It only fetches the public app catalog and app bundle selected by an administrator.

== External services ==

ODD connects to https://odd.regionallyfamous.com/catalog/v1/ to display and download verified app bundles. Normal HTTPS request metadata such as IP address, user agent, URL, and timestamp may reach the catalog host. ODD does not send site content, notes, user details, cookies, analytics events, or license keys.

Service terms: https://odd.regionallyfamous.com/terms/

Privacy policy: https://odd.regionallyfamous.com/privacy/

== Source and build tools ==

Source code and deterministic catalog tooling are available at https://github.com/RegionallyFamous/odd.

Typical checks:

1. `npm run build:notes`
2. `python3 _tools/build-catalog.py`
3. `ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog`
4. `npm test`
5. `composer phpcs`
6. `odd/bin/build-zip`

== Screenshots ==

1. ODD Shop has one focused Apps department and a verified ODD Notes install card.
2. ODD Notes combines a searchable library, tags, favorites, paper colors, and a distraction-free editor in one native OpenStation window.
3. WordPress revision history keeps earlier note content available for one-click restore.

== Changelog ==

= 1.1.5 =

* Rebuilt ODD as an Apps-only OpenStation store.
* Added ODD Notes with private WordPress storage, autosave, local recovery, search, tags, favorites, archives, sharing, and revision restore.
* Updated the runtime to OpenStation 1.1.0 public APIs and native window/launcher contracts.
* Fixed note updates in Playground and eliminated false edit-conflict prompts caused by harmless retries or stale identical drafts.
* Isolated recovery journals by WordPress installation and user.
* Redesigned the Shop and Notes app, including consistent monochrome action icons.
* Removed legacy wallpaper, icon-set, cursor, widget, and custom placement runtime surfaces.

= 1.1.4 =

* Improved compatibility with the previous Desktop Mode 0.8.8 host runtime.

== Upgrade Notice ==

= 1.1.5 =

ODD is now a focused Apps-only store for OpenStation 1.1.0 or newer. Update to use ODD Notes and its reliable WordPress-backed autosave, recovery, and revision history.
