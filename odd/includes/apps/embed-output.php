<?php
/**
 * ODD Apps — optional transforms for `/odd-app/` iframe payloads.
 *
 * Injects an inline fetch shim so apps can use root-relative
 * `/wp-json/odd/v1/apps/…` paths on subdirectory installs, and strips
 * service-worker registration leftovers from obsolete archives if any
 * survive on disk (sideways-install safety net).
 */

defined( 'ABSPATH' ) || exit;

/**
 * REST API root URL for scripts inside `/odd-app/{slug}/` HTML (fetch bootstrap).
 *
 * WordPress `rest_url()` matches `site_url()` and usually omits Playground’s
 * `/scope:{instance}/` URL prefix (the embedded site is reached at that path,
 * but `siteurl` stays unprefixed). Catalog apps then build
 * `{restUrl}/odd/v1/…` using a `restUrl` derived from `location.href`, which
 * includes the scope segment. The fetch shim fixes `/odd/v1/` paths by
 * prepending this base — so the base must be `…/scope:…/wp-json`, not plain
 * `…/wp-json`, or requests leave the Playground worker and return 404/empty.
 *
 * @return string Untrailingslashit REST root, e.g. https://host/scope:x/wp-json
 */
function odd_apps_iframe_effective_rest_root() {
	$base  = untrailingslashit( esc_url_raw( rest_url() ) );
	$parts = wp_parse_url( $base );
	if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
		return function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( $base ) : $base;
	}

	$uri      = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$uri      = sanitize_text_field( $uri );
	$req_path = explode( '?', $uri, 2 )[0];
	if ( '' !== $req_path && '/' !== $req_path[0] ) {
		$req_path = '/' . $req_path;
	}

	if ( ! preg_match( '#^(/scope:[^/]+)(?:/|$)#', $req_path, $rm ) ) {
		return function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( $base ) : $base;
	}
	$scope_seg = $rm[1];

	$rest_path = isset( $parts['path'] ) ? (string) $parts['path'] : '';
	if ( false !== strpos( $rest_path, '/scope:' ) ) {
		return function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( $base ) : $base;
	}

	$new_path = $scope_seg . ( '' !== $rest_path ? $rest_path : '/wp-json' );

	$scheme = isset( $parts['scheme'] ) ? (string) $parts['scheme'] . '://' : '';
	$host   = (string) $parts['host'];
	$port   = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
	$user   = isset( $parts['user'] ) ? (string) $parts['user'] : '';
	$pass   = isset( $parts['pass'] ) ? ':' . (string) $parts['pass'] : '';
	$auth   = ( '' !== $user ) ? $user . $pass . '@' : '';

	$merged = $scheme . $auth . $host . $port . $new_path;
	$merged = untrailingslashit( $merged );

	$merged = (string) apply_filters( 'odd_apps_iframe_effective_rest_root', $merged, $base );

	return function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( $merged ) : $merged;
}

/**
 * JSON-serialize the REST root for use inside an inline script.
 *
 * @return string Quoted JSON string (no wrapping tags).
 */
function odd_apps_iframe_rest_root_json() {
	return wp_json_encode(
		odd_apps_iframe_effective_rest_root(),
		JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_UNESCAPED_SLASHES
	);
}

/**
 * Inline script: rewrite fetches whose path ends in `/odd/v1/apps/*` to use the
 * real REST base (critical for subdirectory installs + Playground `/scope:…/`).
 *
 * @return string HTML fragment (script element only).
 */
function odd_apps_iframe_fetch_bootstrap_fragment() {
	$j = odd_apps_iframe_rest_root_json();

	return '<script id="odd_apps_iframe_fetch_bootstrap">'
		. '(function(){var B=' . $j . ';var o=window.fetch;'
		. 'window.fetch=function(I,i){if(typeof I==="string"){var j=I.indexOf("/odd/v1/apps/");'
		. 'if(j!==-1&&I.slice(0,j).indexOf("wp-json")===-1){I=B+I.slice(j);}}'
		. 'return o.call(this,I,i);};})();'
		. '</script>';
}

/**
 * Insert the fetch bootstrap immediately after the opening <head> tag.
 *
 * @param string $html Full document.
 *
 * @return string
 */
function odd_apps_inject_iframe_fetch_bootstrap( $html ) {
	if ( ! is_string( $html ) || '' === $html ) {
		return $html;
	}
	if ( false !== strpos( $html, 'odd_apps_iframe_fetch_bootstrap' ) ) {
		return $html;
	}
	$frag = odd_apps_iframe_fetch_bootstrap_fragment();
	if ( false !== stripos( $html, '<head>' ) ) {
		return preg_replace( '#<head>#i', "<head>\n" . $frag, $html, 1 );
	}
	if ( false !== stripos( $html, '<head ' ) ) {
		return preg_replace( '#(<head\b[^>]*>)#i', '$1' . "\n" . $frag, $html, 1 );
	}

	return $frag . "\n" . $html;
}

