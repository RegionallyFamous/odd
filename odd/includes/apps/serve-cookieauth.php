<?php
/**
 * ODD Apps — cookie-auth bundle serve endpoint.
 *
 * WHY THIS EXISTS
 * ---------------
 * Installed apps are Vite/React single-page bundles whose HTML entry
 * references static assets with *relative* URLs (`./assets/index-*.js`
 * etc.). The iframe receives those sub-requests from the browser, so
 * they carry the login cookie but NOT the `X-WP-Nonce` header.
 *
 * The REST serve route (`/wp-json/odd/v1/apps/serve/...`) requires a
 * rest_nonce because WP core's `rest_cookie_check_errors`
 * (wp-includes/rest-api.php) runs `wp_set_current_user(0)` whenever
 * a REST request has a login cookie but no nonce. The first request
 * succeeds (the nonce is in the iframe src query string) but every
 * subsequent asset fetch unsets the current user and 403s — the
 * iframe paints blank white.
 *
 * This endpoint sidesteps REST entirely. It listens on `init` for
 * requests whose URI path matches
 *
 *   /odd-app/<slug>/<path>
 *   /odd-app-runtime/<runtime-module>.js
 *
 * authenticates via the logged-in cookie, checks the app's
 * capability, streams the file, and exits. No rewrite rules, no REST
 * pipeline, no nonce — so relative asset URLs from the iframe's own
 * document resolve and stream cleanly.
 *
 * Earlier revisions (<= 1.3.1) used `add_rewrite_rule` +
 * `template_redirect`, but that path depended on `flush_rewrite_rules`
 * having run (and having persisted) on the exact install the user is
 * loading. Playground installs, mu-plugin setups, and any site with a
 * stale `rewrite_rules` option regressed back to the REST path and
 * left the iframe blank. A direct `$_SERVER['REQUEST_URI']` match
 * has no such dependency.
 *
 * SECURITY
 * --------
 *   - Cookie auth is validated via `wp_validate_auth_cookie` — we
 *     don't trust a bare cookie, we re-validate the HMAC.
 *   - Capability is the app's normalized `capability` field (default
 *     `manage_options`) — same surface as the REST serve route.
 *   - Path is regex-constrained; realpath() confines the read to
 *     the app's own directory.
 *   - `X-Frame-Options: SAMEORIGIN` + `Referrer-Policy: no-referrer`
 *     mirror the REST route headers.
 */

