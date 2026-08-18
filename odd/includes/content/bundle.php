<?php
/**
 * ODD — Apps-only `.wp` bundle installer.
 *
 * Public app-bundle entry points:
 *
 *   oddout_bundle_install( $tmp_path, $filename, $args = array() ) → array{ slug, type, manifest } | WP_Error
 *   oddout_bundle_uninstall( $slug )              → true | WP_Error
 *   oddout_bundle_type_for_slug( $slug )          → 'app' | ''
 *   oddout_bundle_slug_in_use( $slug )            → bool
 *
 * Only manifests with `type: "app"` are accepted.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Map the app manifest type to the Apps implementation. The adapter exposes:
 *
 *   oddout_{type}_validate_archive( $tmp_path, $filename, $zip, $manifest )
 *       → normalised manifest | WP_Error
 *   oddout_{type}_install( $tmp_path, $manifest ) → true | WP_Error
 *   oddout_{type}_uninstall( $slug )              → true | WP_Error
 *   oddout_{type}_has( $slug )                    → bool
 *
 */
function oddout_bundle_type_modules() {
	return array(
		'app' => array(
			'validate'  => 'oddout_bundle_app_validate',
			'install'   => 'oddout_bundle_app_install',
			'uninstall' => 'oddout_bundle_app_uninstall',
			'has'       => 'oddout_bundle_app_has',
		),
	);
}

/**
 * Install an app bundle. Returns the normalised descriptor on success
 * or a WP_Error on any validation / extraction failure.
 *
 * @return array|WP_Error { slug, type, manifest }
 */
function oddout_bundle_install( $tmp_path, $filename, $args = array() ) {
	$args      = is_array( $args ) ? $args : array();
	$operation = isset( $args['operation'] ) ? sanitize_key( (string) $args['operation'] ) : ( ! empty( $args['replace_existing'] ) ? 'update' : 'install' );
	if ( ! in_array( $operation, array( 'install', 'update', 'repair' ), true ) ) {
		return new WP_Error( 'invalid_install_operation', __( 'Bundle operation must be install, update, or repair.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 400 ) );
	}
	$args['operation'] = $operation;

	list( $zip, $open_err ) = oddout_content_archive_open( $tmp_path, $filename );
	if ( $open_err ) {
		return $open_err;
	}

	$scanned = oddout_content_archive_scan( $zip );
	if ( is_wp_error( $scanned ) ) {
		$zip->close();
		return $scanned;
	}

	$manifest = oddout_content_archive_read_manifest( $zip );
	if ( is_wp_error( $manifest ) ) {
		$zip->close();
		return $manifest;
	}

	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		$zip->close();
		return $header;
	}

	$slug = $header['slug'];
	$type = $header['type'];

	$modules = oddout_bundle_type_modules();
	if ( empty( $modules[ $type ] ) || ! function_exists( $modules[ $type ]['validate'] ) ) {
		$zip->close();
		return new WP_Error(
			'unsupported_type',
			sprintf( /* translators: %s manifest.type */ __( 'ODD does not know how to install bundles of type "%s".', 'odd-outlandish-desktop-decorator' ), $type )
		);
	}

	$normalised = call_user_func( $modules[ $type ]['validate'], $tmp_path, $filename, $zip, $manifest );
	$zip->close();
	if ( is_wp_error( $normalised ) ) {
		return $normalised;
	}

	$existing_type = oddout_bundle_type_for_slug( $slug );
	if ( '' !== $existing_type ) {
		if ( 'install' === $operation ) {
			return new WP_Error(
				'slug_exists',
				sprintf( /* translators: %s slug */ __( 'A bundle named "%s" is already installed. Remove it before reinstalling.', 'odd-outlandish-desktop-decorator' ), $slug ),
				array( 'status' => 409 )
			);
		}
		if ( $existing_type !== $type ) {
			return new WP_Error(
				'slug_type_mismatch',
				__( 'An installed bundle with this slug has a different type.', 'odd-outlandish-desktop-decorator' ),
				array(
					'status'   => 409,
					'existing' => $existing_type,
					'incoming' => $type,
				)
			);
		}
	} elseif ( 'install' !== $operation ) {
		return new WP_Error( 'not_installed', __( 'The bundle must already be installed for this operation.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
	}

	$installed = call_user_func( $modules[ $type ]['install'], $tmp_path, $normalised, $args );
	if ( is_wp_error( $installed ) ) {
		return $installed;
	}
	$committed_manifest = is_array( $installed ) ? $installed : $normalised;

	do_action( 'oddout_bundle_installed', $slug, $type, $committed_manifest, $operation );

	return array(
		'slug'      => $slug,
		'type'      => $type,
		'operation' => $operation,
		'manifest'  => $committed_manifest,
	);
}

/**
 * Build the Shop row for a freshly installed app.
 *
 * @param array $manifest Normalised manifest from `oddout_bundle_install()`.
 * @return array
 */
function oddout_bundle_panel_row_for( array $manifest ) {
	if ( empty( $manifest['slug'] ) || 'app' !== (string) ( $manifest['type'] ?? '' ) ) {
		return array();
	}
	$slug = sanitize_key( (string) $manifest['slug'] );
	return array(
		'slug'        => $slug,
		'name'        => isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug,
		'version'     => isset( $manifest['version'] ) ? (string) $manifest['version'] : '',
		'description' => isset( $manifest['description'] ) ? (string) $manifest['description'] : '',
		'icon'        => isset( $manifest['icon'] ) ? (string) $manifest['icon'] : '',
		'enabled'     => isset( $manifest['enabled'] ) ? (bool) $manifest['enabled'] : true,
		'installed'   => true,
		'surfaces'    => function_exists( 'oddout_apps_row_surfaces' )
			? oddout_apps_row_surfaces( $manifest )
			: array(
				'desktop' => true,
				'taskbar' => false,
			),
	);
}

/**
 * Uninstall an app bundle by slug.
 */
function oddout_bundle_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid bundle slug.', 'odd-outlandish-desktop-decorator' ) );
	}

	$type = oddout_bundle_type_for_slug( $slug );
	if ( '' === $type ) {
		return new WP_Error( 'not_installed', __( 'No bundle with that slug is installed.', 'odd-outlandish-desktop-decorator' ) );
	}

	$modules = oddout_bundle_type_modules();
	if ( empty( $modules[ $type ]['uninstall'] ) || ! function_exists( $modules[ $type ]['uninstall'] ) ) {
		return new WP_Error( 'unsupported_type', __( 'Internal error: type module missing.', 'odd-outlandish-desktop-decorator' ) );
	}

	$result = call_user_func( $modules[ $type ]['uninstall'], $slug );
	if ( is_wp_error( $result ) ) {
		return $result;
	}

	do_action( 'oddout_bundle_uninstalled', $slug, $type );
	return true;
}

/**
 * Return `app` when the slug is installed, otherwise an empty string.
 */
function oddout_bundle_type_for_slug( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return '';
	}
	foreach ( oddout_bundle_type_modules() as $type => $module ) {
		if ( ! empty( $module['has'] ) && function_exists( $module['has'] ) && call_user_func( $module['has'], $slug ) ) {
			return $type;
		}
	}
	return '';
}

