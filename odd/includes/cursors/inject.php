<?php
/**
 * ODD cursors — stylesheet injection for the Desktop Mode portal only.
 */

defined( 'ABSPATH' ) || exit;

function oddout_cursors_is_desktop_mode_portal_request() {
	if ( function_exists( 'oddout_is_desktop_mode_portal_request' ) ) {
		return oddout_is_desktop_mode_portal_request();
	}
	if ( ! is_admin() ) {
		return false;
	}
	return isset( $_GET['desktop_mode_portal'] ) && rest_sanitize_boolean( wp_unslash( $_GET['desktop_mode_portal'] ) );
}

function oddout_cursors_is_desktop_mode_runtime_request() {
	return function_exists( 'oddout_desktop_mode_available' ) &&
		oddout_desktop_mode_available() &&
		oddout_cursors_is_desktop_mode_portal_request();
}

function oddout_cursors_should_enqueue_admin() {
	if ( ! is_admin() || ! current_user_can( 'read' ) ) {
		return false;
	}
	if ( ! oddout_cursors_is_desktop_mode_runtime_request() ) {
		return false;
	}
	return '' !== oddout_cursors_get_active_slug();
}

function oddout_cursors_should_enqueue_runtime() {
	return is_admin() && current_user_can( 'read' ) && oddout_cursors_is_desktop_mode_runtime_request();
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
add_action( 'admin_enqueue_scripts', 'oddout_cursors_enqueue_admin_stylesheet', 1000 );

function oddout_cursors_enqueue_runtime() {
	if ( ! oddout_cursors_should_enqueue_runtime() ) {
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
