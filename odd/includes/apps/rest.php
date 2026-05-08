<?php
/**
 * ODD Apps — REST namespace.
 *
 * Routes (all under /wp-json/odd/v1/apps/):
 *
 *   GET  /apps                              List installed apps
 *   GET  /apps/{slug}                       Full manifest
 *   POST /apps/upload                       Install a .wp archive
 *   POST /apps/{slug}/toggle                Enable / disable
 *   DELETE /apps/{slug}                     Uninstall
 *   GET  /apps/serve/{slug}/{path...}       Serve a file from the app bundle
 *   GET  /apps/icon/{slug}                  Public icon for the app (no auth)
 *   POST /apps/runtime/errors               Client error ingest (logged-in)
 *   GET  /apps/store/{slug}/{segment}       KV store read { value }
 *   PUT/POST /apps/store/{slug}/{segment}   KV store write { value }
 *   DELETE /apps/store/{slug}/{segment}     KV store delete
 *   GET  /apps/store/{slug}                 KV segment keys (bare array)
 *   DELETE /apps/store/{slug}               Clear KV bucket for slug
 *
 * Authorization:
 *
 *   - Management endpoints require manage_options.
 *   - serve/* requires the normalized per-app `capability` (default manage_options)
 *     and confines the file read to realpath( odd_apps_dir_for($slug) ).
 *   - icon/* is intentionally public: &lt;img src&gt; cannot send an
 *     X-WP-Nonce header, and dock/desktop icons are public branding
 *     anyway. Only the manifest's declared icon path is served.
 *
 * The serve endpoint is the only way app files reach the browser;
 * direct URLs to wp-content/odd-apps are blocked by the .htaccess
 * written on first install.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODD_APPS_KV_USER_META' ) ) {
	define( 'ODD_APPS_KV_USER_META', 'odd_apps_kv' );
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'odd/v1',
			'/apps',
			array(
				'methods'             => 'GET',
				'callback'            => 'odd_apps_rest_list',
				'permission_callback' => function () {
					return current_user_can( 'read' );
				},
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/upload',
			array(
				'methods'             => 'POST',
				'callback'            => 'odd_apps_rest_upload',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/runtime/errors',
			array(
				'methods'             => 'POST',
				'callback'            => 'odd_apps_rest_runtime_errors',
				'permission_callback' => static function () {
					return is_user_logged_in() && current_user_can( 'read' );
				},
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/store/(?P<slug>[a-z0-9-]+)/(?P<segment>[a-z0-9-]+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => 'odd_apps_rest_store_get',
					'permission_callback' => static function () {
						return is_user_logged_in() && current_user_can( 'read' );
					},
				),
				array(
					'methods'             => array( 'PUT', 'POST' ),
					'callback'            => 'odd_apps_rest_store_put',
					'permission_callback' => static function () {
						return is_user_logged_in() && current_user_can( 'read' );
					},
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => 'odd_apps_rest_store_delete',
					'permission_callback' => static function () {
						return is_user_logged_in() && current_user_can( 'read' );
					},
				),
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/store/(?P<slug>[a-z0-9-]+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => 'odd_apps_rest_store_keys',
					'permission_callback' => static function () {
						return is_user_logged_in() && current_user_can( 'read' );
					},
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => 'odd_apps_rest_store_clear',
					'permission_callback' => static function () {
						return is_user_logged_in() && current_user_can( 'read' );
					},
				),
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/(?P<slug>[a-z0-9-]+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => 'odd_apps_rest_get',
					'permission_callback' => function () {
						return current_user_can( 'read' );
					},
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => 'odd_apps_rest_delete',
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
				),
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/(?P<slug>[a-z0-9-]+)/toggle',
			array(
				'methods'             => 'POST',
				'callback'            => 'odd_apps_rest_toggle',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'odd/v1',
			'/apps/serve/(?P<slug>[a-z0-9-]+)(?:/(?P<path>.+))?',
			array(
				'methods'             => 'GET',
				'callback'            => 'odd_apps_rest_serve',
				'permission_callback' => 'odd_apps_rest_serve_permission',
			)
		);

		// Public icon endpoint. REST cookie auth requires an
		// X-WP-Nonce header and an <img src> tag can't send one, so
		// the desktop dock (and every panel card) would 401 otherwise.
		// Icons are already public branding — any enabled app shows
		// its icon on the desktop — so we serve just the manifest's
		// declared icon path with no auth. Path escape is impossible
		// because we never read client-supplied path segments here.
		register_rest_route(
			'odd/v1',
			'/apps/icon/(?P<slug>[a-z0-9-]+)',
			array(
				'methods'             => 'GET',
				'callback'            => 'odd_apps_rest_icon',
				'permission_callback' => '__return_true',
			)
		);

		// Diagnostic endpoint. Exists so a site admin can reproduce
		// "app window opens blank white" on any install without
		// attaching a debugger. Returns a JSON envelope describing
		// the request context, the install state of the requested
		// slug, and whether every function our serve path relies on
		// is actually loaded.
		//
		// Always gated on manage_options — its payload includes
		// filesystem paths and the first 256 bytes of the app's HTML
		// entry. Never public.
		register_rest_route(
			'odd/v1',
			'/apps/diag/(?P<slug>[a-z0-9-]+)',
			array(
				'methods'             => 'GET',
				'callback'            => 'odd_apps_rest_diag',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}
);

function odd_apps_rest_list() {
	return rest_ensure_response(
		array(
			'apps' => odd_apps_list(),
		)
	);
}

function odd_apps_rest_get( WP_REST_Request $req ) {
	$slug     = sanitize_key( $req['slug'] );
	$manifest = odd_apps_manifest_load( $slug );
	if ( empty( $manifest ) ) {
		return new WP_Error( 'not_found', __( 'App not found.', 'odd' ), array( 'status' => 404 ) );
	}
	return rest_ensure_response( $manifest );
}

function odd_apps_rest_upload( WP_REST_Request $req ) {
	$files = $req->get_file_params();
	if ( empty( $files['file'] ) || ! isset( $files['file']['tmp_name'] ) ) {
		return new WP_Error( 'no_file', __( 'No file uploaded. Use multipart field "file".', 'odd' ), array( 'status' => 400 ) );
	}
	$file   = $files['file'];
	$tmp    = $file['tmp_name'];
	$name   = $file['name'];
	$result = odd_apps_install( $tmp, $name );
	if ( is_wp_error( $result ) ) {
		$data           = $result->get_error_data();
		$data['status'] = isset( $data['status'] ) ? $data['status'] : 400;
		$result->add_data( $data );
		return $result;
	}
	$out = array(
		'installed' => true,
		'slug'      => sanitize_key( (string) ( $result['slug'] ?? '' ) ),
		'type'      => 'app',
		'manifest'  => $result,
	);
	if ( isset( $out['slug'] ) && '' !== $out['slug'] && function_exists( 'odd_apps_serve_url_for_rest_payload' ) ) {
		$serve = odd_apps_serve_url_for_rest_payload( $out['slug'] );
		if ( '' !== $serve ) {
			$out['serve_url'] = $serve;
		}
	}
	return rest_ensure_response( $out );
}

function odd_apps_rest_delete( WP_REST_Request $req ) {
	$slug   = sanitize_key( $req['slug'] );
	$result = odd_apps_uninstall( $slug );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( array( 'uninstalled' => true ) );
}

function odd_apps_rest_toggle( WP_REST_Request $req ) {
	$slug     = sanitize_key( $req['slug'] );
	$enabled  = $req->get_param( 'enabled' );
	$surfaces = $req->get_param( 'surfaces' );

	// Back-compat: a bare POST with no body still toggles `enabled`,
	// matching the original contract. A payload can now ALSO carry
	// a `surfaces` object; either field alone (or both) is valid.
	if ( null === $enabled && null === $surfaces ) {
		$index   = odd_apps_index_load();
		$enabled = ! ( isset( $index[ $slug ]['enabled'] ) && $index[ $slug ]['enabled'] );
	}

	if ( null !== $enabled ) {
		$result = odd_apps_set_enabled( $slug, (bool) $enabled );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
	}

	if ( null !== $surfaces ) {
		if ( ! is_array( $surfaces ) ) {
			return new WP_Error( 'invalid_surfaces', __( 'surfaces must be an object.', 'odd' ), array( 'status' => 400 ) );
		}
		$result = odd_apps_set_surfaces( $slug, $surfaces );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
	}

	$index = odd_apps_index_load();
	$row   = isset( $index[ $slug ] ) ? $index[ $slug ] : array();

	return rest_ensure_response(
		array(
			'enabled'  => isset( $row['enabled'] ) ? (bool) $row['enabled'] : (bool) $enabled,
			'surfaces' => odd_apps_row_surfaces( $row ),
		)
	);
}

/**
 * Serve a file from an app bundle.
 *
 * Safety walk:
 *   - Resolve the requested path via realpath inside the app's own
 *     realpath base — if it escapes, return 403.
 *   - Forbidden extensions from the validator are re-checked here so
 *     a manifest.json that lies about an entry can't slip through.
 *   - Cache-Control is private, no-store — app bundles change on
 *     install/uninstall and must never hit a shared proxy.
 *
 * Content-Type is guessed via a small MIME table covering the common
 * static file types. Unknowns fall back to application/octet-stream.
 */
