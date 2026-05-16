<?php
/**
 * ODD — remote bundle catalog.
 *
 * ODD 1.0 keeps the plugin runtime lightweight; every scene, icon set,
 * cursor set, widget, and app lives in a remote registry at `ODDOUT_CATALOG_URL`. We fetch that
 * registry over HTTPS, cache it in a 12h transient, and surface the
 * parsed rows through the same `/odd/v1/bundles/*` REST endpoints the
 * panel already consumes.
 *
 * Registry schema (v1, see site/catalog/v1/registry.schema.json):
 *
 *   {
 *     "version": 1,
 *     "starter_pack": {
 *       "scenes":    ["<slug>"],
 *       "iconSets":  ["<slug>"],
 *       "widgets":   ["<slug>"],
 *       "apps":      ["<slug>"]
 *     },
 *     "bundles": [
 *       {
 *         "type":         "scene" | "icon-set" | "cursor-set" | "widget" | "app",
 *         "slug":         "<unique>",
 *         "name":         "Human-readable name",
 *         "version":      "1.0.0",
 *         "author":       "Vendor",
 *         "description":  "Short paragraph",
 *         "category":     "Category",
 *         "tags":         ["optional"],
 *         "icon_url":     "https://.../icons/<name>.webp",
 *         "card_url":     "https://.../cards/<name>.webp",
 *         "download_url": "https://.../bundles/<name>.wp",
 *         "sha256":       "<64 hex chars>",
 *         "size":         12345,
 *         "requires":     {"odd":"1.0.0","desktopMode":"0.8.5","api":"2.3.0"}
 *       }
 *     ]
 *   }
 *
 * All remote installs route through {@see oddout_bundle_install()} after
 * a sha256 match so a compromised or rewritten .wp fails loudly.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_CATALOG_URL' ) ) {
	define( 'ODDOUT_CATALOG_URL', 'https://odd.regionallyfamous.com/catalog/v1/registry.json' );
}
if ( ! defined( 'ODDOUT_CATALOG_TRANSIENT' ) ) {
	define( 'ODDOUT_CATALOG_TRANSIENT', 'oddout_catalog_v1' );
}
if ( ! defined( 'ODDOUT_CATALOG_STALE_OPTION' ) ) {
	define( 'ODDOUT_CATALOG_STALE_OPTION', 'oddout_catalog_v1_stale' );
}
if ( ! defined( 'ODDOUT_CATALOG_META_OPTION' ) ) {
	define( 'ODDOUT_CATALOG_META_OPTION', 'oddout_catalog_v1_meta' );
}
if ( ! defined( 'ODDOUT_CATALOG_ROLLBACK_OPTION' ) ) {
	define( 'ODDOUT_CATALOG_ROLLBACK_OPTION', 'oddout_catalog_v1_rollbacks' );
}
if ( ! defined( 'ODDOUT_CATALOG_ROLLBACK_LIMIT' ) ) {
	define( 'ODDOUT_CATALOG_ROLLBACK_LIMIT', 3 );
}
if ( ! defined( 'ODDOUT_CATALOG_PUBLIC_KEY' ) ) {
	define( 'ODDOUT_CATALOG_PUBLIC_KEY', '2aIvGPQMF//a9ciDvQ8GST7Q8QhfVsM6h1HB3/Td5Gk=' );
}
if ( ! defined( 'ODDOUT_CATALOG_API_VERSION' ) ) {
	define( 'ODDOUT_CATALOG_API_VERSION', '2.3.0' );
}
if ( ! defined( 'ODDOUT_CATALOG_CACHE_TTL' ) ) {
	// Twelve hours. The catalog changes infrequently (only when the
	// plugin-catalog repo publishes GitHub Pages), but users who hit
	// "Refresh" in the Shop get a forced revalidate via
	// oddout_catalog_refresh().
	define( 'ODDOUT_CATALOG_CACHE_TTL', 12 * HOUR_IN_SECONDS );
}
if ( ! defined( 'ODDOUT_CATALOG_MAX_RESPONSE_BYTES' ) ) {
	define( 'ODDOUT_CATALOG_MAX_RESPONSE_BYTES', 2 * 1024 * 1024 );
}

/**
 * Resolve the catalog URL at runtime. Hosts can override via
 * `oddout_catalog_url` filter or the `ODDOUT_CATALOG_URL` constant.
 */
function oddout_catalog_url() {
	return (string) apply_filters( 'oddout_catalog_url', ODDOUT_CATALOG_URL );
}

function oddout_catalog_allowed_types() {
	return array( 'scene', 'icon-set', 'cursor-set', 'widget', 'app' );
}

function oddout_catalog_max_response_bytes() {
	$bytes = (int) apply_filters( 'oddout_catalog_max_response_bytes', ODDOUT_CATALOG_MAX_RESPONSE_BYTES );
	return max( 1024, min( 10 * 1024 * 1024, $bytes ) );
}

function oddout_catalog_base_url( $catalog_url = '' ) {
	$catalog_url = '' === $catalog_url ? oddout_catalog_url() : (string) $catalog_url;
	$parts       = wp_parse_url( $catalog_url );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return '';
	}

	$path = isset( $parts['path'] ) ? (string) $parts['path'] : '/';
	$dir  = dirname( $path );
	if ( '.' === $dir || '\\' === $dir ) {
		$dir = '/';
	}

	$host = strtolower( (string) $parts['host'] );
	$port = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
	return strtolower( (string) $parts['scheme'] ) . '://' . $host . $port . trailingslashit( $dir );
}

function oddout_catalog_is_first_party_url( $catalog_url ) {
	$parts = wp_parse_url( (string) $catalog_url );
	if ( ! is_array( $parts ) ) {
		return false;
	}
	$scheme = isset( $parts['scheme'] ) ? strtolower( (string) $parts['scheme'] ) : '';
	$host   = isset( $parts['host'] ) ? strtolower( (string) $parts['host'] ) : '';
	$path   = isset( $parts['path'] ) ? (string) $parts['path'] : '';
	return 'https' === $scheme
		&& 'odd.regionallyfamous.com' === $host
		&& 0 === strpos( $path, '/catalog/v1/' );
}

function oddout_catalog_signature_url( $catalog_url = '' ) {
	$base = oddout_catalog_base_url( $catalog_url );
	return '' === $base ? '' : $base . 'registry.json.sig';
}

function oddout_catalog_signature_required( $catalog_url ) {
	$required = oddout_catalog_is_first_party_url( $catalog_url );
	/**
	 * Require a detached Ed25519 registry signature. First-party ODD
	 * catalogs fail closed by default; private mirrors can opt out or
	 * supply their own public key through the matching public-keys filter.
	 *
	 * @param bool   $required
	 * @param string $catalog_url
	 */
	return (bool) apply_filters( 'oddout_catalog_signature_required', $required, (string) $catalog_url );
}

function oddout_catalog_public_keys( $catalog_url ) {
	$keys = array();
	if ( defined( 'ODDOUT_CATALOG_PUBLIC_KEY' ) && '' !== ODDOUT_CATALOG_PUBLIC_KEY ) {
		$keys[] = ODDOUT_CATALOG_PUBLIC_KEY;
	}
	/**
	 * Filter base64-encoded Ed25519 public keys accepted for a catalog.
	 *
	 * @param string[] $keys
	 * @param string   $catalog_url
	 */
	$keys = apply_filters( 'oddout_catalog_public_keys', $keys, (string) $catalog_url );
	return is_array( $keys ) ? array_values( array_filter( array_map( 'strval', $keys ) ) ) : array();
}

function oddout_catalog_decode_base64( $value, $expected_bytes ) {
	$value = trim( (string) $value );
	if ( '' === $value ) {
		return '';
	}
	$decoded = base64_decode( $value, true );
	if ( ! is_string( $decoded ) || strlen( $decoded ) !== (int) $expected_bytes ) {
		return '';
	}
	return $decoded;
}

function oddout_catalog_signature_meta( $status, $signature_url = '', $key = '' ) {
	return array(
		'signature_status' => sanitize_key( (string) $status ),
		'signature_url'    => esc_url_raw( (string) $signature_url ),
		'signature_key'    => sanitize_text_field( (string) $key ),
	);
}

function oddout_catalog_verify_registry_signature( $body, $signature_body, $catalog_url, $signature_url = '' ) {
	if ( ! oddout_catalog_signature_required( $catalog_url ) ) {
		return oddout_catalog_signature_meta( 'skipped', $signature_url );
	}
	if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
		return new WP_Error(
			'catalog_signature_unavailable',
			__( 'Catalog signatures require the PHP sodium extension.', 'odd-outlandish-desktop-decorator' ),
			oddout_catalog_signature_meta( 'unavailable', $signature_url )
		);
	}

	$signature = oddout_catalog_decode_base64( $signature_body, 64 );
	if ( '' === $signature ) {
		return new WP_Error(
			'catalog_signature_invalid',
			__( 'Catalog signature is missing or malformed.', 'odd-outlandish-desktop-decorator' ),
			oddout_catalog_signature_meta( 'invalid', $signature_url )
		);
	}

	$keys = oddout_catalog_public_keys( $catalog_url );
	if ( empty( $keys ) ) {
		return new WP_Error(
			'catalog_signature_no_key',
			__( 'No trusted catalog signing key is configured.', 'odd-outlandish-desktop-decorator' ),
			oddout_catalog_signature_meta( 'no_key', $signature_url )
		);
	}

	foreach ( $keys as $key ) {
		$public_key = oddout_catalog_decode_base64( $key, 32 );
		if ( '' === $public_key ) {
			continue;
		}
		try {
			if ( sodium_crypto_sign_verify_detached( $signature, (string) $body, $public_key ) ) {
				return oddout_catalog_signature_meta( 'valid', $signature_url, substr( hash( 'sha256', $public_key ), 0, 16 ) );
			}
		} catch ( SodiumException $e ) {
			continue;
		}
	}

	return new WP_Error(
		'catalog_signature_mismatch',
		__( 'Catalog signature did not verify against a trusted key.', 'odd-outlandish-desktop-decorator' ),
		oddout_catalog_signature_meta( 'mismatch', $signature_url )
	);
}

