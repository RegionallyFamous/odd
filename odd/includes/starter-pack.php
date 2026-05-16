<?php
/**
 * ODD — starter pack runner (cron-free).
 *
 * The plugin ships empty. The starter pack (a handful of scenes + icon
 * sets + widgets pulled from the remote catalog) has to land on every
 * new install so the desktop doesn't boot into a blank, unselectable
 * state. This runs through an explicit admin-triggered install path
 * instead of activation scheduling. Cron only ticks when someone hits
 * the site, DISABLE_WP_CRON is common in production, and a freshly
 * activated site that never receives a visitor can sit "pending"
 * forever.
 *
 * So: no cron. Install attempts happen synchronously on two hooks:
 *
 *   1. `register_activation_hook` — the user clicked "Activate" in
 *      wp-admin, so we're already in a privileged admin request.
 *      Run the installer inline. If it fails (catalog down, loopback
 *      blocked, whatever), we capture the error into state and fall
 *      through to the safety net below — we never block activation.
 *
 *   2. `init` — on every subsequent page load (admin *or* frontend),
 *      if the state isn't `installed` and the backoff window has
 *      elapsed, run the installer inline for privileged users.
 *      Anonymous/readonly visitors never trigger network I/O.
 *
 * A status=running lock (auto-expires after 120s) keeps concurrent
 * admin tabs from racing each other. A per-request in-memory guard
 * keeps the safety net from firing twice on a single request.
 *
 * State shape, persisted to the `oddout_starter_state` option:
 *
 *   {
 *     "status":       "pending" | "running" | "installed" | "failed",
 *     "attempts":     int,
 *     "last_attempt": unix timestamp,
 *     "last_error":   string,
 *     "installed":    [ "<slug>", ... ],   // what made it to disk
 *     "prefs_set":    bool
 *   }
 *
 * The Shop exposes state via GET /odd/v1/starter and can force an
 * immediate retry (bypassing backoff) via POST /odd/v1/starter/retry.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_STARTER_OPTION' ) ) {
	define( 'ODDOUT_STARTER_OPTION', 'oddout_starter_state' );
}

/**
 * Max wall-clock we allow a single running state to sit before we
 * consider the lock stale and retry. Sized for a slow catalog host +
 * a few bundle downloads (~3 × 60s default download_url timeout).
 */
if ( ! defined( 'ODDOUT_STARTER_LOCK_TTL' ) ) {
	define( 'ODDOUT_STARTER_LOCK_TTL', 240 );
}

/**
 * Exponential backoff schedule (in seconds) indexed by attempt count
 * (1-based). Used to gate the `init` safety net so a chronically
 * failing catalog host doesn't hammer every page load.
 */
function oddout_starter_backoff_seconds() {
	return array(
		1 => 0,               // first attempt: immediate
		2 => 30,              // 30s
		3 => 2 * MINUTE_IN_SECONDS,
		4 => 10 * MINUTE_IN_SECONDS,
		5 => HOUR_IN_SECONDS,
		6 => 6 * HOUR_IN_SECONDS,
	);
}

function oddout_starter_get_state() {
	$state = get_option( ODDOUT_STARTER_OPTION, null );
	if ( ! is_array( $state ) ) {
		$state = array();
	}
	$state = wp_parse_args(
		$state,
		array(
			'status'       => 'pending',
			'attempts'     => 0,
			'last_attempt' => 0,
			'last_error'   => '',
			'installed'    => array(),
			'prefs_set'    => false,
			'catalog'      => array(),
			// Monotonic per-slug record: slug => {
			//   status: 'done' | 'pending' | 'failed',
			//   error:  string,
			//   attempted_at: unix timestamp,
			// }. Successful entries are never downgraded; retries
			// only re-attempt 'pending' and 'failed'. See
			// oddout_starter_merge_slug_results().
			'slugs'        => array(),
		)
	);
	if ( ! is_array( $state['slugs'] ) ) {
		$state['slugs'] = array();
	}
	return $state;
}

/**
 * Fold per-slug install results into the monotonic state map. A
 * successful attempt can flip pending/failed → done; a failed attempt
 * can only flip pending → failed (never overwrite a prior done).
 *
 * @param array                $state   Starter state as returned by oddout_starter_get_state().
 * @param array<string,array>  $results Keyed by slug; each value
 *                                      is { status, error?, attempted_at? }.
 * @return array Updated state with merged slugs map.
 */
