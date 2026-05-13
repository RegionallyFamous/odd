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

CHECKS='
$_SERVER["REQUEST_URI"] = "/scope:kind-modern-forest/wp-admin/index.php";
$scope_path = "/scope:kind-modern-forest/odd-app/board/index.html";
echo "oddout_scope_peel=" . oddout_apps_cookieauth_strip_playground_scope_prefix( $scope_path ) . "\n";
echo "oddout_scope_iframe=" . oddout_apps_cookieauth_url_for( "board" ) . "\n";
echo "oddout_scope_rest=" . oddout_https_rest_url( "odd/v1/apps" ) . "\n";
$map = oddout_apps_runtime_importmap_html();
if ( preg_match( "#<script type=\"importmap\">(.+)</script>#", $map, $matches ) ) {
	$decoded = json_decode( $matches[1], true );
	echo "oddout_scope_runtime_react=" . $decoded["imports"]["react"] . "\n";
	echo "oddout_scope_runtime_jsx=" . $decoded["imports"]["react/jsx-runtime"] . "\n";
}
$react_imports = "import React from \"react\";import{jsx}from\"react/jsx-runtime\";";
echo "oddout_scope_rewrite=" . oddout_apps_rewrite_runtime_bare_imports( $react_imports ) . "\n";
'

OUT="$( cd "${WP_DIR}" && php -d memory_limit=512M "$( command -v wp )" eval "${CHECKS}" 2>/dev/null )"

EXP="oddout_scope_peel=/odd-app/board/index.html"
if [[ "${OUT}" != *"${EXP}"* ]]; then
	echo "scope peel mismatch: expected ${EXP}" >&2
	echo "${OUT}" >&2
	exit 1
fi

for NEEDLE in \
	"/scope:kind-modern-forest/odd-app/board/" \
	"/scope:kind-modern-forest/wp-json/odd/v1/apps" \
	"/scope:kind-modern-forest/odd-app-runtime/react.js" \
	"/scope:kind-modern-forest/odd-app-runtime/react-jsx-runtime.js"
do
	if [[ "${OUT}" != *"${NEEDLE}"* ]]; then
		echo "missing scoped generated URL segment: ${NEEDLE}" >&2
		echo "${OUT}" >&2
		exit 1
	fi
done

echo "OK: Playground scope prefix peels and generated app/runtime URLs stay scoped"
