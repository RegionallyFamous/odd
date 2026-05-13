<?php
/**
 * ODD cursors — stylesheet injection for Desktop Mode and wp-admin.
 */

defined( 'ABSPATH' ) || exit;

function oddout_cursors_should_enqueue_admin() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return false;
	}
	return '' !== oddout_cursors_get_active_slug();
}

function oddout_cursors_enqueue_admin_stylesheet() {
	if ( ! oddout_cursors_should_enqueue_admin() ) {
		return;
	}
	$slug = oddout_cursors_get_active_slug();
	wp_enqueue_style(
		'odd-cursors',
		oddout_cursors_active_stylesheet_url( $slug ),
		array(),
		( defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0' ) . '-' . $slug
	);
}
add_action( 'admin_enqueue_scripts', 'oddout_cursors_enqueue_admin_stylesheet', 1 );

function oddout_cursors_enqueue_runtime() {
	if ( ! oddout_cursors_should_enqueue_admin() ) {
		return;
	}
	wp_enqueue_script(
		'odd-cursors',
		ODDOUT_URL . '/src/cursors/index.js',
		array( 'wp-hooks', 'odd-store', 'odd-events', 'odd-debug' ),
		defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0',
		true
	);
}
add_action( 'admin_enqueue_scripts', 'oddout_cursors_enqueue_runtime', 20 );

add_filter(
	'desktop_mode_shell_config',
	function ( $config ) {
		$slug = oddout_cursors_get_active_slug();
		if ( '' === $slug || ! is_array( $config ) ) {
			return $config;
		}
		$contract                       = oddout_cursors_shell_contract( $slug );
		$config['oddCursorSet']         = $slug;
		$config['oddCursorStylesheet']  = $contract['stylesheet'];
		$config['oddCursorStylesheetV'] = $contract['version'];
		$config['oddCursor']            = $contract;
		return $config;
	},
	20
);
