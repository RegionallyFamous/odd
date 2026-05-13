<?php
/**
 * ODD — universal `.wp` bundle installer.
 *
 * Single public entry for every content type:
 *
 *   oddout_bundle_install( $tmp_path, $filename ) → array{ slug, type, manifest } | WP_Error
 *   oddout_bundle_uninstall( $slug )              → true | WP_Error
 *   oddout_bundle_type_for_slug( $slug )          → 'app' | 'icon-set' | 'cursor-set' | 'scene' | 'widget' | ''
 *   oddout_bundle_slug_in_use( $slug )            → bool
 *
 * The dispatcher reads `manifest.type` (defaulting to `app` for
 * back-compat with every bundle shipped before v1.8.0), routes to the
 * per-type validator for field-level checks, and then to the per-type
 * installer to extract + register.
 *
 * Slugs are a single global namespace across all content types — the
 * same slug can't be installed as both a scene and a widget. That
 * guarantees uninstall is unambiguous: look up which of four indexes
 * holds the slug, dispatch.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Map of manifest.type → per-type module. Each module exposes:
 *
 *   oddout_{type}_validate_archive( $tmp_path, $filename, $zip, $manifest )
 *       → normalised manifest | WP_Error
 *   oddout_{type}_install( $tmp_path, $manifest ) → true | WP_Error
 *   oddout_{type}_uninstall( $slug )              → true | WP_Error
 *   oddout_{type}_has( $slug )                    → bool
 *
 * Apps are listed first so the lookup falls through to the existing
 * Apps implementation — no second code path for the common case.
 */
function oddout_bundle_type_modules() {
	return array(
		'app'        => array(
			'validate'  => 'oddout_bundle_app_validate',
			'install'   => 'oddout_bundle_app_install',
			'uninstall' => 'oddout_bundle_app_uninstall',
			'has'       => 'oddout_bundle_app_has',
		),
		'icon-set'   => array(
			'validate'  => 'oddout_iconset_bundle_validate',
			'install'   => 'oddout_iconset_bundle_install',
			'uninstall' => 'oddout_iconset_bundle_uninstall',
			'has'       => 'oddout_iconset_bundle_has',
		),
		'cursor-set' => array(
			'validate'  => 'oddout_cursorset_bundle_validate',
			'install'   => 'oddout_cursorset_bundle_install',
			'uninstall' => 'oddout_cursorset_bundle_uninstall',
			'has'       => 'oddout_cursorset_bundle_has',
		),
		'scene'      => array(
			'validate'  => 'oddout_scene_bundle_validate',
			'install'   => 'oddout_scene_bundle_install',
			'uninstall' => 'oddout_scene_bundle_uninstall',
			'has'       => 'oddout_scene_bundle_has',
		),
		'widget'     => array(
			'validate'  => 'oddout_widget_bundle_validate',
			'install'   => 'oddout_widget_bundle_install',
			'uninstall' => 'oddout_widget_bundle_uninstall',
			'has'       => 'oddout_widget_bundle_has',
		),
	);
}

/**
 * Install any bundle. Returns the normalised descriptor on success
 * or a WP_Error on any validation / extraction failure.
 *
 * @return array|WP_Error { slug, type, manifest }
 */
