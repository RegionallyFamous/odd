# App manifest

Every `.wp` archive contains `manifest.json` at its root and declares
`"type": "app"`. The canonical machine-readable schema is
[`schemas/manifest.schema.json`](schemas/manifest.schema.json).

Required fields:

```json
{
  "type": "app",
  "slug": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "entry": "index.html",
  "icon": "icon.svg"
}
```

Optional fields are `$schema`, `author`, `description`, `capability`, `native`,
`window`, `desktopIcon`, and `surfaces`. Unknown fields are rejected.

- `entry` and `icon` are safe relative paths to files in the archive.
- `icon` is SVG, PNG, or WebP.
- `capability` defaults to `manage_options`; only explicitly trusted first-party
  apps may lower it.
- `native.script` and optional `native.style` load an OpenStation native app.
- `window` accepts bounded width/height/minimums, a title, and `resizable`.
- `desktopIcon.position` is an integer from 0 through 10000.
- `surfaces.desktop` and `surfaces.taskbar` are booleans.

Apps may not declare registry extensions, service workers, server-executable
files, unsafe paths, unresolved package imports, or missing/non-local entry
assets.
