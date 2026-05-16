# ADR 0001: Server-canonical icon live-swap

- **Status:** Superseded for rail/dock/system icon surfaces; accepted for desktop shortcuts and the ODD Shop launcher
- **Date:** 2025
- **Context:** When a user picks a new icon set in the ODD panel, desktop shortcuts need to re-render without ODD styling around Desktop Mode or patching the live DOM. Rail, dock, and system action icons should stay on Desktop Mode defaults, while the ODD Shop launcher should follow the active set.
- **Decision:** ODD treats Desktop Mode as the source of truth. Icon sets flow through `desktop_mode_icons`, the ODD native-window entry in `desktop_mode_shell_config`, and file-layer shortcut serialization only. The Shop saves the preference and reloads so Desktop Mode rebuilds its native desktop shortcut payload.
- **Consequences:** One reload per icon-set change, but zero DOM drift and no ODD-owned rail visuals. The icon set changes desktop shortcut artwork through Desktop Mode's normal data contracts.
- **Alternatives considered:**
  - *Pure client-side surgery.* Rejected: see context. Every mismatch means someone files a bug that only reproduces in their menu layout.
  - *Build a client mapping of `menu-X` → `menu slug`.* Rejected: requires a round-trip to populate, and the mapping is already computed server-side — might as well render there.
  - *Use `wp.data` stores to drive the dock.* Rejected: WP Desktop Mode doesn't expose a store for the dock items; bolting one on is a much larger scope change than one soft reload.
