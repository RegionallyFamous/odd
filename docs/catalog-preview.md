# Catalog Preview Workflow

Use this workflow when you want to test first-party catalog content
without publishing it to the live catalog at
`https://odd.regionallyfamous.com/catalog/v1/`. It exercises the same
builder and validator as production, but writes to preview-only output
and uses a non-production HTTPS base URL.

## Local preview build

```sh
npm run catalog:preview
```

This writes:

```text
.odd/catalog-preview/v1/
├── registry.json
├── registry.schema.json
├── bundles/
├── cards/
└── icons/
```

The preview registry uses:

```text
https://odd-catalog-preview.invalid/catalog/v1/
```

That host is intentionally not the public catalog. The files are not
under `site/`, are ignored by Git, and cannot be deployed by the Pages
workflow.

## Preview-only rows

By default, sources under `_tools/catalog-sources/` are treated as
stable catalog rows. To make a row appear only in preview builds, add
one of these fields to the source `meta.json` or `manifest.json`:

```json
{
  "catalog_channel": "preview"
}
```

or:

```json
{
  "catalog": {
    "channel": "preview"
  }
}
```

Production builds include only stable rows. Preview builds include
stable plus preview rows and mark preview-only registry rows with
`"channel": "preview"` for diagnostics.

## Hosted preview Playground

GitHub Pages also builds a hosted preview catalog at:

```text
https://odd.regionallyfamous.com/catalog-preview/v1/
```

Open [`/go/preview/`](https://odd.regionallyfamous.com/go/preview/) to
launch WordPress Playground with ODD `main`, pinned Desktop Mode, and a
small must-use plugin that points ODD at that preview catalog. This lets
you test Shop install flows against the same static host as production
without changing the live `/catalog/v1/` feed.

To build that hosted shape locally:

```sh
odd/bin/build-catalog-preview --hosted
```

The output goes to ignored `site/catalog-preview/v1/`. It is generated
by Pages during deploy and should not be committed.

## What gets validated

`odd/bin/build-catalog-preview` runs the production catalog builder with
preview-safe output settings, then runs:

```sh
ODD_VALIDATE_REBUILD=1 ODD_VALIDATE_FALLBACK_REGISTRY=0 odd/bin/validate-catalog
```

That means preview catalogs still prove:

- `registry.json` parses and matches the schema.
- Every row has valid type, slug, semver, size, SHA256, card, icon, and
  download URL fields.
- Every `.wp` archive opens and its manifest type, slug, and version
  match the registry row.
- Starter-pack references resolve.
- Card images decode at the expected dimensions.
- The preview build is deterministic.

The only production check intentionally skipped is the bundled fallback
registry comparison, because preview builds must not update
`odd/data/fallback-registry.json`.

## CI preview artifact

The `catalog-preview` workflow runs on catalog PRs and on manual
dispatch. It builds the same non-published local preview catalog,
validates it, and uploads an `odd-catalog-preview` artifact for seven
days.

This is for review and QA only. The workflow does not deploy GitHub
Pages and does not create a plugin release.

## Manual Shop testing

For a local WordPress test site, copy the preview output into a fixture
folder and use the smoke MU-plugin:

```php
define( 'ODD_SMOKE_FIXTURE_ROOT', '/absolute/path/to/odd/.odd/catalog-preview/v1' );
define( 'ODD_SMOKE_CATALOG_URL', 'https://odd-catalog-preview.invalid/catalog/v1/registry.json' );
```

Then install `ci/smoke/odd-smoke-fixture.php` as a must-use plugin in
that site. It intercepts ODD catalog HTTP requests and serves the
preview registry and bundles from disk, so the Shop exercises the real
catalog install path without touching the live catalog.

## Promotion

Previewing does not promote anything. To publish catalog content:

1. Commit the source changes under `_tools/catalog-sources/`.
2. Run the preview Playground or the local smoke fixture against the
   candidate.
3. Commit the normal generated production artifacts under
   `site/catalog/v1/` and `odd/data/fallback-registry.json`.
4. Merge/push to `main`.
5. Let `pages.yml` rebuild, sign, validate, deploy, and smoke-test the
   live catalog.

That keeps draft testing, PR review, and public publishing as separate
steps.
