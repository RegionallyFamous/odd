# ODD product QA team

The project-scoped Codex QA team is designed to find user-facing failures before catalog promotion. It is intentionally read-only with respect to product code:

- `odd_product_qa_auditor` traces app behavior, WordPress/API boundaries, persistence, permissions, security, and regression coverage.
- `odd_product_qa_browser` tests exact packaged bundles at desktop, mobile, and compact sizes, preserving screenshots and interaction evidence under `test-results/`.
- `odd_product_qa_release` audits manifests, generated packages, registry integrity, reproducibility, CI gates, and preview-versus-production safety.

Recommended invocation:

```text
Use the ODD product QA team on the current tree. Run the auditor, browser specialist, and release specialist in parallel. Wait for all three. Report only confirmed P0–P3 findings with exact file paths, reproduction steps, evidence artifacts, and coverage gaps. Do not edit, commit, push, publish, or release.
```

The browser specialist may write only disposable evidence under `test-results/`. The other two agents are read-only. Findings should be routed to a separate implementation agent only after the coordinator confirms scope and ownership. After pulling these files, start a new Codex task or reopen the workspace so Codex reloads the custom agent types.
