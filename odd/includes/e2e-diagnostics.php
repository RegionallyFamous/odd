<?php
/**
 * ODD — E2E / troubleshooting diagnostics (REST).
 *
 * GET /wp-json/odd/v1/e2e-diagnostics
 *
 * Structured JSON for Playwright and support: WordPress + ODD + Desktop Mode
 * snapshot. Restricted to administrators. Optional `probe=1` adds a short
 * outbound HTTP probe of the configured catalog URL (slow; use in failure paths).
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build the diagnostics payload for the current request context.
 *
 * @param bool $probe_catalog Whether to HTTP-probe the catalog registry URL.
 * @return array
 */
function oddout_e2e_diagnostics_payload( $probe_catalog = false ) {
	$uid = get_current_user_id();

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$active = array();
	$data   = get_plugins();
	foreach ( (array) get_option( 'active_plugins', array() ) as $rel ) {
		if ( isset( $data[ $rel ] ) ) {
			$active[] = array(
				'file'    => $rel,
				'name'    => $data[ $rel ]['Name'],
				'version' => $data[ $rel ]['Version'],
			);
		} else {
			$active[] = array(
				'file' => $rel,
			);
		}
	}

	$dm_os = get_user_meta( $uid, 'desktop_mode_os_settings', true );
	if ( ! is_array( $dm_os ) ) {
		$dm_os = array();
	}
	$dm_mode = get_user_meta( $uid, 'desktop_mode_mode', true );

	$catalog_url = '';
	if ( function_exists( 'oddout_catalog_url' ) ) {
		$catalog_url = oddout_catalog_url();
	} elseif ( defined( 'ODDOUT_CATALOG_URL' ) ) {
		$catalog_url = ODDOUT_CATALOG_URL;
	}
	$catalog_row = array(
		'url' => $catalog_url,
	);
	if ( $probe_catalog && is_string( $catalog_url ) && $catalog_url !== '' ) {
		$t0                   = microtime( true );
		$r                    = wp_remote_head(
			$catalog_url,
			array(
				'timeout'     => 8,
				'redirection' => 3,
			)
		);
		$catalog_row['probe'] = array(
			'ok'      => ! is_wp_error( $r ),
			'code'    => is_wp_error( $r ) ? 0 : wp_remote_retrieve_response_code( $r ),
			'elapsed' => round( ( microtime( true ) - $t0 ) * 1000 ),
			'error'   => is_wp_error( $r ) ? $r->get_error_message() : null,
		);
	}

	$scenes = function_exists( 'oddout_wallpaper_scene_slugs' ) ? oddout_wallpaper_scene_slugs() : array();

	$starter_key = defined( 'ODDOUT_STARTER_OPTION' ) ? ODDOUT_STARTER_OPTION : 'oddout_starter_state';
	$starter     = get_option( $starter_key, null );

	$out = array(
		'schema'      => 1,
		'generatedAt' => gmdate( 'c' ),
		'wordpress'   => array(
			'version' => get_bloginfo( 'version' ),
			'url'     => home_url( '/' ),
			'siteUrl' => site_url( '/' ),
		),
		'php'         => PHP_VERSION,
		'server'      => array(
			'software' => isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ) : '',
		),
		'odd'         => array(
			'version'        => ODDOUT_VERSION,
			'desktopModeMin' => ODDOUT_DESKTOP_MODE_MIN_VERSION,
			'appsEnabled'    => defined( 'ODDOUT_APPS_ENABLED' ) && ODDOUT_APPS_ENABLED,
		),
		'plugins'     => $active,
		'user'        => array(
			'id'                   => $uid,
			'desktopModeWallpaper' => isset( $dm_os['wallpaper'] ) ? (string) $dm_os['wallpaper'] : '',
			'desktopModeMode'      => $dm_mode,
		),
		'starterPack' => $starter,
		'wallpaper'   => array(
			'sceneSlugs' => array_values( $scenes ),
			'count'      => count( $scenes ),
			'activeSlug' => function_exists( 'oddout_wallpaper_get_user_scene' ) ? (string) oddout_wallpaper_get_user_scene( $uid ) : '',
		),
		'catalog'     => $catalog_row,
		'transients'  => array(
			'oddCatalogV1' => function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : null,
		),
	);

	if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
		$out['wpDebug'] = true;
	}

	return apply_filters( 'oddout_e2e_diagnostics', $out, $probe_catalog );
}

/**
 * REST callback: GET odd/v1/e2e-diagnostics
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function oddout_rest_e2e_diagnostics_get( WP_REST_Request $request ) {
	$probe = filter_var( $request->get_param( 'probe' ), FILTER_VALIDATE_BOOLEAN );
	$data  = oddout_e2e_diagnostics_payload( $probe );
	return rest_ensure_response( $data );
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'odd/v1',
			'/e2e-diagnostics',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => 'oddout_rest_e2e_diagnostics_get',
				'args'                => array(
					'probe' => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);
	}
);
