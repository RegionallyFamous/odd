# ODD repository contract

ODD is Apps for OpenStation. It ships one WordPress plugin, one signed static
app catalog, and two first-party apps: ODD Notes and ODD Workbench.

## Non-negotiable boundaries

- OpenStation 1.1.0+ only: PHP APIs use `openstation_*`; browser APIs use
  `wp.os`; native window renderers use `window.openStationNativeWindows`.
- The WordPress.org dependency slug remains `desktop-mode`. That slug is not a
  compatibility API and must not be renamed in plugin headers or download URLs.
- ODD supports only manifests with `type: "app"`.
- Apps do not register service workers, load CDN dependencies, execute server
  code, or extend hidden ODD registries.
- App installation updates OpenStation placement in memory and calls
  `wp.os.refreshMenu()` so launchers appear without a page reload.
- A failed `wp.os.openWindow()` is refreshed and retried once, then reported to
  the user. Do not ignore a false return value.
- Playground URLs must retain the active `/scope:<id>/` prefix.
- Never publish the plugin, catalog, or Pages site without an explicit request.

## Source of truth

- `odd/`: shipped plugin source; `odd/bin/build-zip` is an explicit allowlist.
- `_tools/catalog-sources/apps/{odd-notes,workbench}`: the only catalog apps.
- `_tools/build-catalog.py`: deterministic catalog builder.
- `site/catalog/v1/`: generated catalog output.
- `odd/data/fallback-registry.json`: byte-identical registry fallback.
- `tests/app-only/`: the active JS and WordPress test suites.

Run the commands in `CONTRIBUTING.md` before handoff. The ZIP content checker
is the final guard against unsupported APIs or files entering a release.
