#!/usr/bin/env bash
# Local Playwright e2e stack — same steps as .github/workflows/e2e.yml
#
# Requires: PHP, WP-CLI (`wp`), curl, Docker (optional, for MySQL only)
#
# Usage:
#   Docker MySQL (recommended):
#     docker compose -f docker-compose.e2e.yml up -d
#     E2E_DB_PORT=3307 bash bin/e2e-local.sh provision
#     bash bin/e2e-local.sh serve   # terminal A
#     bash bin/e2e-local.sh test    # terminal B
#
#   One-shot (Docker MySQL on 3307 + provision + wp server + Playwright):
#     bash bin/e2e-local.sh all
#
# Env:
#   E2E_WP_DIR        WordPress tree (default: <repo>/.e2e/wp)
#   E2E_DB_HOST         default 127.0.0.1
#   E2E_DB_PORT         default 3306; use 3307 with docker-compose.e2e.yml
#   E2E_BASE_URL        default http://127.0.0.1:8080
#   E2E_WP_MEMORY_LIMIT PHP CLI limit for `wp` (default 512M)
#   WP_ADMIN_USER / WP_ADMIN_PASS  (for Playwright login; defaults match CI)

set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
ODD_PLUGIN="${ROOT}/odd"

WP_DIR="${E2E_WP_DIR:-${ROOT}/.e2e/wp}"
DB_HOST="${E2E_DB_HOST:-127.0.0.1}"
DB_PORT="${E2E_DB_PORT:-3306}"

sync_db_hostport() {
	DB_HOSTPORT="${DB_HOST}"
	if [[ "${DB_PORT}" != "3306" ]]; then
		DB_HOSTPORT="${DB_HOST}:${DB_PORT}"
	fi
}
sync_db_hostport

BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:8080}"

export WP_CLI_ALLOW_ROOT="${WP_CLI_ALLOW_ROOT:-1}"
# Homebrew WP-CLI is `#!/usr/bin/env php` + phar — extra PHP args must be passed explicitly (WP_CLI_PHP_ARGS is not applied).
E2E_WP_MEMORY_LIMIT="${E2E_WP_MEMORY_LIMIT:-512M}"

WP_ADMIN_USER="${WP_ADMIN_USER:-admin}"
export WP_ADMIN_USER
WP_ADMIN_PASS="${WP_ADMIN_PASS:-password}"
export WP_ADMIN_PASS

die() { echo "e2e-local: $*" >&2; exit 1; }

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

e2e_wp() {
	php -d "memory_limit=${E2E_WP_MEMORY_LIMIT}" "$(command -v wp)" "$@"
}

mysql_up() {
	need_cmd docker
	docker compose -f "${ROOT}/docker-compose.e2e.yml" up -d
	echo "Waiting for MySQL (Docker)..."
	local i
	for i in $( seq 1 45 ); do
		if docker compose -f "${ROOT}/docker-compose.e2e.yml" exec -T mysql mysqladmin ping -h 127.0.0.1 -uroot -proot --silent 2>/dev/null; then
			echo "mysql ready"
			return 0
		fi
		sleep 2
	done
	die "MySQL container did not become ready"
}

