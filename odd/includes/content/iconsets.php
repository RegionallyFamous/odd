<?php
/**
 * ODD — icon-set bundle installer.
 *
 * Installs `.wp` bundles that declare `"type": "icon-set"`. The
 * manifest format is `slug`, `label`, `accent`, `preview`, and an
 * `icons` map of native Desktop Mode keys to PNG/WebP files.
 *
 * Installed sets live at `uploads/odd/icon-sets/<slug>/` and are
 * merged into {@see oddout_icons_get_sets()} by the registry, so every
 * consumer (panel and Desktop Mode icon filters) sees them as static
 * authenticated image URLs.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_ICONSETS_DIR' ) ) {
	define( 'ODDOUT_ICONSETS_DIR', oddout_storage_dir( 'icon-sets' ) );
}
if ( ! defined( 'ODDOUT_ICONSETS_URL' ) ) {
	define( 'ODDOUT_ICONSETS_URL', oddout_storage_url( 'icon-sets' ) );
}
if ( ! defined( 'ODDOUT_ICONSETS_OPTION_INDEX' ) ) {
	define( 'ODDOUT_ICONSETS_OPTION_INDEX', 'oddout_iconsets_index' );
}

function oddout_iconsets_dir_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_ICONSETS_DIR . $slug . '/';
}

function oddout_iconsets_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_ICONSETS_URL . $slug . '/';
}

function oddout_iconsets_ensure_storage() {
	if ( ! is_dir( ODDOUT_ICONSETS_DIR ) ) {
		wp_mkdir_p( ODDOUT_ICONSETS_DIR );
	}
}

function oddout_iconsets_index_load() {
	$raw = get_option( ODDOUT_ICONSETS_OPTION_INDEX, array() );
	return is_array( $raw ) ? $raw : array();
}

function oddout_iconsets_index_save( $index ) {
	update_option( ODDOUT_ICONSETS_OPTION_INDEX, is_array( $index ) ? $index : array(), false );
}

function oddout_iconset_bundle_has( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = oddout_iconsets_index_load();
	return isset( $index[ $slug ] );
}

/**
 * Required icon keys. Mirrors the visible Desktop Mode desktop shortcuts that
 * ODD themes through {@see oddout_icons_slug_to_key()}.
 */
function oddout_iconsets_required_keys() {
	return array(
		'odd',
		'my-wordpress',
		'content-graph',
		'recycle-bin',
		'fallback',
	);
}

function oddout_iconsets_allowed_extensions() {
	return array( 'png', 'webp' );
}

function oddout_iconset_image_validate( $bytes, $rel ) {
	return oddout_iconset_raster_validate( $bytes, $rel, true );
}

function oddout_iconset_preview_validate( $bytes, $rel ) {
	return oddout_iconset_raster_validate( $bytes, $rel, false );
}

