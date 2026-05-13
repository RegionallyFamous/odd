<?php
/**
 * ODD — icon-set bundle installer.
 *
 * Installs `.wp` bundles that declare `"type": "icon-set"`. The
 * manifest format matches the one used by ODD's built-in sets under
 * `odd/assets/icons/` — `slug`, `label`, `accent`, `preview`, and an
 * `icons` map — so authors can copy one of the built-ins and rename.
 *
 * Installed sets live at `uploads/odd/icon-sets/<slug>/` and are
 * merged into {@see oddout_icons_get_sets()} by the registry, so every
 * consumer (panel, dock filter, tinted-SVG endpoint) sees them
 * identically to the plugin-bundled sets.
 *
 * SVG validation rejects scriptable or externally-loaded content so
 * installing a third-party set can't inject JavaScript into admin pages
 * that render the icon.
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
 * Required icon keys. Mirrors the keys the dock filter looks up in
 * {@see oddout_icons_slug_to_key()} — leaving any of these out means the
 * set can't fully re-skin the WP Desktop dock.
 */
function oddout_iconsets_required_keys() {
	return array(
		'dashboard',
		'posts',
		'pages',
		'media',
		'comments',
		'appearance',
		'plugins',
		'users',
		'tools',
		'settings',
		'fallback',
	);
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

		// Only SVGs are allowed — the registry and tinting logic both
		// assume SVG content.
		$ext = strtolower( pathinfo( $clean_rel, PATHINFO_EXTENSION ) );
		if ( 'svg' !== $ext ) {
			return new WP_Error(
				'invalid_icon_ext',
				sprintf( /* translators: %s icon filename */ __( 'Icon "%s" must be an SVG.', 'odd-outlandish-desktop-decorator' ), $clean_rel )
			);
		}

		$svg = $zip->getFromName( $clean_rel );
		if ( false === $svg ) {
			return new WP_Error(
				'missing_icon',
				sprintf( /* translators: %s icon filename */ __( 'Icon file "%s" was declared in the manifest but not found in the bundle.', 'odd-outlandish-desktop-decorator' ), $clean_rel )
			);
		}
		$scrubbed = oddout_iconset_svg_scrub( $svg );
		if ( is_wp_error( $scrubbed ) ) {
			return $scrubbed;
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
		if ( '' === $preview_rel || false === $zip->getFromName( $preview_rel ) ) {
			return new WP_Error( 'invalid_preview', __( 'Preview file is not present in the bundle.', 'odd-outlandish-desktop-decorator' ) );
		}
		$preview = $preview_rel;
	}

	$accent = isset( $manifest['accent'] ) ? trim( (string) $manifest['accent'] ) : '';
	if ( '' !== $accent && ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $accent ) ) {
		return new WP_Error( 'invalid_accent', __( 'Icon set accent must be a hex colour like #ffb000.', 'odd-outlandish-desktop-decorator' ) );
	}

	return array(
		'slug'        => $header['slug'],
		'name'        => $header['name'],
		'label'       => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'     => $header['version'],
		'type'        => 'icon-set',
		'author'      => $header['author'],
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'franchise'   => isset( $manifest['franchise'] ) ? sanitize_text_field( (string) $manifest['franchise'] ) : '',
		'accent'      => $accent ? $accent : '#3858e9',
		'preview'     => $preview,
		'icons'       => $icons,
	);
}

/**
 * Install a validated icon-set bundle. Extracts into
 * uploads/odd/icon-sets/<slug>/, writes the canonical
 * manifest.json (scrubbed + normalised), updates the installed-sets
 * index, and busts the icon-registry transient so the panel and
 * dock filter pick up the new set immediately.
 */
function oddout_iconset_bundle_install( $tmp_path, array $manifest ) {
	oddout_iconsets_ensure_storage();
	$slug = $manifest['slug'];

	$extracted = oddout_content_archive_extract( $tmp_path, ODDOUT_ICONSETS_DIR, $slug );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	$dir = oddout_iconsets_dir_for( $slug );

	// Post-extract: rewrite every SVG with its scrubbed form so the
	// bytes on disk match what validation accepted. This is a belt-
	// and-braces safeguard for the rare case where a malformed SVG
	// passed the cheap string filters on the validator pass but
	// would render with inert `on*` attributes if shipped as-is.
	foreach ( $manifest['icons'] as $rel ) {
		$abs = oddout_iconsets_resolve_path( $dir, $rel );
		if ( '' === $abs ) {
			continue;
		}
		$raw = file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false === $raw ) {
			continue;
		}
		$clean = oddout_iconset_svg_scrub( $raw );
		if ( is_wp_error( $clean ) ) {
			oddout_content_rrmdir( $dir );
			return $clean;
		}
		if ( ! oddout_write_file( $abs, $clean ) ) {
			oddout_content_rrmdir( $dir );
			return new WP_Error( 'write_failed', __( 'Could not write scrubbed icon file.', 'odd-outlandish-desktop-decorator' ) );
		}
	}

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
		'franchise' => $manifest['franchise'],
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

