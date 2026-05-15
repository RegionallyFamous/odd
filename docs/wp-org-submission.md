# WordPress.org plugin directory publishing

This doc records the current WordPress.org status for ODD and the manual publishing workflow for https://wordpress.org/plugins/odd-outlandish-desktop-decorator/.

## Status

- [x] Slug chosen: `odd-outlandish-desktop-decorator`
- [x] `readme.txt` written per plugin directory conventions ([`odd/readme.txt`](../odd/readme.txt))
- [x] Plugin header fields are complete and match the readme (verified by `odd/bin/check-version` and `odd/bin/check-plugin-metadata`)
- [x] Text domain declared and wired to `load_plugin_textdomain` + `wp_set_script_translations`
- [x] `languages/odd-outlandish-desktop-decorator.pot` regenerated at release time
- [x] Zero runtime dependencies shipped in the zip. Scenes load Pixi via CDN at runtime; installed bundles carry their own assets (see [ADR 0005](adr/0005-remote-catalog-empty-plugin.md)).
- [x] Licensing of every first-party catalog asset recorded in [`LICENSES.md`](../LICENSES.md), all CC0-1.0 or GPL-compatible
- [x] No server-side telemetry ([ADR 0004](adr/0004-zero-server-side-telemetry.md))
- [x] Remote catalog is a single HTTPS JSON fetch to a static GitHub Pages URL, configurable via `ODDOUT_CATALOG_URL` for enterprise mirrors ([ADR 0005](adr/0005-remote-catalog-empty-plugin.md))
- [x] Submitted to the plugin directory for review (manual step, done via https://wordpress.org/plugins/developers/add/)
- [x] Accepted on WordPress.org: https://wordpress.org/plugins/odd-outlandish-desktop-decorator/
- [ ] SVN trunk seeded for the 1.0.0 public baseline (manual, see below)
- [ ] Screenshots captured and uploaded to `assets/` in SVN (3 screenshots listed in readme.txt)
- [x] Banner and icon assets generated in [`wporg-assets/`](../wporg-assets/)

## Directory asset checklist

Directory assets live in `/assets/` on the SVN side (sibling of `/trunk/`, `/tags/`, `/branches/`), not inside the plugin zip. WordPress.org uses exact filenames and implied dimensions; oversized, undersized, or renamed variants do not display. See the official [Plugin Assets handbook page](https://developer.wordpress.org/plugins/wordpress-org/plugin-assets/).

| File                  | Size             | What it shows                                          |
|-----------------------|------------------|--------------------------------------------------------|
| `banner-1544x500.png` | 1544x500         | High-DPI directory header banner                        |
| `banner-772x250.png`  | 772x250          | Standard directory header banner                        |
| `icon-256x256.gif`    | 256x256          | High-DPI animated directory icon                        |
| `icon-128x128.gif`    | 128x128          | Standard animated directory icon                        |
| `screenshot-1.png`    | 1280x720 target  | Desktop with themed wallpaper, icons, cursors, widgets  |
| `screenshot-2.png`    | 1280x720 target  | Wallpaper department with preview/apply controls        |
| `screenshot-3.png`    | 1280x720 target  | Icon Sets department with catalog cards                 |

Generated banner and animated icon files are kept in [`wporg-assets/`](../wporg-assets/). WordPress.org documents GIF as a valid extension for `icon-128x128` and `icon-256x256`; do not upload `icon.svg` with the animated icon set because SVG can take precedence over raster icons in WordPress icon selection paths. Screenshots should be captured from the live demo (`https://playground.wordpress.net/?blueprint-url=` + URL-encoded `https://raw.githubusercontent.com/RegionallyFamous/odd/main/blueprint.json?oddbp=wporg-latest`) at 1x zoom, cropped to the desktop surface, and saved as lowercase PNG files that match the `readme.txt` screenshot captions. WordPress.org permits PNG or JPG screenshots, but local PNG keeps the desktop UI crisp.

## SVN workflow

Use the local `wporg-plugin-release` Codex skill for day-to-day publishing. It stages `trunk/` and `tags/<version>/` from the validated release zip so nobody has to hand-copy files into SVN:

```sh
python3 /Users/nick/.codex/skills/wporg-plugin-release/scripts/publish_wporg.py \
  --repo-root /Users/nick/.codex/worktrees/dcf7/odd \
  --plugin-dir odd \
  --slug odd-outlandish-desktop-decorator \
  --svn-url https://plugins.svn.wordpress.org/odd-outlandish-desktop-decorator \
  --version 1.0.0 \
  --svn-dir /Users/nick/wporg-svn/odd-outlandish-desktop-decorator \
  --zip dist/odd.zip \
  --skip-build
```

After reviewing `svn status`, publish by rerunning with `--commit` and `--username nickhamze`. Do not paste the SVN password into chat; authenticate through the local SVN prompt or the local SVN credential cache.

The manual equivalent, kept here as a reference:

```sh
# Check out the SVN repo the directory publishes.
svn co https://plugins.svn.wordpress.org/odd-outlandish-desktop-decorator ~/plugins-svn/odd-outlandish-desktop-decorator

# Stage the trunk.
cd ~/plugins-svn/odd-outlandish-desktop-decorator
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='vendor' \
  --exclude='packages' \
  --exclude='examples' \
  --exclude='e2e' \
  --exclude='playwright*' \
  --exclude='.github' \
  --exclude='_tools' \
  --exclude='docs' \
  --exclude='ci' \
  /path/to/odd-repo/odd/ trunk/

# Copy readme.txt up to the expected location (WordPress.org reads it
# from trunk/readme.txt, which rsync from odd/ already puts there).

# Screenshots + banners live in assets/, not trunk/.
cp /path/to/screenshots/*.png assets/

# Version-tag this release.
svn cp trunk tags/1.0.0

# Review the diff, then commit.
svn status
svn add --force .
svn ci -m "Release 1.0.0"
```

We intentionally do not use a GitHub Action for SVN publishing. The release should be staged and reviewed locally with Codex, then committed to WordPress.org SVN only when explicitly requested.

## Plugin review feedback

Common feedback from the WP.org plugin review team + how ODD answers it:

- **"Don't bundle frameworks you load from CDN."** We don't bundle Pixi; scenes load it via `wp_enqueue_script` against jsdelivr, and the plugin zip stays under the 2 MB `zip-budget` cap because user-facing content installs from the remote catalog.
- **"Escape everything."** See PHPCS-enforced WordPress-Extra ruleset in `phpcs.xml`; the `phpcs` CI job blocks unescaped output.
- **"Call `load_plugin_textdomain` on `init` and pass the `languages/` folder."** See `odd/odd.php`.
- **"No opaque remote calls."** ODD makes exactly one kind of remote call: `wp_remote_get( ODDOUT_CATALOG_URL )` to load the content catalog (a static JSON file at `odd.regionallyfamous.com/catalog/v1/registry.json`), and subsequent `download_url()` calls for bundles the user chooses to install from the Shop. Every URL, the transient cache window, and an opt-out (`define( 'ODDOUT_CATALOG_URL', false )` or filter) are documented in `odd/readme.txt`.

## After approval

- Ship each subsequent release by staging the validated zip into SVN `trunk/`, copying `trunk/` -> `tags/<version>/`, and committing. Keep the GitHub release/tag and WordPress.org SVN tag aligned.
- Keep the changelog in `odd/readme.txt` short — point at `CHANGELOG.md` on GitHub for the long-form history.
