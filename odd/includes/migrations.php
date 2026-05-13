<?php
/**
 * ODD — schema migrations.
 *
 * Runs a versioned list of one-shot migrations on each login. Schema
 * version is tracked per-user via the `oddout_schema_version` meta key;
 * each migration bumps it by one. No-op migrations are cheap and
 * exercise the runner so problems surface early.
 *
 * Migrations ship as `migration_<n>_<label>()` callables. Core
 * migrations live in this file; feature submodules register their own
 * by appending to the `oddout_migrations` filter. Keep the list append-
 * only: never edit a past migration, only add a new one at the tail.
 *
 * Index of every core-shipped migration (source of truth — ODDOUT_SCHEMA_VERSION
 * below must equal the highest entry here):
 *
 *   1  baseline                   odd/includes/migrations.php
 *   2  apps_baseline             odd/includes/migrations.php
 *   3  empty_slot                odd/includes/migrations.php (no-op placeholder)
 *   4  reserved                  odd/includes/migrations.php (no-op)
 * Third-party plugins can register higher-numbered migrations via
 * `add_filter( 'oddout_migrations', … )`; see docs/building-on-odd.md.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_SCHEMA_VERSION' ) ) {
	define( 'ODDOUT_SCHEMA_VERSION', 4 );
}

function oddout_migrations_all() {
	/**
	 * Filter the ordered list of migrations to run.
	 *
	 * Core ships a numbered list; third-party code can append additional
	 * callables by adding to this array at a higher version number. The
	 * runner processes them in ascending numeric order and bumps
	 * `oddout_schema_version` after each successful step.
	 *
	 * @since 0.16.0
	 *
	 * @param array<int, callable> $migrations Version => callable map.
	 */
	return (array) apply_filters(
		'oddout_migrations',
		array(
			1 => 'oddout_migration_1_baseline',
			2 => 'oddout_migration_2_apps_baseline',
			3 => 'oddout_migration_3_empty_slot',
			4 => 'oddout_migration_4_reserved',
		)
	);
}

function oddout_run_migrations( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	if ( $user_id <= 0 ) {
		return;
	}
	$current = (int) get_user_meta( $user_id, 'oddout_schema_version', true );
	$target  = (int) ODDOUT_SCHEMA_VERSION;
	if ( $current >= $target ) {
		return;
	}
	$migrations = oddout_migrations_all();
	ksort( $migrations );
	foreach ( $migrations as $version => $callable ) {
		if ( $version <= $current ) {
			continue;
		}
		if ( ! is_callable( $callable ) ) {
			continue;
		}
		try {
			$result = call_user_func( $callable, $user_id );
		} catch ( \Throwable $e ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG && function_exists( 'error_log' ) ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( sprintf( '[ODD] migration %d failed for user %d: %s', $version, $user_id, $e->getMessage() ) );
			}
			return;
		}
		// A migration may return `false` to signal "skip, don't advance
		// the schema version — retry on the next pageload." This is
		// how long-running or lock-contention migrations handle
		// partial progress without silently losing the migration
		// forever. `null` / `true` / `void` all count as success for
		// back-compat with no-op migrations.
		if ( false === $result ) {
			return;
		}
		update_user_meta( $user_id, 'oddout_schema_version', $version );
	}
}

/**
 * Baseline. Sets `oddout_schema_version = 1` for every user that logs
 * in after the migration runner ships, without touching any data.
 * Exists so the runner is exercised on every install — if the meta
 * key or update path ever breaks, the next release catches it.
 */
function oddout_migration_1_baseline( $user_id ) {
	unset( $user_id );
	// Intentionally no-op. The runner updates the version marker.
}

/**
 * Apps baseline. Ensures the apps storage directory and .htaccess exist for
 * every user that logs in after the apps engine ships. Idempotent and cheap
 * if the file already exists.
 */
function oddout_migration_2_apps_baseline( $user_id ) {
	unset( $user_id );
	if ( function_exists( 'oddout_apps_ensure_storage' ) ) {
		oddout_apps_ensure_storage();
	}
}

/**
 * Empty placeholder for migration slot 3 (reserved — older installs may already
 * have advanced past this step).
 */
function oddout_migration_3_empty_slot( $user_id ) {
	unset( $user_id );
}

/**
 * Reserved schema step (no-op — keeps numbering stable vs early pre-release installs).
 */
function oddout_migration_4_reserved( $user_id ) {
	unset( $user_id );
}


// Run on every admin pageload for the current user. Cheap when the
// version already matches target; a single integer meta read.
//
// Intentionally independent of WP Desktop Mode's own loader: if an
// admin temporarily deactivates the host plugin during an ODD
// upgrade, we still need usermeta to migrate forward. Migrations are
// pure meta rewrites; they're safe to run
// with or without the host plugin loaded.
add_action(
	'admin_init',
	function () {
		if ( ! is_user_logged_in() ) {
			return;
		}
		oddout_run_migrations();
	},
	5
);
