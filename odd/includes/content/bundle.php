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
	$args             = is_array( $args ) ? $args : array();
	$replace_existing = ! empty( $args['replace_existing'] );

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
		if ( ! $replace_existing ) {
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
	}

	// Atomic install lock per slug — add_option returns false when
	// the key already exists, so a concurrent install of the same
	// slug fails fast. The timestamp value lets later requests detect
	// and replace locks stranded by a fatal error.
	$lock_key = 'oddout_bundle_install_lock_' . $slug;
	if ( ! add_option( $lock_key, (string) time(), '', false ) ) {
		$started = (int) get_option( $lock_key, 0 );
		if ( $started <= 0 || ( time() - $started ) <= 10 * MINUTE_IN_SECONDS ) {
			return new WP_Error(
				'install_in_progress',
				__( 'An installation of this bundle is already in progress.', 'odd-outlandish-desktop-decorator' ),
				array(
					'status'     => 409,
					'started_at' => $started,
				)
			);
		}
		update_option( $lock_key, (string) time(), false );
	}

	if ( '' !== $existing_type ) {
		$removed = oddout_bundle_uninstall( $slug );
		if ( is_wp_error( $removed ) ) {
			delete_option( $lock_key );
			return $removed;
		}
	}

	$installed = call_user_func( $modules[ $type ]['install'], $tmp_path, $normalised );
	delete_option( $lock_key );
	if ( is_wp_error( $installed ) ) {
		return $installed;
	}

	do_action( 'oddout_bundle_installed', $slug, $type, $normalised );

	return array(
		'slug'     => $slug,
		'type'     => $type,
		'manifest' => $normalised,
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
		'enabled'     => true,
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

function oddout_bundle_app_install( $tmp_path, array $manifest ) {
	if ( ! function_exists( 'oddout_apps_install' ) ) {
		return new WP_Error( 'apps_disabled', __( 'ODD Apps are disabled on this site.', 'odd-outlandish-desktop-decorator' ) );
	}
	// oddout_apps_install() re-validates + extracts. The double-
	// validate is cheap (one ZIP open) and keeps the Apps installer
	// usable as a standalone API.
	$filename = isset( $manifest['slug'] ) ? $manifest['slug'] . '.wp' : 'bundle.wp';
	$result   = oddout_apps_install( $tmp_path, $filename );
	return is_wp_error( $result ) ? $result : true;
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
