=== ODD — Apps for OpenStation ===
Contributors: nickhamze
Tags: openstation, desktop, apps, notes, productivity
Requires at least: 6.8
Tested up to: 7.0
Requires PHP: 8.1
Requires Plugins: desktop-mode
Stable tag: 1.1.11
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A growing catalog of delightful apps for OpenStation.

== Description ==

ODD is an app shop for OpenStation.

OpenStation makes WordPress feel less like a stack of admin screens and more like a computer you actually own. It gives you a desktop, a dock, movable windows, launchers, and apps that stay close while you work.

ODD is here to fill that desktop with good stuff.

We are building useful little tools, playful experiments, and apps that make WordPress more fun to spend time in. Some will help you get work done. Some may be delightfully unnecessary. All of them should feel like they belong in OpenStation.

Each app ships through ODD's signed catalog, so the shelf can grow without waiting for another plugin release.

= Meet ODD Notes =

ODD Notes is a calm, native place to write things down without leaving your WordPress desktop. Your notes live in WordPress, open in their own window, and stay ready whenever you need them.

You can:

* Write and organize notes with search, tags, favorites, and archives.
* Pin notes to your OpenStation desktop.
* Share a note when you want to, while keeping notes private by default.
* Recover drafts if your connection disappears at the wrong moment.
* Browse WordPress revision history and restore an earlier version.
* Trust autosave without sending your notes to another service.

= Why ODD? =

Because OpenStation deserves great apps.

ODD gives those apps one friendly place to live. Open the Shop, find something interesting, install it, and decide whether it belongs on your desktop, in your dock, or both. OpenStation creates the workspace. ODD fills it with things worth opening.

The shelf will keep growing with thoughtfully made OpenStation apps: useful ones, weird ones, tiny ones, and things WordPress did not know it needed yet.

== Installation ==

1. Install and activate [OpenStation](https://wordpress.org/plugins/desktop-mode/) 1.1.0 or newer. Its WordPress.org plugin slug is `desktop-mode`.
2. Install and activate ODD.
3. Enable OpenStation for your user.
4. Open ODD Shop from the OpenStation desktop.
5. Choose an app from the shelf and install it.

== Frequently Asked Questions ==

= Does ODD change my public website? =

No. OpenStation, ODD, and ODD Notes live inside your WordPress admin workspace. Visitors will not see them on your public site.

= Is ODD just a notes app? =

No. ODD Notes is one example from a growing shelf. New apps can arrive through the signed catalog without another plugin update.

= Why does ODD require OpenStation? =

OpenStation provides the desktop, windows, dock, and launchers that make these apps feel like part of a real workspace. ODD builds on that foundation instead of trying to replace it.

= Where are notes stored? =

Notes are stored as private WordPress content. ODD Notes also keeps a local draft journal so interrupted edits can recover cleanly.

= Does this preserve notes created with the OpenStation Notes prototype? =

Yes. ODD Notes uses the same `wpd_note` content model and compatible metadata.

= Does ODD send analytics or notes to another service? =

No. ODD sends no telemetry or note content. It only fetches the public app catalog and an app bundle when an administrator chooses to install it.

== External services ==

ODD connects to https://odd.regionallyfamous.com/catalog/v1/ to display and download verified app bundles. Normal HTTPS request metadata such as IP address, user agent, URL, and timestamp may reach the catalog host. ODD does not send site content, notes, user details, cookies, analytics events, or license keys.

Service terms: https://odd.regionallyfamous.com/terms/

Privacy policy: https://odd.regionallyfamous.com/privacy/

== Source and build tools ==

ODD is open source. The human-readable plugin and ODD Notes source, along with the catalog and packaging tools, are available at https://github.com/RegionallyFamous/odd.

To rebuild the distributed files:

1. `npm ci`
2. `npm run build:notes`
3. `python3 _tools/build-catalog.py`
4. `odd/bin/build-zip`

== Screenshots ==

1. ODD Shop has one focused Apps department with verified install cards from the signed catalog.
2. ODD Notes combines a searchable library, tags, favorites, paper colors, and a distraction-free editor in one native OpenStation window.
3. WordPress revision history keeps earlier note content available for one-click restore.

== Changelog ==

= 1.1.11 =

* Added the scoped ODD app browser API used by Pantry for authenticated WordPress requests and private per-user storage.
* Hardened app installation, updates, recovery, catalog refreshes, and storage against interrupted requests and concurrent writes.
* Aligned manifest, archive, and serving validation so an accepted app remains safe and usable after installation.
* Improved Shop compatibility states and made release packages reproducible, immutable, and smoke-tested as the exact published artifact.

= 1.1.10 =

* Rebuilt ODD Shop as a compact responsive multi-column shelf that scales to a much larger app catalog.
* Removed the repeated Featured app badge and updated the Shop copy for a growing catalog.
* Corrected WordPress and OpenStation capitalization in catalog tags.

= 1.1.9 =

* Made the signed Apps catalog the authority for app slugs, so future apps no longer require plugin allowlist updates.
* Kept an optional host filter for sites that want to restrict which catalog app slugs may install or launch.
* Split catalog publishing from the plugin's frozen offline fallback so normal app releases do not modify the plugin package.
* Unified ODD Shop and catalog app launchers around simple neutral monochrome icons.

= 1.1.8 =

* Made newly installed app launchers appear in OpenStation without a page refresh.
* Added a refresh-and-retry path when an app window has not registered yet.
* Fixed Workbench's iframe template so it renders after reload, fills its bounded, resizable window, and verified all six tools.
* Tightened bundle validation, iframe policy, catalog generation, packaging, and current-version checks.

= 1.1.7 =

* Added ODD Workbench to the production Shop with six local-first text, Markdown, slug, JSON, diff, and encoding utilities.
* Allowed installed catalog apps to register their own OpenStation windows and launchers.
* Kept Workbench in a bounded floating window and simplified its icons to match OpenStation.

= 1.1.6 =

* Renamed ODD to “ODD — Apps for OpenStation” everywhere the product appears.
* Updated the website, repository, plugin metadata, and WordPress.org listing around ODD's apps-first direction.

= 1.1.5 =

* Rebuilt ODD as an Apps-only OpenStation store.
* Added ODD Notes with private WordPress storage, autosave, local recovery, search, tags, favorites, archives, sharing, and revision restore.
* Updated the runtime to OpenStation 1.1.0 public APIs and native window/launcher contracts.
* Fixed note updates in Playground and eliminated false edit-conflict prompts caused by harmless retries or stale identical drafts.
* Isolated recovery journals by WordPress installation and user.
* Redesigned the Shop and Notes app, including consistent monochrome action icons.
* Focused the product, catalog, and distributable package exclusively on apps.

== Upgrade Notice ==

= 1.1.11 =

Adds the catalog API required by ODD Pantry and strengthens app installation, recovery, storage, and release safety.

= 1.1.10 =

ODD Shop now fits more apps into a compact responsive shelf.

= 1.1.9 =

Future ODD apps can now arrive through the signed catalog without another plugin update.

= 1.1.8 =

Apps now appear and open in the same OpenStation session in which they are installed.

= 1.1.7 =

ODD Workbench is now available beside ODD Notes in the production Shop.

= 1.1.6 =

ODD now has a clearer name: ODD — Apps for OpenStation. The Shop and ODD Notes continue to work exactly as before.

= 1.1.5 =

ODD is now a focused Apps-only store for OpenStation 1.1.0 or newer. Update to use ODD Notes and its reliable WordPress-backed autosave, recovery, and revision history.