function oddout_starter_merge_slug_results( array $state, array $results ) {
	$slugs = isset( $state['slugs'] ) && is_array( $state['slugs'] ) ? $state['slugs'] : array();
	$now   = time();
	foreach ( $results as $slug => $row ) {
		$slug = sanitize_key( (string) $slug );
		if ( '' === $slug || ! is_array( $row ) ) {
			continue;
		}
		$incoming = array(
			'status'       => isset( $row['status'] ) ? (string) $row['status'] : 'pending',
			'error'        => isset( $row['error'] ) ? (string) $row['error'] : '',
			'attempted_at' => isset( $row['attempted_at'] ) ? (int) $row['attempted_at'] : $now,
		);
		$existing = isset( $slugs[ $slug ] ) && is_array( $slugs[ $slug ] ) ? $slugs[ $slug ] : null;
		if ( $existing && isset( $existing['status'] ) && 'done' === $existing['status'] ) {
			// Monotonic: already-done slugs are never overwritten by
			// a later failed or pending result.
			continue;
		}
		$slugs[ $slug ] = $incoming;
	}
	$state['slugs'] = $slugs;
	return $state;
}

/**
 * Derive the top-level status string from per-slug state.
 *
 * Returns one of:
 *   - 'installed' — every wanted slug recorded as done.
 *   - 'partial'   — at least one done AND at least one failed or pending.
 *   - 'failed'    — nothing done, at least one failed.
 *   - 'pending'   — nothing attempted yet.
 *
 * @param array    $state Starter state.
 * @param string[] $wanted Expected slug list (empty means "trust slugs map").
 * @return string
 */
function oddout_starter_compute_status( array $state, array $wanted = array() ) {
	$slugs = isset( $state['slugs'] ) && is_array( $state['slugs'] ) ? $state['slugs'] : array();
	if ( empty( $wanted ) ) {
		$wanted = array_keys( $slugs );
	}
	if ( empty( $wanted ) ) {
		return 'pending';
	}
	$done   = 0;
	$failed = 0;
	foreach ( $wanted as $slug ) {
		$row = isset( $slugs[ $slug ] ) ? $slugs[ $slug ] : null;
		if ( ! is_array( $row ) ) {
			continue;
		}
		$s = isset( $row['status'] ) ? (string) $row['status'] : 'pending';
		if ( 'done' === $s ) {
			++$done;
		} elseif ( 'failed' === $s ) {
			++$failed;
		}
	}
	if ( $done === count( $wanted ) ) {
		return 'installed';
	}
	if ( $done > 0 && ( $failed > 0 || $done < count( $wanted ) ) ) {
		return 'partial';
	}
	if ( $failed > 0 ) {
		return 'failed';
	}
	return 'pending';
}

function oddout_starter_save_state( array $state ) {
	update_option( ODDOUT_STARTER_OPTION, $state, false );
}

function oddout_starter_reset() {
	delete_option( ODDOUT_STARTER_OPTION );
}

/**
 * Activation hook. Runs in an admin request with the activating user
 * on the line. We try to install the starter pack inline right now
 * so the Shop has content on first open — if the catalog host is
 * slow/unreachable the error is captured to state and the `init`
 * safety net retries on the next page load.
 */
function oddout_activate_install_starter() {
	$state = oddout_starter_get_state();
	// Reactivations on an already-installed site are no-ops.
	if ( 'installed' === $state['status'] ) {
		return;
	}

	// Reset counters on a fresh activation so attempt #1 gets a
	// clean slate — but PRESERVE the monotonic `slugs` map so
	// previously-installed starter entries stay marked done and
	// don't get re-attempted on activation.
	$state['status']       = 'pending';
	$state['attempts']     = 0;
	$state['last_attempt'] = 0;
	$state['last_error']   = '';
	oddout_starter_save_state( $state );

	oddout_starter_ensure_installed( true );
}
register_activation_hook( ODDOUT_FILE, 'oddout_activate_install_starter' );

/**
 * ODD seeds WP Desktop Mode's host wallpaper setting to "odd" so the
 * installed scene is visible on first boot. If ODD is deactivated while
 * that host setting remains selected, Desktop Mode no longer has a matching
 * canvas wallpaper registration and can boot into a blank shell. Restore
 * only users currently pointing at ODD; leave every other wallpaper choice
 * untouched.
 */
