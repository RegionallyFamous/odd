# Release policy

Plugin runtime changes require an ODD plugin version bump, a release ZIP, and
the full quality gate. Catalog-only app changes rebuild and publish the catalog
without changing the plugin version.

The signed catalog is the authority for first-party app slugs. Adding or
polishing an app updates its own version, site card, and catalog artifacts; it
does not change the evergreen README, plugin runtime files, or frozen fallback
registry. Refresh the fallback only as part of a deliberate plugin release with
`ODD_CATALOG_WRITE_FALLBACK=1`.

The stable Playground boots the exact current WordPress release ZIP through
Playground's same-origin proxy and installs an exact official OpenStation ZIP.
The pinned versions must match WordPress.org and the upstream OpenStation
GitHub release before a release is prepared.

Publishing is never implied by building or testing. A release, WordPress.org
SVN push, GitHub tag, or Pages deployment requires an explicit request.

Every release must pass the commands in [the runbook](release-runbook.md), and
the working tree diff must contain no generated drift or unreviewed artifacts.
