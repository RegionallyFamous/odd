# Release runbook

1. Verify current versions from authoritative sources: WordPress Core API,
   WordPress.org plugin API, and the upstream OpenStation GitHub release.
2. Test against a clean checkout of that OpenStation tag. Preserve any dirty
   developer checkout by using a detached worktree.
3. Run `npm ci`, `npm run build:notes`, and `npm test`.
4. Run `composer phpcs` and `composer phpunit`.
5. Run `python3 _tools/build-catalog.py` and `odd/bin/validate-catalog`; confirm
   generated catalog output has no unexplained diff.
6. Run `odd/bin/smoke-catalog-apps odd-notes workbench --no-screenshots`.
7. Provision latest WordPress and run Playwright. Confirm, without reloading:
   install Notes, see its launcher, open it; install Workbench, see its launcher,
   open it in a bounded window; remove each app and see placement disappear.
8. Run `odd/bin/build-zip` and `odd/bin/check-zip-contents --list`.
9. Install the ZIP on a clean site with the official OpenStation release and
   check `debug.log` plus the browser console for fatals or uncaught errors.
10. Publish only after explicit approval.
