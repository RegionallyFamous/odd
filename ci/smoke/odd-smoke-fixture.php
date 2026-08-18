<?php
/**
 * Plugin Name: ODD Smoke Fixture
 * Description: MU-plugin used only by the install-smoke CI job. Short-circuits
 *              outbound HTTP requests for the ODD remote catalog (registry.json
 *              and any .wp bundle under /catalog/v1/bundles/) so the smoke
 *              suite can prove catalog app installation works hermetically,
 *              with no dependency on the live GitHub Pages deployment.
 *
 *              DO NOT INSTALL IN PRODUCTION. This intercepts catalog HTTP
 *              traffic and swaps the response in-process.
 *
 * The fixture catalog + bundles live at the path in the
 * `ODD_SMOKE_FIXTURE_ROOT` constant (defined in wp-config via the smoke
 * workflow). Inside that root we expect:
 *
 *   registry.json              — the registry payload to return for
 *                                catalog URL fetches.
 *   bundles/<slug>-<type>-<v>.wp — on-disk .wp archives whose paths match
 *                                the download_url entries in registry.json.
 *
 * Matching is by URL path suffix so the real `ODDOUT_CATALOG_URL` doesn't need
 * to be overridden for production-shaped smoke tests — any GET to
 * `/catalog/v1/registry.json` or `/catalog/v1/bundles/<file>.wp` on any host
 * resolves to the local file. Define `ODD_SMOKE_CATALOG_URL` when testing a
 * preview catalog whose registry rows intentionally use a non-production host.
 *
 * @package ODD_Smoke
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODD_SMOKE_FIXTURE_ROOT' ) ) {
	// Conventional default so running the MU-plugin locally without the
	// workflow env still finds the fixture — `site/catalog/v1/` is a
	// byte-identical superset of the prod registry on every branch.
	define( 'ODD_SMOKE_FIXTURE_ROOT', WP_CONTENT_DIR . '/odd-smoke-fixture' );
}

if (
	defined( 'ODD_SMOKE_CATALOG_URL' )
	&& is_string( ODD_SMOKE_CATALOG_URL )
	&& '' !== ODD_SMOKE_CATALOG_URL
) {
	add_filter(
		'oddout_catalog_url',
		static function () {
			return ODD_SMOKE_CATALOG_URL;
		}
	);
}

// The hermetic fixture has no production signing key. Signature verification
// is covered by catalog validation and release gates; browser/install smoke
// still verifies every downloaded archive against the fixture registry's exact
// size and SHA-256. Without this explicit test-only exemption, ODD falls back
// to its frozen shipped registry and can accidentally install old hashes while
// the browser suite appears to exercise the newly built catalog.
add_filter( 'oddout_catalog_signature_required', '__return_false' );

/**
 * Permit the browser-facing copies of fixture artwork. The registry itself
 * stays on fixture.invalid so catalog and bundle HTTP remains hermetic, while
 * icons and cards are rewritten to the fixture directory under wp-content so
 * the browser can load them from the local WordPress origin.
 */
add_filter(
	'oddout_catalog_entry_url_allowed',
	static function ( $allowed, $url, $field ) {
		if ( $allowed || ! in_array( $field, array( 'icon_url', 'card_url' ), true ) ) {
			return $allowed;
		}

		return oddout_smoke_public_asset_url_allowed( $url );
	},
	10,
	3
);

/**
 * Intercept HTTP requests to the ODD catalog domain and serve fixtures
 * from disk. Returning anything other than `false` short-circuits the
 * standard HTTP API pipeline with our fabricated response.
 *
 * @param false|array|WP_Error $preempt The filter's short-circuit sentinel.
 * @param array                $args    Request args (method, headers, …).
 * @param string               $url     Target URL.
 * @return false|array                 Fabricated response or `false` to pass through.
 */