defined( 'ABSPATH' ) || exit;

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
function odd_apps_cookieauth_strip_home_path_prefix( $req_path, $home_pt ) {
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
function odd_apps_cookieauth_strip_playground_scope_prefix( $req_path ) {
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
	'odd_apps_cookieauth_maybe_serve',
	1
);

function odd_apps_cookieauth_maybe_serve() {
	if ( ! defined( 'ODD_APPS_ENABLED' ) || ! ODD_APPS_ENABLED ) {
		return;
	}

	$uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	if ( '' === $uri ) {
		return;
	}

	$parts = explode( '?', $uri, 2 );
	$path  = (string) $parts[0];

	// Before site-path stripping — Playground scope is outside WP’s site_url path.
	$path = odd_apps_cookieauth_strip_playground_scope_prefix( $path );

	// Optional one-shot JSON trace, gated on manage_options. Lets
	// an admin hit /odd-app/<slug>/?odd_debug=1 and see the exact
	// branch this matcher took — including auth + capability
	// decisions — without stopping the iframe to attach a debugger.
	$debug_trace = array();
	$debug_on    = false;
	$debug_param = isset( $_GET['odd_debug'] ) ? sanitize_text_field( wp_unslash( $_GET['odd_debug'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
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
	$path    = odd_apps_cookieauth_strip_home_path_prefix( $path, false === $site_pt ? '' : $site_pt );

	// Runtime endpoint: serves React 19 ESM bundles + any shared chunks
	// esbuild emitted alongside them. The app bundles' bare `react` /
	// `react-dom` / `react/jsx-runtime` imports are rewritten by
	// odd_apps_rewrite_runtime_bare_imports() to absolute URLs under
	// /odd-app-runtime/, and the entry modules import their shared
	// chunks with relative paths like `./chunk-AB12CDEF.js`, which
	// the browser resolves back into this same endpoint.
	if ( preg_match( '#^/odd-app-runtime/([a-zA-Z0-9._-]+\.js)$#', $path, $runtime_match ) ) {
		odd_apps_serve_runtime_module( $runtime_match[1] );
		exit;
	}

	// Expect `/odd-app/<slug>[/<rest>]`.
	if ( ! preg_match( '#^/odd-app/([a-z0-9-]+)(?:/(.*))?$#', $path, $m ) ) {
		if ( $debug_on && false !== strpos( $path, 'odd-app' ) ) {
			// Only emit when the request nominally targeted us —
			// otherwise every unrelated page load would return JSON.
			odd_apps_debug_emit(
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
	// odd_apps_serve_cookieauth() — so every `/odd-app/<slug>/`
	// request emitted the debug-JSON envelope instead of the real
	// HTML / asset response. That's the long-running "still white"
	// regression: the iframe's body was literally the debug JSON
	// trace, so nothing mounted and `#root` was missing entirely.
	odd_apps_serve_cookieauth( $slug, $sub, $debug_on ? $debug_trace : null );
	exit;
}

/**
 * Emit a JSON debug payload and exit. Only reached when the caller
 * is logged in as manage_options AND passed `?odd_debug=1`, so no
 * session info is exposed to anonymous visitors.
 *
 * @param array $data
 */
function odd_apps_debug_emit( array $data ) {
	$user_id = wp_validate_auth_cookie( '', 'logged_in' );
	if ( ! $user_id ) {
		status_header( 401 );
		exit;
	}
	wp_set_current_user( $user_id );
	if ( ! current_user_can( 'manage_options' ) ) {
		status_header( 403 );
		exit;
	}
	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}
	nocache_headers();
	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'X-Content-Type-Options: nosniff' );
	echo wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
	exit;
}

/**
 * Serve an app bundle file using cookie auth only.
 *
 * @param string $slug App slug.
 * @param string $path Requested file path relative to the app root.
 */
function odd_apps_serve_cookieauth( $slug, $path, $debug_trace = null ) {
	// `$debug_trace` must be null to disable debug JSON output.
	// An empty array still arms the debug emitter — callers must
	// pass null explicitly. Belt-and-suspenders: also require the
	// `?odd_debug=1` query to be present, so a stray non-null
	// value from a future caller can't accidentally leak JSON
	// instead of the real response body.
	$debug_on = is_array( $debug_trace )
		&& isset( $_GET['odd_debug'] ) // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		&& '1' === sanitize_text_field( wp_unslash( $_GET['odd_debug'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$slug     = sanitize_key( $slug );
	if ( '' === $slug ) {
		if ( $debug_on ) {
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'invalid_slug' ) ) );
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
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'auth_missing' ) ) );
		}
		status_header( 401 );
		exit;
	}
	wp_set_current_user( $user_id );

	if ( ! function_exists( 'odd_apps_index_load' ) ) {
		// Registry wasn't loaded — this can happen during very early
		// bootstrap errors. Fail closed rather than serve nothing.
		if ( $debug_on ) {
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'registry_not_loaded' ) ) );
		}
		status_header( 500 );
		exit;
	}

	$index = odd_apps_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		if ( $debug_on ) {
			odd_apps_debug_emit(
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
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'slug_disabled' ) ) );
		}
		status_header( 404 );
		exit;
	}
	$cap = function_exists( 'odd_apps_normalize_capability' )
		? odd_apps_normalize_capability( isset( $index[ $slug ]['capability'] ) ? $index[ $slug ]['capability'] : '' )
		: 'manage_options';
	if ( $debug_on ) {
		$debug_trace['required_cap'] = $cap;
		$debug_trace['cap_ok']       = current_user_can( $cap );
	}
	if ( ! current_user_can( $cap ) ) {
		if ( $debug_on ) {
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'capability_denied' ) ) );
		}
		status_header( 403 );
		exit;
	}

	if ( '' === $path ) {
		$manifest = odd_apps_manifest_load( $slug );
		$path     = isset( $manifest['entry'] ) && $manifest['entry']
			? (string) $manifest['entry']
			: 'index.html';
	}
	if ( $debug_on ) {
		$debug_trace['path_resolved'] = $path;
	}

	if (
		false !== strpos( $path, '..' ) ||
		( strlen( $path ) > 0 && '/' === $path[0] ) ||
		false !== strpos( $path, "\0" ) ||
		! preg_match( '#^[a-zA-Z0-9._/-]+$#', $path )
	) {
		if ( $debug_on ) {
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'bad_path' ) ) );
		}
		status_header( 400 );
		exit;
	}

	$ext = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	if ( in_array( $ext, odd_apps_forbidden_extensions(), true ) ) {
		if ( $debug_on ) {
			odd_apps_debug_emit(
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

	$base      = odd_apps_dir_for( $slug );
	$real_base = realpath( $base );
	$full      = realpath( $base . $path );
	if ( ( ! $real_base || ! $full ) && '' !== $path ) {
		$repaired = function_exists( 'odd_apps_repair_from_catalog' )
			? odd_apps_repair_from_catalog( $slug, $path )
			: false;
		if ( $debug_on ) {
			$debug_trace['repair_attempted'] = true;
			$debug_trace['repair_result']    = is_wp_error( $repaired ) ? $repaired->get_error_code() : ( $repaired ? 'ok' : 'skipped' );
		}
		if ( true === $repaired ) {
			clearstatcache();
			$real_base = realpath( $base );
			$full      = realpath( $base . $path );
		}
	}
	if ( $debug_on ) {
		$debug_trace['base']      = $base;
		$debug_trace['real_base'] = $real_base;
		$debug_trace['full']      = $full;
	}
	if ( ! $real_base || ! $full || 0 !== strpos( $full, $real_base ) ) {
		if ( $debug_on ) {
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'realpath_escape_or_missing' ) ) );
		}
		status_header( 404 );
		exit;
	}
	if ( ! is_file( $full ) || ! is_readable( $full ) ) {
		if ( $debug_on ) {
			odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'file_not_found_or_unreadable' ) ) );
		}
		status_header( 404 );
		exit;
	}

	$mime = odd_apps_mime_for( $full );
	$body = null;
	$size = filesize( $full );

	if ( $debug_on ) {
		$debug_trace['mime']      = $mime;
		$debug_trace['size']      = (int) $size;
		$head                     = (string) @file_get_contents( $full, false, null, 0, 512 );
		$debug_trace['body_head'] = $head;
		odd_apps_debug_emit( array_merge( $debug_trace, array( 'reason' => 'ok_would_serve' ) ) );
	}

	if ( odd_apps_is_html_mime( $mime ) ) {
		$manifest = odd_apps_manifest_load( $slug );
		$csp      = odd_apps_cookieauth_csp( $slug, is_array( $manifest ) ? $manifest : array() );
		if ( is_string( $csp ) && '' !== $csp ) {
			header( 'Content-Security-Policy: ' . $csp );
		}
		// Browser-built app archives may leave React as bare module
		// imports (`react`, `react-dom`, `react/jsx-runtime`). The
		// sandbox iframe has no bundler, so those imports fail before
		// the app can render. Injecting a same-origin import map here
		// fixes fresh and already-installed apps without rewriting
		// their archives on disk.
		$raw = file_get_contents( $full ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false !== $raw ) {
			if ( function_exists( 'odd_apps_prepare_app_html_output' ) ) {
				$body = odd_apps_prepare_app_html_output( $raw );
			} else {
				$body = odd_apps_inject_runtime_importmap( $raw );
			}
			$size = strlen( $body );
		}
	} elseif ( odd_apps_is_js_mime( $mime ) ) {
		// Defense-in-depth for the same bare-import problem: rewrite
		// `from"react"` / `from"react/jsx-runtime"` etc. inside JS
		// chunks to absolute `/odd-app-runtime/*.js` URLs. The HTML
		// import map works for most browsers, but some environments
		// (sandboxed iframes behind service workers, preloaded module
		// graphs, etc.) race ahead of the import map and throw
		// `Failed to resolve module specifier "react/jsx-runtime"`
		// before it registers. Rewriting the chunks makes them
		// self-resolving regardless of import-map support or timing.
		$raw = file_get_contents( $full ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( false !== $raw ) {
			$body = odd_apps_rewrite_runtime_bare_imports( $raw );
			if ( function_exists( 'odd_apps_transform_embed_bundle_output' ) ) {
				$body = odd_apps_transform_embed_bundle_output( $body, $mime );
			}
			$size = strlen( $body );
		}
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
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( 'Permissions-Policy: camera=(), microphone=(), geolocation=()' );
	if ( null !== $body ) {
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	} else {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		$sent = readfile( $full );
		if ( false === $sent && defined( 'WP_DEBUG' ) && WP_DEBUG && function_exists( 'error_log' ) ) {
			// Headers are already flushed by the time we're streaming,
			// so we can't change the status — but logging makes a
			// disk-read regression visible to admins.
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( sprintf( '[ODD Apps] cookie-auth readfile() failed for %s', $full ) );
		}
	}
}

/**
 * Build the public iframe URL for an app. Always uses the pretty
 * `/odd-app/<slug>/` shape — since the matcher runs directly on
 * `$_SERVER['REQUEST_URI']` we don't need permalinks configured or
 * rewrite rules flushed for it to work.
 */
function odd_apps_cookieauth_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return odd_url_with_playground_scope( site_url( '/odd-app/' . $slug . '/' ) );
}