/**
 * Validate and normalize an SVG payload. Returns the cleaned string, or
 * a WP_Error if the input isn't a well-formed, passive SVG.
 *
 * Rejected surfaces:
 *   - Script-capable/foreign content (`script`, `foreignObject`, `image`, etc.).
 *   - Any `on*=` event attribute (onload, onclick, etc.).
 *   - `xlink:href`/`href` whose value isn't a fragment (`#…`).
 *   - Attributes outside the passive drawing allowlist.
 *   - Control bytes outside `\t\n\r` — same byte filter the catalog
 *     validators use.
 *
 * Tinting scenes still work: `currentColor` is a literal string and
 * our scrubber leaves it intact.
 */
function oddout_iconset_svg_scrub( $svg ) {
	$svg = (string) $svg;
	if ( '' === $svg ) {
		return new WP_Error( 'empty_svg', __( 'SVG file is empty.', 'odd-outlandish-desktop-decorator' ) );
	}
	// Control-byte reject. Matches the validator used by odd/bin/validate-icon-sets.
	if ( preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $svg ) ) {
		return new WP_Error( 'invalid_svg', __( 'SVG contains control bytes and cannot be installed.', 'odd-outlandish-desktop-decorator' ) );
	}
	// Require it to actually be an SVG.
	if ( false === stripos( $svg, '<svg' ) ) {
		return new WP_Error( 'invalid_svg', __( 'File is not an SVG.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( ! class_exists( 'DOMDocument' ) ) {
		return new WP_Error( 'svg_parser_unavailable', __( 'Server cannot safely validate SVG files.', 'odd-outlandish-desktop-decorator' ) );
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
		return new WP_Error( 'invalid_svg', __( 'File is not a well-formed SVG.', 'odd-outlandish-desktop-decorator' ) );
	}

	$allowed_elements = array_flip(
		array(
			'svg',
			'g',
			'defs',
			'title',
			'desc',
			'path',
			'rect',
			'circle',
			'ellipse',
			'line',
			'polyline',
			'polygon',
			'text',
			'tspan',
			'use',
			'clipPath',
			'mask',
			'linearGradient',
			'radialGradient',
			'stop',
			'filter',
			'feBlend',
			'feColorMatrix',
			'feComposite',
			'feDropShadow',
			'feFlood',
			'feGaussianBlur',
			'feMerge',
			'feMergeNode',
			'feMorphology',
			'feOffset',
		)
	);
	$allowed_attrs    = array_flip(
		array(
			'xmlns',
			'viewBox',
			'width',
			'height',
			'role',
			'aria-label',
			'id',
			'class',
			'x',
			'y',
			'x1',
			'y1',
			'x2',
			'y2',
			'cx',
			'cy',
			'r',
			'rx',
			'ry',
			'd',
			'points',
			'fill',
			'fill-opacity',
			'fill-rule',
			'stroke',
			'stroke-width',
			'stroke-linecap',
			'stroke-linejoin',
			'stroke-miterlimit',
			'stroke-opacity',
			'stroke-dasharray',
			'stroke-dashoffset',
			'opacity',
			'transform',
			'clip-path',
			'clip-rule',
			'mask',
			'filter',
			'offset',
			'stop-color',
			'stop-opacity',
			'gradientUnits',
			'gradientTransform',
			'font-family',
			'font-size',
			'font-weight',
			'letter-spacing',
			'text-anchor',
			'dominant-baseline',
			'textLength',
			'lengthAdjust',
			'dx',
			'dy',
			'stdDeviation',
			'flood-color',
			'flood-opacity',
			'in',
			'in2',
			'mode',
			'operator',
			'values',
			'result',
			'color-interpolation-filters',
			'href',
			'xlink:href',
			'xmlns:xlink',
		)
	);

	$nodes = $doc->getElementsByTagName( '*' );
	foreach ( $nodes as $node ) {
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOMElement API property.
		$tag = $node->localName;
		if ( ! isset( $allowed_elements[ $tag ] ) ) {
			return new WP_Error( 'disallowed_svg_element', sprintf( /* translators: %s SVG element */ __( 'SVG contains disallowed element: %s', 'odd-outlandish-desktop-decorator' ), $tag ) );
		}
		if ( ! $node->hasAttributes() ) {
			continue;
		}
		foreach ( iterator_to_array( $node->attributes ) as $attr ) {
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOMAttr API property.
			$name  = '' !== $attr->prefix ? $attr->prefix . ':' . $attr->localName : $attr->localName;
			$value = trim( (string) $attr->value );
			if ( 0 === stripos( $name, 'on' ) ) {
				return new WP_Error( 'disallowed_svg_attribute', __( 'SVG event handler attributes are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( ! isset( $allowed_attrs[ $name ] ) && 0 !== strpos( $name, 'data-' ) ) {
				return new WP_Error( 'disallowed_svg_attribute', sprintf( /* translators: %s SVG attribute */ __( 'SVG contains disallowed attribute: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
			}
			if ( in_array( $name, array( 'href', 'xlink:href' ), true ) && '' !== $value && '#' !== $value[0] ) {
				return new WP_Error( 'disallowed_svg_reference', __( 'SVG external references are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( false !== stripos( $value, 'url(' ) && ! preg_match( '/url\(\s*#[^)]+\)/i', $value ) ) {
				return new WP_Error( 'disallowed_svg_reference', __( 'SVG external url() references are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( preg_match( '/(?:javascript|data|vbscript)\s*:/i', $value ) ) {
				return new WP_Error( 'disallowed_svg_reference', __( 'SVG scriptable URL values are not allowed.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
	}

	return $svg;
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
