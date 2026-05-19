<?php
/**
 * ODD admin-bar preference.
 *
 * WordPress exposes a core `show_admin_bar` filter for front-end toolbar
 * visibility, but wp-admin always renders the toolbar. ODD keeps the user
 * preference in its own meta key, uses the core filter where it applies, and
 * only removes wp-admin toolbar space on Desktop Mode portal requests.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current request is the Desktop Mode portal shell.
 *
 * @return bool
 */
function oddout_is_desktop_mode_portal_request() {
	if ( ! is_admin() ) {
		return false;
	}
	return isset( $_GET['desktop_mode_portal'] ) && rest_sanitize_boolean( wp_unslash( $_GET['desktop_mode_portal'] ) );
}

/**
 * Default admin-bar visibility preference.
 *
 * ODD is a Desktop Mode-first experience, so new users get the clean top edge
 * by default. An explicit saved `0` always wins when a user restores the bar.
 *
 * @return bool
 */
function oddout_admin_bar_hidden_default() {
	return (bool) apply_filters( 'oddout_admin_bar_hidden_default', true );
}

/**
 * Per-user ODD preference for hiding the WordPress admin bar.
 *
 * @param int $uid User ID. Defaults to current user.
 * @return bool
 */
function oddout_admin_bar_hidden( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if ( $uid <= 0 ) {
		return false;
	}
	$raw = get_user_meta( $uid, 'oddout_admin_bar_hidden', true );
	if ( '' === $raw ) {
		return oddout_admin_bar_hidden_default();
	}
	return '1' === (string) $raw;
}

/**
 * Persist the admin-bar preference.
 *
 * @param int  $uid    User ID.
 * @param bool $hidden True to hide the admin bar for ODD contexts.
 * @return bool Stored value.
 */
function oddout_set_admin_bar_hidden( $uid, $hidden ) {
	$uid = (int) $uid;
	if ( $uid <= 0 ) {
		return false;
	}
	update_user_meta( $uid, 'oddout_admin_bar_hidden', $hidden ? 1 : 0 );
	return oddout_admin_bar_hidden( $uid );
}

/**
 * Whether this request should render without the WordPress toolbar.
 *
 * Keep classic wp-admin untouched. The wp-admin toolbar is only suppressed in
 * the Desktop Mode portal, where Desktop Mode already provides the primary
 * chrome. Front-end admin-bar visibility can use the native core filter.
 *
 * @param int $uid User ID. Defaults to current user.
 * @return bool
 */
function oddout_should_hide_admin_bar_for_request( $uid = 0 ) {
	if ( ! oddout_admin_bar_hidden( $uid ) ) {
		return false;
	}
	return ! is_admin() || oddout_is_desktop_mode_portal_request();
}

/**
 * Hide the front-end admin bar through WordPress' native filter.
 *
 * @param bool $show Existing value.
 * @return bool
 */
function oddout_filter_show_admin_bar( $show ) {
	return oddout_should_hide_admin_bar_for_request() ? false : $show;
}
add_filter( 'show_admin_bar', 'oddout_filter_show_admin_bar', 20 );

/**
 * Remove the wp-admin toolbar and its reserved top padding in Desktop Mode.
 *
 * @return void
 */
function oddout_print_admin_bar_hidden_css() {
	if ( ! oddout_should_hide_admin_bar_for_request() ) {
		return;
	}

	$css = '#wpadminbar{display:none!important}html.wp-toolbar{padding-top:0!important}body.admin-bar{padding-top:0!important}';
	printf( '<style id="oddout-admin-bar-hidden">%s</style>', esc_html( $css ) );
}
add_action( 'admin_head', 'oddout_print_admin_bar_hidden_css', 1 );
add_action( 'wp_head', 'oddout_print_admin_bar_hidden_css', 1 );