/**
 * Full iframe URL + wp_rest nonce for REST install/upload responses (matches `appServeUrls` in enqueue).
 *
 * @param string $slug App slug.
 * @return string Empty when slug invalid or apps are unavailable.
 */
function odd_apps_serve_url_for_rest_payload( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || ! function_exists( 'odd_apps_cookieauth_url_for' ) ) {
		return '';
	}
	return esc_url_raw(
		add_query_arg(
			array( '_wpnonce' => wp_create_nonce( 'wp_rest' ) ),
			odd_apps_cookieauth_url_for( $slug )
		)
	);
}

function odd_apps_runtime_importmap_html() {
	$imports = array(
		'react'             => odd_url_with_playground_scope( site_url( '/odd-app-runtime/react.js' ) ),
		'react-dom'         => odd_url_with_playground_scope( site_url( '/odd-app-runtime/react-dom.js' ) ),
		'react-dom/client'  => odd_url_with_playground_scope( site_url( '/odd-app-runtime/react-dom-client.js' ) ),
		'react/jsx-runtime' => odd_url_with_playground_scope( site_url( '/odd-app-runtime/react-jsx-runtime.js' ) ),
	);
	return '<script type="importmap">' . wp_json_encode( array( 'imports' => $imports ) ) . '</script>';
}