function oddout_bundle_slug_in_use( $slug ) {
	return '' !== oddout_bundle_type_for_slug( $slug );
}

function oddout_bundle_app_validate( $tmp_path, $filename, ZipArchive $zip, array $manifest ) {
	// Defer to the existing loader's field-level validation. It
	// opens its own ZipArchive handle, which is fine — we've
	// already enforced the envelope once here.
	if ( ! function_exists( 'oddout_apps_validate_archive' ) ) {
		return new WP_Error( 'apps_disabled', __( 'ODD Apps are disabled on this site.', 'odd-outlandish-desktop-decorator' ) );
	}
	$result = oddout_apps_validate_archive( $tmp_path, $filename );
	return is_wp_error( $result ) ? $result : $result;
}

function oddout_bundle_app_install( $tmp_path, array $manifest, $args = array() ) {
	if ( ! function_exists( 'oddout_apps_install' ) ) {
		return new WP_Error( 'apps_disabled', __( 'ODD Apps are disabled on this site.', 'odd-outlandish-desktop-decorator' ) );
	}
	// The bundle validator already ran the complete app archive validator.
	// Standalone callers should continue to use oddout_apps_install(), which
	// validates before entering the same transaction.
	$result = oddout_apps_install_validated_archive( $tmp_path, $manifest, $args );
	return $result;
}

function oddout_bundle_app_uninstall( $slug ) {
	if ( ! function_exists( 'oddout_apps_uninstall' ) ) {
		return new WP_Error( 'apps_disabled', __( 'ODD Apps are disabled on this site.', 'odd-outlandish-desktop-decorator' ) );
	}
	return oddout_apps_uninstall( $slug );
}

function oddout_bundle_app_has( $slug ) {
	return function_exists( 'oddout_apps_exists' ) && oddout_apps_exists( $slug );
}
