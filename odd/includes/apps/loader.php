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
 *   7. Required fields               type, name, slug, version
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
	for ( $i = 0; $i < $count; $i++ ) {
		$stat = $zip->statIndex( $i );
		if ( false === $stat ) {
			$zip->close();
			return new WP_Error( 'corrupt_archive', __( 'Archive contains an unreadable entry.', 'odd-outlandish-desktop-decorator' ) );
		}
		$name = $stat['name'];

		if ( false !== strpos( $name, '..' ) || ( strlen( $name ) > 0 && '/' === $name[0] ) ) {
			$zip->close();
			return new WP_Error( 'path_traversal', sprintf( /* translators: %s filename */ __( 'Archive contains a path-traversal entry: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
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
			return new WP_Error( 'forbidden_file_type', sprintf( /* translators: %s filename */ __( 'Server-executable files are not allowed. Found: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}

		$compressed   = (int) $stat['comp_size'];
		$uncompressed = (int) $stat['size'];
		if ( $compressed > 0 && $uncompressed > 0 ) {
			$ratio = $uncompressed / $compressed;
			if ( $ratio > 100 ) {
				$zip->close();
				return new WP_Error( 'zip_bomb', sprintf( /* translators: 1 filename 2 ratio */ __( 'Suspicious compression ratio (%2$d:1) in %1$s.', 'odd-outlandish-desktop-decorator' ), $name, (int) $ratio ) );
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

	foreach ( array( 'type', 'name', 'slug', 'version' ) as $field ) {
		if ( empty( $manifest[ $field ] ) || ! is_string( $manifest[ $field ] ) ) {
			$zip->close();
			return new WP_Error( 'missing_manifest_field', sprintf( /* translators: %s field name */ __( 'manifest.json is missing required field: %s', 'odd-outlandish-desktop-decorator' ), $field ) );
		}
	}

	if ( 'app' !== strtolower( (string) $manifest['type'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_type', __( 'App archives must declare manifest type "app".', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( ! preg_match( '/^[a-z0-9-]+$/', $manifest['slug'] ) ) {
		$zip->close();
		return new WP_Error( 'invalid_slug', __( 'App slug must contain only lowercase letters, numbers, and hyphens.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( oddout_apps_exists( $manifest['slug'] ) ) {
		$zip->close();
		return new WP_Error( 'slug_exists', sprintf( /* translators: %s slug */ __( 'App "%s" is already installed. Delete it before reinstalling.', 'odd-outlandish-desktop-decorator' ), $manifest['slug'] ) );
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

	if ( isset( $manifest['icon'] ) && '' !== (string) $manifest['icon'] ) {
		$icon = (string) $manifest['icon'];
		if (
			0 === stripos( $icon, 'http://' ) ||
			0 === stripos( $icon, 'https://' )
		) {
			$safe_icon = esc_url_raw( $icon, array( 'http', 'https' ) );
			if ( '' === $safe_icon ) {
				$zip->close();
				return new WP_Error( 'invalid_icon', __( 'Manifest icon URL is invalid.', 'odd-outlandish-desktop-decorator' ) );
			}
			$manifest['icon'] = $safe_icon;
		} else {
			if (
				false !== strpos( $icon, '..' ) ||
				( strlen( $icon ) > 0 && '/' === $icon[0] ) ||
				false !== strpos( $icon, "\0" ) ||
				! preg_match( '#^[a-zA-Z0-9._/-]+$#', $icon )
			) {
				$zip->close();
				return new WP_Error( 'invalid_icon', __( 'Manifest icon path contains invalid characters or path traversal.', 'odd-outlandish-desktop-decorator' ) );
			}
			$ext = strtolower( pathinfo( $icon, PATHINFO_EXTENSION ) );
			if ( ! in_array( $ext, array( 'svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'ico' ), true ) ) {
				$zip->close();
				return new WP_Error( 'invalid_icon', __( 'Manifest icon must be an image file.', 'odd-outlandish-desktop-decorator' ) );
			}
			if ( false === $zip->getFromName( $icon ) ) {
				$zip->close();
				return new WP_Error( 'missing_icon', sprintf( /* translators: %s icon */ __( 'Icon file "%s" not found in archive.', 'odd-outlandish-desktop-decorator' ), $icon ) );
			}
			$manifest['icon'] = $icon;
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
