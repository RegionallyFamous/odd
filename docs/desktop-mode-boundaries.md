# Desktop Mode Boundaries

ODD should make Desktop Mode richer without taking over Desktop Mode. This page is the working contract for v1 code reviews.

## Native First

- Use public Desktop Mode PHP and JavaScript APIs for windows, notices, widgets, settings, icons, file drops, and shell actions.
- Use feature detection when a Desktop Mode surface is optional or newly introduced.
- Feed data into Desktop Mode. Do not restyle or patch host rails, host windows, host shortcuts, or host menus.
- Keep expressive art inside ODD content: desktop shortcut icons, catalog cards, wallpapers, widgets, apps, and app iframes.

## Containment

- ODD Shop CSS lives inside the ODD native window surface.
- Cursor styles and cursor runtime load only inside Desktop Mode portal requests.
- Admin-bar hiding is a user preference and only removes wp-admin toolbar space in the Desktop Mode portal.
- App iframe diagnostics accept messages only from known ODD app frames and cap message sizes at the parent collector.
- Long-running listeners, observers, Pixi apps, timers, audio, and canvas work must return or register teardown.

## Store Workflow

- Store content should ship through the catalog whenever runtime code does not need to change.
- Installed rows must keep catalog download metadata so update and repair flows remain available.
- Install, update, repair, apply, add, and open states should be explicit and version-driven.
- Catalog integrity checks are not optional. Size, SHA256, type, slug, and manifest version checks protect users and make cache problems visible.

## Security Baseline

- Use WordPress upload/path helpers, realpath confinement, extension and MIME allowlists, nonce checks, and capability checks.
- User-local reads may use `read`; installs, refreshes, diagnostics, file mutations, and privileged actions use `manage_options`.
- Public routes are only for intentional static assets and must still validate paths and response headers.
- Escape late on output. Raw byte responses need a narrow wrapper and documented headers.

## Performance Baseline

- Render the Shop in slices, preload visible art, and keep search/catalog normalization memoized.
- Use stable data attributes for card grids, and favor delegated events when changing hot paths.
- Keep cursor pointer work on one RAF pass.
- Wallpaper swaps must leave one active canvas/ticker path after teardown settles.
- CI guardrails should fail when catalog card budgets, search metadata, or containment contracts disappear.

## Review Checklist

- Does this use a Desktop Mode API before reaching into host DOM?
- Does it stay inside the ODD window, ODD iframe, ODD content root, or Desktop Mode portal?
- Does it leave classic wp-admin unchanged?
- Does it clean up observers, RAFs, timers, audio, canvases, and iframes?
- Does it have a test or source guardrail for the contract it relies on?