provision() {
	need_cmd php
	need_cmd wp
	need_cmd curl

	sync_db_hostport

	[[ -d "${ODD_PLUGIN}" ]] || die "expected ODD plugin at ${ODD_PLUGIN}"

	mkdir -p "$( dirname "${WP_DIR}" )"
	if [[ -f "${WP_DIR}/wp-config.php" ]]; then
		echo "Reusing existing ${WP_DIR} (remove it to reprovision from scratch)"
	else
		mkdir -p "${WP_DIR}"
		( cd "${WP_DIR}" && e2e_wp core download )
		( cd "${WP_DIR}" && e2e_wp config create \
			--dbname=wordpress \
			--dbuser=root \
			--dbpass=root \
			--dbhost="${DB_HOSTPORT}" \
			--skip-check )
		( cd "${WP_DIR}" && e2e_wp core install \
			--url="${BASE_URL}" \
			--title=ODD-e2e \
			--admin_user="${WP_ADMIN_USER}" \
			--admin_password="${WP_ADMIN_PASS}" \
			--admin_email=e2e@example.com \
			--skip-email )
	fi

	( cd "${WP_DIR}" && e2e_wp plugin install desktop-mode --activate )

	ODD_LINK="${WP_DIR}/wp-content/plugins/odd"
	if [[ -L "${ODD_LINK}" ]] || [[ -d "${ODD_LINK}" ]]; then
		rm -rf "${ODD_LINK}"
	fi
	ln -sf "${ODD_PLUGIN}" "${ODD_LINK}"

	( cd "${WP_DIR}" && e2e_wp plugin activate odd )

	( cd "${WP_DIR}" && e2e_wp user meta update 1 desktop_mode_mode 1 )

	( cd "${WP_DIR}" && e2e_wp eval '$r = odd_starter_install_now(); if (is_wp_error($r)) { fwrite(STDERR, $r->get_error_message() . "\n"); exit(1); } var_export($r);' )

	# Small catalog app used by Playwright to assert the iframe serve path (avoid UI install:
	# `wp server` can return 5xx on long admin-ajax/REST requests; CLI install matches CI reliability).
	( cd "${WP_DIR}" && e2e_wp eval '$reg = odd_catalog_refresh(); $slug = "board"; if (function_exists("odd_bundle_catalog_installed_versions") && array_key_exists($slug, odd_bundle_catalog_installed_versions())) { fwrite(STDOUT, "e2e: app already installed\n"); exit(0); } $entry = null; foreach ((array) ($reg["bundles"] ?? array()) as $e) { if ((isset($e["type"], $e["slug"]) && $e["type"] === "app" && $e["slug"] === $slug)) { $entry = $e; break; } } if (!$entry) { fwrite(STDERR, "e2e: catalog missing app {$slug}\n"); exit(1);} $r = odd_catalog_install_entry($entry); if (is_wp_error($r)) { fwrite(STDERR, $r->get_error_message() . "\n"); exit(1);} var_export($r);' )

	( cd "${WP_DIR}" && e2e_wp user meta update 1 desktop_mode_os_settings '{"wallpaper":"odd"}' --format=json )

	# Plain permalinks break `/wp-json/...` on `wp server`; Desktop Mode + Playwright need REST.
	( cd "${WP_DIR}" && e2e_wp option update permalink_structure '/%postname%/' )
	( cd "${WP_DIR}" && e2e_wp rewrite flush --hard )

	echo "Provisioned WordPress at ${WP_DIR} (BASE_URL=${BASE_URL})"
}

serve() {
	need_cmd php
	need_cmd wp
	[[ -f "${WP_DIR}/wp-config.php" ]] || die "run: bash bin/e2e-local.sh provision"
	( cd "${WP_DIR}" && exec php -d "memory_limit=${E2E_WP_MEMORY_LIMIT}" "$(command -v wp)" server --host=127.0.0.1 --port=8080 )
}

run_playwright() {
	need_cmd npx
	[[ -f "${WP_DIR}/wp-config.php" ]] || die "run: bash bin/e2e-local.sh provision"
	export BASE_URL
	( cd "${ROOT}" && npx playwright test "$@" )
}

wait_http() {
	for _ in $( seq 1 45 ); do
		if curl -fsS "${BASE_URL}/" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	die "HTTP server at ${BASE_URL} did not respond"
}

run_all() {
	need_cmd php
	need_cmd wp
	need_cmd curl
	need_cmd npx

	export E2E_DB_PORT="${E2E_DB_PORT:-3307}"
	DB_PORT="${E2E_DB_PORT}"
	sync_db_hostport
	mysql_up

	provision

	mkdir -p "${ROOT}/.e2e"
	( cd "${WP_DIR}" && nohup php -d "memory_limit=${E2E_WP_MEMORY_LIMIT}" "$(command -v wp)" server --host=127.0.0.1 --port=8080 >"${ROOT}/.e2e/wp-server.log" 2>&1 ) &
	SRV_PID=$!
	trap 'kill "${SRV_PID}" 2>/dev/null || true' EXIT
	wait_http

	run_playwright "$@"
}

case "${1:-}" in
	mysql-up)
		mysql_up
		;;
	mysql-down)
		need_cmd docker
		docker compose -f "${ROOT}/docker-compose.e2e.yml" down
		;;
	provision)
		provision
		;;
	serve)
		serve
		;;
	test|playwright)
		shift || true
		run_playwright "$@"
		;;
	all)
		shift || true
		run_all "$@"
		;;
	*)
		sed -n '1,25p' "$0" >&2
		die "usage: bash bin/e2e-local.sh {mysql-up|mysql-down|provision|serve|test|all}"
		;;
esac
