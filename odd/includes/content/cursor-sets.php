<?php
/**
 * ODD — cursor-set bundle installer.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_CURSORSETS_DIR' ) ) {
	define( 'ODDOUT_CURSORSETS_DIR', oddout_storage_dir( 'cursor-sets' ) );
}
if ( ! defined( 'ODDOUT_CURSORSETS_URL' ) ) {
	define( 'ODDOUT_CURSORSETS_URL', oddout_storage_url( 'cursor-sets' ) );
}
if ( ! defined( 'ODDOUT_CURSORSETS_OPTION_INDEX' ) ) {
	define( 'ODDOUT_CURSORSETS_OPTION_INDEX', 'oddout_cursorsets_index' );
}

function oddout_cursorsets_dir_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_CURSORSETS_DIR . $slug . '/';
}

function oddout_cursorsets_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_CURSORSETS_URL . $slug . '/';
}

function oddout_cursorsets_ensure_storage() {
	if ( ! is_dir( ODDOUT_CURSORSETS_DIR ) ) {
		wp_mkdir_p( ODDOUT_CURSORSETS_DIR );
	}
}

function oddout_cursorsets_index_load() {
	$raw = get_option( ODDOUT_CURSORSETS_OPTION_INDEX, array() );
	return is_array( $raw ) ? $raw : array();
}

function oddout_cursorsets_index_save( $index ) {
	update_option( ODDOUT_CURSORSETS_OPTION_INDEX, is_array( $index ) ? $index : array(), false );
}

function oddout_cursorset_bundle_has( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = oddout_cursorsets_index_load();
	return isset( $index[ $slug ] );
}

function oddout_cursorset_bundle_validate( $tmp_path, $filename, ZipArchive $zip, array $manifest ) {
	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	if ( empty( $manifest['cursors'] ) || ! is_array( $manifest['cursors'] ) ) {
		return new WP_Error( 'invalid_manifest', __( 'Cursor set manifest.json must include a "cursors" map.', 'odd-outlandish-desktop-decorator' ) );
	}

	$allowed = function_exists( 'oddout_cursors_allowed_kinds' ) ? oddout_cursors_allowed_kinds() : array( 'default', 'pointer', 'text', 'grab', 'grabbing', 'crosshair', 'not-allowed', 'wait', 'help', 'progress' );
	$cursors = array();
	foreach ( $manifest['cursors'] as $kind => $def ) {
		$clean_kind = sanitize_key( (string) $kind );
		if ( ! in_array( $clean_kind, $allowed, true ) || ! is_array( $def ) ) {
			return new WP_Error( 'invalid_cursor_key', __( 'Cursor set includes an unsupported cursor kind.', 'odd-outlandish-desktop-decorator' ) );
		}
		$rel = isset( $def['file'] ) ? oddout_content_sanitize_relative_path( (string) $def['file'] ) : '';
		if ( '' === $rel ) {
			return new WP_Error( 'invalid_cursor_path', __( 'Cursor file path is invalid.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( 'svg' !== strtolower( pathinfo( $rel, PATHINFO_EXTENSION ) ) ) {
			return new WP_Error( 'invalid_cursor_ext', __( 'Cursor files must be SVG.', 'odd-outlandish-desktop-decorator' ) );
		}
		$svg = $zip->getFromName( $rel );
		if ( false === $svg ) {
			return new WP_Error( 'missing_cursor', __( 'A cursor file declared in manifest.json was not found in the bundle.', 'odd-outlandish-desktop-decorator' ) );
		}
		$scrubbed = function_exists( 'oddout_iconset_svg_scrub' ) ? oddout_iconset_svg_scrub( $svg ) : $svg;
		if ( is_wp_error( $scrubbed ) ) {
			return $scrubbed;
		}
		$hotspot = isset( $def['hotspot'] ) && is_array( $def['hotspot'] ) ? array_values( $def['hotspot'] ) : array( 0, 0 );
		if ( count( $hotspot ) < 2 ) {
			return new WP_Error( 'invalid_hotspot', __( 'Cursor hotspots must be [x, y] integer pairs.', 'odd-outlandish-desktop-decorator' ) );
		}
		$cursors[ $clean_kind ] = array(
			'file'    => $rel,
			'hotspot' => array(
				max( 0, min( 128, (int) $hotspot[0] ) ),
				max( 0, min( 128, (int) $hotspot[1] ) ),
			),
		);
	}

	if ( empty( $cursors['default'] ) ) {
		return new WP_Error( 'missing_default_cursor', __( 'Cursor set must include a default cursor.', 'odd-outlandish-desktop-decorator' ) );
	}

	$preview = '';
	if ( ! empty( $manifest['preview'] ) ) {
		$preview_rel = oddout_content_sanitize_relative_path( (string) $manifest['preview'] );
		if ( '' === $preview_rel || false === $zip->getFromName( $preview_rel ) ) {
			return new WP_Error( 'invalid_preview', __( 'Preview file is not present in the bundle.', 'odd-outlandish-desktop-decorator' ) );
		}
		$preview = $preview_rel;
	}

	$accent = isset( $manifest['accent'] ) ? trim( (string) $manifest['accent'] ) : '';
	if ( '' !== $accent && ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $accent ) ) {
		return new WP_Error( 'invalid_accent', __( 'Cursor set accent must be a hex colour like #38e8ff.', 'odd-outlandish-desktop-decorator' ) );
	}

	return array(
		'slug'        => $header['slug'],
		'name'        => $header['name'],
		'label'       => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'     => $header['version'],
		'type'        => 'cursor-set',
		'author'      => $header['author'],
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'franchise'   => isset( $manifest['franchise'] ) ? sanitize_text_field( (string) $manifest['franchise'] ) : '',
		'accent'      => $accent ? $accent : '#38e8ff',
		'preview'     => $preview,
		'cursors'     => $cursors,
	);
}

function oddout_cursorset_bundle_install( $tmp_path, array $manifest ) {
	oddout_cursorsets_ensure_storage();
	$slug      = $manifest['slug'];
	$extracted = oddout_content_archive_extract( $tmp_path, ODDOUT_CURSORSETS_DIR, $slug );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	$dir = oddout_cursorsets_dir_for( $slug );
	foreach ( $manifest['cursors'] as $def ) {
		$abs = oddout_content_resolve_path( $dir, $def['file'] );
		if ( '' === $abs ) {
			continue;
		}
		$raw = file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false === $raw ) {
			continue;
		}
		$clean = function_exists( 'oddout_iconset_svg_scrub' ) ? oddout_iconset_svg_scrub( $raw ) : $raw;
		if ( is_wp_error( $clean ) ) {
			oddout_content_rrmdir( $dir );
			return $clean;
		}
		if ( ! oddout_write_file( $abs, $clean ) ) {
			oddout_content_rrmdir( $dir );
			return new WP_Error( 'write_failed', __( 'Could not write scrubbed cursor file.', 'odd-outlandish-desktop-decorator' ) );
		}
	}

	$canonical = wp_json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
	if ( is_string( $canonical ) ) {
		oddout_write_file( $dir . 'manifest.json', $canonical );
	}

	$index          = oddout_cursorsets_index_load();
	$index[ $slug ] = array(
		'slug'      => $slug,
		'name'      => $manifest['name'],
		'label'     => $manifest['label'],
		'version'   => $manifest['version'],
		'franchise' => $manifest['franchise'],
		'accent'    => $manifest['accent'],
		'installed' => time(),
	);
	oddout_cursorsets_index_save( $index );
	oddout_cursorsets_bust_registry_cache();
	return true;
}

function oddout_cursorset_bundle_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index = oddout_cursorsets_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return new WP_Error( 'not_installed', __( 'Cursor set is not installed.', 'odd-outlandish-desktop-decorator' ) );
	}
	$dir = oddout_cursorsets_dir_for( $slug );
	if ( $dir && is_dir( $dir ) ) {
		oddout_content_rrmdir( rtrim( $dir, '/' ) );
	}
	unset( $index[ $slug ] );
	oddout_cursorsets_index_save( $index );
	oddout_cursorsets_bust_registry_cache();
	return true;
}

function oddout_cursorsets_bust_registry_cache() {
	if ( function_exists( 'oddout_cursors_registry_transient_key' ) ) {
		delete_transient( oddout_cursors_registry_transient_key() );
	}
	do_action( 'oddout_cursors_invalidate_cache' );
}

function oddout_cursorsets_scan_installed() {
	$out = array();
	if ( ! is_dir( ODDOUT_CURSORSETS_DIR ) ) {
		return $out;
	}
	$dirs = glob( rtrim( ODDOUT_CURSORSETS_DIR, '/' ) . '/*', GLOB_ONLYDIR );
	if ( ! is_array( $dirs ) ) {
		return $out;
	}
	foreach ( $dirs as $dir ) {
		$slug = basename( $dir );
		if ( '' === $slug || '.' === $slug[0] ) {
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
			'base_url' => ODDOUT_CURSORSETS_URL . rawurlencode( $slug ),
			'source'   => 'installed',
		);
	}
	return $out;
}
