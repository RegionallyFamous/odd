<?php
/**
 * ODD icons — set registry.
 *
 * Walks `assets/icons/<slug>/manifest.json` at plugin boot and exposes:
 *   - oddout_icons_get_sets()          full list (for the panel + REST).
 *   - oddout_icons_get_set( $slug )    one entry, or null.
 *   - oddout_icons_get_active_slug()   current user's pick, falling back
 *                                   to the `oddout_icons_default_slug`
 *                                   filter, else `''` (= pass-through).
 *   - oddout_icons_set_active_slug()   save pick to user meta (oddout_icon_set).
 *
 * Sets are directories containing manifest + PNG/WebP images, so instead
 * of one big JSON we scan the directory tree and pass plain image URLs to
 * Desktop Mode's native icon surfaces.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shared registry of broken manifest.json paths.
 *
 * Both the scene registry (odd/includes/wallpaper/registry.php) and
 * the icon registry below push onto this list when json_decode
 * silently returns null — previously those failures were invisible
 * and the whole set/scene just disappeared from the panel with no
 * admin-side signal.
 *
 * On WP_DEBUG we error_log each entry as it comes in so devs see
 * the failure on first refresh; for production we also surface a
 * single admin_notices banner to any `manage_options` user so the
 * site owner knows something broke.
 *
 * Kept intentionally minimal — odd/bin/validate-scenes and
 * odd/bin/validate-icon-sets are the primary authoring tools; this
 * is the runtime safety net for hand-edited JSON or broken
 * third-party content.
 */
function oddout_registry_bad_manifests( $path = null, $error = null ) {
	static $store = array();
	if ( null !== $path ) {
		if ( ! isset( $store[ $path ] ) ) {
			$store[ $path ] = (string) $error;
		}
	}
	return $store;
}

function oddout_registry_report_bad_manifest( $path, $error = '' ) {
	$before = count( oddout_registry_bad_manifests() );
	oddout_registry_bad_manifests( (string) $path, (string) $error );
	$after = count( oddout_registry_bad_manifests() );
	if ( $after === $before ) {
		return; // Already reported this path.
	}
	if ( defined( 'WP_DEBUG' ) && WP_DEBUG && function_exists( 'error_log' ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( '[ODD] manifest failed to parse: %s (%s)', $path, $error ) );
	}
	if ( 1 === $after && is_admin() && ! has_action( 'admin_notices', 'oddout_registry_admin_notice_bad_manifests' ) ) {
		add_action( 'admin_notices', 'oddout_registry_admin_notice_bad_manifests' );
	}
}

