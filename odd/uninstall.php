<?php
/**
 * Remove ODD-owned database state when WordPress deletes the plugin.
 *
 * Installed app files under uploads/odd/apps are user content and remain on
 * disk. A later reinstall can discover or deliberately remove those files.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

// Remove current and previously created ODD options, including dynamic app
// manifests, install locks, catalog mirrors, and transient timeout rows.
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall must discover dynamic ODD-owned option names.
$oddout_option_names = $wpdb->get_col(
	$wpdb->prepare(
		"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s",
		$wpdb->esc_like( 'oddout_' ) . '%',
		$wpdb->esc_like( '_transient_oddout_' ) . '%',
		$wpdb->esc_like( '_transient_timeout_oddout_' ) . '%'
	)
);
if ( is_array( $oddout_option_names ) ) {
	foreach ( $oddout_option_names as $oddout_option_name ) {
		delete_option( $oddout_option_name );
	}
}

// Remove every ODD-owned per-user preference in one bounded query.
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall removes all ODD-owned user meta.
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->usermeta} WHERE meta_key LIKE %s",
		$wpdb->esc_like( 'oddout_' ) . '%'
	)
);

wp_cache_flush();