add_filter(
	'pre_http_request',
	function ( $preempt, $args, $url ) {
		if ( false !== $preempt ) {
			// Some other filter already claimed this request. Don't
			// fight them — let the first interceptor win.
			return $preempt;
		}
		if ( ! is_string( $url ) || '' === $url ) {
			return false;
		}

		$path = wp_parse_url( $url, PHP_URL_PATH );
		if ( ! is_string( $path ) ) {
			return false;
		}

		$root = rtrim( ODD_SMOKE_FIXTURE_ROOT, '/\\' );
		if ( '' === $root || ! is_dir( $root ) ) {
			return false;
		}

		// Catalog registry.
		if ( false !== strpos( $path, '/catalog/v1/registry.json' ) ) {
			$file = $root . '/registry.json';
			return oddout_smoke_serve_registry( $file, $args );
		}

		// Catalog bundle (.wp).
		if ( preg_match( '#/catalog/v1/bundles/([^/]+\.wp)$#', $path, $m ) ) {
			$file = $root . '/bundles/' . $m[1];
			return oddout_smoke_serve_file( $file, 'application/zip', $args );
		}

		// Catalog artwork. Browser requests use the rewritten local URLs,
		// while this also keeps server-side fixture requests well formed.
		if ( preg_match( '#/catalog/v1/icons/(.+)$#', $path, $m ) ) {
			$file = $root . '/icons/' . $m[1];
			if ( is_readable( $file ) ) {
				return oddout_smoke_serve_file( $file, oddout_smoke_asset_content_type( $file ), $args );
			}
		}

		if ( preg_match( '#/catalog/v1/cards/(.+)$#', $path, $m ) ) {
			$file = $root . '/cards/' . $m[1];
			if ( is_readable( $file ) ) {
				return oddout_smoke_serve_file( $file, oddout_smoke_asset_content_type( $file ), $args );
			}
		}

		return false;
	},
	10,
	3
);

/**
 * Return the public URL prefix for a fixture directory inside wp-content.
 *
 * @return string Empty when the configured fixture is not web-accessible.
 */
function oddout_smoke_public_asset_base_url() {
	$root         = realpath( ODD_SMOKE_FIXTURE_ROOT );
	$content_root = realpath( WP_CONTENT_DIR );
	if ( false === $root || false === $content_root ) {
		return '';
	}

	$content_root = rtrim( wp_normalize_path( $content_root ), '/' );
	$root         = wp_normalize_path( $root );
	if ( $root === $content_root || 0 !== strpos( $root, $content_root . '/' ) ) {
		return '';
	}

	$relative = ltrim( substr( $root, strlen( $content_root ) ), '/' );
	return rtrim( content_url( '/' . $relative ), '/' );
}

/**
 * Check that a rewritten artwork URL points to one exact fixture asset.
 *
 * @param string $url Candidate registry URL.
 * @return bool
 */
function oddout_smoke_public_asset_url_allowed( $url ) {
	$base = oddout_smoke_public_asset_base_url();
	if ( '' === $base || ! is_string( $url ) || '' === $url ) {
		return false;
	}

	$path      = wp_parse_url( $url, PHP_URL_PATH );
	$base_path = wp_parse_url( $base, PHP_URL_PATH );
	if ( ! is_string( $path ) || ! is_string( $base_path ) ) {
		return false;
	}
	if ( ! preg_match( '#^' . preg_quote( rtrim( $base_path, '/' ), '#' ) . '/(icons|cards)/([A-Za-z0-9._-]+)$#', $path, $matches ) ) {
		return false;
	}

	$expected = $base . '/' . $matches[1] . '/' . rawurlencode( $matches[2] );
	return $expected === $url && is_readable( rtrim( ODD_SMOKE_FIXTURE_ROOT, '/\\' ) . '/' . $matches[1] . '/' . $matches[2] );
}

/**
 * Convert one remote artwork URL to its browser-readable local fixture URL.
 *
 * @param string $url Remote registry URL.
 * @param string $directory Expected fixture directory.
 * @return string Original URL when it cannot be safely rewritten.
 */
function oddout_smoke_rewrite_asset_url( $url, $directory ) {
	$base = oddout_smoke_public_asset_base_url();
	$path = wp_parse_url( (string) $url, PHP_URL_PATH );
	if ( '' === $base || ! is_string( $path ) ) {
		return $url;
	}

	$filename = basename( $path );
	if ( ! preg_match( '/^[A-Za-z0-9._-]+$/', $filename ) ) {
		return $url;
	}
	$file = rtrim( ODD_SMOKE_FIXTURE_ROOT, '/\\' ) . '/' . $directory . '/' . $filename;
	if ( ! is_readable( $file ) ) {
		return $url;
	}

	return $base . '/' . $directory . '/' . rawurlencode( $filename );
}

