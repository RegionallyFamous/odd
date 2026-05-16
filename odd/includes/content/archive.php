<?php
/**
 * ODD — shared `.wp` archive helpers.
 *
 * Every content type (apps, icon sets, cursor sets, scenes, widgets) installs from
 * the same kind of ZIP archive with the same security envelope:
 *
 *   1. Extension must be `.wp` (no `.odd`, no other aliases).
 *   2. ZIP parses via ZipArchive::RDONLY.
 *   3. ≤ 2000 entries, no path traversal, no symlinks, no server-
 *      executable extensions (PHP, shell, CGI, etc.).
 *   4. Per-entry compression ratio ≤ 100:1 (zip-bomb guard).
 *   5. Total uncompressed size ≤ 25 MB.
 *   6. `manifest.json` at the archive root, valid JSON.
 *
 * The per-type validators call into these primitives for the envelope
 * checks and then layer their own field-level validation on top.
 *
 * Nothing here writes to disk. `oddout_content_archive_extract()` is the
 * one side-effecting primitive, used after validation succeeds.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_CONTENT_MAX_UNCOMPRESSED' ) ) {
	// 25 MB uncompressed cap per bundle. Matches ODDOUT_APPS_MAX_UNCOMPRESSED
	// from the Apps installer so the limits compose cleanly when a
	// future pack (`type: "pack"`) bundles multiple child archives.
	define( 'ODDOUT_CONTENT_MAX_UNCOMPRESSED', 25 * 1024 * 1024 );
}

if ( ! defined( 'ODDOUT_CONTENT_MAX_FILES' ) ) {
	define( 'ODDOUT_CONTENT_MAX_FILES', 2000 );
}

/**
 * Server-executable file extensions that must never appear inside a
 * bundle. Forks from {@see oddout_apps_forbidden_extensions()} so the
 * universal installer doesn't depend on the Apps include being loaded
 * first — `bundle.php` is required before `apps/bootstrap.php` on
 * request pipelines where only one of the two runs.
 */
