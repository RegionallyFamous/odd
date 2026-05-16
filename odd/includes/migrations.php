<?php
/**
 * ODD — current v1 setup marker.
 *
 * Public v1 does not preserve pre-release user migrations. This file keeps a
 * tiny schema marker for diagnostics and future setup checks without carrying
 * the old append-only migration runner or placeholder steps.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_SCHEMA_VERSION' ) ) {
	define( 'ODDOUT_SCHEMA_VERSION', 1 );
}

function oddout_mark_current_schema( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	if ( $user_id <= 0 ) {
		return;
	}

	$current = (int) get_user_meta( $user_id, 'oddout_schema_version', true );
	if ( $current < (int) ODDOUT_SCHEMA_VERSION ) {
		update_user_meta( $user_id, 'oddout_schema_version', (int) ODDOUT_SCHEMA_VERSION );
	}

	if ( function_exists( 'oddout_apps_ensure_storage' ) ) {
		oddout_apps_ensure_storage();
	}
}

add_action(
	'admin_init',
	function () {
		if ( current_user_can( 'read' ) ) {
			oddout_mark_current_schema();
		}
	},
	5
);