/**
 * Strip `<base href="…">` from app HTML streamed into `/odd-app/{slug}/`.
 *
 * Default Vite `base: '/'` emits `<base href="/">`, which resolves every
 * relative URL against the install root (`/blog/` or scoped Playground
 * roots) instead of the iframe document `/odd-app/{slug}/`. The browser
 * then requests `/assets/*.js` at the WordPress root (404 → white screen)
 * rather than `/…/odd-app/{slug}/assets/*.js`.
 *
 * Removing `base` makes resolution follow the iframe URL WordPress ships
 * (always ends with `/`), so `./assets/` rewrites behave correctly.
 *
 * @param string $html Document HTML bytes.
 *
 * @return string
 */
function odd_apps_strip_iframe_document_base_tags( $html ) {
	if ( ! is_string( $html ) || '' === $html ) {
		return $html;
	}
	if ( ! apply_filters( 'odd_apps_strip_iframe_base_tags', true ) ) {
		return $html;
	}

	return (string) preg_replace( '#\s*<base\b[^>]*>\s*#i', '', $html );
}

/**
 * Turn root-absolute Vite artefact URLs into document-relative `./…`
 * refs so `<script src="/assets/*.js">` loads from `/odd-app/{slug}/…`.
 *
 * @param string $html Document HTML after base-tag stripping is recommended.
 *
 * @return string
 */
function odd_apps_rewrite_iframe_absolute_asset_roots( $html ) {
	if ( ! is_string( $html ) || '' === $html ) {
		return $html;
	}
	if ( ! apply_filters( 'odd_apps_rewrite_iframe_root_asset_refs', true ) ) {
		return $html;
	}

	$out = (string) preg_replace(
		'#(\s(?:src|href)\s*=\s*)(["\'])/(assets|chunks|static|build)/#',
		'$1$2./$3/',
		$html
	);

	// Dev-bundle leftovers only (production builds omit the client harness).
	return (string) preg_replace(
		'#(\s(?:src|href)\s*=\s*)(["\'])/@vite/client#',
		'$1$2./@vite/client',
		$out
	);
}

/**
 * Minor HTML/JS sanitization before streaming an app iframe asset.
 *
 * @param string $contents Response body.
 * @param string $mime     Response Content-Type primary value (may include charset).
 *
 * @return string
 */
function odd_apps_transform_embed_bundle_output( $contents, $mime ) {
	if ( ! is_string( $contents ) || '' === $contents ) {
		return $contents;
	}
	if ( ! apply_filters( 'odd_apps_rewrite_embed_bundle_output', true ) ) {
		return $contents;
	}

	$m = strtolower( (string) $mime );
	if ( false !== strpos( $m, ';' ) ) {
		$m = trim( strstr( $m, ';', true ) );
	}

	$is_js   = (
		0 === strpos( $m, 'application/javascript' )
		|| 0 === strpos( $m, 'application/x-javascript' )
		|| 0 === strpos( $m, 'text/javascript' )
	);
	$is_html = ( 0 === strpos( $m, 'text/html' ) || 0 === strpos( $m, 'application/xhtml' ) );
	if ( ! $is_js && ! $is_html ) {
		return $contents;
	}

	// Sideways-installed archives sometimes still ship Vite/React PWA bootstraps:
	// a load listener wrapping `navigator.serviceWorker.register("./sw.js")` with no
	// trailing semicolon (Firefox warns when that worker evaluates). Strip both shapes.
	if ( false !== strpos( $contents, 'serviceWorker' ) ) {
		$contents = (string) preg_replace(
			'#"serviceWorker"in navigator&&window\.addEventListener\("load",\(\)=>\{navigator\.serviceWorker\.register\("\./sw\.js"\)\.catch\(\(\)=>\{\}\)\}\)#',
			'void 0',
			$contents
		);
		$contents = (string) preg_replace(
			'#navigator\.serviceWorker\.register\("\./sw\.js"\)[^;]*;#',
			'void 0;',
			$contents
		);
	}

	return $contents;
}

/**
 * Full HTML pipeline for cookie-auth app entry documents.
 *
 * @param string $raw Original index.html bytes.
 *
 * @return string
 */
function odd_apps_prepare_app_html_output( $raw ) {
	$html = odd_apps_transform_embed_bundle_output( $raw, 'text/html; charset=utf-8' );
	$html = odd_apps_strip_iframe_document_base_tags( $html );
	$html = odd_apps_rewrite_iframe_absolute_asset_roots( $html );
	$html = odd_apps_inject_iframe_fetch_bootstrap( $html );
	if ( function_exists( 'odd_apps_inject_runtime_importmap' ) ) {
		return odd_apps_inject_runtime_importmap( $html );
	}

	return $html;
}
