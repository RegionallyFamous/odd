# WordPress.org Directory Assets

These files are staged for the top-level `assets/` directory in the WordPress.org SVN repository for `odd-outlandish-desktop-decorator`. They are not part of the plugin zip.

## Files

| File | Size | Purpose |
| --- | ---: | --- |
| `banner-772x250.png` | 772x250 | Standard plugin page banner |
| `banner-1544x500.png` | 1544x500 | High-DPI plugin page banner |
| `icon-128x128.gif` | 128x128 | Standard animated directory icon |
| `icon-256x256.gif` | 256x256 | High-DPI animated directory icon |
| `screenshot-1.jpg` | 1280x720 | ODD Shop's focused Apps section and ODD Notes install card |
| `screenshot-2.jpg` | 1280x720 | ODD Notes library, organization tools, and editor |
| `screenshot-3.jpg` | 1280x720 | ODD Notes WordPress revision history and restore action |

Do not upload `source/static-icon/icon.svg` if the animated GIF should be the visible directory icon. WordPress and WordPress.org clients can prefer SVG icons when they exist, which would hide the animated GIF.

WordPress.org currently documents `icon-128x128.(png|jpg|gif)` and `icon-256x256.(png|jpg|gif)` as valid plugin icon filenames, so these GIFs use the official icon slots. Keep the animation subtle; there has been long-running Meta discussion about discouraging animated icons and banners for accessibility.

## Source Prompt

The current banner source was generated with:

> Wide horizontal WordPress.org plugin banner background for ODD — Apps for OpenStation, matching a playful square app icon with a white eyeball mascot on a magenta violet cyan gradient. Flat premium vector-meets-soft-3D style, clean abstract app windows, translucent floating window outlines, rounded squares, tiny star charms, subtle grain, vibrant pink purple teal gradient, polished but weird, fun OpenStation app energy. Leave open negative space in the center-right for real text added later. No text, no letters, no numbers, no logos, no WordPress mark, no readable UI.

The final uploaded banners intentionally keep the image text-free. WordPress.org already renders the plugin name outside the header image, and removing text keeps the asset cleaner at both `1544x500` and `772x250`.