function oddout_deactivate_restore_host_wallpaper() {
	$default_wallpaper = oddout_starter_host_default_wallpaper();
	if ( '' === $default_wallpaper || 'odd' === $default_wallpaper ) {
		$default_wallpaper = 'dark';
	}

	$offset = 0;
	$number = 500;
	do {
		$users = get_users(
			array(
				'fields' => array( 'ID' ),
				'number' => $number,
				'offset' => $offset,
			)
		);
		foreach ( $users as $u ) {
			$uid      = (int) $u->ID;
			$settings = oddout_starter_get_host_settings_for_user( $uid );
			if ( ! is_array( $settings ) || ( isset( $settings['wallpaper'] ) ? (string) $settings['wallpaper'] : '' ) !== 'odd' ) {
				continue;
			}
			$settings['wallpaper'] = $default_wallpaper;
			oddout_starter_save_host_settings_for_user( $uid, $settings );
		}
		$offset += $number;
	} while ( count( $users ) === $number );
}
register_deactivation_hook( ODDOUT_FILE, 'oddout_deactivate_restore_host_wallpaper' );

/**
 * Core entry point: bring the site to a fully-installed starter-pack
 * state. Safe to call from anywhere; no-ops fast if we already
 * succeeded, are already running, or are inside the backoff window.
 *
 * @param bool $force If true, ignore backoff (activation / manual
 *                    retry path). Still respects the running-lock so
 *                    concurrent tabs don't double-install.
 * @return array{installed:string[],prefs_set:bool}|WP_Error|null
 *         array when we ran and succeeded, WP_Error when we ran and
 *         failed, null when we didn't run (locked or backoff).
 */
function oddout_starter_ensure_installed( $force = false ) {
	static $ran_this_request = false;
	if ( $ran_this_request ) {
		return null;
	}

	$state = oddout_starter_get_state();
	if ( 'installed' === $state['status'] ) {
		return null;
	}

	$now = time();

	// Running-lock: another request is mid-install. Treat the lock
	// as stale after ODDOUT_STARTER_LOCK_TTL seconds (a hung PHP worker
	// or a killed activation can leave status=running behind).
	if ( 'running' === $state['status'] ) {
		$age = $now - (int) $state['last_attempt'];
		if ( $age < ODDOUT_STARTER_LOCK_TTL ) {
			return null;
		}
	}

	// Backoff: only enforced in the non-forced path. Both 'failed'
	// and 'partial' states go through backoff so we don't hammer a
	// chronically broken catalog host on every request. The
	// activation hook and the REST retry endpoint both pass
	// $force=true, bypassing backoff but still respecting the lock.
	if ( ! $force && in_array( $state['status'], array( 'failed', 'partial' ), true ) ) {
		$backoff = oddout_starter_backoff_seconds();
		$want    = max( 1, (int) $state['attempts'] + 1 );
		$delay   = isset( $backoff[ $want ] ) ? $backoff[ $want ] : end( $backoff );
		if ( $now - (int) $state['last_attempt'] < (int) $delay ) {
			return null;
		}
	}

	$ran_this_request = true;

	// Take the lock.
	$state['status']       = 'running';
	$state['attempts']     = (int) $state['attempts'] + 1;
	$state['last_attempt'] = $now;
	oddout_starter_save_state( $state );

	$prior_slugs = isset( $state['slugs'] ) && is_array( $state['slugs'] ) ? $state['slugs'] : array();
	$run         = oddout_starter_install_now( $prior_slugs );

	// Refetch in case another request stomped state while we ran.
	$after = oddout_starter_get_state();

	// Fatal: we couldn't even load the catalog. Leave prior
	// per-slug state intact, just mark the top-level status.
	if ( ! empty( $run['fatal'] ) && is_wp_error( $run['fatal'] ) ) {
		$after['status']     = 'failed';
		$after['last_error'] = $run['fatal']->get_error_message();
		oddout_starter_save_state( $after );
		return $run['fatal'];
	}

	// Fold per-slug results into monotonic state.
	$after = oddout_starter_merge_slug_results( $after, $run['results'] );

	$wanted             = isset( $run['wanted'] ) ? (array) $run['wanted'] : array();
	$after['status']    = oddout_starter_compute_status( $after, $wanted );
	$after['prefs_set'] = $after['prefs_set'] || (bool) $run['prefs_set'];
	$after['catalog']   = isset( $run['catalog'] ) && is_array( $run['catalog'] ) ? $run['catalog'] : array();

	// Aggregate the last error for the top-level `last_error` field so the Shop
	// and smoke tests get a concise summary. Per-slug detail lives in `slugs`.
	$run_errors = array();
	foreach ( $run['results'] as $slug => $row ) {
		if ( isset( $row['status'] ) && 'failed' === $row['status'] && ! empty( $row['error'] ) ) {
			$run_errors[] = sprintf( '%s: %s', $slug, $row['error'] );
		}
	}
	if ( empty( $run_errors ) ) {
		$after['last_error'] = '';
	} else {
		$after['last_error'] = implode( '; ', $run_errors );
	}

	// Keep a flat installed slug list for the public REST state.
	$installed_flat = array();
	foreach ( $after['slugs'] as $slug => $row ) {
		if ( isset( $row['status'] ) && 'done' === $row['status'] ) {
			$installed_flat[] = $slug;
		}
	}
	$after['installed'] = $installed_flat;

	oddout_starter_save_state( $after );

	if ( ! empty( $run_errors ) ) {
		return new WP_Error(
			'installed' === $after['status'] ? 'partial_failure' : 'starter_failed',
			implode( '; ', $run_errors ),
			array(
				'state' => $after,
			)
		);
	}

	return array(
		'installed' => $after['installed'],
		'prefs_set' => $after['prefs_set'],
		'slugs'     => $after['slugs'],
		'status'    => $after['status'],
	);
}

