# ADR 0003: API versioning separate from plugin releases

- **Status:** Accepted
- **Date:** 2026-04
- **Context:** ODD ships visual content (scenes, icon sets, wallpapers) on a faster cadence than the JS/PHP extension surface evolves. If the plugin version and the API version are the same number, every tiny scene tweak becomes a "major" release any time a breaking API change ships, or every API break gets smuggled into a misleading patch bump.
- **Decision:** Expose `window.__odd.api.version` as an independent SemVer string (today: `2.0.0`, aligned with the ODD 2.0.0 product release). After 2.0, bump it only when the surface described in [`docs/api-versioning.md`](../api-versioning.md) changes. Plugin-only releases do not have to move `api.version` in lockstep (see the ADR table in `docs/adr/README.md`).
- **Consequences:** Downstream extensions can pin to `api.version >= 1.x` and trust that patch and minor plugin releases won't break them. Contributors touching api.js, REST endpoints, or registry filters MUST update the constant and the guard test (`tests/integration/api-surface.test.js`) in the same PR.
- **Alternatives considered:**
  - *Piggyback on `ODDOUT_VERSION`.* Rejected: forces every scene release to carry API-major semantics, which is dishonest.
  - *Use a purely numeric API revision (`api.rev = 12`).* Rejected: SemVer is something extension authors already know how to reason about; inventing a new numbering scheme just obfuscates it.
