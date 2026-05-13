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
 *     - oddout_apps_index                 installed app catalog
 *     - oddout_scenes_index               installed scene catalog (.wp-installed)
 *     - oddout_iconsets_index             installed icon-set catalog (.wp-installed)
 *     - oddout_widgets_index              installed widget catalog (.wp-installed)
 *     - oddout_apps_shared_secret         signed-URL shared secret
 *     - oddout_starter_state              starter-pack runner state
 *     - oddout_app_{slug}                 one row per installed app
 *     - oddout_scene_{slug} / oddout_icon_set_{slug} / oddout_widget_{slug}
 *                                      one row per installed bundle
 *                                      of each universal-.wp type
 *
 *   Site transients
 *     - _transient_oddout_icon_registry_v{version}    icon registry cache
 *     - _transient_oddout_catalog                     remote catalog cache
 *     - timeout rows for the above
 *
 *   User meta (all users)
 *     - oddout_schema_version
 *     - any key starting with `oddout_` (wallpaper, icon_set, favorites,
 *       recents, shuffle, screensaver, audio_reactive, apps_pinned,
 *       initiated, mascot_quiet, wink_unlocked, …)
 *
 * WHAT DOESN'T GET REMOVED
 *
 *   - uploads/odd/apps/            user-installed app bundles.
 *   - uploads/odd/scenes/          user-installed scene bundles.
 *   - uploads/odd/icon-sets/       user-installed icon-set bundles.
 *   - uploads/odd/widgets/         user-installed widget bundles.
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
$oddout_known_options = array(
	'oddout_apps_index',
	'oddout_scenes_index',
	'oddout_iconsets_index',
	'oddout_widgets_index',
	'oddout_apps_shared_secret',
	'oddout_starter_state',
);
foreach ( $oddout_known_options as $oddout_option ) {
	delete_option( $oddout_option );
}

// Per-bundle option rows across all universal .wp types. A direct
// LIKE query is the only way to sweep them without knowing the slug
// set after the per-type index rows are already gone. Scoped to the
// four prefixes so we don't clobber unrelated options like
// `oddout_apps_shared_secret` (already deleted above).
$oddout_bundle_option_prefixes = array(
	'oddout_app_',
	'oddout_scene_',
	'oddout_icon_set_',
	'oddout_widget_',
);
foreach ( $oddout_bundle_option_prefixes as $oddout_prefix ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall must discover dynamic per-bundle option names.
	$oddout_rows = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( $oddout_prefix ) . '%'
		)
	);
	if ( is_array( $oddout_rows ) ) {
		foreach ( $oddout_rows as $oddout_row ) {
			delete_option( $oddout_row );
		}
	}
}

// Transients. The icon-registry transient is keyed by ODDOUT_VERSION
// which we don't have at uninstall time, so match the family.
$oddout_transient_prefixes = array(
	'_transient_oddout_',
	'_transient_timeout_oddout_',
);
foreach ( $oddout_transient_prefixes as $oddout_prefix ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall must discover versioned transient names.
	$oddout_rows = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( $oddout_prefix ) . '%'
		)
	);
	if ( is_array( $oddout_rows ) ) {
		foreach ( $oddout_rows as $oddout_row ) {
			delete_option( $oddout_row );
		}
	}
}

// User meta sweep. One LIKE scan to capture every oddout_* key; a
// second explicit delete for the schema version which doesn't fit
// the prefix pattern cleanly (different naming, but oddout_ prefix —
// so actually covered, but we keep the explicit pass for safety
// if the prefix rule ever changes).
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall removes all ODD-owned user meta in one sweep.
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->usermeta} WHERE meta_key LIKE %s",
		$wpdb->esc_like( 'oddout_' ) . '%'
	)
);
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- explicit schema-version cleanup for uninstall completeness.
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->usermeta} WHERE meta_key = %s",
		'oddout_schema_version'
	)
);

// Clear object cache so the next request doesn't resurrect
// freshly-deleted values from in-process memoization.
wp_cache_flush();