function oddout_catalog_fetch_registry_signature( $catalog_url, $body ) {
	$signature_url = oddout_catalog_signature_url( $catalog_url );
	if ( ! oddout_catalog_signature_required( $catalog_url ) ) {
		return oddout_catalog_signature_meta( 'skipped', $signature_url );
	}
	if ( '' === $signature_url ) {
		return new WP_Error(
			'catalog_signature_url_missing',
			__( 'Catalog signature URL could not be resolved.', 'odd-outlandish-desktop-decorator' ),
			oddout_catalog_signature_meta( 'missing', '' )
		);
	}

	$signature_body = apply_filters( 'oddout_catalog_registry_signature_body', null, (string) $body, (string) $catalog_url, $signature_url );
	if ( null === $signature_body ) {
		$response = wp_remote_get(
			$signature_url,
			array(
				'timeout'             => 5,
				'limit_response_size' => 2048,
				'headers'             => array( 'Accept' => 'text/plain' ),
			)
		);
		if ( is_wp_error( $response ) ) {
			$response->add_data( oddout_catalog_signature_meta( 'missing', $signature_url ) );
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			return new WP_Error(
				'catalog_signature_status',
				sprintf( 'Catalog signature returned HTTP %d', $code ),
				array_merge(
					oddout_catalog_signature_meta( 'missing', $signature_url ),
					array( 'http_status' => $code )
				)
			);
		}
		$signature_body = (string) wp_remote_retrieve_body( $response );
	}

	return oddout_catalog_verify_registry_signature( (string) $body, (string) $signature_body, (string) $catalog_url, $signature_url );
}