function odd_apps_rest_serve_permission( WP_REST_Request $req ) {
	if ( ! is_user_logged_in() ) {
		return false;
	}
	$slug  = sanitize_key( $req['slug'] );
	$index = odd_apps_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return false;
	}
	if ( empty( $index[ $slug ]['enabled'] ) ) {
		return false;
	}
	$cap = function_exists( 'odd_apps_normalize_capability' )
		? odd_apps_normalize_capability( isset( $index[ $slug ]['capability'] ) ? $index[ $slug ]['capability'] : '' )
		: 'manage_options';
	return current_user_can( $cap );
}

function odd_apps_rest_serve( WP_REST_Request $req ) {
	$slug = sanitize_key( $req['slug'] );
	$path = (string) $req['path'];
	if ( '' === $path ) {
		$manifest = odd_apps_manifest_load( $slug );
		$path     = isset( $manifest['entry'] ) && $manifest['entry'] ? (string) $manifest['entry'] : 'index.html';
	}

	if (
		false !== strpos( $path, '..' ) ||
		( strlen( $path ) > 0 && '/' === $path[0] ) ||
		false !== strpos( $path, "\0" ) ||
		! preg_match( '#^[a-zA-Z0-9._/-]+$#', $path )
	) {
		return new WP_Error( 'bad_path', __( 'Bad app path.', 'odd' ), array( 'status' => 400 ) );
	}

	$ext = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	if ( in_array( $ext, odd_apps_forbidden_extensions(), true ) ) {
		return new WP_Error( 'forbidden', __( 'This file type cannot be served.', 'odd' ), array( 'status' => 403 ) );
	}

	$base      = odd_apps_dir_for( $slug );
	$real_base = realpath( $base );
	$full      = realpath( $base . $path );
	if ( ( ! $real_base || ! $full ) && '' !== $path && function_exists( 'odd_apps_repair_from_catalog' ) ) {
		$repair = odd_apps_repair_from_catalog( $slug, $path );
		if ( true === $repair ) {
			clearstatcache();
			$real_base = realpath( $base );
			$full      = realpath( $base . $path );
		}
	}
	if ( ! $real_base || ! $full || 0 !== strpos( $full, $real_base ) ) {
		return new WP_Error( 'not_found', __( 'File not found.', 'odd' ), array( 'status' => 404 ) );
	}
	if ( ! is_file( $full ) || ! is_readable( $full ) ) {
		return new WP_Error( 'not_found', __( 'File not found.', 'odd' ), array( 'status' => 404 ) );
	}

	$mime = odd_apps_mime_for( $full );
	$body = null;
	$size = filesize( $full );

	if ( odd_apps_is_html_mime( $mime ) ) {
		$raw = file_get_contents( $full ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false !== $raw ) {
			if ( function_exists( 'odd_apps_prepare_app_html_output' ) ) {
				$body = odd_apps_prepare_app_html_output( $raw );
			} elseif ( function_exists( 'odd_apps_inject_runtime_importmap' ) ) {
				$body = odd_apps_inject_runtime_importmap( $raw );
			}
			if ( null !== $body ) {
				$size = strlen( $body );
			}
		}
	}

	// Drain any admin-side output buffers so readfile streams the
	// file bytes unmolested. Without this a stray debug notice or
	// admin_head echo ends up prepended to the response body.
	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}

	nocache_headers();
	header( 'Content-Type: ' . $mime );
	header( 'X-Content-Type-Options: nosniff' );
	// Content-Length is only meaningful when no transport compression
	// is in play; the PHP runtime may gzip the response otherwise.
	if ( false === $size || ini_get( 'zlib.output_compression' ) ) {
		header_remove( 'Content-Length' );
	} else {
		header( 'Content-Length: ' . (int) $size );
	}
	header( 'Referrer-Policy: no-referrer' );
	// Apps load into a sandboxed iframe. Explicit framing headers
	// prevent a third-party site from embedding the serve URL outside
	// our own admin shell.
	header( 'X-Frame-Options: SAMEORIGIN' );
	if ( null !== $body ) {
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	} else {
		// readfile() is used intentionally: the serve endpoint streams
		// potentially multi-megabyte static assets to a sandboxed iframe
		// and must not buffer the whole payload into memory.
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		$sent = readfile( $full );
		if ( false === $sent && defined( 'WP_DEBUG' ) && WP_DEBUG && function_exists( 'error_log' ) ) {
			// Headers are already flushed at this point, so we can't
			// surface the failure to the client — but logging lets
			// the admin spot a disk-read or permissions regression.
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( sprintf( '[ODD Apps] readfile() failed for %s', $full ) );
		}
	}
	exit;
}

