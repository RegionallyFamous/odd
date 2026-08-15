<?php
/**
 * ODD Notes — WordPress-backed storage and native-window support.
 */

defined( 'ABSPATH' ) || exit;

require_once ODDOUT_DIR . 'includes/notes/class-notes-service.php';
require_once ODDOUT_DIR . 'includes/notes/class-notes-rest-controller.php';
require_once ODDOUT_DIR . 'includes/notes/template.php';

/**
 * Canonical ODD Notes app slug.
 *
 * @return string
 */
function oddout_notes_slug() {
	return 'odd-notes';
}

/**
 * Canonical OpenStation window/icon id.
 *
 * @return string
 */
function oddout_notes_window_id() {
	return 'odd-app-' . oddout_notes_slug();
}

/**
 * Whether ODD Notes is installed and enabled.
 *
 * @return bool
 */
function oddout_notes_enabled() {
	if ( ! function_exists( 'oddout_apps_index_load' ) ) {
		return false;
	}
	$index = oddout_apps_index_load();
	$slug  = oddout_notes_slug();
	return isset( $index[ $slug ] ) && ! empty( $index[ $slug ]['enabled'] );
}

/**
 * Session-bound config delivered through OpenStation's window config API.
 *
 * @return array
 */
function oddout_notes_window_config() {
	$colors = function_exists( 'openstation_notes_colors' )
		? openstation_notes_colors()
		: array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' );

	return array(
		'restBase'  => esc_url_raw( oddout_https_rest_url( 'odd-notes/v1/' ) ),
		'restNonce' => wp_create_nonce( 'wp_rest' ),
		'userId'    => get_current_user_id(),
		'colors'    => array_values( array_map( 'sanitize_key', (array) $colors ) ),
	);
}

$oddout_notes_service = new ODDOUT_Notes_Service();
$oddout_notes_service->boot();
( new ODDOUT_Notes_REST_Controller( $oddout_notes_service ) )->boot();
