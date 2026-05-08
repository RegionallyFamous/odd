#!/usr/bin/env bash
# One-shot Docker-backed Playwright e2e (matches CI: MySQL in Docker + wp server + tests).
#
# Prereq: Docker Desktop running.
#
#   bash bin/docker-e2e.sh
#   bash bin/docker-e2e.sh e2e/panel.spec.ts
#
# Equivalent to:
#   E2E_DB_PORT=3307 bash bin/e2e-local.sh all [args…]

set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
export E2E_DB_PORT="${E2E_DB_PORT:-3307}"
exec bash "${ROOT}/bin/e2e-local.sh" all "$@"
