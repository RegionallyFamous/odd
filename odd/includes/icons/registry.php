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
 * Sets are directories containing manifest + SVGs, so instead of one
 * big JSON we scan the directory tree.
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
 * Why not data URIs any more: in v1.0.4 we stopped emitting
 * `data:image/svg+xml;utf8,...` icons because WP Desktop Mode's
 * client-side `resolveIcon()` only accepts `data:image/svg+xml;base64,`
 * for dock tiles and HTTP(S) URLs for desktop shortcuts — URL-encoded
 * data URIs (and base64 data URIs for desktop icons) silently fall
 * through to letter-badge rendering. Serving tinted icons through a
 * real REST URL (`/odd/v1/icons/<set>/<key>`) gives us a single
 * representation that works across both surfaces, benefits from HTTP
 * caching, and stays under 8 KB per request.
 */
/**
 * Resolve a manifest-declared relative path against a set directory, refusing
 * anything that escapes it. Returns the absolute path on success, or '' if
 * the entry is missing, unreadable, contains `..` / absolute components, or
 * resolves outside the set root. Paths are also required to be flat — sets
 * ship SVGs next to the manifest, no subdirectories, no symlinks to elsewhere.
 */
function oddout_icons_resolve_set_path( $set_dir, $rel ) {
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
	if ( false !== strpos( $rel, '\\' ) ) {
		return '';
	}
	$rel = ltrim( $rel, '/' );
	if ( '' === $rel || basename( $rel ) !== $rel ) {
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

/**
 * Does the SVG at the given absolute path opt in to currentColor
 * tinting? Used by the registry to decide whether to route an icon
 * through the tinted-SVG REST endpoint or serve the static file
 * directly via plugins_url().
 */
function oddout_icons_svg_uses_current_color( $abs_path ) {
	if ( ! is_readable( $abs_path ) ) {
		return false;
	}
	$svg = file_get_contents( $abs_path );
	if ( false === $svg || '' === $svg ) {
		return false;
	}
	return false !== strpos( $svg, 'currentColor' );
}

/**
 * Build the public REST URL for a tinted icon. Set and key are
 * sanitized inputs; the endpoint itself still re-validates both.
 */
function oddout_icons_tinted_svg_url( $set_slug, $key ) {
	return oddout_https_rest_url( 'odd/v1/icons/' . $set_slug . '/' . $key );
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
				$basename  = basename( $abs );
				$clean_key = sanitize_key( (string) $key );
				if ( oddout_icons_svg_uses_current_color( $abs ) ) {
					$icons[ $clean_key ] = oddout_icons_tinted_svg_url( $slug, $clean_key );
				} else {
					$icons[ $clean_key ] = $base_url . '/' . rawurlencode( $basename );
				}
			}
		}

		$preview = '';
		if ( ! empty( $data['preview'] ) ) {
			$preview_abs = oddout_icons_resolve_set_path( $base_dir, $data['preview'] );
			if ( '' !== $preview_abs && is_readable( $preview_abs ) ) {
				$preview_basename = basename( $preview_abs );
				if ( oddout_icons_svg_uses_current_color( $preview_abs ) ) {
					$preview_key = '__preview__';
					foreach ( (array) $data['icons'] as $k => $rel ) {
						if ( basename( (string) $rel ) === $preview_basename ) {
							$preview_key = sanitize_key( (string) $k );
							break;
						}
					}
					$preview = oddout_icons_tinted_svg_url( $slug, $preview_key );
				} else {
					$preview = $base_url . '/' . rawurlencode( $preview_basename );
				}
			}
		}

		$cache[ $slug ] = array(
			'slug'        => $slug,
			'label'       => isset( $data['label'] ) ? (string) $data['label'] : $slug,
			'franchise'   => isset( $data['franchise'] ) ? (string) $data['franchise'] : '',
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

/**
 * Public REST route that serves a single tinted SVG from a set.
 *
 *   GET /wp-json/odd/v1/icons/{set}/{key}
 *
 * This endpoint is intentionally public: dock and desktop-shortcut
 * icons are painted via `<img src>` which cannot send a nonce, and
 * icon SVGs are branding-level content already on disk under
 * `odd/assets/icons/<set>/`. The only things we vary by request are
 * which key the caller asked for and the set's accent color
 * substituted for `currentColor`.
 *
 * Inputs are route-validated by regex (`[a-z0-9-]+`) and then
 * re-checked against the scanned registry so unknown sets/keys 404.
 * The SVG is always served from the realpath inside the set
 * directory (see oddout_icons_resolve_set_path()), no arbitrary file
 * traversal is possible.
 */
add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'odd/v1',
			'/icons/(?P<set>[a-z0-9-]+)/(?P<key>[a-z0-9-_]+)',
			array(
				'methods'             => 'GET',
				'callback'            => 'oddout_icons_rest_serve_tinted',
				'permission_callback' => '__return_true',
				'args'                => array(
					'set' => array( 'type' => 'string' ),
					'key' => array( 'type' => 'string' ),
				),
			)
		);
	}
);

function oddout_icons_rest_serve_tinted( WP_REST_Request $request ) {
	$set_slug = sanitize_key( (string) $request->get_param( 'set' ) );
	$key      = sanitize_key( (string) $request->get_param( 'key' ) );

	if ( '' === $set_slug || '' === $key ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}

	// Built-ins live under odd/assets/icons/; user-installed sets
	// live under uploads/odd/icon-sets/. The registry already
	// merges both when building URLs, so the tinted-SVG endpoint
	// has to look up both too.
	$root = ODDOUT_DIR . 'assets/icons/' . $set_slug;
	if ( ! is_dir( $root ) && defined( 'ODDOUT_ICONSETS_DIR' ) ) {
		$installed_root = ODDOUT_ICONSETS_DIR . $set_slug;
		if ( is_dir( $installed_root ) ) {
			$root = $installed_root;
		}
	}
	if ( ! is_dir( $root ) ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon set.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}
	$manifest_path = $root . '/manifest.json';
	if ( ! is_readable( $manifest_path ) ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon set.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}
	$raw  = file_get_contents( $manifest_path );
	$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
	if ( ! is_array( $data ) || empty( $data['icons'] ) || ! is_array( $data['icons'] ) ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon set.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}

	$rel = null;
	foreach ( $data['icons'] as $k => $v ) {
		if ( sanitize_key( (string) $k ) === $key ) {
			$rel = (string) $v;
			break;
		}
	}
	if ( null === $rel ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}

	$abs = oddout_icons_resolve_set_path( $root, $rel );
	if ( '' === $abs || ! is_readable( $abs ) ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}

	$svg = file_get_contents( $abs );
	if ( false === $svg || '' === $svg ) {
		return new WP_Error( 'oddout_icon_invalid', __( 'Unknown icon.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}

	$accent = isset( $data['accent'] ) ? (string) $data['accent'] : '';
	$accent = trim( $accent );
	if ( preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $accent ) ) {
		$svg = str_replace( 'currentColor', $accent, $svg );
	}

	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}

	nocache_headers();
	header( 'Content-Type: image/svg+xml' );
	header( 'Cache-Control: public, max-age=3600, immutable' );
	header( 'X-Content-Type-Options: nosniff' );
	oddout_emit_raw_response( $svg );
	exit;
}
