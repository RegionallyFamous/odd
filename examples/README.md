# ODD example bundles

Four tiny, publishable `.wp` bundles — one per supported type — kept in-tree as third-party-shaped fixtures. CI zips them and runs the universal installer against them in `install-smoke.yml`, which proves:

1. The bundle dispatcher accepts an archive it didn't author.
2. The JSON Schema at `docs/schemas/manifest.schema.json` matches the PHP validators in practice, not just in theory.
3. A contributor can learn what a valid bundle looks like by reading these files, not by reverse-engineering first-party catalog bundles.

If you're building an ODD bundle, copy the closest example to your working directory, rename the slug, and iterate. `odd/bin/validate-manifest path/to/manifest.json` will tell you when the shape drifts away from the schema.

| Directory                   | Type       | What it does                                                                 |
|-----------------------------|------------|------------------------------------------------------------------------------|
| `example-scene/`            | `scene`    | Slow rainbow radial gradient. ~40 lines. Shows the scene IIFE shape.         |
| `example-iconset/`          | `icon-set` | Core raster icons plus optional rail-action tiles, rendered as native-friendly images. |
| `example-widget/`           | `widget`   | Registers a `odd/example-hello` widget via `window.desktopModeWidgets`.|
| `example-app/`              | `app`      | Minimal "it's alive" HTML app that logs once to the console and renders text.|

The examples deliberately use zero external dependencies. They should still work a decade from now.

## Building the archives

```sh
# From the repo root.
for dir in examples/example-*; do
    (cd "$dir" && zip -r -q "../../dist/$(basename "$dir").wp" . -x '*.DS_Store')
done
```

The `.wp` files land in `dist/` which is gitignored; CI builds them on demand.

## License

Everything under `examples/` is `CC0-1.0` — use them as templates without attribution.
