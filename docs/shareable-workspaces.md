# Shareable `.odd` Workspaces

`.odd` files are portable ODD workspace presets. They remember how a desktop is dressed without carrying executable code, zip archives, or media payloads.

Use them when you want to copy the same mood from one WordPress site to another: wallpaper, icon set, cursor set, enabled widgets, pinned ODD apps, and small preference switches.

## What Gets Saved

- Active wallpaper scene.
- Active icon set and cursor set.
- Enabled ODD widgets.
- Pinned ODD apps.
- Shuffle, screensaver, audio-reactive, and Shop taskbar preferences.
- Favorite and recent wallpaper slugs.

## What Does Not Get Saved

- Bundle source code.
- Images, SVGs, cursor files, widget scripts, or app files.
- Secrets, REST nonces, site URLs, user IDs, or cookies.
- Arbitrary JavaScript.

The file stores catalog slugs. When importing, ODD checks the local install first. If a referenced wallpaper, icon set, cursor set, widget, or app is missing, ODD can install it through the normal catalog route, which keeps the same HTTPS, SHA256, manifest, rate-limit, and capability checks used by every catalog install.

## Export A Workspace

1. Open the ODD Shop.
2. Go to **Install**.
3. Click **Export .odd**.

The exported file is JSON with this marker:

```json
{
  "format": "com.regionallyfamous.odd.workspace",
  "schema": 1
}
```

## Import A Workspace

1. Open the ODD Shop.
2. Go to **Install**.
3. Drop the `.odd` file into the install zone, or choose it with **Import file...**.

ODD applies safe preferences, installs any missing catalog items it can find, and enables remembered widgets through Desktop Mode's widget layer.

## `.odd` vs `.wp`

| Extension | Purpose | Contains Code? |
| --- | --- | --- |
| `.odd` | Share a workspace preset. | No. JSON preferences and slugs only. |
| `.wp` | Install a bundle: app, scene, icon set, cursor set, or widget. | Sometimes, depending on bundle type. Validated by the installer. |

Keep using `.wp` for authored content. Use `.odd` for sharing how a desktop is arranged.
