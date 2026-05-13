<!--
Thanks for the PR. Keep the checklist short and truthful; anything that
doesn't apply can be left unchecked with a note instead of force-checked.
-->

## Summary

<!-- Short, outcome-oriented description. "Why" first, "what" second. -->

## Checklist

- [ ] `python3 _tools/build-catalog.py && odd/bin/validate-catalog` pass locally.
- [ ] `npm test` passes locally.
- [ ] `composer phpcs` passes locally (run `composer phpcbf` to auto-fix).
- [ ] If PHP logic changed, `composer phpunit` passes locally.
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]` (unless this PR is purely internal — e.g. CI-only, test-only, or refactor).
- [ ] Screenshot, screencast, or Playground link attached for any user-visible change.
- [ ] Plugin version bumped in `odd/odd.php` (`Version:` header **and** `ODDOUT_VERSION` constant) if this PR ships in a release.

## Test plan

<!--
Concrete steps: what did you do to convince yourself this works? Include
the smallest repro, the URL you tested on, or the wp-cli command you ran.
-->