/**
 * Public icon endpoint.
 *
 * Resolves the app's manifest.icon path (defaults to icon.svg) and
 * streams it with a long cache header. No client-supplied path is
 * honoured, so there's no traversal surface — the slug is the only
 * variable input and the regex constrains it.
 *
 * Returns 404 for missing / disabled / iconless apps so enumerating
 * slugs reveals nothing extra beyond "an app with this slug either
 * exists or doesn't".
 */
function odd_apps_rest_icon( WP_REST_Request $req ) {
	$slug  = sanitize_key( $req['slug'] );
	$index = odd_apps_index_load();
	if ( ! isset( $index[ $slug ] ) || empty( $index[ $slug ]['enabled'] ) ) {
		return new WP_Error( 'not_found', __( 'App not found.', 'odd' ), array( 'status' => 404 ) );
	}

	$manifest = odd_apps_manifest_load( $slug );
	$icon     = isset( $manifest['icon'] ) && $manifest['icon']
		? (string) $manifest['icon']
		: 'icon.svg';

	// Restrict to a safe character set and forbid path escape.
	if (
		false !== strpos( $icon, '..' ) ||
		( strlen( $icon ) > 0 && '/' === $icon[0] ) ||
		false !== strpos( $icon, "\0" ) ||
		! preg_match( '#^[a-zA-Z0-9._/-]+$#', $icon )
	) {
		return new WP_Error( 'not_found', __( 'App not found.', 'odd' ), array( 'status' => 404 ) );
	}

	$ext = strtolower( pathinfo( $icon, PATHINFO_EXTENSION ) );
	if ( ! in_array( $ext, array( 'svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'ico' ), true ) ) {
		return new WP_Error( 'not_found', __( 'App not found.', 'odd' ), array( 'status' => 404 ) );
	}

	$base      = odd_apps_dir_for( $slug );
	$real_base = realpath( $base );
	$full      = realpath( $base . $icon );
	if ( ( ! $real_base || ! $full ) && function_exists( 'odd_apps_repair_from_catalog' ) ) {
		$repair = odd_apps_repair_from_catalog( $slug, $icon );
		if ( true === $repair ) {
			clearstatcache();
			$real_base = realpath( $base );
			$full      = realpath( $base . $icon );
		}
	}
	if ( ! $real_base || ! $full || 0 !== strpos( $full, $real_base ) ) {
		return new WP_Error( 'not_found', __( 'App not found.', 'odd' ), array( 'status' => 404 ) );
	}
	if ( ! is_file( $full ) || ! is_readable( $full ) ) {
		return new WP_Error( 'not_found', __( 'App not found.', 'odd' ), array( 'status' => 404 ) );
	}

	$mime = odd_apps_mime_for( $full );
	$size = filesize( $full );

	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}

	header( 'Content-Type: ' . $mime );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Cache-Control: public, max-age=86400' );
	if ( $size && ! ini_get( 'zlib.output_compression' ) ) {
		header( 'Content-Length: ' . (int) $size );
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
	$sent = readfile( $full );
	if ( false === $sent && defined( 'WP_DEBUG' ) && WP_DEBUG && function_exists( 'error_log' ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( '[ODD Apps] readfile() failed for icon %s', $full ) );
	}
	exit;
}

function odd_apps_mime_for( $path ) {
	$ext = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	$map = array(
		'html'  => 'text/html; charset=utf-8',
		'htm'   => 'text/html; charset=utf-8',
		'css'   => 'text/css; charset=utf-8',
		'js'    => 'application/javascript; charset=utf-8',
		'mjs'   => 'application/javascript; charset=utf-8',
		'json'  => 'application/json; charset=utf-8',
		'svg'   => 'image/svg+xml',
		'webp'  => 'image/webp',
		'png'   => 'image/png',
		'jpg'   => 'image/jpeg',
		'jpeg'  => 'image/jpeg',
		'gif'   => 'image/gif',
		'ico'   => 'image/x-icon',
		'woff'  => 'font/woff',
		'woff2' => 'font/woff2',
		'ttf'   => 'font/ttf',
		'otf'   => 'font/otf',
		'txt'   => 'text/plain; charset=utf-8',
		'md'    => 'text/markdown; charset=utf-8',
		'wasm'  => 'application/wasm',
		'map'   => 'application/json; charset=utf-8',
	);
	return isset( $map[ $ext ] ) ? $map[ $ext ] : 'application/octet-stream';
}

/**
 * Whether a Content-Type value is HTML (ignores charset and other parameters).
 *
 * odd_apps_mime_for() always appends `; charset=utf-8` for .html — strict
 * equality with `text/html` would skip the entire cookie-auth / REST HTML
 * pipeline (import map, fetch bootstrap, CSP).
 *
 * @param string $mime Full header value, e.g. `text/html; charset=utf-8`.
 * @return bool
 */
function odd_apps_is_html_mime( $mime ) {
	$mime = strtolower( (string) $mime );
	if ( false !== strpos( $mime, ';' ) ) {
		$mime = trim( substr( $mime, 0, strpos( $mime, ';' ) ) );
	}
	return in_array( $mime, array( 'text/html', 'application/xhtml+xml' ), true );
}

/**
 * Diagnostic payload for the "why does my app window render blank"
 * investigation. Walks every known layer between the install record
 * and the served HTML, surfaces what's wired up, and flags the first
 * thing that's missing.
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function odd_apps_rest_diag( WP_REST_Request $req ) {
	$slug = sanitize_key( (string) $req['slug'] );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Missing slug.', 'odd' ), array( 'status' => 400 ) );
	}

	$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$home_url    = function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( home_url( '/' ) ) : home_url( '/' );
	$home_path   = (string) wp_parse_url( $home_url, PHP_URL_PATH );
	$site_url    = function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( site_url( '/' ) ) : site_url( '/' );
	$site_path   = wp_parse_url( $site_url, PHP_URL_PATH );
	$site_path   = is_string( $site_path ) ? $site_path : '';

	$env = array(
		'odd_version'        => defined( 'ODD_VERSION' ) ? ODD_VERSION : null,
		'odd_schema_version' => defined( 'ODD_SCHEMA_VERSION' ) ? ODD_SCHEMA_VERSION : null,
		'apps_enabled'       => defined( 'ODD_APPS_ENABLED' ) && ODD_APPS_ENABLED,
		'is_admin'           => is_admin(),
		'is_rest'            => defined( 'REST_REQUEST' ) && REST_REQUEST,
		'is_ajax'            => wp_doing_ajax(),
		'request_uri'        => $request_uri,
		'home_url'           => $home_url,
		'home_path'          => $home_path,
		'site_url'           => $site_url,
		'site_path'          => $site_path,
		'user_id'            => get_current_user_id(),
		'wp_debug'           => defined( 'WP_DEBUG' ) && WP_DEBUG,
	);

	// Every function we rely on across the install→render→serve
	// chain. If any of these is false, that's the failure mode.
	$loaders = array(
		'odd_apps_list'                     => function_exists( 'odd_apps_list' ),
		'odd_apps_index_load'               => function_exists( 'odd_apps_index_load' ),
		'odd_apps_manifest_load'            => function_exists( 'odd_apps_manifest_load' ),
		'odd_apps_dir_for'                  => function_exists( 'odd_apps_dir_for' ),
		'odd_apps_register_surfaces'        => function_exists( 'odd_apps_register_surfaces' ),
		'odd_apps_render_window_template'   => function_exists( 'odd_apps_render_window_template' ),
		'odd_apps_cookieauth_url_for'       => function_exists( 'odd_apps_cookieauth_url_for' ),
		'odd_apps_cookieauth_maybe_serve'   => function_exists( 'odd_apps_cookieauth_maybe_serve' ),
		'odd_apps_repair_from_catalog'      => function_exists( 'odd_apps_repair_from_catalog' ),
		'odd_apps_repair_meta_for'          => function_exists( 'odd_apps_repair_meta_for' ),
		'odd_apps_forbidden_extensions'     => function_exists( 'odd_apps_forbidden_extensions' ),
		'odd_apps_mime_for'                 => function_exists( 'odd_apps_mime_for' ),
		'odd_apps_inject_runtime_importmap' => function_exists( 'odd_apps_inject_runtime_importmap' ),
		'desktop_mode_register_window'      => function_exists( 'desktop_mode_register_window' ),
	);

	// Hook priority — is serve-cookieauth actually on init@1?
	$init_hooks = array();
	global $wp_filter;
	if ( isset( $wp_filter['init'] ) && $wp_filter['init'] instanceof WP_Hook ) {
		foreach ( $wp_filter['init']->callbacks as $priority => $cbs ) {
			foreach ( $cbs as $cb ) {
				$name = '';
				if ( is_string( $cb['function'] ) ) {
					$name = $cb['function'];
				} elseif ( $cb['function'] instanceof Closure ) {
					$name = '(closure)';
				}
				if ( false === strpos( $name, 'odd_apps' ) ) {
					continue;
				}
				$init_hooks[] = array(
					'priority' => $priority,
					'function' => $name,
				);
			}
		}
	}

	$index     = function_exists( 'odd_apps_index_load' ) ? odd_apps_index_load() : array();
	$row       = isset( $index[ $slug ] ) ? $index[ $slug ] : null;
	$installed = null !== $row;
	$enabled   = $installed && ! empty( $row['enabled'] );

	$manifest    = function_exists( 'odd_apps_manifest_load' ) ? odd_apps_manifest_load( $slug ) : null;
	$icon_health = function_exists( 'odd_apps_manifest_icon_health' )
		? odd_apps_manifest_icon_health( $slug, $manifest )
		: null;

	$base      = function_exists( 'odd_apps_dir_for' ) ? odd_apps_dir_for( $slug ) : '';
	$real_base = $base ? realpath( $base ) : false;

	// Resolve what the iframe src would actually request.
	$entry      = $manifest && ! empty( $manifest['entry'] ) ? (string) $manifest['entry'] : 'index.html';
	$entry_path = $base ? ( $base . $entry ) : '';
	$entry_real = $entry_path ? realpath( $entry_path ) : false;
	$entry_size = ( $entry_real && is_file( $entry_real ) ) ? (int) filesize( $entry_real ) : 0;
	$entry_head = '';
	if ( $entry_real && is_readable( $entry_real ) && $entry_size > 0 ) {
		$entry_head = (string) @file_get_contents( $entry_real, false, null, 0, 256 );
	}

	$serve_url = '';
	if ( function_exists( 'odd_apps_cookieauth_url_for' ) ) {
		$serve_url = odd_apps_cookieauth_url_for( $slug );
	}

	// Exercise the same regex the cookie-auth matcher uses, against
	// a simulated path shaped like what the browser would send.
	$simulated     = '/odd-app/' . $slug . '/';
	$regex_matches = (bool) preg_match( '#^/odd-app/([a-z0-9-]+)(?:/(.*))?$#', $simulated );

	// Sanity: would the import-map injection corrupt an empty-head
	// HTML? Run the actual function on a known-good minimal doc.
	$importmap_ok = null;
	if ( function_exists( 'odd_apps_inject_runtime_importmap' ) ) {
		$sample       = '<!doctype html><html><head></head><body></body></html>';
		$transformed  = odd_apps_inject_runtime_importmap( $sample );
		$importmap_ok = is_string( $transformed ) && false !== stripos( $transformed, 'importmap' );
	}

	// Has the client-side desktop shell template element been
	// written for this window? We can't see the shell's DOM from
	// the server, but we can confirm the registry entry exists.
	$desktop_mode_registered = null;
	if ( function_exists( 'desktop_mode_native_window_registry' ) ) {
		$desktop_mode_registered = null !== desktop_mode_native_window_registry( 'odd-app-' . $slug );
	}

	$diag = array(
		'slug'         => $slug,
		'env'          => $env,
		'loaders'      => $loaders,
		'init_hooks'   => $init_hooks,
		'install'      => array(
			'installed' => $installed,
			'enabled'   => $enabled,
			'row'       => $row,
			'manifest'  => $manifest ? array(
				'name'           => isset( $manifest['name'] ) ? $manifest['name'] : null,
				'entry'          => $entry,
				'icon'           => isset( $manifest['icon'] ) ? $manifest['icon'] : null,
				'has_extensions' => ! empty( $manifest['extensions'] ),
			) : null,
		),
		'filesystem'   => array(
			'base'       => $base,
			'real_base'  => $real_base,
			'entry_path' => $entry_path,
			'entry_real' => $entry_real,
			'entry_size' => $entry_size,
			'entry_head' => $entry_head,
		),
		'serve'        => array(
			'url'           => $serve_url,
			'regex_matches' => $regex_matches,
			'importmap_ok'  => $importmap_ok,
		),
		'repair'       => array(
			'last' => function_exists( 'odd_apps_repair_meta_for' ) ? odd_apps_repair_meta_for( $slug ) : array(),
		),
		'icon'         => $icon_health,
		'desktop_mode' => array(
			'window_id'         => 'odd-app-' . $slug,
			'window_registered' => $desktop_mode_registered,
		),
	);

	return rest_ensure_response( $diag );
}

function odd_apps_kv_load_tree( $user_id ) {
	$user_id = (int) $user_id;
	$root    = get_user_meta( $user_id, ODD_APPS_KV_USER_META, true );
	if ( ! is_array( $root ) ) {
		return array(
			'stores' => array(),
		);
	}
	if ( isset( $root['stores'] ) && is_array( $root['stores'] ) ) {
		return array(
			'stores' => $root['stores'],
		);
	}

	return array(
		'stores' => array(),
	);
}

function odd_apps_kv_save_tree( $user_id, array $stores ) {
	update_user_meta(
		(int) $user_id,
		ODD_APPS_KV_USER_META,
		array(
			'stores' => $stores,
		)
	);
}

function odd_apps_kv_segments_for_slug( $user_id, $slug ) {
	$slug = sanitize_key( (string) $slug );
	$tree = odd_apps_kv_load_tree( $user_id );
	if ( '' === $slug || ! isset( $tree['stores'][ $slug ] ) || ! is_array( $tree['stores'][ $slug ] ) ) {
		return array();
	}

	return $tree['stores'][ $slug ];
}

function odd_apps_rest_runtime_errors( WP_REST_Request $request ) {
	unset( $request );

	return rest_ensure_response( array( 'ok' => true ) );
}

function odd_apps_rest_store_get( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request['slug'] );
	$segment = sanitize_key( (string) $request['segment'] );
	$bucket  = odd_apps_kv_segments_for_slug( $user_id, $slug );
	$value   = null;
	if ( isset( $bucket[ $segment ] ) ) {
		$value = $bucket[ $segment ];
	}

	return rest_ensure_response(
		array(
			'value' => $value,
		)
	);
}

function odd_apps_rest_store_put( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request['slug'] );
	$segment = sanitize_key( (string) $request['segment'] );
	$params  = $request->get_json_params();
	if ( ! is_array( $params ) ) {
		$params = array();
	}

	$value       = isset( $params['value'] ) ? $params['value'] : null;
	$tree        = odd_apps_kv_load_tree( $user_id );
	$tree_stores = isset( $tree['stores'] ) && is_array( $tree['stores'] ) ? $tree['stores'] : array();
	if ( ! isset( $tree_stores[ $slug ] ) || ! is_array( $tree_stores[ $slug ] ) ) {
		$tree_stores[ $slug ] = array();
	}
	$tree_stores[ $slug ][ $segment ] = $value;
	odd_apps_kv_save_tree( $user_id, $tree_stores );

	return rest_ensure_response(
		array(
			'value' => $value,
		)
	);
}

function odd_apps_rest_store_delete( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request['slug'] );
	$segment = sanitize_key( (string) $request['segment'] );

	$tree        = odd_apps_kv_load_tree( $user_id );
	$tree_stores = isset( $tree['stores'] ) && is_array( $tree['stores'] ) ? $tree['stores'] : array();

	if ( isset( $tree_stores[ $slug ][ $segment ] ) ) {
		unset( $tree_stores[ $slug ][ $segment ] );
	}

	odd_apps_kv_save_tree( $user_id, $tree_stores );

	return new WP_REST_Response( null, 204 );
}

function odd_apps_rest_store_keys( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request['slug'] );

	$segments = odd_apps_kv_segments_for_slug( $user_id, $slug );
	$keys     = array_keys( $segments );
	sort( $keys, SORT_NATURAL );

	return rest_ensure_response( $keys );
}

function odd_apps_rest_store_clear( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request['slug'] );

	$tree        = odd_apps_kv_load_tree( $user_id );
	$tree_stores = isset( $tree['stores'] ) && is_array( $tree['stores'] ) ? $tree['stores'] : array();

	unset( $tree_stores[ $slug ] );

	odd_apps_kv_save_tree( $user_id, $tree_stores );

	return new WP_REST_Response( null, 204 );
}
