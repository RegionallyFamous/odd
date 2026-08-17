# ODD Notes source

The maintainable application runtime lives in `src/`. It is compiled with
esbuild and joined to the vendored OpenStation UI component snapshot by:

```bash
npm run build:notes
```

The generated catalog asset is
`bundle-src/assets/js/odd-notes.min.js`. Do not edit that file directly.

`component-snapshot/openstation-ui-components.min.js` contains only the optional
OpenStation web components that ODD Notes must self-register when the host has
not loaded them. The application state, REST, journaling, and rendering logic
remains readable and testable under `src/`.

Refresh that snapshot only from a clean checkout of the exact supported
OpenStation release, then rebuild Notes:

```bash
npm run build:openstation-components -- .e2e/openstation-1.1.0
npm run build:notes
```
