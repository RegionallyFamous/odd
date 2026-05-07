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
 * JSON-serialize the REST root for use inside an inline script.
 *
 * @return string Quoted JSON string (no wrapping tags).
 */
function odd_apps_iframe_rest_root_json() {
	return wp_json_encode(
		untrailingslashit( esc_url_raw( rest_url() ) ),
		JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_UNESCAPED_SLASHES
	);
}

/**
 * Inline script: prefix root-relative `/odd/v1/apps/*` fetches with the
 * real REST base (critical for subdirectory installs + Playground scopes).
 *
 * @return string HTML fragment (script element only).
 */
function odd_apps_iframe_fetch_bootstrap_fragment() {
	$j = odd_apps_iframe_rest_root_json();

	return '<script id="odd_apps_iframe_fetch_bootstrap">'
		. '(function(){var B=' . $j . ';var o=window.fetch;'
		. 'window.fetch=function(I,i){if(typeof I==="string"&&I.indexOf("/odd/v1/apps/")===0){I=B+I;}'
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

	// Sideways-installed archives may register `./sw.js` under wp-admin —
	// strip registration so orphaned workers never wedge the iframe root.
	return (string) preg_replace(
		'#navigator\.serviceWorker\.register\("\./sw\.js"\)[^;]*;#',
		'void 0;',
		$contents
	);
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
	$html = odd_apps_inject_iframe_fetch_bootstrap( $html );
	if ( function_exists( 'odd_apps_inject_runtime_importmap' ) ) {
		return odd_apps_inject_runtime_importmap( $html );
	}

	return $html;
}