/**
 * The actual installer. Walks the starter pack from the loaded
 * catalog, calls oddout_catalog_install_entry() for each bundle that
 * isn't already installed, and sets initial user prefs.
 *
 * Monotonic: returns per-slug results so the caller can fold them
 * into state without overwriting prior 'done' entries. A mix of
 * successes and failures is reported as a partial run, never as a
 * single aggregate error.
 *
 * The caller is expected to pass the prior monotonic `slugs` map
 * (from oddout_starter_get_state()) so retries only touch pending /
 * failed slugs — already-done slugs are not re-attempted, even when
 * the installed-on-disk detection says otherwise.
 *
 * @param array $prior_slugs Monotonic prior state: [ slug => { status, ... } ].
 * @return array {
 *   results:   array<string, { status: 'done'|'failed', error: string, attempted_at: int }>,
 *   wanted:    string[] complete starter-pack slug list,
 *   prefs_set: bool,
 *   fatal:     WP_Error|null (only when we couldn't even evaluate wanted slugs),
 * }
 */
function oddout_starter_install_now( array $prior_slugs = array() ) {
	$out = array(
		'results'   => array(),
		'wanted'    => array(),
		'prefs_set' => false,
		'fatal'     => null,
		'catalog'   => array(),
	);
	if ( ! function_exists( 'oddout_catalog_load' ) || ! function_exists( 'oddout_catalog_install_entry' ) ) {
		$out['fatal'] = new WP_Error( 'catalog_unavailable', 'Catalog module not loaded.' );
		return $out;
	}
	// Prefer any usable cached/stale/fallback catalog first. A fresh
	// remote fetch is only forced when that tier is empty or the
	// starter slugs point at rows that are not present.
	$registry = oddout_catalog_load( false );
	if ( empty( $registry['bundles'] ) ) {
		$registry = oddout_catalog_load( true );
		if ( empty( $registry['bundles'] ) ) {
			$out['fatal']   = new WP_Error( 'empty_catalog', 'Catalog returned no bundles from remote, stale, or fallback sources.' );
			$out['catalog'] = function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : array();
			return $out;
		}
	}

	$starter    = isset( $registry['starter_pack'] ) && is_array( $registry['starter_pack'] )
		? $registry['starter_pack']
		: array();
	$want_slugs = array();
	foreach ( array( 'scenes', 'iconSets', 'cursorSets', 'widgets', 'apps' ) as $group ) {
		if ( ! empty( $starter[ $group ] ) && is_array( $starter[ $group ] ) ) {
			foreach ( $starter[ $group ] as $slug ) {
				$want_slugs[] = sanitize_key( (string) $slug );
			}
		}
	}
	$want_slugs     = array_values( array_filter( array_unique( $want_slugs ) ) );
	$out['wanted']  = $want_slugs;
	$out['catalog'] = function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : array();

	if ( empty( $want_slugs ) ) {
		// No starter pack defined. Apply prefs and report success
		// with an empty slug set; oddout_starter_compute_status will
		// decide the top-level status.
		$out['prefs_set'] = oddout_starter_apply_prefs( $starter );
		return $out;
	}

	$already_installed_on_disk = oddout_bundle_catalog_installed_slugs();
	$now                       = time();
	$available_rows            = array();
	foreach ( isset( $registry['bundles'] ) && is_array( $registry['bundles'] ) ? $registry['bundles'] : array() as $row ) {
		if ( is_array( $row ) && ! empty( $row['slug'] ) ) {
			$available_rows[ sanitize_key( (string) $row['slug'] ) ] = true;
		}
	}

	if ( ! empty( $want_slugs ) && count( array_intersect( $want_slugs, array_keys( $available_rows ) ) ) < count( $want_slugs ) ) {
		$refreshed = oddout_catalog_load( true );
		if ( ! empty( $refreshed['bundles'] ) ) {
			$registry       = $refreshed;
			$out['catalog'] = function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : $out['catalog'];
		}
	}

	foreach ( $want_slugs as $slug ) {
		// Monotonic skip: prior state says we completed this slug,
		// do not re-run the install. Prevents retries from flapping
		// on a slug that actually succeeded in an earlier attempt.
		if ( isset( $prior_slugs[ $slug ]['status'] ) && 'done' === $prior_slugs[ $slug ]['status'] ) {
			$out['results'][ $slug ] = array(
				'status'       => 'done',
				'error'        => '',
				'attempted_at' => isset( $prior_slugs[ $slug ]['attempted_at'] ) ? (int) $prior_slugs[ $slug ]['attempted_at'] : $now,
			);
			continue;
		}
		// On-disk already installed — treat as done.
		if ( isset( $already_installed_on_disk[ $slug ] ) ) {
			$out['results'][ $slug ] = array(
				'status'       => 'done',
				'error'        => '',
				'attempted_at' => $now,
			);
			continue;
		}
		$row = oddout_catalog_row_for( $slug );
		if ( null === $row ) {
			$out['results'][ $slug ] = array(
				'status'       => 'failed',
				'error'        => sprintf( 'starter-pack slug %s not in registry', $slug ),
				'attempted_at' => $now,
			);
			continue;
		}
		$res = oddout_catalog_install_entry( $row );
		if ( is_wp_error( $res ) ) {
			$out['results'][ $slug ] = array(
				'status'       => 'failed',
				'error'        => $res->get_error_message(),
				'attempted_at' => $now,
			);
			continue;
		}
		$out['results'][ $slug ] = array(
			'status'       => 'done',
			'error'        => '',
			'attempted_at' => $now,
		);
	}

	$out['prefs_set'] = oddout_starter_apply_prefs( $starter );
	return $out;
}

