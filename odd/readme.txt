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

A growing collection of delightful OpenStation apps, starting with ODD Notes.

== Description ==

ODD is an app shop for OpenStation.

OpenStation makes WordPress feel less like a stack of admin screens and more like a computer you actually own. It gives you a desktop, a dock, movable windows, launchers, and apps that stay close while you work.

ODD is here to fill that desktop with good stuff.

We are building useful little tools, playful experiments, and apps that make WordPress more fun to spend time in. Some will help you get work done. Some may be delightfully unnecessary. All of them should feel like they belong in OpenStation.

We are starting with one app because we want each one to be good. ODD Notes is the first app, not the last.

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

ODD Notes is only the beginning. We plan to keep making all sorts of cool apps for OpenStation: useful ones, weird ones, tiny ones, and things WordPress did not know it needed yet.

== Installation ==

1. Install and activate [OpenStation](https://wordpress.org/plugins/desktop-mode/) 1.1.0 or newer. Its WordPress.org plugin slug is `desktop-mode`.
2. Install and activate ODD.
3. Enable OpenStation for your user.
4. Open ODD Shop from the OpenStation desktop.
5. Install ODD Notes, then come back as the app shelf grows.

== Frequently Asked Questions ==

= Does ODD change my public website? =

No. OpenStation, ODD, and ODD Notes live inside your WordPress admin workspace. Visitors will not see them on your public site.

= Is ODD just a notes app? =

Not for long. ODD Notes is the first app in the Shop. The plan is to keep adding thoughtfully made OpenStation apps over time.

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