function oddout_registry_admin_notice_bad_manifests() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$list = oddout_registry_bad_manifests();
	if ( empty( $list ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p><strong>ODD</strong>: ';
	echo esc_html__( 'One or more manifest.json files failed to parse and were ignored. Check the plugin folder:', 'odd-outlandish-desktop-decorator' );
	echo '</p><ul style="margin-left:2em;list-style:disc">';
	foreach ( $list as $path => $error ) {
		echo '<li><code>' . esc_html( (string) $path ) . '</code>';
		if ( $error ) {
			echo ' — ' . esc_html( (string) $error );
		}
		echo '</li>';
	}
	echo '</ul></div>';
}

/**
 * Resolve a manifest-declared relative path against a set directory, refusing
 * anything that escapes it. Returns the absolute path on success, or '' if
 * the entry is missing, unreadable, contains `..` / absolute components, or
 * resolves outside the set root. Paths are also required to be flat — sets
 * ship raster files next to the manifest, no subdirectories, no symlinks to elsewhere.
 */
function oddout_icons_resolve_set_path( $set_dir, $rel ) {
	$rel = (string) $rel;
	if ( '' === $rel ) {
		return '';
	}
	if ( function_exists( 'oddout_content_resolve_path' ) ) {
		return oddout_content_resolve_path( $set_dir, $rel );
	}
	if ( false !== strpos( $rel, "\0" ) ) {
		return '';
	}
	if ( false !== strpos( $rel, '..' ) ) {
		return '';
	}
	if ( false !== strpos( $rel, '\\' ) ) {
		return '';
	}
	$rel = ltrim( $rel, '/' );
	if ( '' === $rel || ! preg_match( '#^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$#', $rel ) ) {
		return '';
	}

	$abs      = $set_dir . '/' . $rel;
	$abs_real = realpath( $abs );
	$dir_real = realpath( $set_dir );
	if ( false === $abs_real || false === $dir_real ) {
		return '';
	}
	if ( 0 !== strpos( $abs_real, $dir_real . DIRECTORY_SEPARATOR ) ) {
		return '';
	}
	return $abs_real;
}

function oddout_icons_url_for_set_path( $base_url, $rel ) {
	if ( function_exists( 'oddout_content_url_for_relative' ) ) {
		return oddout_content_url_for_relative( $base_url, $rel );
	}
	$rel = (string) $rel;
	if ( '' === (string) $base_url || '' === $rel || false !== strpos( $rel, '..' ) || false !== strpos( $rel, "\0" ) ) {
		return '';
	}
	$rel = ltrim( $rel, '/' );
	if ( '' === $rel || ! preg_match( '#^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$#', $rel ) ) {
		return '';
	}
	return trailingslashit( (string) $base_url ) . implode( '/', array_map( 'rawurlencode', explode( '/', $rel ) ) );
}

/**
 * Transient key for the persisted icon registry. Keyed by
 * ODDOUT_VERSION so a plugin update automatically busts the cache —
 * new / renamed / removed sets propagate without a manual flush.
 */
function oddout_icons_registry_transient_key() {
	return 'oddout_icon_registry_v' . ( defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0' );
}

/**
 * Per-request cache-reset hook. The icon-set installer fires
 * `oddout_icons_invalidate_cache` after install/uninstall so the static
 * below gets wiped on the same request the change happened.
 */
add_action(
	'oddout_icons_invalidate_cache',
	function () {
		oddout_icons_get_sets( true );
	}
);

function oddout_icons_get_sets( $reset = false ) {
	static $cache = null;
	if ( $reset ) {
		$cache = null;
		// Also wipe the transient so the next scan is fully fresh —
		// prevents stale persisted data from masking a cache-bust
		// that happened out-of-band (e.g. a test fixture writing
		// directly into uploads/odd/icon-sets/).
		if ( function_exists( 'delete_transient' ) ) {
			delete_transient( oddout_icons_registry_transient_key() );
		}
		// Fall through to rebuild + return fresh.
	}
	if ( null !== $cache ) {
		return $cache;
	}

	// Persistent cache: the on-disk registry is fully determined by
	// files under assets/icons/ + uploads/odd/icon-sets/, which
	// only change on plugin update or `.wp` install/uninstall (the
	// installer busts this transient explicitly). Hitting this
	// transient avoids ~221 small file reads + 17 JSON parses per
	// cold PHP worker for the built-ins.
	//
	// Third-party plugins that extend the registry via the
	// `oddout_icon_set_registry` filter still get called on every
	// request — the disk scan is the only thing we memoize.
	$transient_key = oddout_icons_registry_transient_key();
	$persisted     = get_transient( $transient_key );
	if ( is_array( $persisted ) ) {
		$filtered = apply_filters( 'oddout_icon_set_registry', $persisted );
		$cache    = is_array( $filtered ) ? $filtered : $persisted;
		return $cache;
	}

	$cache = array();

	// Built-in sets: scanned from odd/assets/icons/<slug>/.
	$sources = array();
	$root    = ODDOUT_DIR . 'assets/icons';
	if ( is_dir( $root ) ) {
		$dirs = glob( $root . '/*', GLOB_ONLYDIR );
		if ( is_array( $dirs ) ) {
			foreach ( $dirs as $dir ) {
				$slug = basename( $dir );
				if ( '' === $slug || $slug[0] === '.' ) {
					continue;
				}
				$manifest_path = $dir . '/manifest.json';
				if ( ! is_readable( $manifest_path ) ) {
					continue;
				}
				$raw  = file_get_contents( $manifest_path );
				$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
				if ( ! is_array( $data ) ) {
					oddout_registry_report_bad_manifest( $manifest_path, json_last_error_msg() );
					continue;
				}
				$sources[ $slug ] = array(
					'data'     => $data,
					'base_dir' => $dir,
					'base_url' => ODDOUT_URL . '/assets/icons/' . rawurlencode( $slug ),
					'source'   => 'plugin',
				);
			}
		}
	}

	// Installed sets: scanned from uploads/odd/icon-sets/<slug>/.
	// Installed sets take precedence over built-ins on collision —
	// the installer already refuses a slug that exists anywhere in
	// the bundle namespace, but if a user drops a folder in by hand
	// the installed copy wins.
	if ( function_exists( 'oddout_iconsets_scan_installed' ) ) {
		foreach ( oddout_iconsets_scan_installed() as $slug => $entry ) {
			$sources[ $slug ] = $entry;
		}
	}

	foreach ( $sources as $slug => $entry ) {
		$data     = $entry['data'];
		$base_dir = $entry['base_dir'];
		$base_url = $entry['base_url'];

		$accent = isset( $data['accent'] ) ? (string) $data['accent'] : '#3858e9';

		$icons = array();
		if ( isset( $data['icons'] ) && is_array( $data['icons'] ) ) {
			foreach ( $data['icons'] as $key => $rel ) {
				$abs = oddout_icons_resolve_set_path( $base_dir, $rel );
				if ( '' === $abs || ! is_readable( $abs ) ) {
					continue;
				}
				$clean_key           = sanitize_key( (string) $key );
				$icons[ $clean_key ] = oddout_icons_url_for_set_path( $base_url, $rel );
			}
		}

		$preview = '';
		if ( ! empty( $data['preview'] ) ) {
			$preview_abs = oddout_icons_resolve_set_path( $base_dir, $data['preview'] );
			if ( '' !== $preview_abs && is_readable( $preview_abs ) ) {
				$preview = oddout_icons_url_for_set_path( $base_url, $data['preview'] );
			}
		}

		$cache[ $slug ] = array(
			'slug'        => $slug,
			'label'       => isset( $data['label'] ) ? (string) $data['label'] : $slug,
			'category'    => isset( $data['category'] ) ? (string) $data['category'] : '',
			'accent'      => $accent,
			'description' => isset( $data['description'] ) ? (string) $data['description'] : '',
			'preview'     => $preview,
			'icons'       => $icons,
			'source'      => $entry['source'],
		);
	}

	// Persist the disk-scan result before letting filters mutate it.
	// Filters run per-request so plugins that register sets
	// conditionally (per-user, per-role) keep working; the cached
	// value is the "raw" set list only.
	set_transient( $transient_key, $cache, DAY_IN_SECONDS );

	/**
	 * Filter the ODD icon-set registry.
	 *
	 * Runs once per request, after on-disk sets are scanned. Third-party
	 * plugins can register external sets (served as plain URLs, not data
	 * URIs) by returning a modified array keyed by slug.
	 *
	 * @since 0.14.0
	 *
	 * @param array $registry Map of slug → set descriptor.
	 */
	$filtered = apply_filters( 'oddout_icon_set_registry', $cache );
	if ( is_array( $filtered ) ) {
		$cache = $filtered;
	}

	return $cache;
}

function oddout_icons_get_set( $slug ) {
	$sets = oddout_icons_get_sets();
	return isset( $sets[ $slug ] ) ? $sets[ $slug ] : null;
}

/**
 * Active set for the given (or current) user. `''` means "don't
 * re-skin the dock" — pass-through behaviour.
 */
function oddout_icons_get_active_slug( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	if ( $user_id > 0 ) {
		$saved = get_user_meta( $user_id, 'oddout_icon_set', true );
		if ( is_string( $saved ) && '' !== $saved ) {
			if ( 'none' === $saved ) {
				return '';
			}
			$set = oddout_icons_get_set( $saved );
			if ( $set ) {
				return $saved;
			}
		}
	}

	$default = (string) apply_filters( 'oddout_icons_default_slug', '' );
	if ( '' !== $default && oddout_icons_get_set( $default ) ) {
		return $default;
	}
	return '';
}

function oddout_icons_set_active_slug( $slug, $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	if ( $user_id <= 0 ) {
		return false;
	}
	$slug = (string) $slug;
	if ( 'none' === $slug ) {
		return (bool) update_user_meta( $user_id, 'oddout_icon_set', 'none' );
	}
	if ( '' !== $slug && ! oddout_icons_get_set( $slug ) ) {
		return false;
	}
	return (bool) update_user_meta( $user_id, 'oddout_icon_set', $slug );
}