function oddout_iconset_raster_validate( $bytes, $rel, $must_be_square ) {
	$rel = (string) $rel;
	$ext = strtolower( pathinfo( $rel, PATHINFO_EXTENSION ) );
	if ( ! in_array( $ext, oddout_iconsets_allowed_extensions(), true ) ) {
		return new WP_Error(
			'invalid_icon_ext',
			sprintf( /* translators: %s icon filename */ __( 'Icon "%s" must be a PNG or WebP image.', 'odd-outlandish-desktop-decorator' ), $rel )
		);
	}
	$bytes = (string) $bytes;
	if ( '' === $bytes ) {
		return new WP_Error( 'empty_icon', __( 'Icon image is empty.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( strlen( $bytes ) > 786432 ) {
		return new WP_Error( 'icon_too_large', __( 'Icon image exceeds the 768 KB size limit.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! function_exists( 'getimagesizefromstring' ) ) {
		return new WP_Error( 'image_parser_unavailable', __( 'Server cannot safely validate icon images.', 'odd-outlandish-desktop-decorator' ) );
	}
	$info = @getimagesizefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	if ( ! is_array( $info ) || empty( $info[0] ) || empty( $info[1] ) || empty( $info[2] ) ) {
		return new WP_Error( 'invalid_icon_image', __( 'Icon image is not a valid PNG or WebP file.', 'odd-outlandish-desktop-decorator' ) );
	}
	$expected = 'png' === $ext ? IMAGETYPE_PNG : ( defined( 'IMAGETYPE_WEBP' ) ? IMAGETYPE_WEBP : 18 );
	if ( (int) $info[2] !== (int) $expected ) {
		return new WP_Error( 'invalid_icon_image', __( 'Icon image extension does not match its image data.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( $must_be_square && (int) $info[0] !== (int) $info[1] ) {
		return new WP_Error( 'invalid_icon_image', __( 'Icon image must be square.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( (int) $info[0] < 64 || (int) $info[1] < 64 || (int) $info[0] > 2048 || (int) $info[1] > 2048 ) {
		return new WP_Error( 'invalid_icon_image', __( 'Icon image dimensions must be between 64px and 2048px.', 'odd-outlandish-desktop-decorator' ) );
	}
	return true;
}

/**
 * Per-type validator. Called by the bundle dispatcher after the
 * envelope checks have already passed and the manifest is parsed.
 *
 * @return array|WP_Error Normalised manifest on success.
 */
function oddout_iconset_bundle_validate( $tmp_path, $filename, ZipArchive $zip, array $manifest ) {
	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	if ( empty( $manifest['icons'] ) || ! is_array( $manifest['icons'] ) ) {
		return new WP_Error( 'invalid_manifest', __( 'Icon set manifest.json must include an "icons" map.', 'odd-outlandish-desktop-decorator' ) );
	}

	$icons = array();
	foreach ( $manifest['icons'] as $key => $rel ) {
		$clean_key = sanitize_key( (string) $key );
		if ( '' === $clean_key || ! is_string( $rel ) ) {
			return new WP_Error(
				'invalid_icon_key',
				sprintf( /* translators: %s icon key */ __( 'Icon key "%s" is invalid.', 'odd-outlandish-desktop-decorator' ), $key )
			);
		}
		$clean_rel = oddout_content_sanitize_relative_path( $rel );
		if ( '' === $clean_rel ) {
			return new WP_Error(
				'invalid_icon_path',
				sprintf( /* translators: %s icon path */ __( 'Icon path "%s" contains invalid characters.', 'odd-outlandish-desktop-decorator' ), $rel )
			);
		}

		$ext = strtolower( pathinfo( $clean_rel, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, oddout_iconsets_allowed_extensions(), true ) ) {
			return new WP_Error(
				'invalid_icon_ext',
				sprintf( /* translators: %s icon filename */ __( 'Icon "%s" must be a PNG or WebP image.', 'odd-outlandish-desktop-decorator' ), $clean_rel )
			);
		}

		$image = $zip->getFromName( $clean_rel );
		if ( false === $image ) {
			return new WP_Error(
				'missing_icon',
				sprintf( /* translators: %s icon filename */ __( 'Icon file "%s" was declared in the manifest but not found in the bundle.', 'odd-outlandish-desktop-decorator' ), $clean_rel )
			);
		}
		$valid_image = oddout_iconset_image_validate( $image, $clean_rel );
		if ( is_wp_error( $valid_image ) ) {
			return $valid_image;
		}

		$icons[ $clean_key ] = $clean_rel;
	}

	$missing = array_diff( oddout_iconsets_required_keys(), array_keys( $icons ) );
	if ( ! empty( $missing ) ) {
		return new WP_Error(
			'missing_required_icons',
			sprintf(
				/* translators: %s comma-separated icon keys */
				__( 'Icon set is missing required keys: %s', 'odd-outlandish-desktop-decorator' ),
				implode( ', ', $missing )
			)
		);
	}

	$preview = '';
	if ( ! empty( $manifest['preview'] ) ) {
		$preview_rel = oddout_content_sanitize_relative_path( (string) $manifest['preview'] );
		$preview_raw = '' === $preview_rel ? false : $zip->getFromName( $preview_rel );
		if ( '' === $preview_rel || false === $preview_raw ) {
			return new WP_Error( 'invalid_preview', __( 'Preview file is not present in the bundle.', 'odd-outlandish-desktop-decorator' ) );
		}
		$preview_valid = oddout_iconset_preview_validate( $preview_raw, $preview_rel );
		if ( is_wp_error( $preview_valid ) ) {
			return $preview_valid;
		}
		$preview = $preview_rel;
	}

	$accent = isset( $manifest['accent'] ) ? trim( (string) $manifest['accent'] ) : '';
	if ( '' !== $accent && ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $accent ) ) {
		return new WP_Error( 'invalid_accent', __( 'Icon set accent must be a hex colour like #ffb000.', 'odd-outlandish-desktop-decorator' ) );
	}
	$out = array(
		'slug'        => $header['slug'],
		'name'        => $header['name'],
		'label'       => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'     => $header['version'],
		'type'        => 'icon-set',
		'author'      => $header['author'],
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'category'    => isset( $manifest['category'] ) ? sanitize_text_field( (string) $manifest['category'] ) : '',
		'accent'      => $accent ? $accent : '#3858e9',
		'preview'     => $preview,
		'icons'       => $icons,
	);
	return $out;
}

/**
 * Install a validated icon-set bundle. Extracts into
 * uploads/odd/icon-sets/<slug>/, writes the canonical
 * manifest.json (normalised), updates the installed-sets
 * index, and busts the icon-registry transient so the panel and
 * Desktop Mode icon filters pick up the new set immediately.
 */
function oddout_iconset_bundle_install( $tmp_path, array $manifest ) {
	oddout_iconsets_ensure_storage();
	$slug = $manifest['slug'];

	$extracted = oddout_content_archive_extract( $tmp_path, ODDOUT_ICONSETS_DIR, $slug );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	$dir = oddout_iconsets_dir_for( $slug );

	// Persist the canonical manifest so the registry scan reads it
	// identically to the built-ins. Keep the authored manifest.json
	// intact for users to read; write our canonical copy at a
	// separate filename.
	$canonical = wp_json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
	if ( is_string( $canonical ) ) {
		oddout_write_file( $dir . 'manifest.json', $canonical );
	}

	$index          = oddout_iconsets_index_load();
	$index[ $slug ] = array(
		'slug'      => $slug,
		'name'      => $manifest['name'],
		'label'     => $manifest['label'],
		'version'   => $manifest['version'],
		'category'  => $manifest['category'],
		'accent'    => $manifest['accent'],
		'installed' => time(),
	);
	oddout_iconsets_index_save( $index );

	oddout_iconsets_bust_registry_cache();

	return true;
}

function oddout_iconset_bundle_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index = oddout_iconsets_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return new WP_Error( 'not_installed', __( 'Icon set is not installed.', 'odd-outlandish-desktop-decorator' ) );
	}

	$dir = oddout_iconsets_dir_for( $slug );
	if ( $dir && is_dir( $dir ) ) {
		oddout_content_rrmdir( rtrim( $dir, '/' ) );
	}

	unset( $index[ $slug ] );
	oddout_iconsets_index_save( $index );

	oddout_iconsets_bust_registry_cache();
	return true;
}

function oddout_iconsets_resolve_path( $base_dir, $rel ) {
	return oddout_content_resolve_path( $base_dir, $rel );
}

/**
 * Bust the icon-registry transient + the PHP-static in
 * `oddout_icons_get_sets()`. Called on install, uninstall, and from
 * future content tools that mutate uploads/odd/icon-sets/.
 */
function oddout_iconsets_bust_registry_cache() {
	if ( function_exists( 'oddout_icons_registry_transient_key' ) ) {
		delete_transient( oddout_icons_registry_transient_key() );
	}
	// Wipe the static cache in oddout_icons_get_sets(). There's no
	// helper to reset it directly, so we call through a reserved
	// sentinel action the registry subscribes to.
	do_action( 'oddout_icons_invalidate_cache' );
}

/**
 * Scan uploads/odd/icon-sets/ for user-installed sets and merge
 * them into the registry. Runs from the registry's built-in scan
 * (see odd/includes/icons/registry.php) rather than via the filter
 * so built-ins and installed sets use one code path.
 *
 * Returns an array keyed by slug. Malformed manifests skip silently
 * but are reported through {@see oddout_registry_report_bad_manifest()}.
 */
function oddout_iconsets_scan_installed() {
	$out = array();
	if ( ! is_dir( ODDOUT_ICONSETS_DIR ) ) {
		return $out;
	}
	$dirs = glob( rtrim( ODDOUT_ICONSETS_DIR, '/' ) . '/*', GLOB_ONLYDIR );
	if ( ! is_array( $dirs ) ) {
		return $out;
	}
	foreach ( $dirs as $dir ) {
		$slug = basename( $dir );
		if ( '' === $slug || $slug[0] === '.' ) {
			continue;
		}
		$manifest_path = $dir . '/manifest.json';
		if ( ! is_readable( $manifest_path ) ) {
			continue;
		}
		$raw  = file_get_contents( $manifest_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
		if ( ! is_array( $data ) ) {
			if ( function_exists( 'oddout_registry_report_bad_manifest' ) ) {
				oddout_registry_report_bad_manifest( $manifest_path, json_last_error_msg() );
			}
			continue;
		}
		$out[ $slug ] = array(
			'data'     => $data,
			'base_dir' => $dir,
			'base_url' => ODDOUT_ICONSETS_URL . rawurlencode( $slug ),
			'source'   => 'installed',
		);
	}
	return $out;
}