function oddout_bundle_install( $tmp_path, $filename ) {
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

	if ( oddout_bundle_slug_in_use( $slug ) ) {
		$zip->close();
		return new WP_Error(
			'slug_exists',
			sprintf( /* translators: %s slug */ __( 'A bundle named "%s" is already installed. Remove it before reinstalling.', 'odd-outlandish-desktop-decorator' ), $slug )
		);
	}

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
 * Build the entry_url a freshly-installed bundle needs for in-page
 * registration. Widgets and scenes both ship a JS entry that self-
 * registers on load, so the Shop can hot-inject the script after
 * install instead of rebooting the whole Desktop Mode shell.
 *
 * @param array $manifest Normalised manifest from `oddout_bundle_install()`.
 * @return string|null    Absolute URL to the entry JS, or null.
 */
function oddout_bundle_entry_url_for( array $manifest ) {
	if ( empty( $manifest['type'] ) || empty( $manifest['slug'] ) ) {
		return null;
	}
	$slug = sanitize_key( (string) $manifest['slug'] );
	$type = (string) $manifest['type'];
	if ( 'widget' === $type ) {
		if ( ! function_exists( 'oddout_widgets_url_for' ) ) {
			return null;
		}
		$entry = isset( $manifest['entry'] ) ? (string) $manifest['entry'] : 'widget.js';
		$base  = oddout_widgets_url_for( $slug );
	} elseif ( 'scene' === $type ) {
		if ( ! function_exists( 'oddout_scenes_url_for' ) ) {
			return null;
		}
		$entry = isset( $manifest['entry'] ) ? (string) $manifest['entry'] : 'scene.js';
		$base  = oddout_scenes_url_for( $slug );
	} else {
		return null;
	}
	if ( '' === $base ) {
		return null;
	}
	return $base . rawurlencode( $entry );
}

/**
 * Build the panel-shaped row a freshly-installed bundle contributes to
 * the Shop's state.cfg.{scenes|iconSets|installedWidgets|apps} list.
 *
 * The client splices this directly into its local state after a
 * successful install so the unified grid can re-render with the new
 * tile without re-fetching any registries. Mirrors the row shapes the
 * server bakes into `window.odd` in `includes/enqueue.php` so the
 * merge is a drop-in (keys + types match exactly).
 *
 * Returns an empty array for unknown types rather than null so the
 * client can always `Array.isArray( res.row )`-guard without a second
 * null check.
 *
 * @param array $manifest Normalised manifest from `oddout_bundle_install()`.
 * @return array
 */
function oddout_bundle_panel_row_for( array $manifest ) {
	if ( empty( $manifest['type'] ) || empty( $manifest['slug'] ) ) {
		return array();
	}

	$type = (string) $manifest['type'];
	$slug = sanitize_key( (string) $manifest['slug'] );

	switch ( $type ) {
		case 'scene':
			$preview_name   = isset( $manifest['preview'] ) ? (string) $manifest['preview'] : 'preview.webp';
			$wallpaper_name = isset( $manifest['wallpaper'] ) ? (string) $manifest['wallpaper'] : 'wallpaper.webp';
			$base           = function_exists( 'oddout_scenes_url_for' ) ? oddout_scenes_url_for( $slug ) : '';
			return array(
				'slug'          => $slug,
				'label'         => isset( $manifest['label'] ) ? (string) $manifest['label'] : $slug,
				'franchise'     => isset( $manifest['franchise'] ) ? (string) $manifest['franchise'] : 'Community',
				'tags'          => isset( $manifest['tags'] ) && is_array( $manifest['tags'] ) ? array_values( $manifest['tags'] ) : array(),
				'fallbackColor' => isset( $manifest['fallbackColor'] ) ? (string) $manifest['fallbackColor'] : '#111',
				'installed'     => true,
				'previewUrl'    => '' === $base ? '' : $base . rawurlencode( $preview_name ),
				'wallpaperUrl'  => '' === $base ? '' : $base . rawurlencode( $wallpaper_name ),
			);

		case 'icon-set':
			$icons_map = array();
			$icons     = isset( $manifest['icons'] ) && is_array( $manifest['icons'] ) ? $manifest['icons'] : array();
			$base      = function_exists( 'oddout_iconsets_url_for' ) ? oddout_iconsets_url_for( $slug ) : '';
			foreach ( $icons as $key => $file ) {
				if ( ! is_string( $file ) || '' === $file ) {
					continue;
				}
				$icons_map[ (string) $key ] = '' === $base ? '' : $base . rawurlencode( $file );
			}
			$preview = isset( $manifest['preview'] ) ? (string) $manifest['preview'] : '';
			return array(
				'slug'        => $slug,
				'label'       => isset( $manifest['label'] ) ? (string) $manifest['label'] : $slug,
				'franchise'   => isset( $manifest['franchise'] ) ? (string) $manifest['franchise'] : 'Community',
				'accent'      => isset( $manifest['accent'] ) ? (string) $manifest['accent'] : '',
				'description' => isset( $manifest['description'] ) ? (string) $manifest['description'] : '',
				'preview'     => ( '' === $preview || '' === $base ) ? '' : $base . rawurlencode( $preview ),
				'icons'       => $icons_map,
				'installed'   => true,
			);

		case 'cursor-set':
			$cursors_map = array();
			$cursors     = isset( $manifest['cursors'] ) && is_array( $manifest['cursors'] ) ? $manifest['cursors'] : array();
			$base        = function_exists( 'oddout_cursorsets_url_for' ) ? oddout_cursorsets_url_for( $slug ) : '';
			foreach ( $cursors as $kind => $def ) {
				if ( ! is_array( $def ) || empty( $def['file'] ) ) {
					continue;
				}
				$cursors_map[ (string) $kind ] = array(
					'url'     => '' === $base ? '' : $base . rawurlencode( (string) $def['file'] ),
					'hotspot' => isset( $def['hotspot'] ) && is_array( $def['hotspot'] ) ? array_values( $def['hotspot'] ) : array( 0, 0 ),
				);
			}
			$preview = isset( $manifest['preview'] ) ? (string) $manifest['preview'] : '';
			return array(
				'slug'        => $slug,
				'label'       => isset( $manifest['label'] ) ? (string) $manifest['label'] : $slug,
				'franchise'   => isset( $manifest['franchise'] ) ? (string) $manifest['franchise'] : 'Community',
				'accent'      => isset( $manifest['accent'] ) ? (string) $manifest['accent'] : '',
				'description' => isset( $manifest['description'] ) ? (string) $manifest['description'] : '',
				'preview'     => ( '' === $preview || '' === $base ) ? '' : $base . rawurlencode( $preview ),
				'cursors'     => $cursors_map,
				'installed'   => true,
			);

		case 'widget':
			return array(
				'id'          => 'odd/' . $slug,
				'slug'        => $slug,
				'label'       => isset( $manifest['label'] ) ? (string) $manifest['label'] : $slug,
				'description' => isset( $manifest['name'] ) ? (string) $manifest['name'] : ( isset( $manifest['description'] ) ? (string) $manifest['description'] : '' ),
				'franchise'   => isset( $manifest['franchise'] ) ? (string) $manifest['franchise'] : 'Community',
				'installed'   => true,
			);

		case 'app':
			return array(
				'slug'        => $slug,
				'name'        => isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug,
				'version'     => isset( $manifest['version'] ) ? (string) $manifest['version'] : '',
				'description' => isset( $manifest['description'] ) ? (string) $manifest['description'] : '',
				'icon'        => isset( $manifest['icon'] ) ? (string) $manifest['icon'] : '',
				'enabled'     => true,
				'installed'   => true,
			);
	}

	return array();
}

/**
 * Uninstall any bundle by slug. Looks up which type owns the slug
 * and dispatches to the matching per-type uninstaller.
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
 * Which type owns the slug? Returns '' if the slug is not installed
 * in any type index.
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

// ============================================================ //
// App type module — thin adapters onto the existing Apps API so
// the dispatcher doesn't need to know Apps-specific internals.
// ============================================================ //

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
