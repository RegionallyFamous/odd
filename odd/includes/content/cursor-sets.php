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

function oddout_cursorsets_base_dir() {
	return function_exists( 'oddout_storage_dir' ) ? oddout_storage_dir( 'cursor-sets' ) : ODDOUT_CURSORSETS_DIR;
}

function oddout_cursorsets_base_url() {
	return function_exists( 'oddout_storage_url' ) ? oddout_storage_url( 'cursor-sets' ) : ODDOUT_CURSORSETS_URL;
}

function oddout_cursorsets_dir_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	$base = oddout_cursorsets_base_dir();
	return '' === $slug || '' === $base ? '' : $base . $slug . '/';
}

function oddout_cursorsets_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	$base = oddout_cursorsets_base_url();
	return '' === $slug || '' === $base ? '' : $base . $slug . '/';
}

function oddout_cursorsets_asset_path( $slug, $file ) {
	$slug = sanitize_key( (string) $slug );
	$file = function_exists( 'oddout_content_sanitize_relative_path' ) ? oddout_content_sanitize_relative_path( (string) $file ) : '';
	if ( '' === $slug || '' === $file || 'svg' !== strtolower( pathinfo( $file, PATHINFO_EXTENSION ) ) ) {
		return '';
	}
	$dir = oddout_cursorsets_dir_for( $slug );
	return '' === $dir || ! function_exists( 'oddout_content_resolve_path' ) ? '' : oddout_content_resolve_path( $dir, $file );
}

function oddout_cursorsets_asset_url( $slug, $file ) {
	$slug = sanitize_key( (string) $slug );
	$file = function_exists( 'oddout_content_sanitize_relative_path' ) ? oddout_content_sanitize_relative_path( (string) $file ) : '';
	if ( '' === $slug || '' === $file || 'svg' !== strtolower( pathinfo( $file, PATHINFO_EXTENSION ) ) ) {
		return '';
	}
	return esc_url_raw(
		add_query_arg(
			array( 'file' => $file ),
			oddout_https_rest_url( 'odd/v1/cursors/asset/' . $slug )
		)
	);
}

