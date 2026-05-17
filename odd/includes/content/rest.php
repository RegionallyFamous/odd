<?php
/**
 * ODD — universal bundle REST routes.
 *
 * Two routes, one namespace:
 *
 *   POST   /wp-json/odd/v1/bundles/upload
 *   DELETE /wp-json/odd/v1/bundles/{slug}
 *
 * See odd/includes/apps/rest.php for app runtime and app-management routes.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		$manage_cb = function () {
			return current_user_can( 'manage_options' );
		};

		register_rest_route(
			'odd/v1',
			'/bundles/upload',
			array(
				'methods'             => 'POST',
				'callback'            => 'oddout_bundle_rest_upload',
				'args'                => array(
					'allow_update' => array(
						'description'       => __( 'Whether to replace an installed bundle with the uploaded archive.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'boolean',
						'required'          => false,
						'default'           => false,
						'sanitize_callback' => 'rest_sanitize_boolean',
					),
				),
				'permission_callback' => $manage_cb,
			)
		);

		register_rest_route(
			'odd/v1',
			'/bundles/(?P<slug>[a-z0-9-]+)',
			array(
				'methods'             => 'DELETE',
				'callback'            => 'oddout_bundle_rest_delete',
				'permission_callback' => $manage_cb,
			)
		);
	}
);

/**
 * Accept a multipart file upload, dispatch to the type-specific
 * installer, and respond with { installed, slug, type, manifest }.
 */
function oddout_bundle_rest_upload( WP_REST_Request $req ) {
	$rl = oddout_bundle_rate_limit_check( 'bundle_upload' );
	if ( is_wp_error( $rl ) ) {
		return $rl;
	}

	$files = $req->get_file_params();
	if ( empty( $files['file'] ) || ! isset( $files['file']['tmp_name'] ) ) {
		return new WP_Error(
			'no_file',
			__( 'No file uploaded. Use multipart field "file".', 'odd-outlandish-desktop-decorator' ),
			array( 'status' => 400 )
		);
	}
	$file = $files['file'];
	$tmp  = $file['tmp_name'];
	$name = $file['name'];

	$result = oddout_bundle_install(
		$tmp,
		$name,
		array(
			'replace_existing' => (bool) $req->get_param( 'allow_update' ),
		)
	);
	if ( is_wp_error( $result ) ) {
		$data           = $result->get_error_data();
		$data           = is_array( $data ) ? $data : array();
		$data['status'] = isset( $data['status'] ) ? (int) $data['status'] : 400;
		$result->add_data( $data );
		return $result;
	}

	$out = array(
		'installed'  => true,
		'slug'       => $result['slug'],
		'type'       => $result['type'],
		'manifest'   => $result['manifest'],
		// Shop hot-register payload. `entry_url` is the widget or
		// scene bundle's JS URL (null for every other type), and
		// `style_urls` carries widget CSS for same-page installs.
		// `row` is a panel-shaped record the client splices into
		// `state.cfg.installedWidgets` / `scenes` / `iconSets` /
		// `apps` so the unified grid can re-render with the new
		// tile without a page reload.
		'entry_url'  => oddout_bundle_entry_url_for( $result['manifest'] ),
		'style_urls' => oddout_bundle_style_urls_for( $result['manifest'] ),
		'row'        => oddout_bundle_panel_row_for( $result['manifest'] ),
	);
	if ( 'app' === $result['type'] && function_exists( 'oddout_apps_serve_url_for_rest_payload' ) ) {
		$serve = oddout_apps_serve_url_for_rest_payload( $result['slug'] );
		if ( '' !== $serve ) {
			$out['serve_url'] = $serve;
		}
	}
	return rest_ensure_response( $out );
}

function oddout_bundle_rest_delete( WP_REST_Request $req ) {
	$slug   = sanitize_key( (string) $req['slug'] );
	$result = oddout_bundle_uninstall( $slug );
	if ( is_wp_error( $result ) ) {
		$data           = $result->get_error_data();
		$data           = is_array( $data ) ? $data : array();
		$data['status'] = isset( $data['status'] ) ? (int) $data['status'] : 400;
		$result->add_data( $data );
		return $result;
	}
	return rest_ensure_response( array( 'uninstalled' => true ) );
}
