# Build for Desktop Mode Example Pack

This folder is the smallest useful example of building on ODD without
fighting Desktop Mode. It contains two installable `.wp` bundle sources:

- `widget/` registers a movable Desktop Mode widget.
- `app/` registers a sandboxed desktop app window.

Both examples use public host contracts:

- `wp.desktop.ready()` waits for Desktop Mode.
- `wp.desktop.registerWidget()` registers widget behavior.
- `window.__odd.sdk` reads local ODD health and preferences.
- Every mount returns teardown work or keeps its DOM scoped to the bundle.

## Build the bundles

From this directory:

```sh
cd widget
zip -r ../build-for-desktop-mode-widget.wp manifest.json widget.js

cd ../app
zip -r ../build-for-desktop-mode-app.wp manifest.json index.html app.js icon.svg
```

Then open ODD Shop, go to **Install**, and drop the generated `.wp` file.

The examples are deliberately plain. They are here to show the native
extension contract, not to compete with first-party catalog art.
