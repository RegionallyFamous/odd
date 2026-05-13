<?php
/**
 * ODD — installed content reconciliation.
 */

defined( 'ABSPATH' ) || exit;

function oddout_reconcile_app_asset_refs( $slug, array $manifest ) {
	$slug  = sanitize_key( (string) $slug );
	$entry = isset( $manifest['entry'] ) && $manifest['entry'] ? (string) $manifest['entry'] : 'index.html';
	$base  = function_exists( 'oddout_apps_dir_for' ) ? oddout_apps_dir_for( $slug ) : '';
	$file  = $base ? realpath( $base . $entry ) : false;
	$refs  = array();
	if ( ! $file || ! is_readable( $file ) ) {
		return $refs;
	}
	$html = file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( ! is_string( $html ) || '' === $html ) {
		return $refs;
	}
	if ( preg_match_all( '#(?:src|href)=["\']([^"\']+)["\']#', $html, $matches ) ) {
		foreach ( array_unique( $matches[1] ) as $ref ) {
			if ( preg_match( '~^(?:https?:|data:|/|#)~', $ref ) ) {
				continue;
			}
			$clean = ltrim( preg_replace( '~[?#].*$~', '', $ref ), './' );
			if ( '' === $clean ) {
				continue;
			}
			$refs[] = array(
				'ref'    => $ref,
				'exists' => is_file( $base . $clean ),
			);
		}
	}
	return $refs;
}

function oddout_reconcile_installed_content() {
	$report = array(
		'catalog' => function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : array(),
		'apps'    => array(),
	);
	if ( ! function_exists( 'oddout_apps_index_load' ) ) {
		return $report;
	}
	$index = oddout_apps_index_load();
	foreach ( $index as $slug => $row ) {
		$slug             = sanitize_key( (string) $slug );
		$manifest         = function_exists( 'oddout_apps_manifest_load' ) ? oddout_apps_manifest_load( $slug ) : array();
		$base             = function_exists( 'oddout_apps_dir_for' ) ? oddout_apps_dir_for( $slug ) : '';
		$real             = $base ? realpath( $base ) : false;
		$entry            = isset( $manifest['entry'] ) && $manifest['entry'] ? (string) $manifest['entry'] : 'index.html';
		$refs             = oddout_reconcile_app_asset_refs( $slug, is_array( $manifest ) ? $manifest : array() );
		$missing          = array_values(
			array_filter(
				$refs,
				static function ( $ref ) {
					return empty( $ref['exists'] );
				}
			)
		);
		$catalog_row      = function_exists( 'oddout_apps_catalog_app_row' ) ? oddout_apps_catalog_app_row( $slug ) : null;
		$report['apps'][] = array(
			'slug'             => $slug,
			'installed'        => true,
			'enabled'          => ! empty( $row['enabled'] ),
			'catalog_owned'    => is_array( $catalog_row ),
			'repairable'       => is_array( $catalog_row ) && ! empty( $catalog_row['sha256'] ),
			'directory_exists' => (bool) $real,
			'manifest_exists'  => ! empty( $manifest ),
			'entry_exists'     => $base && is_file( $base . $entry ),
			'missing_assets'   => $missing,
			'icon'             => function_exists( 'oddout_apps_manifest_icon_health' ) ? oddout_apps_manifest_icon_health( $slug, $manifest ) : array(),
			'last_repair'      => function_exists( 'oddout_apps_repair_meta_for' ) ? oddout_apps_repair_meta_for( $slug ) : array(),
		);
	}
	return $report;
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'odd/v1',
			'/bundles/reconcile',
			array(
				'methods'             => 'GET',
				'callback'            => function () {
					return rest_ensure_response( oddout_reconcile_installed_content() );
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/bundles/repair-app',
			array(
				'methods'             => 'POST',
				'callback'            => function ( WP_REST_Request $req ) {
					$slug = sanitize_key( (string) $req->get_param( 'slug' ) );
					if ( '' === $slug || ! function_exists( 'oddout_apps_repair_from_catalog' ) ) {
						return new WP_Error( 'repair_unavailable', __( 'App repair is unavailable.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 400 ) );
					}
					$result = oddout_apps_repair_from_catalog( $slug, 'manual_repair' );
					if ( is_wp_error( $result ) ) {
						$data           = $result->get_error_data();
						$data           = is_array( $data ) ? $data : array();
						$data['status'] = isset( $data['status'] ) ? (int) $data['status'] : 400;
						$result->add_data( $data );
						return $result;
					}
					return rest_ensure_response(
						array(
							'repaired' => true,
							'slug'     => $slug,
							'report'   => oddout_reconcile_installed_content(),
						)
					);
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	},
	5
);
