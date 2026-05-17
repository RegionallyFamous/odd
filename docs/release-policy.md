# ODD Release Policy

This document describes when to bump which version number and how to
cut a release. Read alongside [`api-versioning.md`](api-versioning.md) —
they track different numbers on different cadences.

## Two version numbers

| Number | Source of truth | Bumped when |
|--------|-----------------|-------------|
| `ODDOUT_VERSION` (plugin) | `odd/odd.php` header + constant (kept in sync by `odd/bin/check-version`) | Any plugin release — bug fix, runtime feature, API change, or other shipped zip change. |
| `window.__odd.api.version` (extension surface) | `API_VERSION` constant in `odd/src/shared/api.js` | Only when the surface described in [api-versioning.md](api-versioning.md) changes. |

Since the 1.0 baseline, shipping new scenes / icon sets / cursor sets / widgets / apps doesn't
touch either number — content lives in the remote catalog and
updates on the next `pages.yml` deploy (see
[ADR 0005](adr/0005-remote-catalog-empty-plugin.md)). A plugin
release that adds a new `window.__odd.api` method bumps both — plugin
minor (new feature) and API minor (new surface).

## Content-only store updates

Use the Pages/catalog path when the change is limited to catalog content:
new or updated bundles, widget card art, icon/cursor previews, metadata,
starter-pack slugs, or other registry fields that older plugin versions
already understand. Do **not** bump `ODDOUT_VERSION`, add a plugin
`CHANGELOG.md` entry, or tag a GitHub plugin release for these changes.
Merge to `main`; `.github/workflows/pages.yml` rebuilds and validates
`site/catalog/v1/`, then publishes it to GitHub Pages.

Installed sites read the remote registry through the Shop's catalog
fetch. They may see the update after the 12-hour transient expires, or
immediately after an admin uses **Refresh catalog**. The Shop and a twice-daily
WP-Cron task also run a lightweight signed-registry hash check; when that sees
new remote content, admins get a **Refresh catalog** prompt. The bundled
`odd/data/fallback-registry.json` is only a last-resort offline snapshot
inside future plugin zips; updating it in the repo does not change the
fallback embedded in already-installed plugin copies.

Use a plugin release instead when the change requires plugin runtime
code, panel layout/CSS/JS behavior, REST contract changes, a new catalog
schema requirement, or a change older plugins cannot safely ignore.

The catalog route is intentionally strict: remote registries must be HTTPS,
small enough for the response cap, free of duplicate slugs, and complete
with valid sha256 hashes plus bundle/icon/card URLs under the configured
catalog base. Site owners can filter those URL rules for private mirrors,
but first-party ODD catalog updates should ship through `site/catalog/v1/`
and never require plugin releases by themselves.

First-party catalog deploys are signed. `pages.yml` builds
`site/catalog/v1/registry.json`, writes the detached Ed25519
`registry.json.sig` using `ODD_CATALOG_SIGNING_KEY`, validates it with
`ODD_VALIDATE_REQUIRE_CATALOG_SIGNATURE=1`, and smoke-tests the
published registry/signature pair against the bundled public key. A
missing or mismatched signature keeps installed sites on their transient,
last-known-good mirror, or bundled full-registry fallback.

## Catalog Trust Model

ODD treats the configured catalog signing key as part of the trusted
computing base. Signature checks prove the first-party registry came
from the release pipeline, SHA256 checks prove the downloaded `.wp`
bytes match that registry row, and install-time validation proves the
archive shape is safe. Scenes, widgets, and apps are still trusted code
after installation, not hostile-code isolation.

The app iframe sandbox and CSP are defense in depth. Apps run in a
sandboxed iframe and app files are served through authenticated PHP
routes, but `allow-scripts` plus `allow-same-origin` is intentionally
enabled so first-party apps can load same-origin assets and call ODD/WP
REST endpoints with the user session. Do not describe apps as hostile
code isolation; describe them as first-party, capability-gated code.

