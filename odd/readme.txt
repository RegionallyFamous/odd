=== ODD — Outlandish Desktop Decorator ===
Contributors: nickhamze
Tags: wp-desktop-mode, desktop, wallpaper, widgets, apps
Requires at least: 6.8
Tested up to: 6.9
Requires PHP: 8.1
Requires Plugins: desktop-mode
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Make WordPress feel like your digital home with living wallpapers, custom icons, playful cursors, desk widgets, and tiny apps for WP Desktop Mode.

== Description ==

ODD turns your WordPress admin into a customizable desktop you actually want to spend time in.

WordPress does not have to feel like a plain control panel. With ODD and WP Desktop Mode, your admin can become a little digital room: a place with wallpaper, personality, favorite tools, charming desk toys, and a shop full of strange little upgrades.

Want to try it first? Launch the regular ODD Playground at https://odd.regionallyfamous.com/playground/.

Open the ODD Shop, pick what feels right, and make the workspace yours.

With ODD you can:

* Add living wallpapers that make your desktop feel alive.
* Dress up your Desktop Mode dock, taskbar, and desktop icons with themed raster icon sets.
* Swap in custom cursors that match the mood.
* Drop tiny widgets onto the desktop, like notes, toys, embeds, and little desk companions.
* Install small desktop apps that open in their own windows.
* Start with a ready-made starter pack, then customize from there.

ODD is for people who live in WordPress all day and want it to feel less like rented office furniture and more like their own place.

Maybe your WordPress should be calm and cozy. Maybe it should be weird and neon. Maybe it should look like a tiny operating system from a dream. ODD gives you the pieces and lets you decorate.

== Why You'll Like It ==

= Your admin gets a personality =

Change the look and feel of WordPress without changing your public site. ODD decorates your workspace, not your visitors' experience.

= It is easy to try things =

Browse the ODD Shop, install something, apply it, swap it, remove it, and keep playing until the desktop feels right.

= It makes everyday WordPress more fun =

Your tools are still there. Your admin still works. It just feels more alive while you work.

= It works with WP Desktop Mode =

ODD is made for WP Desktop Mode, the plugin that turns wp-admin into a desktop-style workspace.
It works with Desktop Mode's own windows, dock, taskbar, desktop icons, and widget layer instead of replacing the desktop shell.

== Installation ==

1. Install and activate [WP Desktop Mode](https://wordpress.org/plugins/desktop-mode/) v0.8.5 or newer. WordPress will also show it as a required plugin dependency for ODD.
2. Install and activate ODD.
3. Enable Desktop Mode for your user.
4. Open the ODD Shop from the desktop.
5. Pick a wallpaper, icon set, cursor, widget, or app and make yourself at home.

== Frequently Asked Questions ==

= Does ODD change my public website? =

No. ODD customizes your WordPress admin workspace. Visitors to your site will not see your desktop wallpaper, icons, widgets, or apps.

= Do I need WP Desktop Mode? =

Yes. ODD is made for WP Desktop Mode. Desktop Mode creates the desktop workspace, and ODD fills it with personality.

= What can I customize? =

You can customize wallpapers, Desktop Mode icons, cursors, widgets, and small desktop apps.

= Is this just for developers? =

No. ODD is meant to be fun for regular WordPress users. If you can browse a shop and click install, you can use ODD.

= Can I undo things? =

Yes. Installed items can be changed or removed. You can keep experimenting until your workspace feels right.

= Does ODD send analytics or tracking data? =

No. ODD does not send telemetry, analytics, license checks, or error reports. It only fetches the public catalog and the items you choose to install.

== Screenshots ==

1. A decorated WordPress desktop with wallpaper, icons, widgets, and docked apps.
2. The ODD Shop, where you can browse living wallpapers and desktop upgrades.
3. Icon sets in the ODD Shop, ready to install and apply.

== External services ==

ODD connects to the public ODD catalog at https://odd.regionallyfamous.com/catalog/v1/. This catalog is used to show items in the ODD Shop and download the wallpapers, icon sets, cursors, widgets, and apps you choose to install.

When an administrator opens or refreshes the ODD Shop, runs the starter pack, installs catalog content, or repairs an installed item, the site makes normal HTTPS requests for static catalog files and assets. Those requests may include normal web request information such as the server IP address, user agent, requested URL, and timestamp.

ODD does not send site content, user account details, cookies, analytics events, license keys, or diagnostic reports to the catalog service.

Service terms: https://odd.regionallyfamous.com/terms/

Privacy policy: https://odd.regionallyfamous.com/privacy/

== Source and build tools ==

The human-readable source code for ODD is available at https://github.com/RegionallyFamous/odd. The repository includes the source files, build scripts, catalog sources, and package metadata used to create the plugin.

The generated JavaScript runtime files in `apps/runtime/*.js` are built from the public `react` and `react-dom` npm packages pinned in the repository. React source code is maintained at https://github.com/facebook/react, and the exact package versions are recorded in `package-lock.json`.

Typical build commands:

1. `npm ci`
2. `odd/bin/build-runtime`
3. `python3 _tools/build-catalog.py`
4. `odd/bin/build-zip`

== Changelog ==

= 1.1.0 =

ODD 1.1.0 makes the desktop experience feel more native, more polished, and more fun.

* Apps, widgets, taskbar entries, desktop shortcuts, wallpaper controls, and decoration reset actions now work more cleanly with WP Desktop Mode's native surfaces.
* App icons can appear on the desktop immediately after install or placement changes.
* The Shop has more consistent catalog cards, clearer install/open/apply states, refreshed card art, and better app presentation.
* Added the Don't Read the Comments Minesweeper-style desktop app.
* Refreshed the default desktop icon set, including the custom recycle-bin icon treatment.
* Added living cursor effect packs and stricter icon/cursor validation.
* Improved signed catalog checks, cached fallback behavior, repair flows, and catalog health details.
* Added `window.__odd.sdk` for extension authors and updated `window.__odd.api.version` to 2.4.0.
* Kept diagnostics local-only with no telemetry, analytics, license checks, or remote error reporting.

= 1.0.0 =

Welcome to ODD. The first public release brings living wallpapers, icon sets, cursor themes, desktop widgets, tiny apps, starter content, and the ODD Shop to WP Desktop Mode.

== Upgrade Notice ==

= 1.1.0 =

Native Desktop Mode integration, desktop app shortcuts, catalog security checks, the Shop UI, default desktop icons, and cursor effects are improved. Requires WP Desktop Mode v0.8.5 or newer.

= 1.0.0 =

Initial WordPress.org release. Requires WP Desktop Mode v0.8.5 or newer.
