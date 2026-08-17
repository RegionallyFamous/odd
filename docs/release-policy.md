# Release policy

Plugin runtime changes require an ODD plugin version bump, a release ZIP, and
the full quality gate. Catalog-only app changes rebuild and publish the catalog
without changing the plugin version.

The stable Playground uses `wp: latest` and an exact official OpenStation ZIP.
The pinned OpenStation version must match both WordPress.org and the upstream
GitHub latest release before a release is prepared.

Publishing is never implied by building or testing. A release, WordPress.org
SVN push, GitHub tag, or Pages deployment requires an explicit request.

Every release must pass the commands in [the runbook](release-runbook.md), and
the working tree diff must contain no generated drift or unreviewed artifacts.