/**
 * Apply the starter pack's default scene + icon/cursor set to every
 * existing user (so the desktop picks a wallpaper on first boot
 * without asking). Returns true if any pref was written.
 *
 * Two layers get seeded:
 *
 *   1. ODD's *inner* prefs — `oddout_wallpaper` (which scene renders
 *      inside ODD's card), `oddout_icon_set` (which Desktop Mode icon set
 *      is active), and `oddout_cursor_set` (which cursor theme is
 *      active). These are pure user meta.
 *
 *   2. WP Desktop Mode's *outer* wallpaper selection — the host
 *      plugin's `desktop_mode_os_settings.wallpaper` key, which
 *      decides which registered wallpaper card mounts at all. If
 *      that's left at the host default (`"dark"`), ODD's card never
 *      runs and the user sees the host's built-in gradient instead
 *      of whatever ODD installed. Point it at `"odd"` so our
 *      wallpaper engine actually gets a chance to paint. We only do
 *      this for users who haven't already picked something else
 *      explicitly, so people who set e.g. `"image"` or a third-party
 *      wallpaper aren't silently switched.
 *
 * We write at the user-meta level so individual users can still pick
 * something else later; this just seeds the initial state.
 */
function oddout_starter_apply_prefs( array $starter ) {
	$default_scene   = ! empty( $starter['scenes'] ) ? sanitize_key( (string) $starter['scenes'][0] ) : '';
	$default_iconset = ! empty( $starter['iconSets'] ) ? sanitize_key( (string) $starter['iconSets'][0] ) : '';
	$default_cursor  = ! empty( $starter['cursorSets'] ) ? sanitize_key( (string) $starter['cursorSets'][0] ) : '';
	if ( '' === $default_scene && '' === $default_iconset && '' === $default_cursor ) {
		return false;
	}

	$wrote = false;
	$users = get_users(
		array(
			'fields' => array( 'ID' ),
			'number' => 500,
		)
	);
	foreach ( $users as $u ) {
		$uid = (int) $u->ID;
		if ( '' !== $default_scene ) {
			$current = get_user_meta( $uid, 'oddout_wallpaper', true );
			if ( '' === $current ) {
				update_user_meta( $uid, 'oddout_wallpaper', $default_scene );
				$wrote = true;
			}
			if ( oddout_starter_seed_host_wallpaper( $uid ) ) {
				$wrote = true;
			}
		}
		if ( '' !== $default_iconset ) {
			$current = get_user_meta( $uid, 'oddout_icon_set', true );
			if ( '' === $current ) {
				update_user_meta( $uid, 'oddout_icon_set', $default_iconset );
				$wrote = true;
			}
		}
		if ( '' !== $default_cursor ) {
			$current = get_user_meta( $uid, 'oddout_cursor_set', true );
			if ( '' === $current ) {
				update_user_meta( $uid, 'oddout_cursor_set', $default_cursor );
				$wrote = true;
			}
		}
	}
	return $wrote;
}

