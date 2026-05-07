<p align="center">
  <a href="https://odd.regionallyfamous.com/">
    <img src="https://odd.regionallyfamous.com/og.png" alt="ODD — the Luxe + Weird shop for WP Desktop Mode" width="840">
  </a>
</p>

<h1 align="center">ODD — Outlandish Desktop Decorator</h1>

<p align="center">
  <strong>The Luxe + Weird desktop shop for WP Desktop Mode.</strong><br>
  Living wallpapers, icon costumes, pointer themes, draggable widgets, and tiny apps for the WordPress admin desktop.
</p>

<p align="center">
  <a href="https://playground.wordpress.net/?blueprint-url=https%3A%2F%2Fodd.regionallyfamous.com%2Fplayground%2Fblueprint.json%3Foddbp%3Dv2-desktop-zip"><strong>Launch the live demo</strong></a>
  ·
  <a href="https://github.com/RegionallyFamous/odd/releases/latest"><strong>Download ODD</strong></a>
  ·
  <a href="https://odd.regionallyfamous.com/"><strong>Marketing site</strong></a>
  ·
  <a href="https://github.com/RegionallyFamous/odd/wiki"><strong>Docs</strong></a>
</p>

<p align="center">
  <a href="https://github.com/RegionallyFamous/odd/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/RegionallyFamous/odd?style=for-the-badge&label=release"></a>
  <a href="https://github.com/RegionallyFamous/odd/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/RegionallyFamous/odd/ci.yml?branch=main&style=for-the-badge&label=ci"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/RegionallyFamous/odd?style=for-the-badge"></a>
</p>

---

[WP Desktop Mode](https://github.com/WordPress/desktop-mode) makes WordPress feel like a desktop. ODD gives that desktop a polished, updateable shop for visual themes and small tools.

The hosted [Playground blueprint](https://odd.regionallyfamous.com/playground/blueprint.json?oddbp=v2-desktop-zip) pins **[WP Desktop Mode](https://wordpress.org/plugins/desktop-mode/)** to **0.7.2** via the official release zip URL (`resource: "url"` → `downloads.wordpress.org/.../desktop-mode.0.7.2.zip`, matching `ODD_DESKTOP_MODE_MIN_VERSION`) and **[ODD](https://github.com/RegionallyFamous/odd)** to the **semver git tag** for `ODD_VERSION` in `odd/odd.php` (today **v1.0.2**). Raw GitHub copy: [`blueprint.json`](https://raw.githubusercontent.com/RegionallyFamous/odd/main/blueprint.json) (add `?oddbp=v2-desktop-zip` if Playground still loads a cached older file). **Production installs:** **`odd.zip`** on [Releases](https://github.com/RegionallyFamous/odd/releases/latest).

---

## What You Get

| Surface | What It Adds |
| --- | --- |
| **Wallpapers** | Generative PixiJS scenes over painted backdrops, with live preview and shuffle. |
| **Icon Sets** | Full dock and desktop shortcut re-skins, including first-party recycle bin coverage. |
| **Cursor Sets** | Pointer themes that reach Desktop Mode windows, chrome, widgets, and same-origin app frames. |
| **Widgets** | Small desktop tiles like notes, prompts, and embeds, installed from catalog bundles. |
| **Apps** | Sandboxed HTML/CSS/JS tools that open in native Desktop Mode windows with optional launchers. |

## Why It Feels Different

| ODD Shop | Remote Catalog | Safe Installation |
| --- | --- | --- |
| Mac App Store-style browsing with editorial shelves, department glyphs, global search, preview bars, and responsive chrome. | New wallpapers, card art, widgets, apps, icon sets, and cursor sets publish without forcing every site to update the plugin. | `.wp` bundles are validated, catalog downloads are SHA256-checked, and app files are served behind authenticated paths. |

Wallpapers, icon sets, and cursor sets preview instantly. Try a scene, theme, or cursor set, then keep it or roll back from the preview bar. Catalog cards update in place after install, so the thing you install is the thing you use.

---

## Install

### One-click demo

[**Launch ODD in WordPress Playground →**](https://playground.wordpress.net/?blueprint-url=https%3A%2F%2Fodd.regionallyfamous.com%2Fplayground%2Fblueprint.json%3Foddbp%3Dv2-desktop-zip)

First load takes ~20–30 seconds while Playground boots the site and installs the plugin. Throwaway — close the tab and it's gone.

### A real WordPress install

1. Install and activate [WP Desktop Mode](https://github.com/WordPress/desktop-mode) **v0.7.2** or newer (install from [WordPress.org](https://wordpress.org/plugins/desktop-mode/) for the compiled shell).
2. Download the latest `odd.zip` from the [Releases](https://github.com/RegionallyFamous/odd/releases/latest) page.
3. WP Admin → Plugins → Add New → Upload Plugin → pick the zip → Activate.
4. Double-click the **ODD** desktop icon, use the taskbar icon, or run `/odd-panel` from the command palette to open the Shop.

**Requires:** WordPress 6.0+ · PHP 7.4+ · WP Desktop Mode v0.7.2+

---

## Build Your Own

Anyone can ship a scene, icon set, cursor set, widget, or app as a single `.wp` file. ODD validates the archive, checks catalog downloads against SHA256, and keeps app files behind authenticated serve paths. First-party content lives under `_tools/catalog-sources/` and publishes to the remote catalog through GitHub Pages; plugin releases are only for runtime/API changes.

| Guide | Use It For |
| --- | --- |
| [Building an App](docs/building-an-app.md) | Package a sandboxed mini-app with optional desktop/taskbar launchers. |
| [Building a Scene](docs/building-a-scene.md) | Create a PixiJS wallpaper scene with preview and wallpaper art. |
| [Building an Icon Set](docs/building-an-icon-set.md) | Ship a themed SVG pack for Desktop Mode chrome. |
| [Building a Cursor Set](docs/building-a-cursor-set.md) | Add custom pointer roles and cursor assets. |
| [Building a Widget](docs/building-a-widget.md) | Register a small draggable desktop widget. |
| [`.wp` Manifest Reference](docs/wp-manifest.md) | Validate bundle metadata and file contracts. |

## Project Map

- `odd/` — the plugin itself (what ships in `odd.zip`). The 1.0 runtime is intentionally lightweight; catalog content installs on demand.
- `_tools/catalog-sources/` — source of truth for every bundle (scene / icon set / cursor set / widget / app). Rebuilt into `site/catalog/v1/` by `_tools/build-catalog.py`.
- `site/` — the [odd.regionallyfamous.com](https://odd.regionallyfamous.com) marketing site **and the remote catalog** (`site/catalog/v1/registry.json` + `bundles/` + `icons/`), deployed to GitHub Pages.
- `docs/` — authoring guides and reference docs.
- `ci/smoke/` — MU-plugin fixtures used by `install-smoke.yml` to test the starter-pack installer hermetically.
- `bin/` → see `odd/bin/` — `validate-catalog`, `validate-blueprint`, `check-version`, `build-zip`, `make-pot`.

## Useful Links

- [ODD Shop State Machine](docs/store-state-machine.md)
- [Release Runbook](docs/release-runbook.md)
- [Building on ODD](docs/building-on-odd.md)
- [Project wiki](https://github.com/RegionallyFamous/odd/wiki)

## License

GPLv2 or later, matching [WP Desktop Mode](https://github.com/WordPress/desktop-mode). See [LICENSE](./LICENSE).
