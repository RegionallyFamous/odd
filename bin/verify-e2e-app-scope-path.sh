#!/usr/bin/env bash
# Quick sanity check: Playground-style `/scope:<id>/odd-app/...` peels to `/odd-app/...`
# inside WordPress (same helper as cookie-auth). Run after `bash bin/e2e-local.sh provision`.
#
# Usage:
#   bash bin/verify-e2e-app-scope-path.sh
#   E2E_WP_DIR=/path/to/wp bash bin/verify-e2e-app-scope-path.sh

set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WP_DIR="${E2E_WP_DIR:-${ROOT}/.e2e/wp}"
export WP_CLI_ALLOW_ROOT="${WP_CLI_ALLOW_ROOT:-1}"

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need_cmd wp
need_cmd php

[[ -f "${WP_DIR}/wp-config.php" ]] || { echo "No WP at ${WP_DIR} — run: bash bin/e2e-local.sh provision" >&2; exit 1; }

OUT="$( cd "${WP_DIR}" && php -d memory_limit=512M "$( command -v wp )" eval 'echo odd_apps_cookieauth_strip_playground_scope_prefix( "/scope:kind-modern-forest/odd-app/board/index.html" );' 2>/dev/null | tail -1 )"
EXP="/odd-app/board/index.html"
if [[ "${OUT}" != "${EXP}" ]]; then
	echo "scope peel mismatch: got ${OUT}, expected ${EXP}" >&2
	exit 1
fi
echo "OK: Playground scope prefix peels to ${OUT}"
