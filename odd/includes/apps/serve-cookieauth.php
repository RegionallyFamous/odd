<?php
/**
 * ODD Apps — cookie-auth bundle serve endpoint.
 *
 * WHY THIS EXISTS
 * ---------------
 * Installed apps are browser bundles whose HTML entry
 * references static assets with *relative* URLs (`./assets/index-*.js`
 * etc.). The iframe receives those sub-requests from the browser, so
 * they carry the login cookie but NOT the `X-WP-Nonce` header.
 *
 * The REST serve route (`/wp-json/odd/v1/apps/serve/...`) requires a
 * rest_nonce because WP core's `rest_cookie_check_errors`
 * (wp-includes/rest-api.php) clears the current user whenever
 * a REST request has a login cookie but no nonce. The first request
 * succeeds (the nonce is in the iframe src query string) but every
 * subsequent asset fetch unsets the current user and 403s — the
 * iframe paints blank white.
 *
 * This endpoint sidesteps REST entirely. It listens on `init` for
 * requests whose URI path matches
 *
 *   /odd-app/<slug>/<path>
 *
 * authenticates via the logged-in cookie, checks the app's
 * capability, streams the file, and exits. No rewrite rules, no REST
 * pipeline, no nonce — so relative asset URLs from the iframe's own
 * document resolve and stream cleanly.
 *
 * A direct `$_SERVER['REQUEST_URI']` match keeps the endpoint independent
 * from rewrite-rule state, including in WordPress Playground.
 *
 * SECURITY
 * --------
 *   - Cookie auth is validated via `wp_validate_auth_cookie` — we
 *     don't trust a bare cookie, we re-validate the HMAC.
 *   - Capability is the app's normalized `capability` field (default
 *     `manage_options`) — same surface as the REST serve route.
 *   - Path is regex-constrained; realpath() confines the read to
 *     the app's own directory.
 *   - Apps are trusted same-origin code. CSP, frame, and permissions headers
 *     reduce accidental capability; they are not an isolation boundary.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inject the fixed, versioned app runtime before an entry document's scripts.
 * Installed catalog apps are trusted same-origin code; this exposes only the
 * supported REST/storage/confirmation adapter, not arbitrary host internals.
 */
function oddout_apps_inject_runtime( $html, $slug ) {
	$html = (string) $html;
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || false !== strpos( $html, 'data-odd-app-api="1"' ) ) {
		return $html;
	}
	$runtime_path = ODDOUT_DIR . 'assets/odd-browser-api.js';
	if ( ! is_readable( $runtime_path ) ) {
		return $html;
	}
	$runtime = file_get_contents( $runtime_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $runtime ) {
		return $html;
	}
	$config = array(
		'apiVersion' => 1,
		'slug'       => $slug,
		'windowId'   => 'odd-app-' . $slug,
		'restRoot'   => oddout_https_rest_url(),
		'restNonce'  => wp_create_nonce( 'wp_rest' ),
		'adminUrl'   => oddout_url_with_playground_scope( admin_url( '/' ) ),
	);
	$json   = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
	$boot   = '<script type="application/json" id="odd-browser-api-config" data-odd-app-api="1">' . $json . '</script>'
		. '<script data-odd-app-api="1">' . str_replace( '</script', '<\\/script', $runtime ) . '</script>';
	if ( preg_match( '#<head\b[^>]*>#i', $html ) ) {
		return (string) preg_replace( '#<head\b[^>]*>#i', '$0' . $boot, $html, 1 );
	}
	return $boot . $html;
}

/**
 * Normalize REQUEST_URI path for `/odd-app/` matching on subdirectory installs.
 *
 * `wordpress.org/blog/odd-app/foo` exposes a path `/blog/odd-app/foo`; matchers
 * expect `/odd-app/foo`. Uses `$segment/` as the prefix boundary so `/bloggers`
 * is not treated as `/blog` + garbage (earlier substr(len-1) bugs mangled paths
 * whenever `PHP_URL_PATH` omitted a trailing slash).
 *
 * @param string $req_path REQUEST_URI path (no query).
 * @param mixed  $home_pt Path from wp_parse_url( site_url( '/' ), PHP_URL_PATH ); may be false.
 *
 * @return string Path beginning with '/' for `#^/odd-app/` regexes.
 */