function oddout_content_forbidden_extensions() {
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
 * Validate the filename extension + open the archive. Returns a tuple
 * of [ $zip, null ] on success, or [ null, WP_Error ] on failure.
 *
 * @param string $tmp_path
 * @param string $filename
 * @return array{0: ?ZipArchive, 1: ?WP_Error}
 */
function oddout_content_archive_open( $tmp_path, $filename ) {
	$ext = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
	if ( 'wp' !== $ext ) {
		return array( null, new WP_Error( 'invalid_extension', __( 'Bundles must have a .wp extension.', 'odd-outlandish-desktop-decorator' ) ) );
	}

	if ( ! class_exists( 'ZipArchive' ) ) {
		return array( null, new WP_Error( 'zip_unavailable', __( 'The PHP ZipArchive extension is required to install ODD bundles.', 'odd-outlandish-desktop-decorator' ) ) );
	}

	$zip    = new ZipArchive();
	$status = $zip->open( $tmp_path, ZipArchive::RDONLY );
	if ( true !== $status ) {
		return array( null, new WP_Error( 'invalid_zip', __( 'File is not a valid ZIP archive.', 'odd-outlandish-desktop-decorator' ) ) );
	}

	return array( $zip, null );
}

/**
 * Walk every archive entry once and enforce the envelope rules
 * (count, path traversal, symlinks, forbidden extensions, zip-bomb
 * ratios, total uncompressed cap). Returns true on success or a
 * WP_Error on the first violation. Does not close the zip — callers
 * can continue to read from it.
 *
 * @param ZipArchive $zip
 * @return true|WP_Error
 */
function oddout_content_archive_scan( ZipArchive $zip ) {
	$count = $zip->count();
	if ( $count > ODDOUT_CONTENT_MAX_FILES ) {
		return new WP_Error( 'too_many_files', sprintf( /* translators: %d file count limit */ __( 'Bundle exceeds %d files.', 'odd-outlandish-desktop-decorator' ), ODDOUT_CONTENT_MAX_FILES ) );
	}

	$forbidden          = oddout_content_forbidden_extensions();
	$total_uncompressed = 0;
	for ( $i = 0; $i < $count; $i++ ) {
		$stat = $zip->statIndex( $i );
		if ( false === $stat ) {
			return new WP_Error( 'corrupt_archive', __( 'Bundle contains an unreadable entry.', 'odd-outlandish-desktop-decorator' ) );
		}
		$name = isset( $stat['name'] ) ? (string) $stat['name'] : '';

		if ( false !== strpos( $name, '..' ) || ( strlen( $name ) > 0 && '/' === $name[0] ) ) {
			return new WP_Error( 'path_traversal', sprintf( /* translators: %s entry name */ __( 'Bundle contains a path-traversal entry: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}

		$opsys   = 0;
		$extattr = 0;
		$zip->getExternalAttributesIndex( $i, $opsys, $extattr );
		if ( ( ( $extattr >> 16 ) & 0xF000 ) === 0xA000 ) {
			return new WP_Error( 'symlink_in_archive', sprintf( /* translators: %s entry name */ __( 'Bundle contains a symlink: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}

		$file_ext = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( in_array( $file_ext, $forbidden, true ) ) {
			return new WP_Error( 'forbidden_file_type', sprintf( /* translators: %s entry name */ __( 'Server-executable files are not allowed. Found: %s', 'odd-outlandish-desktop-decorator' ), $name ) );
		}

		$compressed   = isset( $stat['comp_size'] ) ? (int) $stat['comp_size'] : 0;
		$uncompressed = isset( $stat['size'] ) ? (int) $stat['size'] : 0;
		if ( $compressed > 0 && $uncompressed > 0 ) {
			$ratio = $uncompressed / $compressed;
			if ( $ratio > 100 ) {
				return new WP_Error( 'zip_bomb', sprintf( /* translators: 1 entry name, 2 ratio */ __( 'Suspicious compression ratio (%2$d:1) in %1$s.', 'odd-outlandish-desktop-decorator' ), $name, (int) $ratio ) );
			}
		}
		$total_uncompressed += $uncompressed;
	}

	$max = (int) apply_filters( 'oddout_content_max_uncompressed', ODDOUT_CONTENT_MAX_UNCOMPRESSED );
	if ( $total_uncompressed > $max ) {
		return new WP_Error(
			'too_large',
			sprintf(
				/* translators: 1 uncompressed MB, 2 max MB */
				__( 'Bundle is too large (%1$s MB uncompressed). Maximum is %2$s MB.', 'odd-outlandish-desktop-decorator' ),
				number_format_i18n( $total_uncompressed / 1024 / 1024, 1 ),
				number_format_i18n( $max / 1024 / 1024, 1 )
			)
		);
	}

	return true;
}

/**
 * Read + parse `manifest.json` from the archive root. Returns the
 * parsed array on success or a WP_Error on failure.
 *
 * @param ZipArchive $zip
 * @return array|WP_Error
 */
function oddout_content_archive_read_manifest( ZipArchive $zip ) {
	$raw = $zip->getFromName( 'manifest.json' );
	if ( false === $raw ) {
		return new WP_Error( 'missing_manifest', __( 'manifest.json was not found at the bundle root.', 'odd-outlandish-desktop-decorator' ) );
	}
	$manifest = json_decode( $raw, true );
	if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $manifest ) ) {
		return new WP_Error( 'invalid_manifest', __( 'manifest.json is not valid JSON.', 'odd-outlandish-desktop-decorator' ) );
	}
	return $manifest;
}

/**
 * Validate the shared header that every bundle type requires:
 * type / name / slug / version. Returns the normalised header or a WP_Error.
 *
 * @param array $manifest
 * @return array|WP_Error
 */
function oddout_content_validate_header( $manifest ) {
	if ( ! is_array( $manifest ) ) {
		return new WP_Error( 'invalid_manifest', __( 'manifest.json must be a JSON object.', 'odd-outlandish-desktop-decorator' ) );
	}
	foreach ( array( 'type', 'name', 'slug', 'version' ) as $field ) {
		if ( empty( $manifest[ $field ] ) || ! is_string( $manifest[ $field ] ) ) {
			return new WP_Error(
				'missing_manifest_field',
				sprintf( /* translators: %s manifest field */ __( 'manifest.json is missing required field: %s', 'odd-outlandish-desktop-decorator' ), $field )
			);
		}
	}
	if ( ! preg_match( '/^[a-z0-9-]+$/', $manifest['slug'] ) ) {
		return new WP_Error( 'invalid_slug', __( 'Slug must contain only lowercase letters, numbers, and hyphens.', 'odd-outlandish-desktop-decorator' ) );
	}

	$type = strtolower( (string) $manifest['type'] );
	if ( ! in_array( $type, array( 'app', 'icon-set', 'cursor-set', 'scene', 'widget' ), true ) ) {
		return new WP_Error(
			'invalid_type',
			sprintf(
				/* translators: %s manifest.type value */
				__( 'Unknown bundle type "%s". Supported: app, icon-set, cursor-set, scene, widget.', 'odd-outlandish-desktop-decorator' ),
				$type
			)
		);
	}

	return array(
		'slug'        => sanitize_key( $manifest['slug'] ),
		'name'        => sanitize_text_field( $manifest['name'] ),
		'version'     => sanitize_text_field( $manifest['version'] ),
		'type'        => $type,
		'author'      => isset( $manifest['author'] ) ? sanitize_text_field( (string) $manifest['author'] ) : '',
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : '',
	);
}

/**
 * Validate a manifest-declared relative path. Returns the normalised
 * relative path on success or '' on failure. Used by validators that
 * need to confirm a named file (entry JS, preview WebP, icon SVG) is
 * present in the archive.
 */
function oddout_content_sanitize_relative_path( $rel ) {
	$rel = (string) $rel;
	if ( '' === $rel ) {
		return '';
	}
	if ( false !== strpos( $rel, "\0" ) ) {
		return '';
	}
	if ( false !== strpos( $rel, '..' ) ) {
		return '';
	}
	if ( '/' === $rel[0] ) {
		return '';
	}
	if ( ! preg_match( '#^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$#', $rel ) ) {
		return '';
	}
	return $rel;
}

/**
 * Extract an archive into the given destination directory atomically.
 * Stages into a sibling `.tmp-<slug>-<rand>/`, strips any residual
 * symlinks, then renames into place.
 *
 * @param string $tmp_path   Uploaded archive on disk.
 * @param string $parent_dir Absolute path of the parent type directory
 *                           (e.g. uploads/odd/icon-sets/). Created
 *                           if it doesn't exist.
 * @param string $slug       Sanitised slug — final dir is $parent_dir/$slug/.
 * @return true|WP_Error
 */
function oddout_content_archive_extract( $tmp_path, $parent_dir, $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$parent_dir = trailingslashit( $parent_dir );
	if ( ! wp_mkdir_p( $parent_dir ) ) {
		return new WP_Error( 'extract_mkdir_failed', __( 'Could not create bundle directory.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( ! function_exists( 'unzip_file' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	global $wp_filesystem;
	if ( empty( $wp_filesystem ) ) {
		WP_Filesystem();
	}

	$staging = $parent_dir . '.tmp-' . $slug . '-' . wp_generate_password( 8, false ) . '/';
	$final   = $parent_dir . $slug;

	if ( ! wp_mkdir_p( $staging ) ) {
		return new WP_Error( 'extract_mkdir_failed', __( 'Could not create staging directory.', 'odd-outlandish-desktop-decorator' ) );
	}

	$result = unzip_file( $tmp_path, $staging );
	if ( is_wp_error( $result ) ) {
		oddout_content_rrmdir( $staging );
		return $result;
	}

	oddout_content_strip_symlinks( rtrim( $staging, '/' ) );

	if ( is_dir( $final ) ) {
		oddout_content_rrmdir( $final );
	}
	// Atomic promote — never expose a half-extracted bundle.
	// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
	if ( ! @rename( rtrim( $staging, '/' ), $final ) ) {
		oddout_content_rrmdir( $staging );
		return new WP_Error( 'extract_rename_failed', __( 'Could not finalise bundle installation.', 'odd-outlandish-desktop-decorator' ) );
	}
	return true;
}

/**
 * Recursive rmdir. Mirrors oddout_apps_rrmdir() so content installers
 * don't depend on the Apps include. Runs from the REST pipeline, on
 * paths under the ODD uploads storage directory where PHP already has the necessary
 * rights, so WP_Filesystem isn't required.
 */
function oddout_content_rrmdir( $path ) {
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
			oddout_content_rrmdir( $child );
		} else {
			wp_delete_file( $child );
		}
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	@rmdir( $path );
}

function oddout_content_strip_symlinks( $dir ) {
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
			oddout_content_strip_symlinks( $path );
		}
	}
}

/**
 * Resolve a relative path against a base directory, confined by
 * realpath. Returns '' if the resolved path escapes the base.
 */
function oddout_content_resolve_path( $base_dir, $rel ) {
	$rel = (string) $rel;
	if ( '' === $rel ) {
		return '';
	}
	$rel = oddout_content_sanitize_relative_path( $rel );
	if ( '' === $rel ) {
		return '';
	}
	$abs      = rtrim( $base_dir, '/' ) . '/' . $rel;
	$abs_real = realpath( $abs );
	$dir_real = realpath( $base_dir );
	if ( false === $abs_real || false === $dir_real ) {
		return '';
	}
	if ( 0 !== strpos( $abs_real, $dir_real . DIRECTORY_SEPARATOR ) ) {
		return '';
	}
	return $abs_real;
}

/**
 * Append a validated manifest-relative path to a base URL without
 * collapsing nested directories into `%2F`.
 */
function oddout_content_url_for_relative( $base_url, $rel ) {
	$base_url = (string) $base_url;
	$rel      = oddout_content_sanitize_relative_path( $rel );
	if ( '' === $base_url || '' === $rel ) {
		return '';
	}
	$segments = array_map( 'rawurlencode', explode( '/', $rel ) );
	return trailingslashit( $base_url ) . implode( '/', $segments );
}
