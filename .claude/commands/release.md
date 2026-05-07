---
description: Bump ODD's version pins, commit, and push a release tag. CI builds the zip and cuts the GitHub release.
argument-hint: <version>  e.g. 1.0.1
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Cut an ODD release

Parse `$ARGUMENTS` as `<version>` (bare, no leading `v`). If missing, read
the current `Version:` from `odd/odd.php` and ask the user what the next
version should be before continuing.

The release zip and GitHub release are produced by
[.github/workflows/release-odd.yml](../../.github/workflows/release-odd.yml)
when a `v*` tag is pushed. This command's job is to bump the version
strings, commit, push `main`, and push the tag.

## 1. Verify preconditions

```bash
git status --porcelain          # warn if uncommitted changes; ask user
git rev-parse --abbrev-ref HEAD # must be main
git log --oneline -5            # sanity check last commits
```

If on a different branch, stop and ask.

## 2. Bump version pins

Use the helper — it updates `odd/odd.php` **and** both Playground blueprints’ ODD **`git:directory` ref** to `v<version>`. If you change `ODD_DESKTOP_MODE_MIN_VERSION` without a plugin bump, update the **Desktop Mode** `installPlugin` URL in **both** blueprints to `https://downloads.wordpress.org/plugin/desktop-mode.<version>.zip`; `odd/bin/validate-blueprint` checks it against `odd/odd.php`.

```bash
odd/bin/bump-version <version>
```

Then confirm they agree:

```bash
odd/bin/check-version --expect <version>
odd/bin/validate-blueprint
```

Commit whatever changed (`odd/odd.php`; both `blueprint.json` files when bump-version rewrote the tag):

```bash
git add odd/odd.php blueprint.json site/playground/blueprint.json
git commit -m "chore: bump version to v<version>"
```

## 3. Push main and the tag

```bash
git push origin main
git tag "v<version>"
git push origin "v<version>"
```

Pushing the tag triggers
[.github/workflows/release-odd.yml](../../.github/workflows/release-odd.yml),
which:

1. Asserts the tag matches `odd/odd.php`'s committed version.
2. Runs `python3 _tools/build-catalog.py && ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog`.
3. Runs `odd/bin/build-zip` to produce `dist/odd.zip`.
4. Calls `gh release create "v<version>" dist/odd.zip --latest=true --generate-notes`
   (auto-generates release notes from commits since the previous tag).
5. Verifies `releases/latest/download/odd.zip` resolves via curl.

## 4. Watch the release

```bash
gh run watch
```

Or browse to the Actions tab in the repo.

## 5. Report back

Give the user:

- The release URL: `https://github.com/RegionallyFamous/odd/releases/tag/v<version>`
- The Playground demo URL (hosted blueprint; pins Desktop Mode + semver ODD tag): `https://playground.wordpress.net/?blueprint-url=https://odd.regionallyfamous.com/playground/blueprint.json`. Raw GitHub mirror: `https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/RegionallyFamous/odd/main/blueprint.json`.
- A one-line summary of what shipped

If the auto-generated release notes need editing, open the release in
GitHub and revise the body after it's been published. The zip is already
attached.