function oddout_apps_cookieauth_strip_home_path_prefix( $req_path, $home_pt ) {
	$path = (string) $req_path;
	if ( '' !== $path && '/' !== $path[0] ) {
		$path = '/' . $path;
	}

	$h = '';
	if ( is_string( $home_pt ) ) {
		$h = '/' . trim( $home_pt, '/' );
	}
	if ( '' === $h || '/' === $h ) {
		return $path;
	}

	$prefix = $h . '/';
	if ( 0 === strpos( $path, $prefix ) ) {
		$tail = substr( $path, strlen( $prefix ) );
		return '' !== $tail ? '/' . ltrim( $tail, '/' ) : '/';
	}
	if ( $path === $h || $path === $h . '/' ) {
		return '/';
	}

	return $path;
}

/**
 * Peel WordPress Playground’s per-instance URL prefix when present.
 *
 * The embedded site is often reached at paths like
 * `/scope:brave-quiet-road/wp-json/...` while `site_url()` path stays `/`.
 * Cookie-auth matching runs on raw `REQUEST_URI` — without this strip the
 * `/odd-app/<slug>/` regex never fires, assets 404, and the iframe stays white.
 *
 * @param string $req_path REQUEST_URI path (no query), with leading slash.
 * @return string Path with a single leading `/scope:…` segment removed when matched.
 */
function oddout_apps_cookieauth_strip_playground_scope_prefix( $req_path ) {
	$path = (string) $req_path;
	if ( '' !== $path && '/' !== $path[0] ) {
		$path = '/' . $path;
	}
	// Scope id is any non-`/` run (Playground uses hyphenated ids; older builds may use `_`, `.`, etc.).
	if ( ! preg_match( '#^/scope:[^/]+#', $path ) ) {
		return $path;
	}
	$tail = (string) preg_replace( '#^/scope:[^/]+#', '', $path );
	if ( '' === $tail || '/' === $tail ) {
		return '/';
	}
	if ( '/' !== $tail[0] ) {
		return '/' . $tail;
	}
	return $tail;
}

/**
 * Match + serve on every request. Registered at priority 1 on
 * `init` — that's the first hook after `pluggable.php` loads, so
 * `wp_validate_auth_cookie` is guaranteed to be available. It still
 * runs before any template / canonical-redirect logic, so the URL
 * can't be repurposed out from under us.
 */
add_action(
	'init',
	'oddout_apps_cookieauth_maybe_serve',
	1
);

