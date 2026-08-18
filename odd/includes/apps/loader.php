<?php
/**
 * ODD Apps — archive loader.
 *
 * Validates and extracts `.wp` archives.
 *
 * The validation pipeline follows a conventional allowlist-first ZIP path:
 *
 *   1. Extension allowlist           (.wp)
 *   2. ZIP integrity                 ZipArchive::open RDONLY
 *   3. File count cap                2000 entries max
 *   4. Per-entry checks              path traversal, symlinks, forbidden
 *                                    extensions, per-file compression ratio
 *   5. Total uncompressed cap        ODDOUT_APPS_MAX_UNCOMPRESSED
 *   6. manifest.json at root
 *   7. Required fields               type, name, slug, version, entry, icon
 *   8. Slug format                   ^[a-z0-9][a-z0-9-]*$, 64 chars max
 *   9. Slug uniqueness               registry lookup
 *  10. Entry path validation         ^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$
 *  11. Entry file present in archive
 *
 * Extraction uses unzip_file() into a staging directory, then moves
 * into place. A post-extract symlink sweep runs as belt-and-braces
 * against non-Unix zip tools that bypass the `external_attr` check.
 *
 * Server-executable extensions that are rejected in validation:
 * php, phtml, phar, versioned php suffixes, phps, cgi, pl, py, rb, sh, bash.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Extensions that must never appear inside an app archive.
 */
function oddout_apps_forbidden_extensions() {
	return array(
		'php',
		'phtml',
		'phar',
		'php3',
		'php4',
		'php5',
		'php7',
		'phps',
		'cgi',
		'pl',
		'py',
		'rb',
		'sh',
		'bash',
	);
}

/** Reject executable suffixes, including current and future versioned PHP forms. */
function oddout_apps_extension_is_forbidden( $extension ) {
	$extension = strtolower( ltrim( (string) $extension, '.' ) );
	return in_array( $extension, oddout_apps_forbidden_extensions(), true ) || (bool) preg_match( '/^php[0-9]+$/', $extension );
}

/** Reject traversal components without banning safe same-segment double dots. */
function oddout_apps_path_has_parent_component( $path ) {
	return in_array( '..', explode( '/', (string) $path ), true );
}

/**
 * Count Unicode characters using the same unit as JSON Schema maxLength.
 *
 * json_decode() has already rejected malformed UTF-8 before this helper is
 * called. The PCRE fallback keeps schema parity on hosts without mbstring.
 *
 * @param string $value Manifest string value.
 * @return int|false Character count, or false for invalid UTF-8.
 */
function oddout_apps_manifest_string_length( $value ) {
	if ( function_exists( 'mb_strlen' ) ) {
		return mb_strlen( $value, 'UTF-8' );
	}

	return preg_match_all( '/./us', $value );
}

/**
 * Run the full validation pipeline on a file. Returns the parsed
 * manifest on success or a WP_Error on failure.
 *
 * @param string $tmp_path Absolute path to the uploaded archive.
 * @param string $filename Original filename, used for the extension check.
 * @return array|WP_Error
 */