/**
 * Is this MIME a JavaScript module we should process for bare imports?
 */
function odd_apps_is_js_mime( $mime ) {
	$mime = strtolower( (string) $mime );
	if ( false !== strpos( $mime, ';' ) ) {
		$mime = trim( substr( $mime, 0, strpos( $mime, ';' ) ) );
	}
	return in_array(
		$mime,
		array(
			'application/javascript',
			'text/javascript',
			'application/x-javascript',
			'application/ecmascript',
			'text/ecmascript',
		),
		true
	);
}

/**
 * Rewrite bare React imports inside a JS chunk to absolute
 * /odd-app-runtime/*.js URLs.
 *
 * Vite emits minified forms like:
 *   import{jsx}from"react/jsx-runtime"
 *   import R,{useState}from"react"
 *   import"react-dom"
 *   export*from"react-dom/client"
 *
 * We rewrite each bare specifier to a same-origin URL so the module
 * loader never needs an import map. Slash-bearing specifiers
 * (`react/jsx-runtime`, `react-dom/client`) map to hyphenated
 * filenames to match the runtime endpoint regex in the top-level
 * matcher (`/odd-app-runtime/react-jsx-runtime.js` etc.).
 */
function odd_apps_rewrite_runtime_bare_imports( $js ) {
	if ( ! is_string( $js ) || '' === $js ) {
		return $js;
	}
	// Quick reject: if no `"react` substring at all, nothing to do —
	// avoids running the regex over large vendor-less chunks.
	if ( false === strpos( $js, '"react' ) && false === strpos( $js, "'react" ) ) {
		return $js;
	}
	$base = rtrim( odd_url_with_playground_scope( site_url( '/odd-app-runtime' ) ), '/' );
	$re   = '#(\b(?:from|import)\s*)(["\'])(react(?:/jsx-runtime|-dom(?:/client)?)?)\2#';
	return preg_replace_callback(
		$re,
		function ( $m ) use ( $base ) {
			$spec      = $m[3];
			$slug      = str_replace( '/', '-', $spec );
			$safe_slug = preg_replace( '#[^a-z0-9-]#', '', $slug );
			return $m[1] . $m[2] . $base . '/' . $safe_slug . '.js' . $m[2];
		},
		$js
	);
}

function odd_apps_inject_runtime_importmap( $html ) {
	if ( false !== stripos( $html, 'type="importmap"' ) || false !== stripos( $html, "type='importmap'" ) ) {
		return $html;
	}
	$map = odd_apps_runtime_importmap_html();
	if ( false !== stripos( $html, '<head>' ) ) {
		return preg_replace( '#<head>#i', "<head>\n" . $map, $html, 1 );
	}
	if ( false !== stripos( $html, '<head ' ) ) {
		return preg_replace( '#(<head\b[^>]*>)#i', '$1' . "\n" . $map, $html, 1 );
	}
	return $map . "\n" . $html;
}