function oddout_catalog_url_is_under_base( $url, $catalog_url = '' ) {
	$base = oddout_catalog_base_url( $catalog_url );
	if ( '' === $base ) {
		return false;
	}

	$parts      = wp_parse_url( (string) $url );
	$base_parts = wp_parse_url( $base );
	if ( ! is_array( $parts ) || ! is_array( $base_parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return false;
	}

	if ( 'https' !== strtolower( (string) $parts['scheme'] ) ) {
		return false;
	}

	if ( strtolower( (string) $parts['host'] ) !== strtolower( (string) $base_parts['host'] ) ) {
		return false;
	}

	$port      = isset( $parts['port'] ) ? (int) $parts['port'] : 443;
	$base_port = isset( $base_parts['port'] ) ? (int) $base_parts['port'] : 443;
	if ( $port !== $base_port ) {
		return false;
	}

	$path      = isset( $parts['path'] ) ? (string) $parts['path'] : '/';
	$base_path = isset( $base_parts['path'] ) ? (string) $base_parts['path'] : '/';
	return 0 === strpos( $path, $base_path );
}

function oddout_catalog_entry_url_allowed( $url, $field, array $entry, $catalog_url = '' ) {
	$url = (string) $url;
	if ( '' === $url ) {
		return false;
	}

	$allowed = oddout_catalog_url_is_under_base( $url, $catalog_url );

	/**
	 * By default, registry-owned bundle, icon, and card URLs must stay
	 * under the configured catalog base. Private mirrors can allow an
	 * external CDN here, but first-party ODD keeps everything scoped to
	 * the registry origin for reviewability and supply-chain safety.
	 *
	 * @param bool   $allowed
	 * @param string $url
	 * @param string $field
	 * @param array  $entry
	 * @param string $catalog_url
	 */
	return (bool) apply_filters( 'oddout_catalog_entry_url_allowed', $allowed, $url, $field, $entry, $catalog_url );
}

function oddout_catalog_empty_registry() {
	return oddout_catalog_normalise(
		array(
			'version' => 1,
			'bundles' => array(),
		)
	);
}

function oddout_catalog_default_meta() {
	return array(
		'source'                 => 'empty',
		'url_host'               => '',
		'http_status'            => 0,
		'bundle_count'           => 0,
		'raw_bundle_count'       => 0,
		'effective_bundle_count' => 0,
		'generated_at'           => '',
		'registry_sha256'        => '',
		'registry_bytes'         => 0,
		'catalog_base_url'       => '',
		'signature_status'       => 'unknown',
		'signature_key'          => '',
		'signature_url'          => '',
		'last_success'           => 0,
		'last_failure'           => 0,
		'last_error_code'        => '',
		'last_error_message'     => '',
		'fallback_available'     => false,
		'stale_available'        => false,
		'stale_age'              => 0,
		'stale_registry_sha256'  => '',
		'rollback_available'     => false,
		'rollback_count'         => 0,
		'rollback_hashes'        => array(),
		'empty_remote'           => false,
	);
}

function oddout_catalog_meta() {
	$meta = get_option( ODDOUT_CATALOG_META_OPTION, array() );
	if ( ! is_array( $meta ) ) {
		$meta = array();
	}
	return wp_parse_args( $meta, oddout_catalog_default_meta() );
}

function oddout_catalog_update_meta( array $changes ) {
	$meta = array_merge( oddout_catalog_meta(), $changes );
	update_option( ODDOUT_CATALOG_META_OPTION, $meta, false );
	return $meta;
}

function oddout_catalog_registry_bundle_count( $registry ) {
	return isset( $registry['bundles'] ) && is_array( $registry['bundles'] )
		? count( $registry['bundles'] )
		: 0;
}

function oddout_catalog_registry_hash( $registry ) {
	if ( is_array( $registry ) && ! empty( $registry['_oddout_registry_sha256'] ) ) {
		return sanitize_text_field( (string) $registry['_oddout_registry_sha256'] );
	}
	if ( ! is_array( $registry ) ) {
		return '';
	}
	$copy = $registry;
	unset( $copy['_oddout_accepted_at'] );
	$json = wp_json_encode( $copy );
	return is_string( $json ) ? hash( 'sha256', $json ) : '';
}

function oddout_catalog_rollback_snapshots() {
	$snapshots = get_option( ODDOUT_CATALOG_ROLLBACK_OPTION, array() );
	if ( ! is_array( $snapshots ) ) {
		return array();
	}
	$out = array();
	foreach ( $snapshots as $snapshot ) {
		if ( ! is_array( $snapshot ) || empty( $snapshot['registry'] ) || ! is_array( $snapshot['registry'] ) ) {
			continue;
		}
		$out[] = array(
			'sha256'       => isset( $snapshot['sha256'] ) ? sanitize_text_field( (string) $snapshot['sha256'] ) : oddout_catalog_registry_hash( $snapshot['registry'] ),
			'accepted_at'  => isset( $snapshot['accepted_at'] ) ? (int) $snapshot['accepted_at'] : 0,
			'generated_at' => isset( $snapshot['generated_at'] ) ? (string) $snapshot['generated_at'] : '',
			'bundle_count' => isset( $snapshot['bundle_count'] ) ? (int) $snapshot['bundle_count'] : oddout_catalog_registry_bundle_count( $snapshot['registry'] ),
			'registry'     => $snapshot['registry'],
		);
	}
	return $out;
}

function oddout_catalog_rollback_summary() {
	$snapshots = oddout_catalog_rollback_snapshots();
	return array(
		'rollback_available' => ! empty( $snapshots ),
		'rollback_count'     => count( $snapshots ),
		'rollback_hashes'    => array_values(
			array_filter(
				array_map(
					static function ( $snapshot ) {
						return isset( $snapshot['sha256'] ) ? (string) $snapshot['sha256'] : '';
					},
					$snapshots
				)
			)
		),
	);
}

function oddout_catalog_store_rollback_snapshot( array $registry ) {
	if ( ! isset( $registry['bundles'] ) || ! is_array( $registry['bundles'] ) ) {
		return;
	}
	$sha = oddout_catalog_registry_hash( $registry );
	if ( '' === $sha ) {
		return;
	}
	$snapshots = oddout_catalog_rollback_snapshots();
	$filtered  = array();
	foreach ( $snapshots as $snapshot ) {
		if ( isset( $snapshot['sha256'] ) && $snapshot['sha256'] === $sha ) {
			continue;
		}
		$filtered[] = $snapshot;
	}
	array_unshift(
		$filtered,
		array(
			'sha256'       => $sha,
			'accepted_at'  => isset( $registry['_oddout_accepted_at'] ) ? (int) $registry['_oddout_accepted_at'] : time(),
			'generated_at' => isset( $registry['generated_at'] ) ? (string) $registry['generated_at'] : '',
			'bundle_count' => oddout_catalog_registry_bundle_count( $registry ),
			'registry'     => $registry,
		)
	);
	$limit = max( 1, min( 10, (int) apply_filters( 'oddout_catalog_rollback_limit', ODDOUT_CATALOG_ROLLBACK_LIMIT ) ) );
	update_option( ODDOUT_CATALOG_ROLLBACK_OPTION, array_slice( $filtered, 0, $limit ), false );
}

function oddout_catalog_remember_previous_stale( array $new_registry ) {
	$current = get_option( ODDOUT_CATALOG_STALE_OPTION, array() );
	if ( ! is_array( $current ) || ! isset( $current['bundles'] ) || ! is_array( $current['bundles'] ) ) {
		return;
	}
	if ( oddout_catalog_registry_hash( $current ) === oddout_catalog_registry_hash( $new_registry ) ) {
		return;
	}
	oddout_catalog_store_rollback_snapshot( $current );
}

function oddout_catalog_stamp_accepted_registry( array $registry ) {
	$registry['_oddout_accepted_at'] = time();
	return $registry;
}

function oddout_catalog_restore_previous_snapshot( $index = 0 ) {
	$snapshots = oddout_catalog_rollback_snapshots();
	$index     = max( 0, (int) $index );
	if ( empty( $snapshots[ $index ]['registry'] ) || ! is_array( $snapshots[ $index ]['registry'] ) ) {
		return new WP_Error(
			'catalog_no_rollback',
			__( 'No previous catalog snapshot is available.', 'odd-outlandish-desktop-decorator' ),
			array( 'status' => 404 )
		);
	}
	$registry = oddout_catalog_stamp_accepted_registry( $snapshots[ $index ]['registry'] );
	$current  = get_option( ODDOUT_CATALOG_STALE_OPTION, array() );
	if (
		is_array( $current )
		&& isset( $current['bundles'] )
		&& is_array( $current['bundles'] )
		&& oddout_catalog_registry_hash( $current ) !== oddout_catalog_registry_hash( $registry )
	) {
		oddout_catalog_store_rollback_snapshot( $current );
	}
	set_transient( ODDOUT_CATALOG_TRANSIENT, $registry, ODDOUT_CATALOG_CACHE_TTL );
	update_option( ODDOUT_CATALOG_STALE_OPTION, $registry, false );
	$runtime = oddout_catalog_effective_registry( $registry );
	oddout_catalog_record_source(
		'rollback_option',
		$registry,
		array(
			'raw_bundle_count'       => oddout_catalog_registry_bundle_count( $registry ),
			'effective_bundle_count' => oddout_catalog_registry_bundle_count( $runtime ),
			'last_error_code'        => '',
			'last_error_message'     => '',
		)
	);
	return $runtime;
}

function oddout_catalog_record_source( $source, $registry, array $extra = array() ) {
	$current_meta = oddout_catalog_meta();
	$stale        = get_option( ODDOUT_CATALOG_STALE_OPTION, array() );
	$stale_at     = is_array( $stale ) && isset( $stale['_oddout_accepted_at'] ) ? (int) $stale['_oddout_accepted_at'] : 0;
	$stale_age    = $stale_at > 0 ? max( 0, time() - $stale_at ) : 0;
	$raw_count    = isset( $extra['raw_bundle_count'] ) ? (int) $extra['raw_bundle_count'] : oddout_catalog_registry_bundle_count( $registry );
	$effect_count = isset( $extra['effective_bundle_count'] ) ? (int) $extra['effective_bundle_count'] : oddout_catalog_registry_bundle_count( $registry );
	return oddout_catalog_update_meta(
		array_merge(
			array(
				'source'                 => sanitize_key( (string) $source ),
				'bundle_count'           => $effect_count,
				'raw_bundle_count'       => $raw_count,
				'effective_bundle_count' => $effect_count,
				'generated_at'           => isset( $registry['generated_at'] ) ? (string) $registry['generated_at'] : '',
				'registry_sha256'        => oddout_catalog_registry_hash( $registry ),
				'registry_bytes'         => isset( $registry['_oddout_registry_bytes'] ) ? (int) $registry['_oddout_registry_bytes'] : 0,
				'catalog_base_url'       => oddout_catalog_base_url(),
				'signature_status'       => isset( $registry['_oddout_signature_status'] ) ? sanitize_key( (string) $registry['_oddout_signature_status'] ) : $current_meta['signature_status'],
				'signature_key'          => isset( $registry['_oddout_signature_key'] ) ? sanitize_text_field( (string) $registry['_oddout_signature_key'] ) : $current_meta['signature_key'],
				'signature_url'          => isset( $registry['_oddout_signature_url'] ) ? esc_url_raw( (string) $registry['_oddout_signature_url'] ) : $current_meta['signature_url'],
				'fallback_available'     => function_exists( 'oddout_catalog_fallback_available' ) ? (bool) oddout_catalog_fallback_available() : false,
				'stale_available'        => is_array( $stale ) && isset( $stale['bundles'] ) && is_array( $stale['bundles'] ) && ! empty( $stale['bundles'] ),
				'stale_age'              => $stale_age,
				'stale_registry_sha256'  => oddout_catalog_registry_hash( $stale ),
			),
			oddout_catalog_rollback_summary(),
			$extra
		)
	);
}

function oddout_catalog_record_failure( WP_Error $error, $url = '' ) {
	$data = $error->get_error_data();
	$data = is_array( $data ) ? $data : array();
	$host = '' !== $url ? (string) wp_parse_url( $url, PHP_URL_HOST ) : '';
	oddout_catalog_update_meta(
		array_merge(
			array(
				'url_host'           => $host,
				'http_status'        => isset( $data['http_status'] ) ? (int) $data['http_status'] : 0,
				'signature_status'   => isset( $data['signature_status'] ) ? sanitize_key( (string) $data['signature_status'] ) : oddout_catalog_meta()['signature_status'],
				'signature_key'      => isset( $data['signature_key'] ) ? sanitize_text_field( (string) $data['signature_key'] ) : oddout_catalog_meta()['signature_key'],
				'signature_url'      => isset( $data['signature_url'] ) ? esc_url_raw( (string) $data['signature_url'] ) : oddout_catalog_signature_url( $url ),
				'last_failure'       => time(),
				'last_error_code'    => $error->get_error_code(),
				'last_error_message' => $error->get_error_message(),
			),
			oddout_catalog_rollback_summary()
		)
	);
}

function oddout_catalog_should_accept_empty_remote( $normalised, $raw ) {
	if ( oddout_catalog_registry_bundle_count( $normalised ) > 0 ) {
		return true;
	}
	/**
	 * Allow hosts with intentionally-empty private catalogs to accept
	 * an empty remote response. First-party ODD keeps the last known
	 * good mirror instead so a bad deploy cannot poison fresh installs.
	 *
	 * @param bool  $allow
	 * @param array $normalised
	 * @param array $raw
	 */
	return (bool) apply_filters( 'oddout_catalog_allow_empty_remote', false, $normalised, $raw );
}

function oddout_catalog_entry_requires_sha( array $entry ) {
	/**
	 * Catalog-owned installs require sha256 by default. Private mirrors
	 * can relax this, but first-party rows must always be verifiable.
	 *
	 * @param bool  $requires_sha
	 * @param array $entry
	 */
	return (bool) apply_filters( 'oddout_bundle_catalog_requires_sha', true, $entry );
}

function oddout_catalog_semver_is_valid( $version ) {
	return is_string( $version )
		&& 1 === preg_match( '/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/', $version );
}

function oddout_catalog_requires_keys() {
	return array( 'odd', 'desktopMode', 'api' );
}

function oddout_catalog_current_versions() {
	$api_version = defined( 'ODDOUT_CATALOG_API_VERSION' ) ? ODDOUT_CATALOG_API_VERSION : '';
	$api_version = (string) apply_filters( 'oddout_catalog_api_version', $api_version );
	$versions    = array(
		'odd'         => defined( 'ODDOUT_VERSION' ) ? (string) ODDOUT_VERSION : '',
		'desktopMode' => function_exists( 'oddout_desktop_mode_version' ) ? oddout_desktop_mode_version() : ( defined( 'DESKTOP_MODE_VERSION' ) ? (string) DESKTOP_MODE_VERSION : '' ),
		'api'         => $api_version,
	);

	/**
	 * Override the local runtime versions used to mark catalog rows as
	 * compatible/incompatible. Useful for tests and private mirrors.
	 *
	 * @param array<string,string> $versions
	 */
	$versions = apply_filters( 'oddout_catalog_current_versions', $versions );
	return is_array( $versions ) ? $versions : array();
}

function oddout_catalog_normalise_requires( $requires ) {
	if ( ! is_array( $requires ) ) {
		return array();
	}

	$out = array();
	foreach ( oddout_catalog_requires_keys() as $key ) {
		if ( ! isset( $requires[ $key ] ) || ! is_scalar( $requires[ $key ] ) ) {
			continue;
		}
		$version = sanitize_text_field( (string) $requires[ $key ] );
		if ( oddout_catalog_semver_is_valid( $version ) ) {
			$out[ $key ] = $version;
		}
	}
	return $out;
}

function oddout_catalog_requirement_label( $key ) {
	switch ( (string) $key ) {
		case 'odd':
			return __( 'ODD', 'odd-outlandish-desktop-decorator' );
		case 'desktopMode':
			return __( 'WP Desktop Mode', 'odd-outlandish-desktop-decorator' );
		case 'api':
			return __( 'ODD API', 'odd-outlandish-desktop-decorator' );
	}
	return sanitize_text_field( (string) $key );
}

function oddout_catalog_entry_compatibility( array $entry ) {
	$requires = isset( $entry['requires'] ) ? oddout_catalog_normalise_requires( $entry['requires'] ) : array();
	if ( empty( $requires ) ) {
		return array(
			'compatible' => true,
			'requires'   => array(),
			'current'    => oddout_catalog_current_versions(),
			'reason'     => '',
		);
	}

	$current = oddout_catalog_current_versions();
	foreach ( $requires as $key => $minimum ) {
		$detected = isset( $current[ $key ] ) ? sanitize_text_field( (string) $current[ $key ] ) : '';
		if ( '' === $detected || version_compare( $detected, $minimum, '<' ) ) {
			return array(
				'compatible' => false,
				'requires'   => $requires,
				'current'    => $current,
				'reason'     => sprintf(
					/* translators: 1: runtime label, 2: minimum required version, 3: detected version. */
					__( 'Requires %1$s %2$s or newer; detected %3$s.', 'odd-outlandish-desktop-decorator' ),
					oddout_catalog_requirement_label( $key ),
					$minimum,
					'' === $detected ? __( 'unknown', 'odd-outlandish-desktop-decorator' ) : $detected
				),
			);
		}
	}

	return array(
		'compatible' => true,
		'requires'   => $requires,
		'current'    => $current,
		'reason'     => '',
	);
}

function oddout_catalog_annotate_compatibility( array $entry ) {
	$compat = oddout_catalog_entry_compatibility( $entry );
	if ( ! empty( $compat['requires'] ) ) {
		$entry['requires'] = $compat['requires'];
	}
	if ( empty( $compat['compatible'] ) ) {
		$entry['incompatible']            = true;
		$entry['state']                   = 'incompatible';
		$entry['incompatibility_reason']  = isset( $compat['reason'] ) ? (string) $compat['reason'] : '';
		$entry['incompatibility_current'] = isset( $compat['current'] ) && is_array( $compat['current'] ) ? $compat['current'] : array();
	}
	return $entry;
}

function oddout_catalog_icon_set_row_is_supported( array $entry ) {
	if ( ! isset( $entry['type'] ) || 'icon-set' !== (string) $entry['type'] ) {
		return true;
	}

	$icon_url = isset( $entry['icon_url'] ) ? (string) $entry['icon_url'] : '';
	$path     = (string) wp_parse_url( $icon_url, PHP_URL_PATH );
	$ext      = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	return in_array( $ext, array( 'png', 'webp' ), true );
}

function oddout_catalog_drop_incompatible_rows( array $registry ) {
	if ( empty( $registry['bundles'] ) || ! is_array( $registry['bundles'] ) ) {
		return $registry;
	}

	$starter_map    = array(
		'scenes'     => 'scene',
		'iconSets'   => 'icon-set',
		'cursorSets' => 'cursor-set',
		'widgets'    => 'widget',
		'apps'       => 'app',
	);
	$group_for_type = array_flip( $starter_map );
	$kept           = array();
	$installable    = array();
	foreach ( $registry['bundles'] as $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		if ( ! oddout_catalog_icon_set_row_is_supported( $entry ) ) {
			continue;
		}
		if ( isset( $entry['type'], $entry['slug'] ) && empty( $entry['incompatible'] ) ) {
			$type = (string) $entry['type'];
			$slug = sanitize_key( (string) $entry['slug'] );
			if ( isset( $group_for_type[ $type ] ) && '' !== $slug ) {
				$group = $group_for_type[ $type ];
				if ( ! isset( $installable[ $group ] ) ) {
					$installable[ $group ] = array();
				}
				$installable[ $group ][ $slug ] = true;
			}
		}
		$kept[] = $entry;
	}
	$registry['bundles'] = $kept;

	foreach ( array_keys( $starter_map ) as $group ) {
		if ( ! isset( $registry['starter_pack'][ $group ] ) || ! is_array( $registry['starter_pack'][ $group ] ) ) {
			continue;
		}
		$allowed                            = isset( $installable[ $group ] ) ? $installable[ $group ] : array();
		$registry['starter_pack'][ $group ] = array_values(
			array_filter(
				$registry['starter_pack'][ $group ],
				static function ( $slug ) use ( $allowed ) {
					$slug = sanitize_key( (string) $slug );
					return isset( $allowed[ $slug ] );
				}
			)
		);
	}

	return $registry;
}

function oddout_catalog_effective_registry( array $registry ) {
	$registry = oddout_catalog_drop_incompatible_rows( $registry );
	if ( oddout_catalog_registry_bundle_count( $registry ) <= 0 ) {
		return $registry;
	}
	return $registry;
}

function oddout_catalog_is_transient_download_error( WP_Error $error ) {
	$code   = $error->get_error_code();
	$data   = $error->get_error_data();
	$data   = is_array( $data ) ? $data : array();
	$status = isset( $data['code'] ) ? (int) $data['code'] : ( isset( $data['http_status'] ) ? (int) $data['http_status'] : 0 );
	if ( in_array( $status, array( 408, 429, 500, 502, 503, 504 ), true ) ) {
		return true;
	}
	return in_array( $code, array( 'http_request_failed', 'download_failed', 'http_429', 'http_500', 'http_502', 'http_503', 'http_504' ), true );
}

function oddout_catalog_lock_acquire( $key, $ttl ) {
	$key = sanitize_key( (string) $key );
	$ttl = max( 1, (int) $ttl );
	if ( '' === $key ) {
		return true;
	}

	if ( add_option( $key, (string) time(), '', false ) ) {
		return true;
	}

	$started = (int) get_option( $key, 0 );
	if ( $started > 0 && ( time() - $started ) > $ttl ) {
		update_option( $key, (string) time(), false );
		return true;
	}

	return new WP_Error(
		'catalog_operation_in_progress',
		__( 'A catalog operation is already in progress. Please try again in a moment.', 'odd-outlandish-desktop-decorator' ),
		array(
			'status'     => 409,
			'started_at' => $started,
		)
	);
}

function oddout_catalog_lock_release( $key ) {
	$key = sanitize_key( (string) $key );
	if ( '' !== $key ) {
		delete_option( $key );
	}
}

/**
 * Download a catalog row to a temporary file and verify the envelope.
 *
 * Caller owns the returned temp path and must delete it with
 * wp_delete_file().
 *
 * @return string|WP_Error Temporary file path.
 */
function oddout_catalog_download_entry_file( array $entry, $context = 'install' ) {
	$download_url = isset( $entry['download_url'] ) ? (string) $entry['download_url'] : '';
	if ( '' === $download_url ) {
		return new WP_Error( 'no_download', __( 'Catalog entry has no download URL.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 400 ) );
	}

	$scheme      = strtolower( (string) wp_parse_url( $download_url, PHP_URL_SCHEME ) );
	$allow_plain = (bool) apply_filters( 'oddout_bundle_allow_insecure_catalog', false, $entry );
	if ( 'https' !== $scheme && ! $allow_plain ) {
		return new WP_Error( 'insecure_download', __( 'Catalog downloads must use HTTPS.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 400 ) );
	}
	$download_url = apply_filters( 'oddout_bundle_catalog_download_url', $download_url, $entry, $context );
	if ( is_wp_error( $download_url ) ) {
		return $download_url;
	}

	$expected_sha = isset( $entry['sha256'] ) ? strtolower( (string) $entry['sha256'] ) : '';
	if ( '' === $expected_sha && oddout_catalog_entry_requires_sha( $entry ) ) {
		return new WP_Error(
			'missing_sha256',
			__( 'Catalog entry is missing a required sha256 digest.', 'odd-outlandish-desktop-decorator' ),
			array( 'status' => 400 )
		);
	}

	if ( ! oddout_catalog_entry_url_allowed( (string) $download_url, 'download_url', $entry, oddout_catalog_url() ) ) {
		return new WP_Error(
			'unsafe_catalog_download_url',
			__( 'Catalog download URL must stay under the configured catalog base.', 'odd-outlandish-desktop-decorator' ),
			array( 'status' => 400 )
		);
	}

	if ( ! function_exists( 'download_url' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}

	$attempts = (int) apply_filters( 'oddout_catalog_download_attempts', 2, $entry, $context );
	$attempts = max( 1, min( 5, $attempts ) );
	$timeout  = (int) apply_filters( 'oddout_catalog_download_timeout', 20, $entry, $context );
	$timeout  = max( 5, min( 60, $timeout ) );
	$tmp      = null;
	$last     = null;
	for ( $i = 1; $i <= $attempts; $i++ ) {
		$tmp = download_url( (string) $download_url, $timeout );
		if ( ! is_wp_error( $tmp ) ) {
			break;
		}
		$last = $tmp;
		if ( $i >= $attempts || ! oddout_catalog_is_transient_download_error( $tmp ) ) {
			break;
		}
		usleep( 150000 * $i );
	}
	if ( is_wp_error( $tmp ) ) {
		return new WP_Error(
			'download_failed',
			sprintf( /* translators: %s error message */ __( 'Could not download bundle: %s', 'odd-outlandish-desktop-decorator' ), $last ? $last->get_error_message() : $tmp->get_error_message() ),
			array(
				'status'   => 502,
				'attempts' => $attempts,
				'context'  => (string) $context,
			)
		);
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local temp file from download_url(); only reads the ZIP signature.
	$magic = file_get_contents( $tmp, false, null, 0, 4 );
	if ( is_string( $magic ) && '' !== $magic ) {
		if ( 0 !== strncmp( $magic, "PK\x03\x04", 4 ) && 0 !== strncmp( $magic, "PK\x05\x06", 4 ) ) {
			wp_delete_file( $tmp );
			return new WP_Error(
				'not_a_zip',
				__( 'The downloaded file is not a valid .wp archive.', 'odd-outlandish-desktop-decorator' ),
				array( 'status' => 502 )
			);
		}
	}

	$expected_size = isset( $entry['size'] ) ? (int) $entry['size'] : 0;
	if ( $expected_size > 0 ) {
		$actual_size = filesize( $tmp );
		if ( false === $actual_size || (int) $actual_size !== $expected_size ) {
			wp_delete_file( $tmp );
			return new WP_Error(
				'size_mismatch',
				sprintf(
					/* translators: 1: expected 2: actual */
					__( 'Bundle size mismatch. Expected %1$d bytes, downloaded %2$d bytes.', 'odd-outlandish-desktop-decorator' ),
					$expected_size,
					false === $actual_size ? 0 : (int) $actual_size
				),
				array( 'status' => 502 )
			);
		}
	}

	if ( '' !== $expected_sha ) {
		$actual_sha = hash_file( 'sha256', $tmp );
		if ( ! is_string( $actual_sha ) || $actual_sha !== $expected_sha ) {
			wp_delete_file( $tmp );
			return new WP_Error(
				'sha256_mismatch',
				sprintf(
					/* translators: 1: expected 2: actual */
					__( 'Bundle sha256 mismatch. Expected %1$s, downloaded %2$s.', 'odd-outlandish-desktop-decorator' ),
					$expected_sha,
					(string) $actual_sha
				),
				array( 'status' => 502 )
			);
		}
	}

	return $tmp;
}

/**
 * Load the remote catalog, with transient cache + stale fallback.
 *
 * Behaviour:
 *   1. Fresh hit on the 12h transient → return it.
 *   2. Stale: issue a blocking wp_remote_get(). On success, refresh
 *      both the transient AND `oddout_catalog_v1_stale` (the
 *      "last known good" mirror) and return the new body.
 *   3. On network / JSON failure, return whatever is in the stale
 *      option. A brand-new site with zero cache gets an empty
 *      `{bundles:[], starter_pack:{}}` and we let the starter-pack
 *      runner retry later.
 *
 * @param bool $force If true, skip the fresh transient and fetch
 *                    remotely. Used by the "Refresh catalog" button.
 * @return array      Normalised registry structure.
 */
function oddout_catalog_load( $force = false ) {
	static $runtime = null;
	if ( ! $force && null !== $runtime ) {
		return $runtime;
	}
	$failure_meta = null;

	if ( ! $force ) {
		$fresh = get_transient( ODDOUT_CATALOG_TRANSIENT );
		if ( is_array( $fresh ) ) {
			$runtime = oddout_catalog_effective_registry( $fresh );
			oddout_catalog_record_source(
				'transient',
				$fresh,
				array(
					'raw_bundle_count'       => oddout_catalog_registry_bundle_count( $fresh ),
					'effective_bundle_count' => oddout_catalog_registry_bundle_count( $runtime ),
				)
			);
			return $runtime;
		}
	}

	$url      = oddout_catalog_url();
	$registry = oddout_catalog_fetch_remote( $url );

	if ( ! is_wp_error( $registry ) ) {
		$normalised = oddout_catalog_normalise( $registry );
		if ( ! oddout_catalog_should_accept_empty_remote( $normalised, $registry ) ) {
			oddout_catalog_update_meta(
				array(
					'source'                 => 'empty',
					'url_host'               => (string) wp_parse_url( $url, PHP_URL_HOST ),
					'http_status'            => isset( $registry['_oddout_http_status'] ) ? (int) $registry['_oddout_http_status'] : 0,
					'bundle_count'           => 0,
					'raw_bundle_count'       => 0,
					'effective_bundle_count' => 0,
					'generated_at'           => isset( $normalised['generated_at'] ) ? (string) $normalised['generated_at'] : '',
					'registry_sha256'        => isset( $registry['_oddout_registry_sha256'] ) ? (string) $registry['_oddout_registry_sha256'] : '',
					'registry_bytes'         => isset( $registry['_oddout_registry_bytes'] ) ? (int) $registry['_oddout_registry_bytes'] : 0,
					'catalog_base_url'       => oddout_catalog_base_url( $url ),
					'signature_status'       => isset( $registry['_oddout_signature_status'] ) ? sanitize_key( (string) $registry['_oddout_signature_status'] ) : 'unknown',
					'signature_key'          => isset( $registry['_oddout_signature_key'] ) ? sanitize_text_field( (string) $registry['_oddout_signature_key'] ) : '',
					'signature_url'          => isset( $registry['_oddout_signature_url'] ) ? esc_url_raw( (string) $registry['_oddout_signature_url'] ) : oddout_catalog_signature_url( $url ),
					'last_failure'           => time(),
					'last_error_code'        => 'empty_remote',
					'last_error_message'     => __( 'Remote catalog returned zero bundles; keeping the last known good catalog.', 'odd-outlandish-desktop-decorator' ),
					'empty_remote'           => true,
				)
			);
		} else {
			oddout_catalog_remember_previous_stale( $normalised );
			$normalised = oddout_catalog_stamp_accepted_registry( $normalised );
			$runtime    = oddout_catalog_effective_registry( $normalised );
			set_transient( ODDOUT_CATALOG_TRANSIENT, $normalised, ODDOUT_CATALOG_CACHE_TTL );
			update_option( ODDOUT_CATALOG_STALE_OPTION, $normalised, false );
			oddout_catalog_record_source(
				'remote',
				$normalised,
				array(
					'url_host'               => (string) wp_parse_url( $url, PHP_URL_HOST ),
					'http_status'            => isset( $registry['_oddout_http_status'] ) ? (int) $registry['_oddout_http_status'] : 0,
					'raw_bundle_count'       => oddout_catalog_registry_bundle_count( $normalised ),
					'effective_bundle_count' => oddout_catalog_registry_bundle_count( $runtime ),
					'last_success'           => time(),
					'last_error_code'        => '',
					'last_error_message'     => '',
					'empty_remote'           => false,
				)
			);
			return $runtime;
		}
	} else {
		oddout_catalog_record_failure( $registry, $url );
		$failure_meta = oddout_catalog_meta();
	}

	// Remote failed. Fall back to the stale mirror so the Shop can
	// still render what we knew last time.
	$stale = get_option( ODDOUT_CATALOG_STALE_OPTION, array() );
	if (
		is_array( $stale )
		&& isset( $stale['bundles'] )
		&& ( ! empty( $stale['bundles'] ) || oddout_catalog_should_accept_empty_remote( $stale, $stale ) )
	) {
		$runtime           = oddout_catalog_effective_registry( $stale );
		$failure_signature = is_array( $failure_meta )
			? array(
				'signature_status' => $failure_meta['signature_status'],
				'signature_key'    => $failure_meta['signature_key'],
				'signature_url'    => $failure_meta['signature_url'],
			)
			: array();
		oddout_catalog_record_source(
			'stale_option',
			$stale,
			array_merge(
				array(
					'raw_bundle_count'       => oddout_catalog_registry_bundle_count( $stale ),
					'effective_bundle_count' => oddout_catalog_registry_bundle_count( $runtime ),
				),
				$failure_signature
			)
		);
		return $runtime;
	}

	// No stale mirror: this is a fresh site whose very first catalog
	// fetch failed (Playground without network, air-gapped WP, or a
	// catalog host outage during activation). Fall through to the
	// frozen in-plugin fallback so the Shop still has something to
	// render and the starter pack can install.
	if ( function_exists( 'oddout_catalog_fallback_load' ) ) {
		$fallback = oddout_catalog_fallback_load();
		if ( ! empty( $fallback['bundles'] ) ) {
			$runtime           = oddout_catalog_effective_registry( $fallback );
			$failure_signature = is_array( $failure_meta )
				? array(
					'signature_status' => $failure_meta['signature_status'],
					'signature_key'    => $failure_meta['signature_key'],
					'signature_url'    => $failure_meta['signature_url'],
				)
				: array();
			oddout_catalog_record_source(
				'fallback_file',
				$fallback,
				array_merge(
					array(
						'raw_bundle_count'       => oddout_catalog_registry_bundle_count( $fallback ),
						'effective_bundle_count' => oddout_catalog_registry_bundle_count( $runtime ),
					),
					$failure_signature
				)
			);
			return $runtime;
		}
	}

	$runtime = oddout_catalog_empty_registry();
	oddout_catalog_record_source( 'empty', $runtime );
	return $runtime;
}

/**
 * Hit the remote registry with wp_remote_get and return the decoded
 * array or a WP_Error.
 *
 * @param string $url
 * @return array|WP_Error
 */
function oddout_catalog_validate_remote_registry( $data, $catalog_url ) {
	if ( ! is_array( $data ) ) {
		return new WP_Error( 'catalog_not_array', __( 'Catalog registry must be a JSON object.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! isset( $data['version'] ) || 1 !== $data['version'] ) {
		return new WP_Error(
			'catalog_bad_version',
			__( 'Catalog registry version must be 1.', 'odd-outlandish-desktop-decorator' ),
			array( 'version' => isset( $data['version'] ) ? $data['version'] : null )
		);
	}
	if ( ! isset( $data['bundles'] ) || ! is_array( $data['bundles'] ) ) {
		return new WP_Error( 'catalog_missing_bundles', __( 'Catalog registry is missing the bundles array.', 'odd-outlandish-desktop-decorator' ) );
	}

	$allowed_types = oddout_catalog_allowed_types();
	$seen_slugs    = array();
	$seen_by_type  = array();
	foreach ( $data['bundles'] as $index => $entry ) {
		if ( ! is_array( $entry ) ) {
			return new WP_Error(
				'catalog_malformed_row',
				__( 'Catalog registry contains a malformed bundle row.', 'odd-outlandish-desktop-decorator' ),
				array( 'row' => (int) $index )
			);
		}

		$type = isset( $entry['type'] ) ? sanitize_text_field( (string) $entry['type'] ) : '';
		if ( ! in_array( $type, $allowed_types, true ) ) {
			return new WP_Error(
				'catalog_unsupported_type',
				__( 'Catalog registry contains an unsupported bundle type.', 'odd-outlandish-desktop-decorator' ),
				array(
					'row'  => (int) $index,
					'type' => $type,
				)
			);
		}

		$raw_slug = isset( $entry['slug'] ) ? (string) $entry['slug'] : '';
		$slug     = sanitize_key( $raw_slug );
		if ( '' === $slug || $slug !== $raw_slug || ! preg_match( '/^[a-z0-9][a-z0-9-]*$/', $slug ) ) {
			return new WP_Error(
				'catalog_bad_slug',
				__( 'Catalog registry contains a bundle with an invalid slug.', 'odd-outlandish-desktop-decorator' ),
				array( 'row' => (int) $index )
			);
		}
		if ( isset( $seen_slugs[ $slug ] ) ) {
			return new WP_Error(
				'catalog_duplicate_slug',
				__( 'Catalog registry contains duplicate bundle slugs.', 'odd-outlandish-desktop-decorator' ),
				array( 'slug' => $slug )
			);
		}
		$seen_slugs[ $slug ] = true;
		if ( ! isset( $seen_by_type[ $type ] ) ) {
			$seen_by_type[ $type ] = array();
		}
		$seen_by_type[ $type ][ $slug ] = true;

		if ( empty( $entry['name'] ) ) {
			return new WP_Error(
				'catalog_missing_name',
				__( 'Catalog registry contains a bundle without a name.', 'odd-outlandish-desktop-decorator' ),
				array( 'slug' => $slug )
			);
		}

		$version = isset( $entry['version'] ) ? (string) $entry['version'] : '';
		if ( ! oddout_catalog_semver_is_valid( $version ) ) {
			return new WP_Error(
				'catalog_bad_bundle_version',
				__( 'Catalog registry contains a bundle with an invalid version.', 'odd-outlandish-desktop-decorator' ),
				array( 'slug' => $slug )
			);
		}

		if ( isset( $entry['requires'] ) ) {
			if ( ! is_array( $entry['requires'] ) ) {
				return new WP_Error(
					'catalog_bad_requires',
					__( 'Catalog registry contains a bundle with malformed compatibility requirements.', 'odd-outlandish-desktop-decorator' ),
					array( 'slug' => $slug )
				);
			}
			foreach ( $entry['requires'] as $requires_key => $requires_version ) {
				if ( ! in_array( (string) $requires_key, oddout_catalog_requires_keys(), true ) ) {
					return new WP_Error(
						'catalog_bad_requires_key',
						__( 'Catalog registry contains an unsupported compatibility requirement.', 'odd-outlandish-desktop-decorator' ),
						array(
							'slug' => $slug,
							'key'  => (string) $requires_key,
						)
					);
				}
				if ( ! is_string( $requires_version ) || ! oddout_catalog_semver_is_valid( $requires_version ) ) {
					return new WP_Error(
						'catalog_bad_requires_version',
						__( 'Catalog registry contains an invalid compatibility requirement version.', 'odd-outlandish-desktop-decorator' ),
						array(
							'slug' => $slug,
							'key'  => (string) $requires_key,
						)
					);
				}
			}
		}

		$sha = isset( $entry['sha256'] ) ? strtolower( (string) $entry['sha256'] ) : '';
		if ( ! preg_match( '/^[0-9a-f]{64}$/', $sha ) ) {
			return new WP_Error(
				'catalog_bad_hash',
				__( 'Catalog registry contains a bundle with an invalid sha256.', 'odd-outlandish-desktop-decorator' ),
				array( 'slug' => $slug )
			);
		}

		$size = isset( $entry['size'] ) ? (int) $entry['size'] : 0;
		if ( $size <= 0 ) {
			return new WP_Error(
				'catalog_bad_size',
				__( 'Catalog registry contains a bundle with an invalid size.', 'odd-outlandish-desktop-decorator' ),
				array( 'slug' => $slug )
			);
		}

		foreach ( array( 'download_url', 'icon_url', 'card_url' ) as $field ) {
			$field_url = isset( $entry[ $field ] ) ? esc_url_raw( (string) $entry[ $field ] ) : '';
			if ( '' === $field_url ) {
				return new WP_Error(
					'catalog_missing_' . $field,
					__( 'Catalog registry contains a bundle with a missing URL field.', 'odd-outlandish-desktop-decorator' ),
					array(
						'slug'  => $slug,
						'field' => $field,
					)
				);
			}
			if ( ! oddout_catalog_entry_url_allowed( $field_url, $field, $entry, $catalog_url ) ) {
				return new WP_Error(
					'catalog_unsafe_url',
					__( 'Catalog registry contains a bundle URL outside the configured catalog base.', 'odd-outlandish-desktop-decorator' ),
					array(
						'slug'  => $slug,
						'field' => $field,
					)
				);
			}
		}
	}

	if ( isset( $data['starter_pack'] ) ) {
		if ( ! is_array( $data['starter_pack'] ) ) {
			return new WP_Error( 'catalog_bad_starter_pack', __( 'Catalog starter_pack must be an object.', 'odd-outlandish-desktop-decorator' ) );
		}
		$starter_map = array(
			'scenes'     => 'scene',
			'iconSets'   => 'icon-set',
			'cursorSets' => 'cursor-set',
			'widgets'    => 'widget',
			'apps'       => 'app',
		);
		foreach ( $starter_map as $group => $type ) {
			if ( ! isset( $data['starter_pack'][ $group ] ) ) {
				continue;
			}
			if ( ! is_array( $data['starter_pack'][ $group ] ) ) {
				return new WP_Error(
					'catalog_bad_starter_pack_group',
					__( 'Catalog starter_pack entries must be arrays.', 'odd-outlandish-desktop-decorator' ),
					array( 'group' => $group )
				);
			}
			foreach ( $data['starter_pack'][ $group ] as $raw_slug ) {
				$slug = is_string( $raw_slug ) ? sanitize_key( $raw_slug ) : '';
				if ( '' === $slug || $slug !== $raw_slug || empty( $seen_by_type[ $type ][ $slug ] ) ) {
					return new WP_Error(
						'catalog_bad_starter_pack_slug',
						__( 'Catalog starter_pack references a missing bundle.', 'odd-outlandish-desktop-decorator' ),
						array(
							'group' => $group,
							'slug'  => $raw_slug,
							'type'  => $type,
						)
					);
				}
			}
		}
	}

	return true;
}

function oddout_catalog_fetch_remote( $url ) {
	if ( '' === $url ) {
		return new WP_Error( 'no_url', __( 'No catalog URL configured.', 'odd-outlandish-desktop-decorator' ) );
	}
	$url    = esc_url_raw( (string) $url );
	$scheme = strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) );
	if ( 'https' !== $scheme ) {
		return new WP_Error( 'insecure_catalog_url', __( 'Catalog registry URL must use HTTPS.', 'odd-outlandish-desktop-decorator' ) );
	}
	$attempts = (int) apply_filters( 'oddout_catalog_fetch_attempts', 2, $url );
	$attempts = max( 1, min( 5, $attempts ) );
	$timeout  = (int) apply_filters( 'oddout_catalog_fetch_timeout', 5, $url );
	$timeout  = max( 2, min( 15, $timeout ) );
	$max_body = oddout_catalog_max_response_bytes();
	$response = null;
	for ( $i = 1; $i <= $attempts; $i++ ) {
		$response = wp_remote_get(
			$url,
			array(
				'timeout'             => $timeout,
				'limit_response_size' => $max_body + 1,
				'headers'             => array( 'Accept' => 'application/json' ),
			)
		);
		if ( is_wp_error( $response ) ) {
			if ( $i < $attempts ) {
				usleep( 150000 * $i );
				continue;
			}
			break;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( in_array( $code, array( 408, 429, 500, 502, 503, 504 ), true ) && $i < $attempts ) {
			usleep( 150000 * $i );
			continue;
		}
		break;
	}
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	$code = (int) wp_remote_retrieve_response_code( $response );
	if ( $code < 200 || $code >= 300 ) {
		return new WP_Error(
			'bad_status',
			sprintf( 'Catalog returned HTTP %d', $code ),
			array( 'http_status' => $code )
		);
	}
	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === $body ) {
		return new WP_Error( 'empty_body', 'Catalog body was empty.' );
	}
	$body_bytes = strlen( $body );
	if ( $body_bytes > $max_body ) {
		return new WP_Error(
			'catalog_body_too_large',
			__( 'Catalog body exceeded the maximum allowed size.', 'odd-outlandish-desktop-decorator' ),
			array(
				'http_status' => $code,
				'bytes'       => $body_bytes,
				'max_bytes'   => $max_body,
			)
		);
	}
	$signature_meta = oddout_catalog_fetch_registry_signature( $url, $body );
	if ( is_wp_error( $signature_meta ) ) {
		$data = $signature_meta->get_error_data();
		$data = is_array( $data ) ? $data : array();
		$signature_meta->add_data( array_merge( $data, array( 'http_status' => $code ) ) );
		return $signature_meta;
	}
	$data = json_decode( $body, true );
	if ( ! is_array( $data ) ) {
		return new WP_Error(
			'bad_json',
			'Catalog body did not parse as JSON.',
			array_merge( array( 'http_status' => $code ), $signature_meta )
		);
	}
	$valid = oddout_catalog_validate_remote_registry( $data, $url );
	if ( is_wp_error( $valid ) ) {
		$valid->add_data(
			array_merge(
				is_array( $valid->get_error_data() ) ? $valid->get_error_data() : array(),
				array( 'http_status' => $code ),
				$signature_meta
			)
		);
		return $valid;
	}
	$data['_oddout_http_status']      = $code;
	$data['_oddout_registry_sha256']  = hash( 'sha256', $body );
	$data['_oddout_registry_bytes']   = $body_bytes;
	$data['_oddout_signature_status'] = isset( $signature_meta['signature_status'] ) ? (string) $signature_meta['signature_status'] : 'unknown';
	$data['_oddout_signature_key']    = isset( $signature_meta['signature_key'] ) ? (string) $signature_meta['signature_key'] : '';
	$data['_oddout_signature_url']    = isset( $signature_meta['signature_url'] ) ? (string) $signature_meta['signature_url'] : '';
	return $data;
}

/**
 * Normalise and sanitise a decoded registry so downstream callers
 * can depend on the shape. Silently drops malformed rows.
 *
 * @param array $data Decoded JSON.
 * @return array      {version:int, starter_pack:array, bundles:array}
 */
function oddout_catalog_normalise( $data ) {
	$out = array(
		'version'                  => isset( $data['version'] ) ? (int) $data['version'] : 1,
		'generated_at'             => isset( $data['generated_at'] ) ? (string) $data['generated_at'] : '',
		'_oddout_http_status'      => isset( $data['_oddout_http_status'] ) ? (int) $data['_oddout_http_status'] : 0,
		'_oddout_registry_sha256'  => isset( $data['_oddout_registry_sha256'] ) ? (string) $data['_oddout_registry_sha256'] : '',
		'_oddout_registry_bytes'   => isset( $data['_oddout_registry_bytes'] ) ? (int) $data['_oddout_registry_bytes'] : 0,
		'_oddout_signature_status' => isset( $data['_oddout_signature_status'] ) ? sanitize_key( (string) $data['_oddout_signature_status'] ) : 'unknown',
		'_oddout_signature_key'    => isset( $data['_oddout_signature_key'] ) ? sanitize_text_field( (string) $data['_oddout_signature_key'] ) : '',
		'_oddout_signature_url'    => isset( $data['_oddout_signature_url'] ) ? esc_url_raw( (string) $data['_oddout_signature_url'] ) : '',
		'starter_pack'             => array(
			'scenes'     => array(),
			'iconSets'   => array(),
			'cursorSets' => array(),
			'widgets'    => array(),
			'apps'       => array(),
		),
		'bundles'                  => array(),
	);

	if ( isset( $data['starter_pack'] ) && is_array( $data['starter_pack'] ) ) {
		foreach ( array( 'scenes', 'iconSets', 'cursorSets', 'widgets', 'apps' ) as $key ) {
			if ( isset( $data['starter_pack'][ $key ] ) && is_array( $data['starter_pack'][ $key ] ) ) {
				$out['starter_pack'][ $key ] = array_values(
					array_filter(
						array_map(
							'sanitize_key',
							$data['starter_pack'][ $key ]
						)
					)
				);
			}
		}
	}

	$allowed_types = oddout_catalog_allowed_types();
	$rows_in       = isset( $data['bundles'] ) && is_array( $data['bundles'] ) ? $data['bundles'] : array();
	foreach ( $rows_in as $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		if ( empty( $entry['slug'] ) || empty( $entry['name'] ) || empty( $entry['type'] ) ) {
			continue;
		}
		$type = sanitize_text_field( (string) $entry['type'] );
		if ( ! in_array( $type, $allowed_types, true ) ) {
			continue;
		}
		$sha = isset( $entry['sha256'] ) ? strtolower( (string) $entry['sha256'] ) : '';
		if ( '' !== $sha && ! preg_match( '/^[0-9a-f]{64}$/', $sha ) ) {
			// Drop rows with malformed hashes — we'd refuse to install them anyway.
			continue;
		}
		if ( ! oddout_catalog_icon_set_row_is_supported( $entry ) ) {
			// SVG icon-set rows cannot install under the raster-only v1 contract.
			continue;
		}
		$row = array(
			'type'         => $type,
			'slug'         => sanitize_key( (string) $entry['slug'] ),
			'name'         => sanitize_text_field( (string) $entry['name'] ),
			'version'      => isset( $entry['version'] ) ? sanitize_text_field( (string) $entry['version'] ) : '',
			'author'       => isset( $entry['author'] ) ? sanitize_text_field( (string) $entry['author'] ) : '',
			'description'  => isset( $entry['description'] ) ? wp_kses_post( (string) $entry['description'] ) : '',
			'category'     => isset( $entry['category'] ) ? sanitize_text_field( (string) $entry['category'] ) : '',
			'icon_url'     => isset( $entry['icon_url'] )
				? oddout_url_current_scheme( esc_url_raw( (string) $entry['icon_url'] ) )
				: '',
			'card_url'     => isset( $entry['card_url'] )
				? oddout_url_current_scheme( esc_url_raw( (string) $entry['card_url'] ) )
				: '',
			'download_url' => isset( $entry['download_url'] )
				? oddout_url_current_scheme( esc_url_raw( (string) $entry['download_url'] ) )
				: '',
			'sha256'       => $sha,
			'size'         => isset( $entry['size'] ) ? (int) $entry['size'] : 0,
			'tags'         => isset( $entry['tags'] ) && is_array( $entry['tags'] )
				? array_values( array_filter( array_map( 'sanitize_text_field', $entry['tags'] ) ) )
				: array(),
			'accent'       => isset( $entry['accent'] ) ? sanitize_hex_color_no_hash( ltrim( (string) $entry['accent'], '#' ) ) : '',
		);
		if ( isset( $entry['requires'] ) ) {
			$requires = oddout_catalog_normalise_requires( $entry['requires'] );
			if ( ! empty( $requires ) ) {
				$row['requires'] = $requires;
			}
		}
		$out['bundles'][] = oddout_catalog_annotate_compatibility( $row );
	}

	$out = oddout_catalog_drop_incompatible_rows( $out );

	/**
	 * Filter the full bundle catalog after remote load + normalisation.
	 * Useful for enterprise deployments that pre-seed internal bundles.
	 *
	 * @param array $out Registry with keys version/starter_pack/bundles.
	 */
	return (array) apply_filters( 'oddout_bundle_catalog', $out );
}

/**
 * Force a fresh fetch on next oddout_catalog_load() (bypassing the
 * transient). Called by the "Refresh catalog" REST endpoint.
 */
function oddout_catalog_refresh() {
	$lock_key = 'oddout_catalog_refresh_lock';
	$lock     = oddout_catalog_lock_acquire( $lock_key, 60 );
	if ( is_wp_error( $lock ) ) {
		oddout_catalog_update_meta(
			array(
				'last_failure'       => time(),
				'last_error_code'    => $lock->get_error_code(),
				'last_error_message' => $lock->get_error_message(),
			)
		);
		return oddout_catalog_load( false );
	}

	delete_transient( ODDOUT_CATALOG_TRANSIENT );
	$registry = oddout_catalog_load( true );
	oddout_catalog_lock_release( $lock_key );
	return $registry;
}

/**
 * Return just the bundle rows from the loaded catalog.
 *
 * @return array<int, array<string, mixed>>
 */
function oddout_bundle_catalog() {
	$registry = oddout_catalog_load();
	return isset( $registry['bundles'] ) ? $registry['bundles'] : array();
}

/**
 * Return the starter-pack descriptor from the registry. Used by
 * odd/includes/starter-pack.php to pick which bundles to install on
 * first activation.
 *
 * @return array{scenes:string[],iconSets:string[],cursorSets:string[],widgets:string[],apps:string[]}
 */
function oddout_catalog_starter_pack() {
	$registry = oddout_catalog_load();
	return isset( $registry['starter_pack'] ) && is_array( $registry['starter_pack'] )
		? $registry['starter_pack']
		: array(
			'scenes'     => array(),
			'iconSets'   => array(),
			'cursorSets' => array(),
			'widgets'    => array(),
			'apps'       => array(),
		);
}

/**
 * Find the sha256 for a given bundle slug in the loaded catalog. Used
 * by the REST install handler to gate the download. Returns '' when
 * the slug isn't present.
 */
function oddout_catalog_sha256_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	foreach ( oddout_bundle_catalog() as $row ) {
		if ( $row['slug'] === $slug ) {
			return isset( $row['sha256'] ) ? (string) $row['sha256'] : '';
		}
	}
	return '';
}

/**
 * Find a single catalog row by slug.
 *
 * @return array|null
 */
function oddout_catalog_row_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	foreach ( oddout_bundle_catalog() as $row ) {
		if ( $row['slug'] === $slug ) {
			return $row;
		}
	}
	return null;
}

/**
 * Redact installer-only fields from catalog rows for non-admin users.
 *
 * The Shop can still render catalog cards from labels, descriptions,
 * tags, and preview/icon URLs, but direct install instructions stay
 * behind the same manage_options boundary as the install endpoint.
 */
function oddout_bundle_catalog_row_for_response( array $entry ) {
	if ( current_user_can( 'manage_options' ) ) {
		return $entry;
	}
	unset( $entry['download_url'], $entry['sha256'] );
	return $entry;
}

/**
 * Catalog rows for a given type, annotated with an `installed` flag.
 *
 * @param string $type One of 'scene' | 'icon-set' | 'cursor-set' | 'widget' | 'app'.
 * @return array<int, array<string, mixed>>
 */
function oddout_bundle_catalog_for_type( $type ) {
	$type      = sanitize_text_field( (string) $type );
	$installed = oddout_bundle_catalog_installed_slugs();
	$rows      = array();
	foreach ( oddout_bundle_catalog() as $entry ) {
		if ( $entry['type'] !== $type ) {
			continue;
		}
		$entry['installed'] = isset( $installed[ $entry['slug'] ] );
		$rows[]             = oddout_bundle_catalog_row_for_response( $entry );
	}
	return $rows;
}

function oddout_bundle_catalog_installed_slugs() {
	$installed = array();
	foreach ( oddout_bundle_catalog_installed_versions() as $slug => $_v ) {
		$installed[ $slug ] = true;
	}
	return $installed;
}

function oddout_bundle_catalog_installed_versions() {
	$installed = array();

	if ( function_exists( 'oddout_apps_list' ) ) {
		foreach ( oddout_apps_list() as $row ) {
			if ( ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	if ( function_exists( 'oddout_icons_get_sets' ) ) {
		foreach ( oddout_icons_get_sets() as $row ) {
			if ( ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	if ( function_exists( 'oddout_cursors_get_sets' ) ) {
		foreach ( oddout_cursors_get_sets() as $row ) {
			if ( ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	$scenes = apply_filters( 'oddout_scene_registry', array() );
	if ( is_array( $scenes ) ) {
		foreach ( $scenes as $row ) {
			if ( is_array( $row ) && ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	$widgets = apply_filters( 'oddout_widget_registry', array() );
	if ( is_array( $widgets ) ) {
		foreach ( $widgets as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$slug = ! empty( $row['slug'] ) ? $row['slug']
				: ( ! empty( $row['id'] ) ? $row['id'] : '' );
			if ( '' !== $slug ) {
				$installed[ $slug ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	return $installed;
}

function oddout_bundle_catalog_is_newer( $catalog_version, $installed_version ) {
	$catalog_version   = (string) $catalog_version;
	$installed_version = (string) $installed_version;
	if ( '' === $catalog_version ) {
		return false;
	}
	if ( '' === $installed_version ) {
		return true;
	}
	return version_compare( $installed_version, $catalog_version, '<' );
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'odd/v1',
			'/bundles/catalog',
			array(
				'methods'             => 'GET',
				'callback'            => 'oddout_bundle_rest_catalog',
				'args'                => array(
					'type' => array(
						'description'       => __( 'Optional catalog bundle type filter.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'string',
						'required'          => false,
						'enum'              => oddout_catalog_allowed_types(),
						'sanitize_callback' => 'sanitize_text_field',
						'validate_callback' => function ( $value ) {
							$value = is_scalar( $value ) ? sanitize_text_field( (string) $value ) : '';
							return '' === $value || in_array( $value, oddout_catalog_allowed_types(), true );
						},
					),
				),
				'permission_callback' => function () {
					return current_user_can( 'read' );
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/bundles/install-from-catalog',
			array(
				'methods'             => 'POST',
				'callback'            => 'oddout_bundle_rest_install_from_catalog',
				'args'                => array(
					'slug'         => array(
						'description'       => __( 'Catalog bundle slug to install.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => 'sanitize_key',
						'validate_callback' => function ( $value ) {
							$value = is_scalar( $value ) ? sanitize_key( (string) $value ) : '';
							return '' !== $value;
						},
					),
					'allow_update' => array(
						'description'       => __( 'Whether to reinstall when the catalog version is newer.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'boolean',
						'required'          => false,
						'default'           => false,
						'sanitize_callback' => 'rest_sanitize_boolean',
					),
				),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/bundles/refresh',
			array(
				'methods'             => 'POST',
				'args'                => array(),
				'callback'            => function () {
					$rl = oddout_bundle_rate_limit_check( 'bundle_catalog_refresh' );
					if ( is_wp_error( $rl ) ) {
						return $rl;
					}
					$registry = oddout_catalog_refresh();
					return rest_ensure_response(
						array(
							'refreshed' => true,
							'count'     => isset( $registry['bundles'] ) ? count( $registry['bundles'] ) : 0,
							'meta'      => oddout_catalog_meta(),
						)
					);
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/bundles/catalog-rollback',
			array(
				'methods'             => 'POST',
				'args'                => array(
					'index' => array(
						'description'       => __( 'Rollback snapshot index to restore.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'integer',
						'required'          => false,
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
				'callback'            => function ( WP_REST_Request $request ) {
					$rl = oddout_bundle_rate_limit_check( 'bundle_catalog_rollback' );
					if ( is_wp_error( $rl ) ) {
						return $rl;
					}
					$registry = oddout_catalog_restore_previous_snapshot( $request->get_param( 'index' ) );
					if ( is_wp_error( $registry ) ) {
						return $registry;
					}
					return rest_ensure_response(
						array(
							'restored' => true,
							'count'    => isset( $registry['bundles'] ) ? count( $registry['bundles'] ) : 0,
							'meta'     => oddout_catalog_meta(),
						)
					);
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/bundles/catalog-meta',
			array(
				'methods'             => 'GET',
				'args'                => array(),
				'callback'            => function () {
					return rest_ensure_response( oddout_catalog_meta() );
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	},
	5
);

function oddout_bundle_rest_catalog( WP_REST_Request $req ) {
	$type     = sanitize_text_field( (string) $req->get_param( 'type' ) );
	$versions = oddout_bundle_catalog_installed_versions();
	$rows     = array();
	foreach ( oddout_bundle_catalog() as $entry ) {
		if ( '' !== $type && $entry['type'] !== $type ) {
			continue;
		}
		$slug                       = $entry['slug'];
		$installed                  = array_key_exists( $slug, $versions );
		$installed_version          = $installed ? $versions[ $slug ] : '';
		$entry['installed']         = $installed;
		$entry['installed_version'] = $installed_version;
		$entry['update_available']  = $installed
			&& oddout_bundle_catalog_is_newer( $entry['version'], $installed_version );
		$rows[]                     = oddout_bundle_catalog_row_for_response( $entry );
	}
	$response = array( 'bundles' => $rows );
	if ( current_user_can( 'manage_options' ) ) {
		$response['meta'] = oddout_catalog_meta();
	}
	return rest_ensure_response( $response );
}

function oddout_bundle_rest_install_from_catalog( WP_REST_Request $req ) {
	$rl = oddout_bundle_rate_limit_check( 'bundle_catalog_install' );
	if ( is_wp_error( $rl ) ) {
		return $rl;
	}

	$slug = sanitize_key( (string) $req->get_param( 'slug' ) );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Missing slug.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 400 ) );
	}

	$entry = oddout_catalog_row_for( $slug );
	if ( null === $entry ) {
		return new WP_Error( 'not_in_catalog', __( 'Bundle is not in the catalog.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
	}
	if ( ! empty( $entry['incompatible'] ) ) {
		return new WP_Error(
			'catalog_incompatible',
			isset( $entry['incompatibility_reason'] ) && '' !== $entry['incompatibility_reason']
				? $entry['incompatibility_reason']
				: __( 'Bundle is not compatible with this ODD runtime.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'   => 409,
				'requires' => isset( $entry['requires'] ) ? $entry['requires'] : array(),
				'current'  => isset( $entry['incompatibility_current'] ) ? $entry['incompatibility_current'] : oddout_catalog_current_versions(),
			)
		);
	}

	$versions          = oddout_bundle_catalog_installed_versions();
	$installed_version = isset( $versions[ $slug ] ) ? $versions[ $slug ] : null;
	$is_installed      = array_key_exists( $slug, $versions );
	$allow_update      = (bool) $req->get_param( 'allow_update' );
	if ( $is_installed ) {
		$newer = oddout_bundle_catalog_is_newer( $entry['version'], (string) $installed_version );
		if ( ! $allow_update ) {
			return new WP_Error(
				$newer ? 'update_available' : 'already_installed',
				$newer
					? __( 'An update is available. Pass allow_update=1 to reinstall.', 'odd-outlandish-desktop-decorator' )
					: __( 'Bundle is already installed.', 'odd-outlandish-desktop-decorator' ),
				array(
					'status'            => 409,
					'installed_version' => (string) $installed_version,
					'catalog_version'   => (string) $entry['version'],
				)
			);
		}
		if ( ! $newer ) {
			return new WP_Error(
				'no_newer_version',
				__( 'Catalog version is not newer than the installed version.', 'odd-outlandish-desktop-decorator' ),
				array( 'status' => 409 )
			);
		}
		if ( function_exists( 'oddout_bundle_uninstall' ) ) {
			$uninstall = oddout_bundle_uninstall( $slug );
			if ( is_wp_error( $uninstall ) ) {
				return $uninstall;
			}
		}
	}

	$install = oddout_catalog_install_entry( $entry );
	if ( is_wp_error( $install ) ) {
		$data           = $install->get_error_data();
		$data           = is_array( $data ) ? $data : array();
		$data['status'] = isset( $data['status'] ) ? (int) $data['status'] : 400;
		$install->add_data( $data );
		return $install;
	}

	$out = array(
		'installed' => true,
		'slug'      => $install['slug'],
		'type'      => $install['type'],
		'manifest'  => $install['manifest'],
		// Shop hot-register payload. See the matching upload
		// endpoint in includes/content/rest.php for the rationale.
		'entry_url' => oddout_bundle_entry_url_for( $install['manifest'] ),
		'row'       => oddout_bundle_panel_row_for( $install['manifest'] ),
	);
	if ( 'app' === $install['type'] && function_exists( 'oddout_apps_serve_url_for_rest_payload' ) ) {
		$serve = oddout_apps_serve_url_for_rest_payload( $install['slug'] );
		if ( '' !== $serve ) {
			$out['serve_url'] = $serve;
		}
	}
	return rest_ensure_response( $out );
}

/**
 * Download + install a single catalog row. Shared between the REST
 * install endpoint and the starter-pack installer so both go through
 * the same HTTPS + sha256 gate.
 *
 * @param array $entry Normalised catalog row.
 * @return array|WP_Error On success: {slug, type, manifest}.
 */
function oddout_catalog_install_entry( array $entry ) {
	$slug     = isset( $entry['slug'] ) ? sanitize_key( (string) $entry['slug'] ) : '';
	$lock_key = 'oddout_catalog_install_lock_' . $slug;
	$lock     = oddout_catalog_lock_acquire( $lock_key, 10 * MINUTE_IN_SECONDS );
	if ( is_wp_error( $lock ) ) {
		return $lock;
	}
	if ( ! empty( $entry['incompatible'] ) ) {
		oddout_catalog_lock_release( $lock_key );
		return new WP_Error(
			'catalog_incompatible',
			isset( $entry['incompatibility_reason'] ) && '' !== $entry['incompatibility_reason']
				? $entry['incompatibility_reason']
				: __( 'Bundle is not compatible with this ODD runtime.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'   => 409,
				'requires' => isset( $entry['requires'] ) ? $entry['requires'] : array(),
				'current'  => isset( $entry['incompatibility_current'] ) ? $entry['incompatibility_current'] : oddout_catalog_current_versions(),
			)
		);
	}

	$tmp = oddout_catalog_download_entry_file( $entry, 'install' );
	if ( is_wp_error( $tmp ) ) {
		oddout_catalog_lock_release( $lock_key );
		return $tmp;
	}

	$download_url = isset( $entry['download_url'] ) ? (string) $entry['download_url'] : '';
	$filename     = wp_parse_url( $download_url, PHP_URL_PATH );
	$filename     = $filename ? basename( $filename ) : $entry['slug'] . '.wp';
	$matches      = oddout_catalog_download_matches_entry( $tmp, $filename, $entry );
	if ( is_wp_error( $matches ) ) {
		wp_delete_file( $tmp );
		oddout_catalog_lock_release( $lock_key );
		return $matches;
	}
	$result = oddout_bundle_install( $tmp, $filename );
	wp_delete_file( $tmp );
	oddout_catalog_lock_release( $lock_key );
	if ( is_wp_error( $result ) ) {
		$data           = $result->get_error_data();
		$data           = is_array( $data ) ? $data : array();
		$data['status'] = isset( $data['status'] ) ? (int) $data['status'] : 400;
		$result->add_data( $data );
		return $result;
	}
	return $result;
}

/**
 * Verify a downloaded archive's manifest still matches the catalog row.
 *
 * SHA256 proves the downloaded bytes match the registry, but this check
 * proves the registry row itself did not advertise one type/slug while
 * installing a different manifest.
 *
 * @param string $tmp_path
 * @param string $filename
 * @param array  $entry Normalised catalog row.
 * @return true|WP_Error
 */
function oddout_catalog_download_matches_entry( $tmp_path, $filename, array $entry ) {
	list( $zip, $open_err ) = oddout_content_archive_open( $tmp_path, $filename );
	if ( $open_err ) {
		return $open_err;
	}

	$manifest = oddout_content_archive_read_manifest( $zip );
	$zip->close();
	if ( is_wp_error( $manifest ) ) {
		return $manifest;
	}

	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	$expected_slug = isset( $entry['slug'] ) ? sanitize_key( (string) $entry['slug'] ) : '';
	$expected_type = isset( $entry['type'] ) ? sanitize_text_field( (string) $entry['type'] ) : '';
	if ( $expected_slug !== $header['slug'] ) {
		return new WP_Error(
			'catalog_slug_mismatch',
			__( 'Downloaded bundle slug does not match the catalog entry.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'   => 400,
				'catalog'  => $expected_slug,
				'manifest' => $header['slug'],
			)
		);
	}
	if ( $expected_type !== $header['type'] ) {
		return new WP_Error(
			'catalog_type_mismatch',
			__( 'Downloaded bundle type does not match the catalog entry.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'   => 400,
				'catalog'  => $expected_type,
				'manifest' => $header['type'],
			)
		);
	}
	$expected_version = isset( $entry['version'] ) ? sanitize_text_field( (string) $entry['version'] ) : '';
	if ( '' !== $expected_version && $expected_version !== $header['version'] ) {
		return new WP_Error(
			'catalog_version_mismatch',
			__( 'Downloaded bundle version does not match the catalog entry.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'   => 400,
				'catalog'  => $expected_version,
				'manifest' => $header['version'],
			)
		);
	}

	return true;
}
