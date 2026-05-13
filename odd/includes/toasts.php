<?php
/**
 * ODD — custom toast tone for scene / icon swap announcements.
 *
 * Registers an `odd-muse` tone on `desktop_mode_toast_types`. ODD's
 * shared client API routes announcements through Desktop Mode v0.6's
 * `wp.desktop.showToast()` API and keeps this tone id in the payload
 * metadata so host-side toast policy can identify ODD messages.
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'desktop_mode_toast_types',
	function ( $types ) {
		if ( ! is_array( $types ) ) {
			$types = array();
		}
		$types[] = array(
			'id'    => 'odd-muse',
			'label' => __( 'ODD', 'odd-outlandish-desktop-decorator' ),
			'icon'  => 'dashicons-art',
			'tone'  => 'neutral',
		);
		return $types;
	}
);