/**
 * Absolute path to the directory containing the pre-built React 19
 * ESM bundles. odd/bin/build-runtime regenerates these. Keeping the
 * directory centralised makes it easy to audit what's shipping.
 */
function odd_apps_runtime_dir() {
	return rtrim( ODD_DIR, '/\\' ) . '/apps/runtime';
}

/**
 * Serve a file from odd/apps/runtime/ at /odd-app-runtime/<name>.js.
 *
 * These are pre-built React 19 ESM bundles (`react.js`, `react-dom.js`,
 * `react-dom-client.js`, `react-jsx-runtime.js`) plus any shared
 * `chunk-*.js` files esbuild emitted when code-splitting.
 *
 * We ship real React 19 (not a shim that proxies wp.element) because
 * Vite-built apps read `React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`
 * — that internals pointer only exists in React 19, while WordPress's
 * wp.element is still React 18. Proxying produced a classic
 * "Cannot read properties of undefined (reading 'S')" at runtime.
 */
function odd_apps_serve_runtime_module( $name ) {
	$user_id = wp_validate_auth_cookie( '', 'logged_in' );
	if ( ! $user_id ) {
		status_header( 401 );
		exit;
	}
	wp_set_current_user( $user_id );
	if ( ! current_user_can( 'read' ) ) {
		status_header( 403 );
		exit;
	}

	$name = (string) $name;
	if ( '' === $name || ! preg_match( '#^[a-zA-Z0-9._-]+\.js$#', $name ) ) {
		status_header( 404 );
		exit;
	}

	$base_dir = odd_apps_runtime_dir();
	$full     = realpath( $base_dir . '/' . $name );
	$root     = realpath( $base_dir );
	if ( ! $root || ! $full || 0 !== strpos( $full, $root ) ) {
		status_header( 404 );
		exit;
	}
	if ( ! is_file( $full ) || ! is_readable( $full ) ) {
		status_header( 404 );
		exit;
	}

	$raw = file_get_contents( $full ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $raw ) {
		status_header( 500 );
		exit;
	}

	// esbuild emits relative imports between chunks (`./chunk-X.js`)
	// and the app bundles import our entry files via absolute
	// `/odd-app-runtime/*.js` paths that are rewritten in
	// odd_apps_rewrite_runtime_bare_imports(). Run the same rewrite
	// here as a safety net: if a future build ever leaves a bare
	// `react`/`react-dom` specifier in a runtime chunk (bug or a
	// dependency change), the rewrite will still catch it.
	$source = odd_apps_rewrite_runtime_bare_imports( $raw );

	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}
	nocache_headers();
	header( 'Content-Type: text/javascript; charset=utf-8' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	header( 'Content-Length: ' . strlen( $source ) );
	echo $source; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Build a Content-Security-Policy value for HTML served from /odd-app/.
 * Default is strict same-origin with common allowances for Vite/React
 * bundles (inline bootstraps, jsdelivr if the import map points there).
 * Manifest may add an optional `csp` string (see docs/wp-manifest.md).
 *
 * @param string               $slug     App slug.
 * @param array<string, mixed> $manifest Parsed manifest.json.
 * @return string
 */
function odd_apps_cookieauth_csp( $slug, array $manifest ) {
	$slug = sanitize_key( (string) $slug );
	// phpcs:ignore WordPress.Arrays.ArrayDeclarationSpacing.AssociativeArrayFound -- long policy string.
	$default = "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data: https:; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
	$policy  = (string) apply_filters( 'odd_app_cookieauth_csp', $default, $slug, $manifest );
	if ( ! empty( $manifest['csp'] ) && is_string( $manifest['csp'] ) ) {
		$extra = odd_apps_sanitize_csp_fragment( $manifest['csp'] );
		if ( '' !== $extra ) {
			$policy .= '; ' . $extra;
		}
	}
	return $policy;
}

/**
 * Strip control characters and cap length; allow only CSP-safe glyph subset.
 *
 * @param string $fragment User-supplied CSP fragment from manifest.
 * @return string
 */
function odd_apps_sanitize_csp_fragment( $fragment ) {
	$s = preg_replace( '/[\x00-\x1F\x7F]/', '', (string) $fragment );
	if ( strlen( $s ) > 2048 ) {
		$s = substr( $s, 0, 2048 );
	}
	if ( ! preg_match( '/^[a-zA-Z0-9_\-:;.,*\'\/\s\(\)]+$/', $s ) ) {
		return '';
	}
	return $s;
}