function oddout_starter_host_settings_meta_key() {
	if ( defined( 'DESKTOP_MODE_OS_SETTINGS_META_KEY' ) ) {
		return DESKTOP_MODE_OS_SETTINGS_META_KEY;
	}
	if ( defined( 'WPDM_OS_SETTINGS_META_KEY' ) ) {
		return WPDM_OS_SETTINGS_META_KEY;
	}
	return 'desktop_mode_os_settings';
}

function oddout_starter_host_default_settings() {
	if ( function_exists( 'desktop_mode_default_os_settings' ) ) {
		$defaults = desktop_mode_default_os_settings();
		return is_array( $defaults ) ? $defaults : null;
	}
	if ( function_exists( 'wpdm_default_os_settings' ) ) {
		$defaults = wpdm_default_os_settings();
		return is_array( $defaults ) ? $defaults : null;
	}
	return null;
}

function oddout_starter_host_default_wallpaper() {
	$defaults = oddout_starter_host_default_settings();
	if ( is_array( $defaults ) ) {
		return isset( $defaults['wallpaper'] ) ? sanitize_key( (string) $defaults['wallpaper'] ) : 'dark';
	}
	return 'dark';
}

function oddout_starter_get_host_settings_for_user( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return null;
	}
	if ( function_exists( 'desktop_mode_get_os_settings' ) ) {
		return desktop_mode_get_os_settings( $user_id );
	}
	if ( function_exists( 'wpdm_get_os_settings' ) ) {
		return wpdm_get_os_settings( $user_id );
	}
	$settings = get_user_meta( $user_id, oddout_starter_host_settings_meta_key(), true );
	return is_array( $settings ) ? $settings : null;
}

function oddout_starter_save_host_settings_for_user( $user_id, array $settings ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	if ( function_exists( 'desktop_mode_save_os_settings' ) ) {
		return (bool) desktop_mode_save_os_settings( $user_id, $settings );
	}
	if ( function_exists( 'wpdm_save_os_settings' ) ) {
		return (bool) wpdm_save_os_settings( $user_id, $settings );
	}
	return (bool) update_user_meta( $user_id, oddout_starter_host_settings_meta_key(), $settings );
}

function oddout_starter_host_os_settings_available() {
	$desktop_mode_api = function_exists( 'desktop_mode_get_os_settings' )
		&& function_exists( 'desktop_mode_save_os_settings' )
		&& function_exists( 'desktop_mode_default_os_settings' );
	$wpdm_api         = function_exists( 'wpdm_get_os_settings' )
		&& function_exists( 'wpdm_save_os_settings' )
		&& function_exists( 'wpdm_default_os_settings' );
	return $desktop_mode_api || $wpdm_api;
}

