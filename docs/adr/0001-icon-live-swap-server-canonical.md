# ADR 0001: Server-canonical icon live-swap

- **Status:** Accepted
- **Date:** 2025
- **Context:** When a user picks a new icon set in the ODD panel, dock icons, taskbar icons, and desktop shortcuts need to re-render without ODD styling around Desktop Mode or patching the live DOM.
- **Decision:** ODD treats Desktop Mode as the source of truth. Icon sets flow through `desktop_mode_dock_item`, `desktop_mode_icons`, and shell-config icon payload filters. The Shop saves the preference and reloads so Desktop Mode rebuilds its native payload.
- **Consequences:** One reload per icon-set change, but zero DOM drift and no ODD-owned rail visuals. The icon set changes everything through Desktop Mode's normal data contracts.
- **Alternatives considered:**
  - *Pure client-side surgery.* Rejected: see context. Every mismatch means someone files a bug that only reproduces in their menu layout.
  - *Build a client mapping of `menu-X` → `menu slug`.* Rejected: requires a round-trip to populate, and the mapping is already computed server-side — might as well render there.
  - *Use `wp.data` stores to drive the dock.* Rejected: WP Desktop Mode doesn't expose a store for the dock items; bolting one on is a much larger scope change than one soft reload.
