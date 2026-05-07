<?php
/**
 * ODD — uninstall handler.
 *
 * WordPress runs this file when the site admin deletes the plugin from
 * the Plugins screen (not on simple deactivation). It's our one chance
 * to scrub the database so a reinstall starts clean rather than
 * inheriting stale option rows or user_meta from the previous tenant.
 *
 * WHAT GETS REMOVED
 *
 *   Site options
 *     - odd_apps_index                 installed app catalog
 *     - odd_scenes_index               installed scene catalog (.wp-installed)
 *     - odd_icon_sets_index            installed icon-set catalog (.wp-installed)
 *     - odd_widgets_index              installed widget catalog (.wp-installed)
 *     - odd_apps_shared_secret         signed-URL shared secret
 *     - odd_starter_state              starter-pack runner state
 *     - odd_app_{slug}                 one row per installed app
 *     - odd_scene_{slug} / odd_icon_set_{slug} / odd_widget_{slug}
 *                                      one row per installed bundle
 *                                      of each universal-.wp type
 *
 *   Site transients
 *     - _transient_odd_icon_registry_v{version}    icon registry cache
 *     - _transient_odd_catalog                     remote catalog cache
 *     - timeout rows for the above
 *
 *   User meta (all users)
 *     - odd_schema_version
 *     - any key starting with `odd_` (wallpaper, icon_set, favorites,
 *       recents, shuffle, screensaver, audio_reactive, apps_pinned,
 *       initiated, mascot_quiet, wink_unlocked, …)
 *
 * WHAT DOESN'T GET REMOVED
 *
 *   - wp-content/odd-apps/         user-installed app bundles.
 *   - wp-content/odd-scenes/       user-installed scene bundles.
 *   - wp-content/odd-icon-sets/    user-installed icon-set bundles.
 *   - wp-content/odd-widgets/      user-installed widget bundles.
 *
 *     All four content directories are deliberately preserved so
 *     admins can keep their bundles around to reinstall later.
 *     Deletion on uninstall would be surprising. Clean up by hand
 *     if desired.
 *
 *   - Third-party plugin data (`b-roll` legacy keys, unrelated `*_index`
 *     options). Those plugins own their own lifecycle.
 *
 * When a new bundle type is added to odd/includes/content/,
 * extend both the options list above AND the content directory
 * list — the former ensures the database row gets swept, the
 * latter documents the "we leave user files alone" policy so a
 * future refactor doesn't silently start scrubbing them.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

// Known site-level option rows. All are autoload=no in production
// (see odd/includes/apps/storage.php) but delete_option handles both states.
$odd_known_options = array(
	'odd_apps_index',
	'odd_scenes_index',
	'odd_icon_sets_index',
	'odd_widgets_index',
	'odd_apps_shared_secret',
	'odd_starter_state',
);
foreach ( $odd_known_options as $opt ) {
	delete_option( $opt );
}

// Per-bundle option rows across all universal .wp types. A direct
// LIKE query is the only way to sweep them without knowing the slug
// set after the per-type index rows are already gone. Scoped to the
// four prefixes so we don't clobber unrelated options like
// `odd_apps_shared_secret` (already deleted above).
$bundle_option_prefixes = array(
	'odd_app_',
	'odd_scene_',
	'odd_icon_set_',
	'odd_widget_',
);
foreach ( $bundle_option_prefixes as $prefix ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall must discover dynamic per-bundle option names.
	$rows = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( $prefix ) . '%'
		)
	);
	if ( is_array( $rows ) ) {
		foreach ( $rows as $row ) {
			delete_option( $row );
		}
	}
}

// Transients. The icon-registry transient is keyed by ODD_VERSION
// which we don't have at uninstall time, so match the family.
$transient_prefixes = array(
	'_transient_odd_',
	'_transient_timeout_odd_',
);
foreach ( $transient_prefixes as $prefix ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall must discover versioned transient names.
	$rows = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( $prefix ) . '%'
		)
	);
	if ( is_array( $rows ) ) {
		foreach ( $rows as $row ) {
			delete_option( $row );
		}
	}
}

// User meta sweep. One LIKE scan to capture every odd_* key; a
// second explicit delete for the schema version which doesn't fit
// the prefix pattern cleanly (different naming, but odd_ prefix —
// so actually covered, but we keep the explicit pass for safety
// if the prefix rule ever changes).
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall removes all ODD-owned user meta in one sweep.
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->usermeta} WHERE meta_key LIKE %s",
		$wpdb->esc_like( 'odd_' ) . '%'
	)
);
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- explicit schema-version cleanup for uninstall completeness.
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->usermeta} WHERE meta_key = %s",
		'odd_schema_version'
	)
);

// Clear object cache so the next request doesn't resurrect
// freshly-deleted values from in-process memoization.
wp_cache_flush();