/**
 * Serve a registry whose visual assets resolve in the local browser.
 *
 * @param string $file Registry path.
 * @param array  $args HTTP request arguments.
 * @return array
 */
function oddout_smoke_serve_registry( $file, $args = array() ) {
	if ( ! is_readable( $file ) ) {
		return oddout_smoke_serve_file( $file, 'application/json', $args );
	}

	$registry = json_decode( (string) file_get_contents( $file ), true );
	if ( ! is_array( $registry ) || ! isset( $registry['bundles'] ) || ! is_array( $registry['bundles'] ) ) {
		return oddout_smoke_serve_file( $file, 'application/json', $args );
	}

	foreach ( $registry['bundles'] as &$entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		if ( isset( $entry['icon_url'] ) ) {
			$entry['icon_url'] = oddout_smoke_rewrite_asset_url( $entry['icon_url'], 'icons' );
		}
		if ( isset( $entry['card_url'] ) ) {
			$entry['card_url'] = oddout_smoke_rewrite_asset_url( $entry['card_url'], 'cards' );
		}
	}
	unset( $entry );

	$body = wp_json_encode( $registry );
	if ( ! is_string( $body ) ) {
		return oddout_smoke_serve_file( $file, 'application/json', $args );
	}

	return oddout_smoke_serve_body( $body, 'application/json', $args );
}

/**
 * Return the MIME type for fixture artwork.
 *
 * @param string $file Artwork path.
 * @return string
 */
function oddout_smoke_asset_content_type( $file ) {
	switch ( strtolower( pathinfo( $file, PATHINFO_EXTENSION ) ) ) {
		case 'webp':
			return 'image/webp';
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'svg':
			return 'image/svg+xml';
		default:
			return 'application/octet-stream';
	}
}

/**
 * Build a WP_HTTP-shaped response array from a local file. Returns a
 * `404` response when the file is missing so the caller sees a well-
 * formed failure it can log, rather than a passthrough to the network.
 *
 * When the request uses streaming mode (`download_url()` does —
 * `stream => true` + a `filename`), short-circuiting via
 * `pre_http_request` skips the transport entirely, so *we* must honour
 * the `filename` contract and write the body to that path. Without this
 * the caller sees an empty tempfile and fails the magic-byte check.
 */
function oddout_smoke_serve_file( $file, $content_type, $args = array() ) {
	if ( ! is_readable( $file ) ) {
		return array(
			'headers'  => array(),
			'body'     => '',
			'response' => array(
				'code'    => 404,
				'message' => 'smoke fixture missing',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	$body = (string) file_get_contents( $file );
	return oddout_smoke_serve_body( $body, $content_type, $args );
}

/**
 * Build a WP_HTTP-shaped response array from an in-memory body.
 *
 * @param string $body         Response body.
 * @param string $content_type Response MIME type.
 * @param array  $args         HTTP request arguments.
 * @return array
 */
function oddout_smoke_serve_body( $body, $content_type, $args = array() ) {
	$headers = array(
		'content-type'   => $content_type,
		'content-length' => (string) strlen( $body ),
	);

	$stream   = ! empty( $args['stream'] );
	$filename = isset( $args['filename'] ) ? (string) $args['filename'] : '';
	if ( $stream && '' !== $filename ) {
		// Mirror what the real transport would do with stream=true:
		// write the body to the caller's tempfile and return an empty
		// body so consumers (download_url) read off disk.
		@file_put_contents( $filename, $body );
		return array(
			'headers'  => $headers,
			'body'     => '',
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => $filename,
		);
	}

	return array(
		'headers'  => $headers,
		'body'     => $body,
		'response' => array(
			'code'    => 200,
			'message' => 'OK',
		),
		'cookies'  => array(),
		'filename' => null,
	);
}