function oddout_apps_validate_archive( $tmp_path, $filename ) {
	$ext = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
	if ( 'wp' !== $ext ) {
		return new WP_Error( 'invalid_extension', __( 'App archives must have a .wp extension.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error( 'zip_unavailable', __( 'PHP ZipArchive extension is required to install apps.', 'odd-outlandish-desktop-decorator' ) );
	}

	$zip    = new ZipArchive();
	$status = $zip->open( $tmp_path, ZipArchive::RDONLY );
	if ( true !== $status ) {
		return new WP_Error( 'invalid_zip', __( 'File is not a valid ZIP archive.', 'odd-outlandish-desktop-decorator' ) );
	}

	$count = $zip->count();
	if ( $count > 2000 ) {
		$zip->close();
		return new WP_Error( 'too_many_files', __( 'App archive exceeds 2000 files.', 'odd-outlandish-desktop-decorator' ) );
	}

	$forbidden          = oddout_apps_forbidden_extensions();
	$total_uncompressed = 0;
	$archive_files      = array();
	for ( $i = 0; $i < $count; $i++ ) {
		$stat = $zip->statIndex( $i );
		if ( false === $stat ) {
			$zip->close();
			return new WP_Error( 'corrupt_archive', __( 'Archive contains an unreadable entry.', 'odd-outlandish-desktop-decorator' ) );
		}
		$name = $stat['name'];

		if (
			'' === $name ||
			false !== strpos( $name, "\0" ) ||
			false !== strpos( $name, '\\' ) ||
			oddout_apps_path_has_parent_component( $name ) ||
			'/' === $name[0]
		) {
			$zip->close();
			return new WP_Error( 'path_traversal', sprintf( /* translators: %s filename */ __( 'Archive contains a path-traversal entry: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}
		$path_parts = array_values( array_filter( explode( '/', rtrim( $name, '/' ) ), 'strlen' ) );
		foreach ( $path_parts as $path_part ) {
			if ( '.' === $path_part || ( isset( $path_part[0] ) && '.' === $path_part[0] ) ) {
				$zip->close();
				return new WP_Error( 'hidden_file', sprintf( /* translators: %s filename */ __( 'Archive contains a hidden file or directory: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
			}
		}
		if ( '/' !== substr( $name, -1 ) ) {
			if ( isset( $archive_files[ $name ] ) ) {
				$zip->close();
				return new WP_Error( 'duplicate_file', sprintf( /* translators: %s filename */ __( 'Archive contains a duplicate file: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
			}
			$archive_files[ $name ] = true;
		}

		$opsys   = 0;
		$extattr = 0;
		$zip->getExternalAttributesIndex( $i, $opsys, $extattr );
		if ( ( ( $extattr >> 16 ) & 0xF000 ) === 0xA000 ) {
			$zip->close();
			return new WP_Error( 'symlink_in_archive', sprintf( /* translators: %s filename */ __( 'Archive contains a symlink: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}

		$file_ext = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( in_array( $file_ext, $forbidden, true ) || oddout_apps_extension_is_forbidden( $file_ext ) ) {
			$zip->close();
			return new WP_Error( 'forbidden_file_type', sprintf( /* translators: %s entry name */ __( 'Server-executable files are not allowed. Found: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}
		if ( in_array( $file_ext, array( 'js', 'mjs' ), true ) ) {
			$source = $zip->getFromIndex( $i );
			if ( false === $source ) {
				$zip->close();
				return new WP_Error( 'corrupt_archive', sprintf( /* translators: %s filename */ __( 'Archive contains an unreadable script: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
			}
			if ( preg_match( '/\b(?:navigator\s*\.\s*)?serviceWorker\b/', $source ) ) {
				$zip->close();
				return new WP_Error( 'service_worker_forbidden', sprintf( /* translators: %s filename */ __( 'App service workers are not allowed. Found in: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
			}
			if ( preg_match( '/\b(?:from\s*|import\s*)(?:\([^)]*)?[\'\"](?![.\/]|https?:\/\/)([^\'\"]+)[\'\"]/', $source, $match ) ) {
				$zip->close();
				return new WP_Error( 'bare_import_forbidden', sprintf( /* translators: 1 module name 2 filename */ __( 'App contains unresolved module import "%1$s" in %2$s.', 'odd-outlandish-desktop-decorator' ), $match[1], $name ) );
			}
		}

		$compressed   = (int) $stat['comp_size'];
		$uncompressed = (int) $stat['size'];
		if ( $compressed > 0 && $uncompressed > 0 ) {
			$ratio = $uncompressed / $compressed;
			if ( $ratio > 100 ) {
				$zip->close();
				return new WP_Error( 'zip_bomb', sprintf( /* translators: 1 entry name, 2 ratio */ __( 'Suspicious compression ratio (%2$d:1) in %1$s.', 'odd-outlandish-desktop-decorator' ), $name, (int) $ratio ) );
			}
		}
		$total_uncompressed += $uncompressed;
	}

	$max = (int) apply_filters( 'oddout_apps_max_uncompressed', ODDOUT_APPS_MAX_UNCOMPRESSED );
	if ( $total_uncompressed > $max ) {
		$zip->close();
		return new WP_Error(
			'too_large',
			sprintf(
				/* translators: 1 uncompressed MB 2 max MB */
				__( 'App is too large (%1$s MB uncompressed). Maximum is %2$s MB.', 'odd-outlandish-desktop-decorator' ),
				number_format_i18n( $total_uncompressed / 1024 / 1024, 1 ),
				number_format_i18n( $max / 1024 / 1024, 1 )
			)
		);
	}

	$raw = $zip->getFromName( 'manifest.json' );
	if ( false === $raw ) {
		$zip->close();
		return new WP_Error( 'missing_manifest', __( 'manifest.json was not found at the archive root.', 'odd-outlandish-desktop-decorator' ) );
	}
	$manifest        = json_decode( $raw, true );
	$manifest_object = json_decode( $raw );
	if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $manifest ) || ! is_object( $manifest_object ) ) {
		$zip->close();
		return new WP_Error( 'invalid_manifest', __( 'manifest.json must be a valid JSON object.', 'odd-outlandish-desktop-decorator' ) );
	}
	$manifest_shapes = get_object_vars( $manifest_object );

	foreach ( array( 'type', 'name', 'slug', 'version', 'entry', 'icon' ) as $field ) {
		if ( ! array_key_exists( $field, $manifest ) || ! is_string( $manifest[ $field ] ) || '' === $manifest[ $field ] ) {
			$zip->close();
			return new WP_Error( 'missing_manifest_field', sprintf( /* translators: %s manifest field */ __( 'manifest.json is missing required field: %s', 'odd-outlandish-desktop-decorator' ), $field ) );
		}
	}

	if ( 'app' !== $manifest['type'] ) {
		$zip->close();
		return new WP_Error( 'invalid_type', __( 'App archives must declare manifest type "app".', 'odd-outlandish-desktop-decorator' ) );
	}

	$manifest_string_limits = array(
		'name'        => 80,
		'author'      => 120,
		'description' => 500,
	);
	foreach ( $manifest_string_limits as $field => $limit ) {
		if ( ! array_key_exists( $field, $manifest ) ) {
			continue;
		}
		$length = is_string( $manifest[ $field ] ) ? oddout_apps_manifest_string_length( $manifest[ $field ] ) : false;
		if ( false === $length || $length > $limit ) {
			$zip->close();
			return new WP_Error(
				'invalid_' . $field,
				sprintf(
					/* translators: 1 manifest field name, 2 maximum character count. */
					__( 'Manifest %1$s must be text of at most %2$d characters.', 'odd-outlandish-desktop-decorator' ),
					$field,
					$limit
				)
			);
		}
	}
	if ( array_key_exists( '$schema', $manifest ) && ! is_string( $manifest['$schema'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_schema', __( 'Manifest $schema must be text.', 'odd-outlandish-desktop-decorator' ) );
	}

	$allowed_manifest_fields = array(
		'$schema',
		'type',
		'name',
		'slug',
		'version',
		'author',
		'description',
		'entry',
		'icon',
		'capability',
		'native',
		'window',
		'desktopIcon',
		'surfaces',
	);
	$unknown_manifest_fields = array_diff( array_keys( $manifest ), $allowed_manifest_fields );
	if ( ! empty( $unknown_manifest_fields ) ) {
		$zip->close();
		return new WP_Error(
			'unknown_manifest_field',
			sprintf(
				/* translators: %s comma-separated manifest keys. */
				__( 'App manifest contains unsupported fields: %s', 'odd-outlandish-desktop-decorator' ),
				implode( ', ', array_map( 'sanitize_key', $unknown_manifest_fields ) )
			)
		);
	}

	if ( strlen( $manifest['slug'] ) > 64 || ! preg_match( '/^[a-z0-9][a-z0-9-]*$/D', $manifest['slug'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_slug', __( 'App slug must start with a lowercase letter or number, contain only lowercase letters, numbers, and hyphens, and be at most 64 characters.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! preg_match( '/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/', $manifest['version'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_version', __( 'App version must use semantic versioning.', 'odd-outlandish-desktop-decorator' ) );
	}

	$entry = isset( $manifest['entry'] ) ? (string) $manifest['entry'] : 'index.html';
	if (
		oddout_apps_path_has_parent_component( $entry ) ||
		( strlen( $entry ) > 0 && '/' === $entry[0] ) ||
		! preg_match( '#^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$#', $entry )
	) {
		$zip->close();
		return new WP_Error( 'invalid_entry', __( 'Manifest entry path contains invalid characters or path traversal.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( false === $zip->getFromName( $entry ) ) {
		$zip->close();
		return new WP_Error( 'missing_entry', sprintf( /* translators: %s entry */ __( 'Entry file "%s" not found in archive.', 'odd-outlandish-desktop-decorator' ), $entry ) );
	}
	if ( in_array( strtolower( pathinfo( $entry, PATHINFO_EXTENSION ) ), array( 'html', 'htm' ), true ) ) {
		$entry_html = $zip->getFromName( $entry );
		if ( false === $entry_html ) {
			$zip->close();
			return new WP_Error( 'missing_entry', __( 'App entry could not be read.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( preg_match( '/<base\b/i', $entry_html ) ) {
			$zip->close();
			return new WP_Error( 'unsafe_entry', __( 'App entries may not override the document base URL.', 'odd-outlandish-desktop-decorator' ) );
		}
		preg_match_all( '/\b(?:src|href)\s*=\s*([\'\"])(.*?)\1/i', $entry_html, $references );
		$entry_dir = dirname( $entry );
		foreach ( $references[2] as $reference ) {
			if ( '' === $reference || 0 === strpos( $reference, '#' ) || 0 === strpos( $reference, 'data:' ) ) {
				continue;
			}
			if ( '/' === $reference[0] || 0 === strpos( $reference, '//' ) || preg_match( '/^[a-z][a-z0-9+.-]*:/i', $reference ) ) {
				$zip->close();
				return new WP_Error( 'external_asset_forbidden', sprintf( /* translators: %s asset URL */ __( 'App entry contains a non-local asset reference: %s', 'odd-outlandish-desktop-decorator' ), $reference ) );
			}
			$asset_path = preg_split( '/[?#]/', $reference, 2 )[0];
			if ( false !== strpos( $asset_path, '%' ) ) {
				$zip->close();
				return new WP_Error( 'unsafe_asset_path', sprintf( /* translators: %s asset path */ __( 'App entry contains an unsafe asset path: %s', 'odd-outlandish-desktop-decorator' ), $reference ) );
			}
			$asset_parts = array();
			$base_parts  = '.' === $entry_dir ? array() : explode( '/', $entry_dir );
			foreach ( array_merge( $base_parts, explode( '/', $asset_path ) ) as $part ) {
				if ( '' === $part || '.' === $part ) {
					continue;
				}
				if ( '..' === $part || ( isset( $part[0] ) && '.' === $part[0] ) ) {
					$zip->close();
					return new WP_Error( 'unsafe_asset_path', sprintf( /* translators: %s asset path */ __( 'App entry contains an unsafe asset path: %s', 'odd-outlandish-desktop-decorator' ), $reference ) );
				}
				$asset_parts[] = $part;
			}
			$resolved_asset = implode( '/', $asset_parts );
			if ( '' === $resolved_asset || ! isset( $archive_files[ $resolved_asset ] ) ) {
				$zip->close();
				return new WP_Error( 'missing_entry_asset', sprintf( /* translators: %s asset path */ __( 'App entry references a missing asset: %s', 'odd-outlandish-desktop-decorator' ), $reference ) );
			}
		}
	}

	$icon = (string) $manifest['icon'];
	if (
		oddout_apps_path_has_parent_component( $icon ) ||
		( strlen( $icon ) > 0 && '/' === $icon[0] ) ||
		false !== strpos( $icon, "\0" ) ||
		! preg_match( '#^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)*\.(?:svg|png|webp)$#', $icon )
	) {
		$zip->close();
		return new WP_Error( 'invalid_icon', __( 'Manifest icon must be a safe relative path ending in .svg, .png, or .webp.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( false === $zip->getFromName( $icon ) ) {
		$zip->close();
		return new WP_Error( 'missing_icon', sprintf( /* translators: %s icon */ __( 'Icon file "%s" not found in archive.', 'odd-outlandish-desktop-decorator' ), $icon ) );
	}
	$manifest['icon'] = $icon;

	if (
		array_key_exists( 'capability', $manifest ) &&
		( ! is_string( $manifest['capability'] ) || ! preg_match( '/^[a-z0-9_]+$/', $manifest['capability'] ) )
	) {
		$zip->close();
		return new WP_Error( 'invalid_capability', __( 'Manifest capability is invalid.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( array_key_exists( 'surfaces', $manifest ) ) {
		if ( ! is_object( $manifest_shapes['surfaces'] ) || ! is_array( $manifest['surfaces'] ) || array_diff( array_keys( $manifest['surfaces'] ), array( 'desktop', 'taskbar' ) ) ) {
			$zip->close();
			return new WP_Error( 'invalid_surfaces', __( 'Manifest surfaces may contain only desktop and taskbar.', 'odd-outlandish-desktop-decorator' ) );
		}
		foreach ( $manifest['surfaces'] as $surface ) {
			if ( ! is_bool( $surface ) ) {
				$zip->close();
				return new WP_Error( 'invalid_surfaces', __( 'Manifest surface values must be boolean.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
	}
	if ( array_key_exists( 'window', $manifest ) && ( ! is_object( $manifest_shapes['window'] ) || ! is_array( $manifest['window'] ) ) ) {
		$zip->close();
		return new WP_Error( 'invalid_window', __( 'Manifest window must be an object.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( array_key_exists( 'window', $manifest ) ) {
		$window_fields = array( 'title', 'width', 'height', 'minWidth', 'minHeight', 'min_width', 'min_height', 'resizable' );
		if ( array_diff( array_keys( $manifest['window'] ), $window_fields ) ) {
			$zip->close();
			return new WP_Error( 'invalid_window', __( 'Manifest window contains unsupported fields.', 'odd-outlandish-desktop-decorator' ) );
		}
		$window_bounds = array(
			'width'      => array( 320, 1600 ),
			'height'     => array( 240, 1200 ),
			'minWidth'   => array( 240, 1600 ),
			'minHeight'  => array( 180, 1200 ),
			'min_width'  => array( 240, 1600 ),
			'min_height' => array( 180, 1200 ),
		);
		foreach ( $window_bounds as $field => $bounds ) {
			if (
				array_key_exists( $field, $manifest['window'] ) &&
				(
					! is_int( $manifest['window'][ $field ] ) ||
					$manifest['window'][ $field ] < $bounds[0] ||
					$manifest['window'][ $field ] > $bounds[1]
				)
			) {
				$zip->close();
				return new WP_Error( 'invalid_window', __( 'Manifest window dimensions are outside the supported range.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		$width      = isset( $manifest['window']['width'] ) ? (int) $manifest['window']['width'] : 860;
		$height     = isset( $manifest['window']['height'] ) ? (int) $manifest['window']['height'] : 600;
		$min_width  = isset( $manifest['window']['minWidth'] )
			? (int) $manifest['window']['minWidth']
			: ( isset( $manifest['window']['min_width'] ) ? (int) $manifest['window']['min_width'] : 420 );
		$min_height = isset( $manifest['window']['minHeight'] )
			? (int) $manifest['window']['minHeight']
			: ( isset( $manifest['window']['min_height'] ) ? (int) $manifest['window']['min_height'] : 320 );
		if ( $min_width > $width || $min_height > $height ) {
			$zip->close();
			return new WP_Error( 'invalid_window', __( 'Manifest minimum dimensions may not exceed its initial window dimensions.', 'odd-outlandish-desktop-decorator' ) );
		}
		if (
			array_key_exists( 'title', $manifest['window'] ) &&
			(
				! is_string( $manifest['window']['title'] ) ||
				false === oddout_apps_manifest_string_length( $manifest['window']['title'] ) ||
				oddout_apps_manifest_string_length( $manifest['window']['title'] ) > 80
			)
		) {
			$zip->close();
			return new WP_Error( 'invalid_window', __( 'Manifest window title must be text of at most 80 characters.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( array_key_exists( 'resizable', $manifest['window'] ) && ! is_bool( $manifest['window']['resizable'] ) ) {
			$zip->close();
			return new WP_Error( 'invalid_window', __( 'Manifest window resizable value must be boolean.', 'odd-outlandish-desktop-decorator' ) );
		}
	}
	if ( array_key_exists( 'desktopIcon', $manifest ) && ( ! is_object( $manifest_shapes['desktopIcon'] ) || ! is_array( $manifest['desktopIcon'] ) ) ) {
		$zip->close();
		return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon must be an object.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( array_key_exists( 'desktopIcon', $manifest ) ) {
		if ( array_diff( array_keys( $manifest['desktopIcon'] ), array( 'title', 'position' ) ) ) {
			$zip->close();
			return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon contains unsupported fields.', 'odd-outlandish-desktop-decorator' ) );
		}
		if (
			array_key_exists( 'title', $manifest['desktopIcon'] ) &&
			(
				! is_string( $manifest['desktopIcon']['title'] ) ||
				false === oddout_apps_manifest_string_length( $manifest['desktopIcon']['title'] ) ||
				oddout_apps_manifest_string_length( $manifest['desktopIcon']['title'] ) > 80
			)
		) {
			$zip->close();
			return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon title must be text of at most 80 characters.', 'odd-outlandish-desktop-decorator' ) );
		}
		if (
			array_key_exists( 'position', $manifest['desktopIcon'] ) &&
			(
				! is_int( $manifest['desktopIcon']['position'] ) ||
				$manifest['desktopIcon']['position'] < 0 ||
				$manifest['desktopIcon']['position'] > 10000
			)
		) {
			$zip->close();
			return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon position must be an integer from 0 through 10000.', 'odd-outlandish-desktop-decorator' ) );
		}
	}
	if ( array_key_exists( 'native', $manifest ) ) {
		if ( ! is_object( $manifest_shapes['native'] ) || ! is_array( $manifest['native'] ) ) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'Manifest native must be an object.', 'odd-outlandish-desktop-decorator' ) );
		}

		$native = $manifest['native'];
		if ( 'odd-notes' !== $manifest['slug'] ) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'Only the bundled ODD Notes app may use the native app surface.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( array_diff( array_keys( $native ), array( 'script', 'style', 'template' ) ) ) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'Manifest native contains unsupported fields.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( array_key_exists( 'style', $native ) && ! is_string( $native['style'] ) ) {
			$zip->close();
			return new WP_Error( 'invalid_native_asset', __( 'Manifest native style must be a relative CSS path.', 'odd-outlandish-desktop-decorator' ) );
		}
		$script = array_key_exists( 'script', $native ) && is_string( $native['script'] ) ? $native['script'] : '';
		$style  = array_key_exists( 'style', $native ) ? $native['style'] : '';
		if ( '' === $script ) {
			$zip->close();
			return new WP_Error( 'missing_native_script', __( 'Native apps must declare native.script.', 'odd-outlandish-desktop-decorator' ) );
		}
		if (
			array_key_exists( 'template', $native ) &&
			( ! is_string( $native['template'] ) || ! preg_match( '/^[a-z0-9][a-z0-9-]*$/', $native['template'] ) )
		) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'Manifest native template must be a lowercase slug.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( array_key_exists( 'template', $native ) && 'odd-notes' !== $native['template'] ) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'ODD Notes must use its registered native template.', 'odd-outlandish-desktop-decorator' ) );
		}

		$native_assets = array( 'script' => $script );
		if ( array_key_exists( 'style', $native ) ) {
			$native_assets['style'] = $style;
		}
		foreach ( $native_assets as $kind => $asset ) {
			$pattern = 'script' === $kind
				? '#^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)*\.js$#'
				: '#^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)*\.css$#';
			if (
				oddout_apps_path_has_parent_component( $asset ) ||
				( strlen( $asset ) > 0 && '/' === $asset[0] ) ||
				! preg_match( $pattern, $asset )
			) {
				$zip->close();
				return new WP_Error( 'invalid_native_asset', __( 'Native app assets must use safe relative paths ending in lowercase .js or .css.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		foreach ( $native_assets as $asset ) {
			if ( false === $zip->getFromName( $asset ) ) {
				$zip->close();
				return new WP_Error( 'missing_native_asset', sprintf( /* translators: %s asset path. */ __( 'Native app asset "%s" was not found.', 'odd-outlandish-desktop-decorator' ), $asset ) );
			}
		}

		$manifest['native'] = array( 'script' => $script );
		if ( array_key_exists( 'style', $native ) ) {
			$manifest['native']['style'] = $style;
		}
		if ( array_key_exists( 'template', $native ) ) {
			$manifest['native']['template'] = $native['template'];
		}
	}

	$zip->close();
	$manifest['entry'] = $entry;
	return $manifest;
}

/**
 * Install a validated archive. Stages extraction in a temporary
 * directory and then moves into place so a half-extracted app is
 * never visible to the REST server.
 */
function oddout_apps_new_staging_path( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-' . wp_generate_password( 8, false );
}

/** Run an optional transaction lease assertion before a filesystem mutation. */
function oddout_apps_check_transaction_lease( $lease_check ) {
	if ( ! is_callable( $lease_check ) ) {
		return true;
	}
	$result = $lease_check();
	return true === $result || is_wp_error( $result )
		? $result
		: new WP_Error( 'transaction_lease_lost', __( 'This app change no longer owns its transaction lease.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
}

/** Remove staging and prove it is gone before its recovery journal is deleted. */
function oddout_apps_cleanup_staging( $staging, $lease_check = null ) {
	$lease = oddout_apps_check_transaction_lease( $lease_check );
	if ( is_wp_error( $lease ) ) {
		return $lease;
	}
	if ( (bool) apply_filters( 'oddout_apps_staging_cleanup_should_fail', false, $staging ) ) {
		return new WP_Error( 'transaction_staging_cleanup_failed', __( 'Could not clean an interrupted app transaction.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( file_exists( $staging ) || is_link( $staging ) ) {
		oddout_apps_rrmdir( $staging );
	}
	return file_exists( $staging ) || is_link( $staging )
		? new WP_Error( 'transaction_staging_cleanup_failed', __( 'Could not clean an interrupted app transaction.', 'odd-outlandish-desktop-decorator' ) )
		: true;
}

function oddout_apps_stage_archive( $tmp_path, $slug, $staging = '', $lease_check = null ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	oddout_apps_ensure_storage();
	$staging = rtrim( (string) $staging, '/\\' );
	if ( '' === $staging ) {
		$staging = oddout_apps_new_staging_path( $slug );
	}
	$expected_prefix = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-';
	if ( 0 !== strpos( $staging, $expected_prefix ) || false !== strpos( substr( $staging, strlen( $expected_prefix ) ), '/' ) ) {
		return new WP_Error( 'invalid_staging', __( 'The app staging path is invalid.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( ! function_exists( 'unzip_file' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}

	// unzip_file() needs a populated $wp_filesystem global. When the
	// REST pipeline runs outside wp-admin (which is our common case,
	// including Playground), that global isn't auto-initialized and
	// unzip_file returns the infamously-opaque WP_Error "Empty
	// filesystem", which the panel surfaces as a generic 500.
	global $wp_filesystem;
	if ( empty( $wp_filesystem ) ) {
		WP_Filesystem();
	}

	$lease = oddout_apps_check_transaction_lease( $lease_check );
	if ( is_wp_error( $lease ) ) {
		return $lease;
	}
	if ( ! wp_mkdir_p( $staging ) ) {
		return new WP_Error( 'extract_mkdir_failed', __( 'Could not create staging directory.', 'odd-outlandish-desktop-decorator' ) );
	}

	$result = unzip_file( $tmp_path, $staging );
	$lease  = oddout_apps_check_transaction_lease( $lease_check );
	if ( is_wp_error( $lease ) ) {
		return $lease;
	}
	if ( is_wp_error( $result ) ) {
		$cleaned = oddout_apps_cleanup_staging( $staging, $lease_check );
		return is_wp_error( $cleaned ) ? $cleaned : $result;
	}

	$lease = oddout_apps_check_transaction_lease( $lease_check );
	if ( is_wp_error( $lease ) ) {
		return $lease;
	}
	oddout_apps_strip_symlinks( $staging );
	return $staging;
}

/** Deterministically fingerprint an installed tree for idempotent rollback. */
function oddout_apps_tree_fingerprint( $directory ) {
	$directory = rtrim( (string) $directory, '/\\' );
	if ( ! is_dir( $directory ) ) {
		return '';
	}
	$files    = array();
	$iterator = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $directory, FilesystemIterator::SKIP_DOTS )
	);
	foreach ( $iterator as $file ) {
		if ( $file->isFile() && ! $file->isLink() ) {
			$files[] = str_replace( '\\', '/', substr( $file->getPathname(), strlen( $directory ) + 1 ) );
		}
	}
	sort( $files, SORT_STRING );
	$hash = hash_init( 'sha256' );
	foreach ( $files as $relative ) {
		$path = $directory . '/' . $relative;
		hash_update( $hash, $relative . "\0" . hash_file( 'sha256', $path ) . "\0" );
	}
	return hash_final( $hash );
}

/**
 * Promote a staged app without destroying the currently working copy.
 *
 * The old directory is renamed to a private backup first. If promotion fails,
 * it is restored before returning. Callers must commit or roll back the token
 * after their registry writes complete.
 *
 * @param string $staging Absolute staged directory.
 * @param string $slug    App slug.
 * @return array|WP_Error Promotion token.
 */
function oddout_apps_prepare_promotion( $staging, $slug ) {
	$slug    = sanitize_key( (string) $slug );
	$staging = rtrim( (string) $staging, '/\\' );
	$final   = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
	if ( '' === $slug || '' === $staging || ! is_dir( $staging ) || '' === $final ) {
		return new WP_Error( 'invalid_staging', __( 'The staged app directory is invalid.', 'odd-outlandish-desktop-decorator' ) );
	}
	$had_final = is_dir( $final );
	return array(
		'staging'         => $staging,
		'final'           => $final,
		'backup'          => $had_final ? rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-' . wp_generate_password( 8, false ) : '',
		'had_final'       => $had_final,
		'old_fingerprint' => $had_final ? oddout_apps_tree_fingerprint( $final ) : '',
	);
}

function oddout_apps_promote_staged_archive( $staging, $slug, $transaction_key = '', $prepared = array(), $journal_owner = '', $lease_check = null ) {
	$token = is_array( $prepared ) && ! empty( $prepared ) ? $prepared : oddout_apps_prepare_promotion( $staging, $slug );
	if ( is_wp_error( $token ) ) {
		return $token;
	}
	$staging = (string) $token['staging'];
	$final   = (string) $token['final'];
	$backup  = (string) $token['backup'];
	$slug    = sanitize_key( (string) $slug );

	if ( ! empty( $token['had_final'] ) ) {
		$lease = oddout_apps_check_transaction_lease( $lease_check );
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		if ( ! is_dir( $final ) ) {
			return new WP_Error( 'installed_app_missing', __( 'The installed app disappeared before replacement began.', 'odd-outlandish-desktop-decorator' ) );
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
		if ( ! @rename( $final, $backup ) ) {
			return new WP_Error( 'backup_rename_failed', __( 'Could not preserve the currently installed app.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( '' !== $transaction_key && function_exists( 'oddout_apps_journal_phase' ) && ! oddout_apps_journal_phase( $transaction_key, 'backup_created', $journal_owner ) ) {
			return new WP_Error( 'transaction_journal_failed', __( 'Could not record the app replacement transaction.', 'odd-outlandish-desktop-decorator' ) );
		}
	}

	// rename() is used here intentionally: it's the only cross-
	// filesystem-atomic way to promote the staging tree to the final
	// location. WP_Filesystem::move() is a non-atomic copy-then-delete
	// that would expose a half-extracted app to the serve endpoint.
	$lease = oddout_apps_check_transaction_lease( $lease_check );
	if ( is_wp_error( $lease ) ) {
		return $lease;
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
	if ( ! @rename( $staging, $final ) ) {
		return new WP_Error( 'extract_rename_failed', __( 'Could not finalize app installation.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( '' !== $transaction_key && function_exists( 'oddout_apps_journal_phase' ) && ! oddout_apps_journal_phase( $transaction_key, 'promoted', $journal_owner ) ) {
		return new WP_Error( 'transaction_journal_failed', __( 'Could not record the promoted app transaction.', 'odd-outlandish-desktop-decorator' ) );
	}

	return $token;
}

function oddout_apps_commit_promoted_archive( array $token, $lease_check = null ) {
	$final   = isset( $token['final'] ) ? (string) $token['final'] : '';
	$staging = isset( $token['staging'] ) ? (string) $token['staging'] : '';
	if ( '' === $final || ! is_dir( $final ) ) {
		return new WP_Error( 'commit_final_missing', __( 'The promoted app directory is missing.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! empty( $token['backup'] ) && is_dir( $token['backup'] ) ) {
		$lease = oddout_apps_check_transaction_lease( $lease_check );
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_rrmdir( $token['backup'] );
		if ( is_dir( $token['backup'] ) ) {
			return new WP_Error( 'commit_backup_cleanup_failed', __( 'Could not remove the app transaction backup.', 'odd-outlandish-desktop-decorator' ) );
		}
	}
	if ( '' !== $staging && ( file_exists( $staging ) || is_link( $staging ) ) ) {
		$cleaned = oddout_apps_cleanup_staging( $staging, $lease_check );
		if ( is_wp_error( $cleaned ) ) {
			return $cleaned;
		}
	}
	return true;
}

function oddout_apps_rollback_promoted_archive( array $token, $lease_check = null ) {
	$final     = isset( $token['final'] ) ? (string) $token['final'] : '';
	$backup    = isset( $token['backup'] ) ? (string) $token['backup'] : '';
	$staging   = isset( $token['staging'] ) ? (string) $token['staging'] : '';
	$had_final = ! empty( $token['had_final'] );
	if ( '' === $final ) {
		return new WP_Error( 'rollback_target_missing', __( 'App rollback target is missing.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( '' !== $backup && is_dir( $backup ) ) {
		if ( is_dir( $final ) ) {
			$lease = oddout_apps_check_transaction_lease( $lease_check );
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
			oddout_apps_rrmdir( $final );
			if ( is_dir( $final ) ) {
				return new WP_Error( 'rollback_candidate_cleanup_failed', __( 'Could not remove the failed app candidate.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		$lease = oddout_apps_check_transaction_lease( $lease_check );
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
		if ( ! @rename( $backup, $final ) || ! is_dir( $final ) ) {
			return new WP_Error( 'rollback_restore_failed', __( 'Could not restore the previous app directory.', 'odd-outlandish-desktop-decorator' ) );
		}
	} elseif ( $had_final ) {
		// A retry after rollback may find the backup and staging already gone.
		// The pre-promotion fingerprint proves the restored tree is complete and
		// makes this cleanup idempotent across another fatal interruption.
		$old_fingerprint = isset( $token['old_fingerprint'] ) ? (string) $token['old_fingerprint'] : '';
		$restored        = '' !== $old_fingerprint && is_dir( $final ) && hash_equals( $old_fingerprint, oddout_apps_tree_fingerprint( $final ) );
		$never_started   = is_dir( $final ) && '' !== $staging && is_dir( $staging );
		if ( ! $restored && ! $never_started ) {
			return new WP_Error( 'rollback_backup_missing', __( 'The previous app backup is missing; manual recovery is required.', 'odd-outlandish-desktop-decorator' ) );
		}
	} elseif ( is_dir( $final ) ) {
		$lease = oddout_apps_check_transaction_lease( $lease_check );
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_rrmdir( $final );
		if ( is_dir( $final ) ) {
			return new WP_Error( 'rollback_new_install_cleanup_failed', __( 'Could not remove the failed app installation.', 'odd-outlandish-desktop-decorator' ) );
		}
	}
	if ( '' !== $staging && ( file_exists( $staging ) || is_link( $staging ) ) ) {
		$cleaned = oddout_apps_cleanup_staging( $staging, $lease_check );
		if ( is_wp_error( $cleaned ) ) {
			return $cleaned;
		}
	}
	return true;
}

/**
 * Compatibility wrapper for callers that do not need registry rollback.
 */
function oddout_apps_extract_archive( $tmp_path, $slug ) {
	$staging = oddout_apps_stage_archive( $tmp_path, $slug );
	if ( is_wp_error( $staging ) ) {
		return $staging;
	}
	$prepared = oddout_apps_prepare_promotion( $staging, $slug );
	if ( is_wp_error( $prepared ) ) {
		return $prepared;
	}
	$token = oddout_apps_promote_staged_archive( $staging, $slug, '', $prepared );
	if ( is_wp_error( $token ) ) {
		oddout_apps_rollback_promoted_archive( $prepared );
		return $token;
	}
	return oddout_apps_commit_promoted_archive( $token );
}

/**
 * Recursive rmdir. Files are removed via wp_delete_file(); the empty
 * directory itself still needs a native rmdir() call since
 * WP_Filesystem expects an initialised instance at a level this
 * helper intentionally avoids (runs from the REST pipeline, outside
 * admin, on paths under the ODD uploads storage directory where PHP already has rights).
 */
function oddout_apps_rrmdir( $path ) {
	if ( ! is_dir( $path ) ) {
		if ( is_file( $path ) ) {
			wp_delete_file( $path );
		}
		return;
	}
	$items = scandir( $path );
	if ( false === $items ) {
		return;
	}
	foreach ( $items as $item ) {
		if ( '.' === $item || '..' === $item ) {
			continue;
		}
		$child = $path . DIRECTORY_SEPARATOR . $item;
		if ( is_link( $child ) ) {
			wp_delete_file( $child );
		} elseif ( is_dir( $child ) ) {
			oddout_apps_rrmdir( $child );
		} else {
			wp_delete_file( $child );
		}
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	@rmdir( $path );
}

function oddout_apps_strip_symlinks( $dir ) {
	if ( ! is_dir( $dir ) ) {
		return;
	}
	$items = scandir( $dir );
	if ( false === $items ) {
		return;
	}
	foreach ( $items as $item ) {
		if ( '.' === $item || '..' === $item ) {
			continue;
		}
		$path = $dir . DIRECTORY_SEPARATOR . $item;
		if ( is_link( $path ) ) {
			wp_delete_file( $path );
		} elseif ( is_dir( $path ) ) {
			oddout_apps_strip_symlinks( $path );
		}
	}
}