Filters that weaken catalog safety — custom catalog URLs, download URL
rewrites, insecure download/catalog allowances, SHA requirement changes,
or lower app capability allowlists — are enterprise escape hatches. They
should be owned by the site operator, documented in that deployment, and
kept off by default.

## Plugin SemVer rules

- **Patch** (`x.y.z` -> `x.y.(z+1)`): bug fixes, internal refactors, docs. No runtime behavior changes that downstream can observe.
- **Minor** (`x.y.z` -> `x.(y+1).0`): new panel features, new plugin-level features, new `window.__odd.api` methods (also bumps `api.version` minor). **Not** triggered by new scenes / icon sets / cursor sets / widgets / apps — those land in the remote catalog without a plugin release.
- **Major** (`x.y.z` -> `(x+1).0.0`): removes or renames anything downstream can observe — REST endpoint shape, `window.__odd.api` method, content-on-disk layout, catalog `registry.json` schema. Usually accompanied by a major bump in `api.version`.

Prereleases follow `1.10.0-rc.1`, `1.10.0-rc.2`, etc. They're tagged and attached to a GitHub release marked **pre-release** but `latest=false`.

## Cutting a release

Start with `odd/bin/bump-version`, then make the release-note edits by hand:

```sh
next_version=<next-version>
odd/bin/bump-version "$next_version"
# edits odd/odd.php header + ODDOUT_VERSION constant
odd/bin/check-version --expect "$next_version"
odd/bin/check-plugin-metadata
# add/update the CHANGELOG.md release section and any readme metadata needed
git diff
# review, then:
git commit -m "release: $next_version"
git tag "v$next_version"
git push origin main "v$next_version"
```

The `.github/workflows/release-odd.yml` workflow fires on the tag: runs the reusable CI quality gates, checks plugin metadata, builds + validates the remote catalog (`python3 _tools/build-catalog.py && ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog`), validates the Playground blueprint, regenerates `odd/languages/odd-outlandish-desktop-decorator.pot`, runs `odd/bin/build-zip`, validates zip contents, runs Plugin Check, runs install-smoke, and `gh release create --latest=true` with a post-upload HTTP probe.

The `.github/workflows/pages.yml` workflow runs independently on any push to `main` that touches `site/`, `_tools/catalog-sources/`, or `_tools/build-catalog.py` — it rebuilds the catalog, validates it, and publishes `site/` (marketing + catalog) to GitHub Pages. Content releases (a new scene / icon set / widget / app) ship through Pages, not through the plugin release flow.

Keep the public stable Playground blueprint on the newest WordPress.org zip
that actually exists. During release prep, `odd.php`, `odd/readme.txt`,
`CHANGELOG.md`, package metadata, and the local release zip can move to the
next version while `blueprint.json` and `site/playground/blueprint.json` still
pin the previous public release. Update those public demo pins only after the
matching `downloads.wordpress.org` zip returns 200.

## CHANGELOG

We maintain `CHANGELOG.md` in the keep-a-changelog format. Each release entry calls out:

- Breaking changes at the top.
- `api.version` bumps (if any) and which methods/events/routes moved.
- Bug fixes and validation/hardening changes.

Content releases (new scenes / icon sets / widgets / apps) don't land in the plugin `CHANGELOG.md`. They're noted in the catalog's own commit log and surface in the Shop's "New" shelf automatically.

Keep the change-log user-readable. Don't list every "fix typo" commit — summarise.

## Hotfixes

For a security or correctness bug that blocks production:

1. Branch from the most recent release tag (not `main`).
2. Apply the fix + a regression test.
3. Tag as a patch (`v1.10.1`).
4. Cherry-pick to `main` in a follow-up PR.

If `main` has already moved on with incompatible changes, the hotfix branch may need to lag behind — that's fine, the point is to get a release out that unblocks users.

## When in doubt

- Err on the side of a bigger bump. Nobody's ever regretted a too-cautious SemVer. They regret the reverse.
- If the release touches both content and API, call out the API change in the changelog headline, even if it's small.
- If you're not sure whether a PR is breaking, open the [api-versioning](api-versioning.md) document, scan the surface list, and ask the reviewer.
