# App example

`example-app/` is the only supported ODD bundle example. It demonstrates the
root manifest, local HTML entry, and local monochrome SVG icon required by an
Apps-only `.wp` archive.

```sh
cd examples/example-app
zip -X -r ../example-app.wp manifest.json index.html icon.svg
odd/bin/validate-manifest manifest.json
```