function oddout_starter_host_wallpaper_registration_available() {
	return function_exists( 'desktop_mode_register_wallpaper' ) || function_exists( 'wp_register_desktop_wallpaper' );
}

function oddout_starter_host_dock_is_large( array $settings ) {
	return isset( $settings['dockSize'] ) && 'large' === (string) $settings['dockSize'];
}

function oddout_starter_with_odd_wallpaper_and_large_dock( array $settings ) {
	$settings['wallpaper'] = 'odd';
	$settings['dockSize']  = 'large';
	return $settings;
}

function oddout_desktop_mode_large_dock_when_odd_active( $config ) {
	if ( ! is_array( $config ) || empty( $config['osSettings'] ) || ! is_array( $config['osSettings'] ) ) {
		return $config;
	}
	$wallpaper = isset( $config['osSettings']['wallpaper'] ) ? (string) $config['osSettings']['wallpaper'] : '';
	if ( 'odd' === $wallpaper ) {
		$config['osSettings']['dockSize'] = 'large';
	}
	return $config;
}
add_filter( 'desktop_mode_shell_config', 'oddout_desktop_mode_large_dock_when_odd_active', 20 );
add_filter( 'wp_desktop_shell_config', 'oddout_desktop_mode_large_dock_when_odd_active', 20 );

/**
 * Point WP Desktop Mode's outer wallpaper selection at `"odd"` for a
 * single user — but only if they haven't picked something non-default
 * already.
 *
 * Desktop Mode stores its settings as a single JSON-ish array in user
 * meta. Its sanitizer rebuilds the entire shape on write, so we can't
 * just merge — we read the current full shape through Desktop Mode's OS
 * settings helper, flip `wallpaper`, set `dockSize` to `large`, and hand
 * the complete array back. That preserves accent / AI settings / etc.
 *
 * Returns true when a write occurred, false otherwise (already seeded,
 * user picked something else, or host plugin not loaded yet).
 *
 * @param int $user_id
 * @return bool
 */
function oddout_starter_seed_host_wallpaper( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	if ( ! oddout_starter_host_os_settings_available() || ! oddout_starter_host_wallpaper_registration_available() ) {
		return false;
	}

	$current = oddout_starter_get_host_settings_for_user( $user_id );
	if ( ! is_array( $current ) ) {
		return false;
	}

	$current_wallpaper = isset( $current['wallpaper'] ) ? (string) $current['wallpaper'] : '';
	$default_wallpaper = oddout_starter_host_default_wallpaper();

	if ( 'odd' === $current_wallpaper ) {
		if ( oddout_starter_host_dock_is_large( $current ) ) {
			return false;
		}
		$next             = $current;
		$next['dockSize'] = 'large';
		return oddout_starter_save_host_settings_for_user( $user_id, $next );
	}
	// User (or another plugin) picked something other than the host
	// default. Respect that choice; don't silently switch them.
	if ( '' !== $current_wallpaper && $current_wallpaper !== $default_wallpaper ) {
		return false;
	}

	return oddout_starter_save_host_settings_for_user(
		$user_id,
		oddout_starter_with_odd_wallpaper_and_large_dock( $current )
	);
}

/**
 * Select the ODD canvas wallpaper in WP Desktop Mode so the scene engine mounts.
 *
 * Used when the user picks an ODD scene via REST — unlike
 * oddout_starter_seed_host_wallpaper() this always targets `"odd"` whenever
 * host APIs exist, so users who left the shell on `"dark"` still get a
 * working canvas after choosing a scene in the Shop.
 *
 * @param int $user_id User ID.
 * @return bool Whether a write occurred.
 */
function oddout_wallpaper_ensure_host_engine_selected( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	if ( ! oddout_starter_host_os_settings_available() || ! oddout_starter_host_wallpaper_registration_available() ) {
		return false;
	}

	$current = oddout_starter_get_host_settings_for_user( $user_id );
	if ( ! is_array( $current ) ) {
		$current = oddout_starter_host_default_settings();
	}
	if ( ! is_array( $current ) ) {
		return false;
	}

	$current_wallpaper = isset( $current['wallpaper'] ) ? (string) $current['wallpaper'] : '';
	if ( 'odd' === $current_wallpaper && oddout_starter_host_dock_is_large( $current ) ) {
		return false;
	}

	return oddout_starter_save_host_settings_for_user(
		$user_id,
		oddout_starter_with_odd_wallpaper_and_large_dock( $current )
	);
}