function oddout_cursorsets_ensure_storage() {
	$base = oddout_cursorsets_base_dir();
	if ( '' === $base ) {
		return false;
	}
	if ( ! is_dir( $base ) ) {
		return wp_mkdir_p( $base );
	}
	return true;
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

function oddout_cursorset_preview_svg_validate( $svg ) {
	$svg = (string) $svg;
	if ( '' === $svg ) {
		return new WP_Error( 'empty_svg', __( 'Preview SVG file is empty.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $svg ) ) {
		return new WP_Error( 'invalid_svg', __( 'Preview SVG contains control bytes and cannot be installed.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( false === stripos( $svg, '<svg' ) ) {
		return new WP_Error( 'invalid_svg', __( 'Preview file is not an SVG.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! class_exists( 'DOMDocument' ) ) {
		return new WP_Error( 'svg_parser_unavailable', __( 'Server cannot safely validate SVG preview files.', 'odd-outlandish-desktop-decorator' ) );
	}

	$doc = new DOMDocument();
	$old = libxml_use_internal_errors( true );
	$ok  = $doc->loadXML( $svg, LIBXML_NONET );
	libxml_clear_errors();
	libxml_use_internal_errors( $old );
	// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOMDocument API property.
	$document_element = $doc->documentElement;
	// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOMElement API property.
	if ( ! $ok || ! $document_element || 'svg' !== strtolower( $document_element->localName ) ) {
		return new WP_Error( 'invalid_svg', __( 'Preview file is not a well-formed SVG.', 'odd-outlandish-desktop-decorator' ) );
	}

	$blocked_elements = array_flip( array( 'script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'image' ) );
	foreach ( $doc->getElementsByTagName( '*' ) as $node ) {
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOMElement API property.
		$tag = $node->localName;
		if ( isset( $blocked_elements[ $tag ] ) ) {
			return new WP_Error( 'disallowed_svg_element', sprintf( /* translators: %s SVG element */ __( 'Preview SVG contains disallowed element: %s', 'odd-outlandish-desktop-decorator' ), $tag ) );
		}
		if ( ! $node->hasAttributes() ) {
			continue;
		}
		foreach ( iterator_to_array( $node->attributes ) as $attr ) {
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOMAttr API property.
			$name  = '' !== $attr->prefix ? $attr->prefix . ':' . $attr->localName : $attr->localName;
			$value = trim( (string) $attr->value );
			if ( 0 === stripos( $name, 'on' ) ) {
				return new WP_Error( 'disallowed_svg_attribute', __( 'Preview SVG event handler attributes are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( in_array( $name, array( 'href', 'xlink:href' ), true ) && '' !== $value && '#' !== $value[0] ) {
				return new WP_Error( 'disallowed_svg_reference', __( 'Preview SVG external references are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( false !== stripos( $value, 'url(' ) && ! preg_match( '/url\(\s*#[^)]+\)/i', $value ) ) {
				return new WP_Error( 'disallowed_svg_reference', __( 'Preview SVG external url() references are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( preg_match( '/(?:javascript|data|vbscript)\s*:/i', $value ) ) {
				return new WP_Error( 'disallowed_svg_reference', __( 'Preview SVG scriptable URL values are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
	}

	return true;
}

function oddout_cursorset_bundle_validate( $tmp_path, $filename, ZipArchive $zip, array $manifest ) {
	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	if ( ! empty( $manifest['cursors'] ) ) {
		return new WP_Error( 'invalid_manifest', __( 'Cursor effect packs must not include cursor image files.', 'odd-outlandish-desktop-decorator' ) );
	}

	$preview = '';
	if ( ! empty( $manifest['preview'] ) ) {
		$preview_rel = oddout_content_sanitize_relative_path( (string) $manifest['preview'] );
		if ( '' === $preview_rel || false === $zip->getFromName( $preview_rel ) ) {
			return new WP_Error( 'invalid_preview', __( 'Preview file is not present in the bundle.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( 'svg' !== strtolower( pathinfo( $preview_rel, PATHINFO_EXTENSION ) ) ) {
			return new WP_Error( 'invalid_preview', __( 'Cursor effect preview files must be SVG.', 'odd-outlandish-desktop-decorator' ) );
		}
		$preview_valid = oddout_cursorset_preview_svg_validate( $zip->getFromName( $preview_rel ) );
		if ( is_wp_error( $preview_valid ) ) {
			return $preview_valid;
		}
		$preview = $preview_rel;
	}

	$accent = isset( $manifest['accent'] ) ? trim( (string) $manifest['accent'] ) : '';
	if ( '' !== $accent && ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $accent ) ) {
		return new WP_Error( 'invalid_accent', __( 'Cursor set accent must be a hex colour like #38e8ff.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( isset( $manifest['effects'] ) && ! is_array( $manifest['effects'] ) ) {
		return new WP_Error( 'invalid_effects', __( 'Cursor effect tokens must be an object.', 'odd-outlandish-desktop-decorator' ) );
	}
	$allowed_effects = array( 'accent' => true, 'spark' => true, 'warm' => true, 'ink' => true, 'recipe' => true );
	$allowed_recipes = function_exists( 'oddout_cursors_allowed_recipes' ) ? oddout_cursors_allowed_recipes() : array( 'signal-bloom', 'gel-pop', 'paper-sparks', 'solar-orbit', 'moonlight-focus' );
	foreach ( isset( $manifest['effects'] ) && is_array( $manifest['effects'] ) ? $manifest['effects'] : array() as $key => $value ) {
		if ( empty( $allowed_effects[ (string) $key ] ) ) {
			return new WP_Error( 'invalid_effects', __( 'Cursor effect packs may only define accent, spark, warm, ink, and recipe tokens.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( 'recipe' === (string) $key ) {
			if ( ! is_string( $value ) || ! in_array( sanitize_key( $value ), $allowed_recipes, true ) ) {
				return new WP_Error( 'invalid_effects', __( 'Cursor effect recipe is not supported.', 'odd-outlandish-desktop-decorator' ) );
			}
			continue;
		}
		if ( ! is_string( $value ) || ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $value ) ) {
			return new WP_Error( 'invalid_effects', __( 'Cursor effect tokens must be hex colours like #38e8ff.', 'odd-outlandish-desktop-decorator' ) );
		}
	}
	$effects = function_exists( 'oddout_cursors_clean_effects' ) ? oddout_cursors_clean_effects( $manifest ) : array();

	return array(
		'slug'        => $header['slug'],
		'name'        => $header['name'],
		'label'       => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'     => $header['version'],
		'type'        => 'cursor-set',
		'author'      => $header['author'],
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'category'    => isset( $manifest['category'] ) ? sanitize_text_field( (string) $manifest['category'] ) : '',
		'accent'      => $accent ? $accent : '#38e8ff',
		'preview'     => $preview,
		'effects'     => $effects,
		'cursors'     => array(),
	);
}

function oddout_cursorset_bundle_install( $tmp_path, array $manifest ) {
	if ( ! oddout_cursorsets_ensure_storage() ) {
		return new WP_Error( 'storage_unavailable', __( 'Cursor set storage is unavailable.', 'odd-outlandish-desktop-decorator' ) );
	}
	$slug      = $manifest['slug'];
	$extracted = oddout_content_archive_extract( $tmp_path, oddout_cursorsets_base_dir(), $slug );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	$dir       = oddout_cursorsets_dir_for( $slug );
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
		'category'  => $manifest['category'],
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
	$out      = array();
	$base_dir = oddout_cursorsets_base_dir();
	if ( '' === $base_dir || ! is_dir( $base_dir ) ) {
		return $out;
	}
	$dirs = glob( rtrim( $base_dir, '/' ) . '/*', GLOB_ONLYDIR );
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
			'base_url' => '',
			'source'   => 'installed',
		);
	}
	return $out;
}
