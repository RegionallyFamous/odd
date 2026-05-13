# ADR 0002: Universal `.wp` bundle format

- **Status:** Accepted
- **Date:** 2025
- **Context:** Originally, `.wp` was an "apps only" bundle format. Icon sets shipped with ODD core or required a companion plugin; new scenes had to be PR'd into `scenes.json`; widgets had no shipping path at all. Authors who just wanted to release a cool visual to their friends had to learn how to build a WordPress plugin first.
- **Decision:** A `.wp` archive can now carry any of four bundle types (app, scene, icon-set, widget), discriminated by `manifest.json`'s `type` field. The installer in `odd/includes/content/bundle.php` dispatches to per-type validators and installers. Installed bundles live in dedicated directories under `wp-content/uploads/odd/{apps,icon-sets,scenes,widgets}/`. JavaScript-executing content (scenes, widgets) requires `manage_options` plus a one-time user confirmation banner; SVG content is scrubbed.
- **Consequences:** Authors never have to write a WordPress plugin. Slug uniqueness is enforced globally across all bundle types, which simplifies the panel UI and `uninstall.php` but means authors need to pick slugs carefully. The same admin-trust model applies to every executing bundle.
- **Alternatives considered:**
  - *Separate archive format per type (`.wpscene`, `.wpwidget`).* Rejected: multiplies the number of upload routes and discoverability is harder. Single format with a `type` field lets the shop UI filter by type without requiring users to know which extension to click.
  - *Always require a companion plugin.* Rejected: raises the barrier for contributors who just want to share a scene; the main appeal of ODD is that it's fun to add to.