function oddout_starter_get_state_for_rest() {
	$state    = oddout_starter_get_state();
	$registry = function_exists( 'oddout_catalog_load' ) ? oddout_catalog_load( false ) : array();
	$meta     = function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : array();
	$starter  = isset( $registry['starter_pack'] ) && is_array( $registry['starter_pack'] ) ? $registry['starter_pack'] : array();
	$rows     = array();
	foreach ( isset( $registry['bundles'] ) && is_array( $registry['bundles'] ) ? $registry['bundles'] : array() as $row ) {
		if ( is_array( $row ) && ! empty( $row['slug'] ) ) {
			$rows[ sanitize_key( (string) $row['slug'] ) ] = $row;
		}
	}
	$next = array();
	foreach ( array( 'scenes', 'iconSets', 'widgets', 'apps' ) as $group ) {
		foreach ( isset( $starter[ $group ] ) && is_array( $starter[ $group ] ) ? $starter[ $group ] : array() as $slug ) {
			$slug = sanitize_key( (string) $slug );
			if ( '' === $slug ) {
				continue;
			}
			$current       = isset( $state['slugs'][ $slug ]['status'] ) ? (string) $state['slugs'][ $slug ]['status'] : 'pending';
			$next[ $slug ] = array(
				'group'  => $group,
				'status' => $current,
				'action' => 'done' === $current ? 'none' : ( isset( $rows[ $slug ] ) ? 'install' : 'missing_from_catalog' ),
			);
		}
	}
	$state['catalog']      = array(
		'source'       => isset( $meta['source'] ) ? $meta['source'] : '',
		'bundle_count' => isset( $meta['bundle_count'] ) ? (int) $meta['bundle_count'] : 0,
		'last_error'   => isset( $meta['last_error_message'] ) ? $meta['last_error_message'] : '',
	);
	$state['next_actions'] = $next;
	return $state;
}

/**
 * Safety net: on every request, if the starter pack isn't installed
 * yet and the caller is privileged, run the installer inline.
 *
 * We attach to `init` (rather than `admin_init`) because WP Desktop
 * Mode users typically land on the frontend and never visit wp-admin.
 * Privilege check (`activate_plugins` / `manage_options`) keeps
 * anonymous frontend traffic from triggering network I/O. Backoff is
 * enforced by `oddout_starter_ensure_installed()` so a chronically
 * failing catalog doesn't run on every request.
 */
function oddout_starter_safety_net() {
	if ( ( defined( 'DOING_CRON' ) && DOING_CRON ) || ( defined( 'WP_INSTALLING' ) && WP_INSTALLING ) ) {
		return;
	}
	$state = oddout_starter_get_state();
	if ( 'installed' === $state['status'] ) {
		return;
	}
	if ( ! is_user_logged_in() ) {
		return;
	}
	if ( ! current_user_can( 'activate_plugins' ) && ! current_user_can( 'manage_options' ) ) {
		return;
	}
	oddout_starter_ensure_installed( false );
}
add_action( 'init', 'oddout_starter_safety_net', 20 );

/**
 * REST: GET the current starter-pack state so the Shop can render
 * progress; POST to force a retry right now.
 */
add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'odd/v1',
			'/starter',
			array(
				'methods'             => 'GET',
				'callback'            => function () {
					return rest_ensure_response( oddout_starter_get_state_for_rest() );
				},
				'permission_callback' => function () {
					return current_user_can( 'read' );
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/starter/retry',
			array(
				'methods'             => 'POST',
				'callback'            => function () {
					$rl = function_exists( 'oddout_bundle_rate_limit_check' ) ? oddout_bundle_rate_limit_check( 'starter_retry' ) : true;
					if ( is_wp_error( $rl ) ) {
						return $rl;
					}
					$result = oddout_starter_ensure_installed( true );
					$state  = oddout_starter_get_state();
					if ( is_wp_error( $result ) ) {
						return new WP_Error(
							'starter_failed',
							$result->get_error_message(),
							array(
								'status' => 502,
								'state'  => $state,
							)
						);
					}
					return rest_ensure_response( $state );
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	},
	5
);
