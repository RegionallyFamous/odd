# WordPress.org plugin directory submission

This doc records the steps and the current state of ODD's submission to https://wordpress.org/plugins/.

## Status

- [x] Slug chosen: `odd` (requested on submit form)
- [x] `readme.txt` written per plugin directory conventions ([`odd/readme.txt`](../odd/readme.txt))
- [x] Plugin header fields are complete and match the readme (verified by `odd/bin/check-version` and `odd/bin/check-plugin-metadata`)
- [x] Text domain declared and wired to `load_plugin_textdomain` + `wp_set_script_translations`
- [x] `languages/odd-outlandish-desktop-decorator.pot` regenerated at release time
- [x] Zero runtime dependencies shipped in the zip. Scenes load Pixi via CDN at runtime; installed bundles carry their own assets (see [ADR 0005](adr/0005-remote-catalog-empty-plugin.md)).
- [x] Licensing of every first-party catalog asset recorded in [`LICENSES.md`](../LICENSES.md), all CC0-1.0 or GPL-compatible
- [x] No server-side telemetry ([ADR 0004](adr/0004-zero-server-side-telemetry.md))
- [x] Remote catalog is a single HTTPS JSON fetch to a static GitHub Pages URL, configurable via `ODDOUT_CATALOG_URL` for enterprise mirrors ([ADR 0005](adr/0005-remote-catalog-empty-plugin.md))
- [ ] Submitted to the plugin directory for review (manual step, done via https://wordpress.org/plugins/developers/add/)
- [ ] SVN trunk seeded once the submission is approved (manual, see below)
- [ ] Screenshots captured and uploaded to `assets/` in SVN (5 screenshots listed in readme.txt)

## Screenshot checklist

Screenshots live in `/assets/` on the SVN side (sibling of `/trunk/`, `/tags/`, `/branches/`), not inside the plugin zip. Required sizes:

| File                  | Size             | What it shows                                          |
|-----------------------|------------------|--------------------------------------------------------|
| `screenshot-1.png`    | 1280×720 (or 1544×500) | ODD Shop — Discover tile view                    |
| `screenshot-2.png`    | 1280×720         | ODD Shop — Wallpaper department with detail sheet       |
| `screenshot-3.png`    | 1280×720         | Aurora + Hologram icon combination on the live desktop  |
| `screenshot-4.png`    | 1280×720         | Origami + Fold icon combination on the live desktop     |
| `screenshot-5.png`    | 1280×720         | Rainfall scene avoiding desktop icons                   |
| `banner-1544x500.png` | 1544×500         | Directory header banner                                 |
| `banner-772x250.png`  | 772×250          | Low-DPI banner fallback                                 |
| `icon-256x256.png`    | 256×256          | Directory icon                                          |
| `icon-128x128.png`    | 128×128          | Directory icon (low-DPI)                                |

All screenshots are captured in the live demo (`https://playground.wordpress.net/?blueprint-url=` + URL-encoded `https://raw.githubusercontent.com/RegionallyFamous/odd/main/blueprint.json?oddbp=v2-1.0.6`) at 1× zoom, cropped to the desktop surface, saved as PNG through `cmd-shift-4` + OSX screenshot viewer "Export" (use PNG — the directory rejects JPEG).

## SVN workflow

Once the plugin submission is approved:

```sh
# Check out the SVN repo the directory publishes.
svn co https://plugins.svn.wordpress.org/odd ~/plugins-svn/odd

# Stage the trunk.
cd ~/plugins-svn/odd
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

Automating this would require a WP.org-specific workflow and secrets; we keep it manual until the plugin has enough release velocity to justify the setup.

## Plugin review feedback

Common feedback from the WP.org plugin review team + how ODD answers it:

- **"Don't bundle frameworks you load from CDN."** We don't bundle Pixi; scenes load it via `wp_enqueue_script` against jsdelivr, and the plugin zip stays under the 2 MB `zip-budget` cap because user-facing content installs from the remote catalog.
- **"Escape everything."** See PHPCS-enforced WordPress-Extra ruleset in `phpcs.xml`; the `phpcs` CI job blocks unescaped output.
- **"Call `load_plugin_textdomain` on `init` and pass the `languages/` folder."** See `odd/odd.php`.
- **"No opaque remote calls."** ODD makes exactly one kind of remote call: `wp_remote_get( ODDOUT_CATALOG_URL )` to load the content catalog (a static JSON file at `odd.regionallyfamous.com/catalog/v1/registry.json`), and subsequent `download_url()` calls for bundles the user chooses to install from the Shop. Every URL, the transient cache window, and an opt-out (`define( 'ODDOUT_CATALOG_URL', false )` or filter) are documented in `odd/readme.txt`.

## After approval

- Ship each subsequent release by copying `trunk/` → `tags/<version>/` and committing, then tag a GitHub release to keep both publishing channels in sync.
- Keep the changelog in `odd/readme.txt` short — point at `CHANGELOG.md` on GitHub for the long-form history.
