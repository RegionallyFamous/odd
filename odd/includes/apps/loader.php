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
 *   8. Slug format                   ^[a-z0-9-]+$
 *   9. Slug uniqueness               registry lookup
 *  10. Entry path validation         ^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$
 *  11. Entry file present in archive
 *
 * Extraction uses unzip_file() into a staging directory, then moves
 * into place. A post-extract symlink sweep runs as belt-and-braces
 * against non-Unix zip tools that bypass the `external_attr` check.
 *
 * Server-executable extensions that are rejected in validation:
 * php, phtml, phar, php3-7, phps, cgi, pl, py, rb, sh, bash.
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
			false !== strpos( $name, '..' ) ||
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
		if ( in_array( $file_ext, $forbidden, true ) ) {
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
	$manifest = json_decode( $raw, true );
	if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $manifest ) ) {
		$zip->close();
		return new WP_Error( 'invalid_manifest', __( 'manifest.json is not valid JSON.', 'odd-outlandish-desktop-decorator' ) );
	}

	foreach ( array( 'type', 'name', 'slug', 'version', 'entry', 'icon' ) as $field ) {
		if ( empty( $manifest[ $field ] ) || ! is_string( $manifest[ $field ] ) ) {
			$zip->close();
			return new WP_Error( 'missing_manifest_field', sprintf( /* translators: %s manifest field */ __( 'manifest.json is missing required field: %s', 'odd-outlandish-desktop-decorator' ), $field ) );
		}
	}

	if ( 'app' !== strtolower( (string) $manifest['type'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_type', __( 'App archives must declare manifest type "app".', 'odd-outlandish-desktop-decorator' ) );
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

	if ( ! preg_match( '/^[a-z0-9-]+$/', $manifest['slug'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_slug', __( 'App slug must contain only lowercase letters, numbers, and hyphens.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! preg_match( '/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/', $manifest['version'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_version', __( 'App version must use semantic versioning.', 'odd-outlandish-desktop-decorator' ) );
	}

	$entry = isset( $manifest['entry'] ) ? (string) $manifest['entry'] : 'index.html';
	if (
		false !== strpos( $entry, '..' ) ||
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
			$asset_path  = rawurldecode( preg_split( '/[?#]/', $reference, 2 )[0] );
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
		false !== strpos( $icon, '..' ) ||
		( strlen( $icon ) > 0 && '/' === $icon[0] ) ||
		false !== strpos( $icon, "\0" ) ||
		! preg_match( '#^[a-zA-Z0-9._/-]+$#', $icon )
	) {
		$zip->close();
		return new WP_Error( 'invalid_icon', __( 'Manifest icon path contains invalid characters or path traversal.', 'odd-outlandish-desktop-decorator' ) );
	}
	$icon_ext = strtolower( pathinfo( $icon, PATHINFO_EXTENSION ) );
	if ( ! in_array( $icon_ext, array( 'svg', 'png', 'webp' ), true ) ) {
		$zip->close();
		return new WP_Error( 'invalid_icon', __( 'Manifest icon must be an SVG, PNG, or WebP file.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( false === $zip->getFromName( $icon ) ) {
		$zip->close();
		return new WP_Error( 'missing_icon', sprintf( /* translators: %s icon */ __( 'Icon file "%s" not found in archive.', 'odd-outlandish-desktop-decorator' ), $icon ) );
	}
	$manifest['icon'] = $icon;

	if ( isset( $manifest['capability'] ) && ! preg_match( '/^[a-z0-9_]+$/', (string) $manifest['capability'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_capability', __( 'Manifest capability is invalid.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( isset( $manifest['surfaces'] ) ) {
		if ( ! is_array( $manifest['surfaces'] ) || array_diff( array_keys( $manifest['surfaces'] ), array( 'desktop', 'taskbar' ) ) ) {
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
	if ( isset( $manifest['window'] ) && ! is_array( $manifest['window'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_window', __( 'Manifest window must be an object.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( isset( $manifest['window'] ) ) {
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
				isset( $manifest['window'][ $field ] ) &&
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
		if ( isset( $manifest['window']['title'] ) && ( ! is_string( $manifest['window']['title'] ) || strlen( $manifest['window']['title'] ) > 80 ) ) {
			$zip->close();
			return new WP_Error( 'invalid_window', __( 'Manifest window title must be text of at most 80 bytes.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( isset( $manifest['window']['resizable'] ) && ! is_bool( $manifest['window']['resizable'] ) ) {
			$zip->close();
			return new WP_Error( 'invalid_window', __( 'Manifest window resizable value must be boolean.', 'odd-outlandish-desktop-decorator' ) );
		}
	}
	if ( isset( $manifest['desktopIcon'] ) && ! is_array( $manifest['desktopIcon'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon must be an object.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( isset( $manifest['desktopIcon'] ) ) {
		if ( array_diff( array_keys( $manifest['desktopIcon'] ), array( 'title', 'position' ) ) ) {
			$zip->close();
			return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon contains unsupported fields.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( isset( $manifest['desktopIcon']['title'] ) && ( ! is_string( $manifest['desktopIcon']['title'] ) || strlen( $manifest['desktopIcon']['title'] ) > 80 ) ) {
			$zip->close();
			return new WP_Error( 'invalid_desktop_icon', __( 'Manifest desktopIcon title must be text of at most 80 bytes.', 'odd-outlandish-desktop-decorator' ) );
		}
		if (
			isset( $manifest['desktopIcon']['position'] ) &&
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
	if ( isset( $manifest['native'] ) ) {
		if ( ! is_array( $manifest['native'] ) ) {
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
		$script = isset( $native['script'] ) ? (string) $native['script'] : '';
		$style  = isset( $native['style'] ) ? (string) $native['style'] : '';
		if ( '' === $script ) {
			$zip->close();
			return new WP_Error( 'missing_native_script', __( 'Native apps must declare native.script.', 'odd-outlandish-desktop-decorator' ) );
		}
		if (
			isset( $native['template'] ) &&
			( ! is_string( $native['template'] ) || ! preg_match( '/^[a-z0-9][a-z0-9-]*$/', $native['template'] ) )
		) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'Manifest native template must be a lowercase slug.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( isset( $native['template'] ) && 'odd-notes' !== $native['template'] ) {
			$zip->close();
			return new WP_Error( 'invalid_native_app', __( 'ODD Notes must use its registered native template.', 'odd-outlandish-desktop-decorator' ) );
		}

		foreach ( array(
			'script' => $script,
			'style'  => $style,
		) as $kind => $asset ) {
			if ( '' === $asset && 'style' === $kind ) {
				continue;
			}
			$expected_ext = 'script' === $kind ? 'js' : 'css';
			if (
				false !== strpos( $asset, '..' ) ||
				( strlen( $asset ) > 0 && '/' === $asset[0] ) ||
				! preg_match( '#^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$#', $asset ) ||
				$expected_ext !== strtolower( pathinfo( $asset, PATHINFO_EXTENSION ) )
			) {
				$zip->close();
				return new WP_Error( 'invalid_native_asset', __( 'Native app asset paths must be safe relative JS/CSS paths.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( false === $zip->getFromName( $asset ) ) {
				$zip->close();
				return new WP_Error( 'missing_native_asset', sprintf( /* translators: %s asset path. */ __( 'Native app asset "%s" was not found.', 'odd-outlandish-desktop-decorator' ), $asset ) );
			}
		}

		$manifest['native'] = array(
			'script'   => $script,
			'style'    => $style,
			'template' => isset( $native['template'] ) ? $native['template'] : '',
		);
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
function oddout_apps_extract_archive( $tmp_path, $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	oddout_apps_ensure_storage();

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

	$staging = ODDOUT_APPS_DIR . '.tmp-' . $slug . '-' . wp_generate_password( 8, false ) . '/';
	$final   = oddout_apps_dir_for( $slug );

	if ( ! wp_mkdir_p( $staging ) ) {
		return new WP_Error( 'extract_mkdir_failed', __( 'Could not create staging directory.', 'odd-outlandish-desktop-decorator' ) );
	}

	$result = unzip_file( $tmp_path, $staging );
	if ( is_wp_error( $result ) ) {
		oddout_apps_rrmdir( $staging );
		return $result;
	}

	oddout_apps_strip_symlinks( rtrim( $staging, '/' ) );

	if ( is_dir( $final ) ) {
		oddout_apps_rrmdir( $final );
	}
	// rename() is used here intentionally: it's the only cross-
	// filesystem-atomic way to promote the staging tree to the final
	// location. WP_Filesystem::move() is a non-atomic copy-then-delete
	// that would expose a half-extracted app to the serve endpoint.
	// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
	if ( ! @rename( $staging, rtrim( $final, '/' ) ) ) {
		oddout_apps_rrmdir( $staging );
		return new WP_Error( 'extract_rename_failed', __( 'Could not finalize app installation.', 'odd-outlandish-desktop-decorator' ) );
	}
	return true;
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
