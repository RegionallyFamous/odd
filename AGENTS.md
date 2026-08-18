# ODD feature team

These instructions apply to the entire repository.

## Product boundaries

- ODD is an Apps-only catalog and installer for OpenStation. Prefer a catalog app under `_tools/catalog-sources/apps/<slug>/` over plugin runtime changes.
- Use public WordPress and OpenStation APIs. Do not patch host DOM, replace native window/rail behavior, read private host storage, or add compatibility shims without evidence that a public contract cannot solve the problem.
- Preserve every unrelated worktree change. Start with `git status --short --branch`, identify generated files, and never revert or overwrite work you do not own.
- Do not commit, push, publish the catalog, deploy, tag, bump the plugin version, or create a release unless the user explicitly asks.

## Custom agent workflow

For non-trivial features, cross-layer bugs, or changes with meaningful WordPress data, security, or UI behavior, the coordinating agent should use the project-scoped custom team:

1. `odd_feature_architect` reads the system and returns a feature contract. It never edits.
2. `odd_feature_builder` receives that contract and is the sole source-code writer for the feature.
3. After implementation, `odd_quality_reviewer` reviews the completed diff. For visible app behavior, `odd_experience_tester` independently tests the packaged bundle and captures evidence.
4. Route concrete findings back to the same builder, then rerun only the affected review and validation lanes.

Do not run multiple source-writing agents on overlapping files. Read-heavy architecture and research can be parallelized when independent; review begins only after the builder's writes are complete. Scale the workflow down for tiny copy or documentation-only edits, but always retain an independent diff check before declaring completion.

The feature contract must establish the user outcome, current execution path, catalog-versus-runtime decision, data/API and permission boundaries, owned files, acceptance criteria, validation commands, and material unknowns. Use [the feature brief](docs/feature-team.md) as the shared handoff format.

## Definition of done

Every implementation handoff must state what changed, what was tested, actual results, and remaining risks. A command that was not run must be reported as not run.

For a catalog app change, the normal gate is:

```sh
npm run verify:app -- <slug>
```

That gate checks JavaScript syntax, validates the source manifest, builds and validates the catalog in an isolated temporary directory, confirms the checked-in generated catalog matches that clean rebuild, smoke-tests the isolated packaged app at desktop and mobile sizes, saves screenshots under `test-results/`, and checks tracked plus owned untracked files for whitespace errors. It does not overwrite generated work. The experience tester must still inspect the screenshots.

For plugin/runtime changes, also run the smallest relevant slice of `npm test`, `composer phpcs`, `composer phpunit`, PHP syntax checks, and Playwright/E2E coverage. Report missing dependencies honestly instead of claiming a skipped check passed.