function oddout_apps_cookieauth_maybe_serve() {
	if ( ! defined( 'ODDOUT_APPS_ENABLED' ) || ! ODDOUT_APPS_ENABLED ) {
		return;
	}

	$uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	if ( '' === $uri ) {
		return;
	}

	$parts = explode( '?', $uri, 2 );
	$path  = (string) $parts[0];

	// Before site-path stripping — Playground scope is outside WP’s site_url path.
	$path = oddout_apps_cookieauth_strip_playground_scope_prefix( $path );

	// Optional one-shot JSON trace, gated on manage_options. Lets
	// an admin hit /odd-app/<slug>/?oddout_debug=1 and see the exact
	// branch this matcher took — including auth + capability
	// decisions — without stopping the iframe to attach a debugger.
	$debug_trace = array();
	$debug_on    = false;
	$debug_param = isset( $_GET['oddout_debug'] ) ? sanitize_text_field( wp_unslash( $_GET['oddout_debug'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( '1' === $debug_param ) {
		$debug_on             = true;
		$debug_trace['entry'] = array(
			'request_uri' => $uri,
			'path'        => $path,
		);
	}

	// Use SITEURL path (WordPress install directory), not home_url path. When
	// HOME ≠ SITE (e.g. front page at `/`, core under `/blog` or `/wp`),
	// REQUEST_URI is scoped to SITEURL — matching HOME would fail to peel
	// /odd-app/.
	$site_pt = wp_parse_url( site_url( '/' ), PHP_URL_PATH );
	$path    = oddout_apps_cookieauth_strip_home_path_prefix( $path, false === $site_pt ? '' : $site_pt );

	// Expect `/odd-app/<slug>[/<rest>]`.
	if ( ! preg_match( '#^/odd-app/([a-z0-9-]+)(?:/(.*))?$#', $path, $m ) ) {
		if ( $debug_on && false !== strpos( $path, 'odd-app' ) ) {
			// Only emit when the request nominally targeted us —
			// otherwise every unrelated page load would return JSON.
			oddout_apps_debug_emit(
				array_merge(
					$debug_trace,
					array(
						'matched' => false,
						'reason'  => 'regex_miss',
					)
				)
			);
		}
		return;
	}

	$slug = $m[1];
	$sub  = isset( $m[2] ) ? (string) $m[2] : '';

	if ( $debug_on ) {
		$debug_trace['matched'] = true;
		$debug_trace['slug']    = $slug;
		$debug_trace['sub']     = $sub;
	}

	// Pass `null` (not an empty array) when debug is off, so the
	// callee's `is_array( $debug_trace )` gate actually gates. An
	// earlier revision passed the bare `$debug_trace` array in both
	// paths, which made `is_array()` always true inside
	// oddout_apps_serve_cookieauth() — so every `/odd-app/<slug>/`
	// request emitted the debug-JSON envelope instead of the real
	// HTML / asset response. That's the long-running "still white"
	// regression: the iframe's body was literally the debug JSON
	// trace, so nothing mounted and `#root` was missing entirely.
	oddout_apps_serve_cookieauth( $slug, $sub, $debug_on ? $debug_trace : null );
	exit;
}

/**
 * Emit a JSON debug payload and exit. Only reached when the caller
 * is logged in as manage_options AND passed `?oddout_debug=1`, so no
 * session info is exposed to anonymous visitors.
 *
 * @param array $data
 */
function oddout_apps_debug_emit( array $data ) {
	$user_id = wp_validate_auth_cookie( '', 'logged_in' );
	if ( ! $user_id ) {
		status_header( 401 );
		exit;
	}
	if ( ! user_can( $user_id, 'manage_options' ) ) {
		status_header( 403 );
		exit;
	}
	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}
	nocache_headers();
	header( 'X-Content-Type-Options: nosniff' );
	wp_send_json( $data, 200, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
}

/**
 * Serve an app bundle file using cookie auth only.
 *
 * @param string $slug App slug.
 * @param string $path Requested file path relative to the app root.
 */
function oddout_apps_serve_cookieauth( $slug, $path, $debug_trace = null ) {
	// `$debug_trace` must be null to disable debug JSON output.
	// An empty array still arms the debug emitter — callers must
	// pass null explicitly. Belt-and-suspenders: also require the
	// `?oddout_debug=1` query to be present, so a stray non-null
	// value from a future caller can't accidentally leak JSON
	// instead of the real response body.
	$debug_on = is_array( $debug_trace )
		&& isset( $_GET['oddout_debug'] ) // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		&& '1' === sanitize_text_field( wp_unslash( $_GET['oddout_debug'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$slug     = sanitize_key( $slug );
	if ( '' === $slug ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'invalid_slug' ) ) );
		}
		status_header( 404 );
		exit;
	}

	// Re-validate the logged-in cookie directly. REST's nonce
	// requirement doesn't apply because we never entered the REST
	// pipeline. The cookie's HMAC is still verified.
	$user_id = wp_validate_auth_cookie( '', 'logged_in' );
	if ( $debug_on ) {
		$debug_trace['auth_user_id'] = $user_id ? (int) $user_id : 0;
	}
	if ( ! $user_id ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'auth_missing' ) ) );
		}
		status_header( 401 );
		exit;
	}
	if ( ! function_exists( 'oddout_apps_index_load' ) ) {
		// Registry wasn't loaded — this can happen during very early
		// bootstrap errors. Fail closed rather than serve nothing.
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'registry_not_loaded' ) ) );
		}
		status_header( 500 );
		exit;
	}

	$index = oddout_apps_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit(
				array_merge(
					$debug_trace,
					array(
						'reason'      => 'slug_not_in_index',
						'known_slugs' => array_keys( $index ),
					)
				)
			);
		}
		status_header( 404 );
		exit;
	}
	if ( empty( $index[ $slug ]['enabled'] ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'slug_disabled' ) ) );
		}
		status_header( 404 );
		exit;
	}
	$cap = function_exists( 'oddout_apps_resolve_capability' )
		? oddout_apps_resolve_capability( $index[ $slug ] )
		: 'manage_options';
	if ( $debug_on ) {
		$debug_trace['required_cap'] = $cap;
		$debug_trace['cap_ok']       = user_can( $user_id, $cap );
	}
	if ( ! user_can( $user_id, $cap ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'capability_denied' ) ) );
		}
		status_header( 403 );
		exit;
	}

	if ( '' === $path ) {
		$manifest = oddout_apps_manifest_load( $slug );
		$path     = isset( $manifest['entry'] ) && $manifest['entry']
			? (string) $manifest['entry']
			: 'index.html';
	}
	if ( $debug_on ) {
		$debug_trace['path_resolved'] = $path;
	}

	if ( ! oddout_apps_relative_path_is_safe( $path ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'bad_path' ) ) );
		}
		status_header( 400 );
		exit;
	}

	$ext = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	if ( oddout_apps_extension_is_forbidden( $ext ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit(
				array_merge(
					$debug_trace,
					array(
						'reason' => 'forbidden_ext',
						'ext'    => $ext,
					)
				)
			);
		}
		status_header( 403 );
		exit;
	}

	$base      = oddout_apps_dir_for( $slug );
	$real_base = realpath( $base );
	$full      = realpath( $base . $path );
	if ( $debug_on ) {
		$debug_trace['base']      = $base;
		$debug_trace['real_base'] = $real_base;
		$debug_trace['full']      = $full;
	}
	if ( ! oddout_apps_realpath_is_inside( $full ? $full : '', $real_base ? $real_base : '' ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'realpath_escape_or_missing' ) ) );
		}
		status_header( 404 );
		exit;
	}
	if ( ! is_file( $full ) || ! is_readable( $full ) ) {
		if ( $debug_on ) {
			oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'file_not_found_or_unreadable' ) ) );
		}
		status_header( 404 );
		exit;
	}

	$mime = oddout_apps_mime_for( $full );
	$body = null;
	if ( oddout_apps_is_html_mime( $mime ) ) {
		$source = file_get_contents( $full ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false === $source ) {
			status_header( 500 );
			exit;
		}
		$body = oddout_apps_inject_runtime( $source, $slug );
	}
	$size = null !== $body ? strlen( $body ) : filesize( $full );

	if ( $debug_on ) {
		$debug_trace['mime']      = $mime;
		$debug_trace['size']      = (int) $size;
		$head                     = (string) @file_get_contents( $full, false, null, 0, 512 );
		$debug_trace['body_head'] = $head;
		oddout_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'ok_would_serve' ) ) );
	}

	if ( oddout_apps_is_html_mime( $mime ) ) {
		header( 'Content-Security-Policy: ' . oddout_apps_cookieauth_csp() );
	}

	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}

	nocache_headers();
	header( 'Content-Type: ' . $mime );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	if ( false === $size || ini_get( 'zlib.output_compression' ) ) {
		header_remove( 'Content-Length' );
	} else {
		header( 'Content-Length: ' . (int) $size );
	}
	header( 'Referrer-Policy: no-referrer' );
	header( 'Cross-Origin-Resource-Policy: same-origin' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( 'Permissions-Policy: camera=(), microphone=(), geolocation=()' );
	if ( null !== $body ) {
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- validated bundle HTML plus server-owned runtime.
		$sent = strlen( $body );
	} else {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		$sent = readfile( $full );
	}
	if ( false === $sent && defined( 'WP_DEBUG' ) && WP_DEBUG && function_exists( 'error_log' ) ) {
		// Headers are already flushed by the time we're streaming, so log a
		// disk-read regression instead of attempting a second response.
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( '[ODD Apps] cookie-auth readfile() failed for %s', $full ) );
	}
}

/**
 * Build the public iframe URL for an app. Always uses the pretty
 * `/odd-app/<slug>/` shape — since the matcher runs directly on
 * `$_SERVER['REQUEST_URI']` we don't need permalinks configured or
 * rewrite rules flushed for it to work.
 */
function oddout_apps_cookieauth_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return oddout_url_with_playground_scope( site_url( '/odd-app/' . $slug . '/' ) );
}

/**
 * Full iframe URL + wp_rest nonce for REST install/upload responses (matches `appServeUrls` in enqueue).
 *
 * @param string $slug App slug.
 * @return string Empty when slug invalid or apps are unavailable.
 */
function oddout_apps_serve_url_for_rest_payload( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || ! function_exists( 'oddout_apps_cookieauth_url_for' ) ) {
		return '';
	}
	return esc_url_raw(
		add_query_arg(
			array( '_wpnonce' => wp_create_nonce( 'wp_rest' ) ),
			oddout_apps_cookieauth_url_for( $slug )
		)
	);
}

/**
 * Build a Content-Security-Policy value for HTML served from /odd-app/.
 * The policy is fixed so an installed archive cannot weaken its own sandbox.
 *
 * @return string
 */
function oddout_apps_cookieauth_csp() {
	return "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
}
