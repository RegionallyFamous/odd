#!/usr/bin/env bash
# Verify that ODD app and REST URLs retain the active Playground scope.

set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WP_DIR="${E2E_WP_DIR:-${ROOT}/.e2e/wp}"
export WP_CLI_ALLOW_ROOT="${WP_CLI_ALLOW_ROOT:-1}"

command -v wp >/dev/null 2>&1 || { echo "missing: wp" >&2; exit 1; }
command -v php >/dev/null 2>&1 || { echo "missing: php" >&2; exit 1; }
[[ -f "${WP_DIR}/wp-config.php" ]] || { echo "run: bash bin/e2e-local.sh provision" >&2; exit 1; }

CHECKS='
$_SERVER["HTTP_HOST"] = "playground.wordpress.net";
$_SERVER["REQUEST_URI"] = "/scope:kind-modern-forest/wp-admin/index.php";
echo "peel=" . oddout_apps_cookieauth_strip_playground_scope_prefix( "/scope:kind-modern-forest/odd-app/workbench/index.html" ) . "\n";
echo "app=" . oddout_apps_cookieauth_url_for( "workbench" ) . "\n";
echo "rest=" . oddout_https_rest_url( "odd/v1/apps" ) . "\n";
'

OUT="$( cd "${WP_DIR}" && php -d memory_limit=512M "$( command -v wp )" eval "${CHECKS}" 2>/dev/null )"
for EXPECTED in \
	"peel=/odd-app/workbench/index.html" \
	"/scope:kind-modern-forest/odd-app/workbench/" \
	"/scope:kind-modern-forest/wp-json/odd/v1/apps"
do
	if [[ "${OUT}" != *"${EXPECTED}"* ]]; then
		echo "missing scoped URL: ${EXPECTED}" >&2
		echo "${OUT}" >&2
		exit 1
	fi
done

echo "OK: app and REST URLs retain the Playground scope"
