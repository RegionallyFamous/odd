# create-odd-bundle

Scaffold a new ODD `.wp` bundle in one command.

```sh
# interactive
npm create odd-bundle

# direct
npx create-odd-bundle scene my-new-scene
npx create-odd-bundle iconset my-new-iconset
npx create-odd-bundle widget my-new-widget
npx create-odd-bundle app my-new-app
```

The scaffold produces a directory ready to zip and upload through ODD Shop → Install → Upload. Slug validation matches the server-side installer (`^[a-z0-9-]+$`, 1–64 chars) so if the scaffold runs, the bundle you just generated is already a valid one.

Icon-set scaffolds include five raster `.webp` placeholder files for the visible desktop shortcuts ODD themes: ODD, My WordPress, Content Graph, Recycle Bin, and fallback. Replace them with your own `.png` or `.webp` icons before shipping.

## Non-interactive use

Pass both `type` and `slug` on the command line and pipe `/dev/null` for stdin:

```sh
node bin/cli.js scene my-scene < /dev/null
```

Name/author/description fall back to the slug / empty when stdin isn't a TTY, so CI scripts don't wedge on unclosed readline prompts.

## License

GPL-2.0-or-later.
