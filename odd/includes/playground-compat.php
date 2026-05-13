<?php
/**
 * WordPress Playground (origin playground.wordpress.net) registers its own
 * service worker. Desktop Mode’s PWA bootstrap also injects a manifest link,
 * probes existing registrations, and would register /desktop-mode/sw.js when no
 * other SW is present — a poor fit beside Playground’s worker and noisy in
 * DevTools (“event handler … initial evaluation”, manifest 404, mixed paths).
 *
 * Quiet that path only on Playground hosts; normal installs unchanged.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Drops Desktop Mode manifest tags on admin screens.
 */
function oddout_playground_compat_remove_dm_pwa_head_tags() {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_pwa_render_head_tags' ) ) {
		remove_action( 'admin_head', 'desktop_mode_pwa_render_head_tags', 1 );
	}
}
add_action( 'plugins_loaded', 'oddout_playground_compat_remove_dm_pwa_head_tags', 30 );

add_filter(
	'desktop_mode_shell_config',
	static function ( $config ) {
		if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() || ! is_array( $config ) ) {
			return $config;
		}
		if ( isset( $config['pwa'] ) && is_array( $config['pwa'] ) ) {
			$config['pwa']['manifestUrl'] = '';
			$config['pwa']['swUrl']       = '';
		}
		return $config;
	},
	50
);
