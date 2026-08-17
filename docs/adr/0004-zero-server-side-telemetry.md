# ADR 0004: No telemetry

- **Status:** Accepted
- **Decision:** ODD does not send analytics, install pings, crash reports, or
  diagnostics to a third party.
- **Consequence:** Users retain control of diagnostic data. New network calls
  require an explicit product decision, documentation, consent, and security
  review; they may not be hidden in an app runtime or maintenance release.
