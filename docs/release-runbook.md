# Release runbook

1. Verify current versions from authoritative sources: WordPress Core API,
   WordPress.org plugin API, and the upstream OpenStation GitHub release.
2. Test against a clean checkout of that OpenStation tag. Preserve any dirty
   developer checkout by using a detached worktree.
3. Run `npm ci`, `npm run build:notes`, and `npm test`.
4. Run `composer phpcs` and `composer phpunit`.
5. Run `python3 _tools/build-catalog.py` and `odd/bin/validate-catalog`; confirm
   generated catalog output has no unexplained diff.
6. Run `npm run verify:app -- <slug>` for every app changed by the release and
   independently inspect the desktop and mobile screenshots under
   `test-results/`.
7. Provision latest WordPress and run Playwright. Confirm, without reloading:
   install Notes, see its launcher, open it; install Workbench, see its launcher,
   open it in a bounded window; remove each app and see placement disappear.
8. Run `odd/bin/build-zip`, verify `dist/odd.zip.sha256`, and run
   `odd/bin/check-zip-contents --list`. Preserve that exact ZIP for every
   remaining gate; do not rebuild a look-alike package in another job.
9. Install that verified ZIP on a clean site with the official OpenStation
   release and check `debug.log` plus the browser console for fatals or
   uncaught errors.
10. Publish only after explicit approval.
