#!/usr/bin/env bash
# Dump ODD app-loading diagnostics from a provisioned WordPress tree.
#
# Usage:
#   bash bin/diagnose-app-load.sh              # defaults to board
#   bash bin/diagnose-app-load.sh ledger
#   E2E_WP_DIR=/path/to/wp bash bin/diagnose-app-load.sh board

set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WP_DIR="${E2E_WP_DIR:-${ROOT}/.e2e/wp}"
SLUG="${1:-board}"
export WP_CLI_ALLOW_ROOT="${WP_CLI_ALLOW_ROOT:-1}"
export ODD_DIAG_SLUG="${SLUG}"

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "missing: $1" >&2
		exit 1
	}
}

need_cmd php
need_cmd wp

[[ -f "${WP_DIR}/wp-config.php" ]] || {
	echo "No WP at ${WP_DIR} — run: bash bin/e2e-local.sh provision" >&2
	exit 1
}

RAW="$(
	cd "${WP_DIR}" && php -d memory_limit=512M "$( command -v wp )" eval '
		$slug = sanitize_key( (string) getenv( "ODD_DIAG_SLUG" ) );
		if ( "" === $slug ) {
			fwrite( STDERR, "Missing slug.\n" );
			exit( 1 );
		}
		wp_set_current_user( 1 );
		do_action( "rest_api_init" );
		$request  = new WP_REST_Request( "GET", "/odd/v1/apps/diag/" . $slug );
		$response = rest_do_request( $request );
		$data     = $response->get_data();
		echo wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
	' 2>/dev/null
)"
JSON="$( printf '%s\n' "${RAW}" | sed -n '/^{/,$p' )"
if [[ -z "${JSON}" ]]; then
	echo "${RAW}" >&2
	echo "No JSON diagnostics payload found in WP-CLI output." >&2
	exit 1
fi

echo "${JSON}"

if command -v jq >/dev/null 2>&1; then
	echo
	echo "Summary:"
	echo "${JSON}" | jq -r '
		[
			"status=" + (.summary.status // "unknown"),
			"firstProblem=" + ((.summary.firstProblem.id // "none") | tostring),
			"serve=" + (.serve.url // ""),
			"regex=" + ((.serve.regex_matches // false) | tostring),
			"assetsProbed=" + ((.asset_probes | length) | tostring)
		] | .[]
	'
fi
