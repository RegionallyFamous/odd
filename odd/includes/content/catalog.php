<?php
/**
 * ODD — remote bundle catalog.
 *
 * ODD 1.0 keeps the plugin runtime lightweight; every scene, icon set,
 * cursor set, widget, and app lives in a remote registry at `ODD_CATALOG_URL`. We fetch that
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
 *         "franchise":    "Category",
 *         "tags":         ["optional"],
 *         "icon_url":     "https://.../icons/<name>.svg",
 *         "card_url":     "https://.../cards/<name>.webp",
 *         "download_url": "https://.../bundles/<name>.wp",
 *         "sha256":       "<64 hex chars>",
 *         "size":         12345
 *       }
 *     ]
 *   }
 *
 * All remote installs route through {@see odd_bundle_install()} after
 * a sha256 match so a compromised or rewritten .wp fails loudly.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODD_CATALOG_URL' ) ) {
	define( 'ODD_CATALOG_URL', 'https://odd.regionallyfamous.com/catalog/v1/registry.json' );
}
if ( ! defined( 'ODD_CATALOG_TRANSIENT' ) ) {
	define( 'ODD_CATALOG_TRANSIENT', 'odd_catalog_v1' );
}
if ( ! defined( 'ODD_CATALOG_STALE_OPTION' ) ) {
	define( 'ODD_CATALOG_STALE_OPTION', 'odd_catalog_v1_stale' );
}
if ( ! defined( 'ODD_CATALOG_META_OPTION' ) ) {
	define( 'ODD_CATALOG_META_OPTION', 'odd_catalog_v1_meta' );
}
if ( ! defined( 'ODD_CATALOG_CACHE_TTL' ) ) {
	// Twelve hours. The catalog changes infrequently (only when the
	// plugin-catalog repo publishes GitHub Pages), but users who hit
	// "Refresh" in the Shop get a forced revalidate via
	// odd_catalog_refresh().
	define( 'ODD_CATALOG_CACHE_TTL', 12 * HOUR_IN_SECONDS );
}

/**
 * Resolve the catalog URL at runtime. Hosts can override via
 * `odd_catalog_url` filter or the `ODD_CATALOG_URL` constant.
 */
function odd_catalog_url() {
	return (string) apply_filters( 'odd_catalog_url', ODD_CATALOG_URL );
}

function odd_catalog_empty_registry() {
	return odd_catalog_normalise(
		array(
			'version' => 1,
			'bundles' => array(),
		)
	);
}

function odd_catalog_default_meta() {
	return array(
		'source'             => 'empty',
		'url_host'           => '',
		'http_status'        => 0,
		'bundle_count'       => 0,
		'generated_at'       => '',
		'last_success'       => 0,
		'last_failure'       => 0,
		'last_error_code'    => '',
		'last_error_message' => '',
		'fallback_available' => false,
		'stale_available'    => false,
		'empty_remote'       => false,
	);
}

function odd_catalog_meta() {
	$meta = get_option( ODD_CATALOG_META_OPTION, array() );
	if ( ! is_array( $meta ) ) {
		$meta = array();
	}
	return wp_parse_args( $meta, odd_catalog_default_meta() );
}

function odd_catalog_update_meta( array $changes ) {
	$meta = array_merge( odd_catalog_meta(), $changes );
	update_option( ODD_CATALOG_META_OPTION, $meta, false );
	return $meta;
}

function odd_catalog_registry_bundle_count( $registry ) {
	return isset( $registry['bundles'] ) && is_array( $registry['bundles'] )
		? count( $registry['bundles'] )
		: 0;
}

function odd_catalog_record_source( $source, $registry, array $extra = array() ) {
	$stale = get_option( ODD_CATALOG_STALE_OPTION, array() );
	return odd_catalog_update_meta(
		array_merge(
			array(
				'source'             => sanitize_key( (string) $source ),
				'bundle_count'       => odd_catalog_registry_bundle_count( $registry ),
				'generated_at'       => isset( $registry['generated_at'] ) ? (string) $registry['generated_at'] : '',
				'fallback_available' => function_exists( 'odd_catalog_fallback_available' ) ? (bool) odd_catalog_fallback_available() : false,
				'stale_available'    => is_array( $stale ) && ! empty( $stale['bundles'] ),
			),
			$extra
		)
	);
}

function odd_catalog_record_failure( WP_Error $error, $url = '' ) {
	$data = $error->get_error_data();
	$data = is_array( $data ) ? $data : array();
	$host = '' !== $url ? (string) wp_parse_url( $url, PHP_URL_HOST ) : '';
	odd_catalog_update_meta(
		array(
			'url_host'           => $host,
			'http_status'        => isset( $data['http_status'] ) ? (int) $data['http_status'] : 0,
			'last_failure'       => time(),
			'last_error_code'    => $error->get_error_code(),
			'last_error_message' => $error->get_error_message(),
		)
	);
}

function odd_catalog_should_accept_empty_remote( $normalised, $raw ) {
	if ( odd_catalog_registry_bundle_count( $normalised ) > 0 ) {
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
	return (bool) apply_filters( 'odd_catalog_allow_empty_remote', false, $normalised, $raw );
}

function odd_catalog_entry_requires_sha( array $entry ) {
	/**
	 * Catalog-owned installs require sha256 by default. Private mirrors
	 * can relax this, but first-party rows must always be verifiable.
	 *
	 * @param bool  $requires_sha
	 * @param array $entry
	 */
	return (bool) apply_filters( 'odd_bundle_catalog_requires_sha', true, $entry );
}

function odd_catalog_is_transient_download_error( WP_Error $error ) {
	$code   = $error->get_error_code();
	$data   = $error->get_error_data();
	$data   = is_array( $data ) ? $data : array();
	$status = isset( $data['code'] ) ? (int) $data['code'] : ( isset( $data['http_status'] ) ? (int) $data['http_status'] : 0 );
	if ( in_array( $status, array( 408, 429, 500, 502, 503, 504 ), true ) ) {
		return true;
	}
	return in_array( $code, array( 'http_request_failed', 'download_failed', 'http_429', 'http_500', 'http_502', 'http_503', 'http_504' ), true );
}

function odd_catalog_lock_acquire( $key, $ttl ) {
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
		__( 'A catalog operation is already in progress. Please try again in a moment.', 'odd' ),
		array(
			'status'     => 409,
			'started_at' => $started,
		)
	);
}

function odd_catalog_lock_release( $key ) {
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
function odd_catalog_download_entry_file( array $entry, $context = 'install' ) {
	$download_url = isset( $entry['download_url'] ) ? (string) $entry['download_url'] : '';
	if ( '' === $download_url ) {
		return new WP_Error( 'no_download', __( 'Catalog entry has no download URL.', 'odd' ), array( 'status' => 400 ) );
	}

	$scheme      = strtolower( (string) wp_parse_url( $download_url, PHP_URL_SCHEME ) );
	$allow_plain = (bool) apply_filters( 'odd_bundle_allow_insecure_catalog', false, $entry );
	if ( 'https' !== $scheme && ! $allow_plain ) {
		return new WP_Error( 'insecure_download', __( 'Catalog downloads must use HTTPS.', 'odd' ), array( 'status' => 400 ) );
	}
	$download_url = apply_filters( 'odd_bundle_catalog_download_url', $download_url, $entry, $context );
	if ( is_wp_error( $download_url ) ) {
		return $download_url;
	}

	$expected_sha = isset( $entry['sha256'] ) ? strtolower( (string) $entry['sha256'] ) : '';
	if ( '' === $expected_sha && odd_catalog_entry_requires_sha( $entry ) ) {
		return new WP_Error(
			'missing_sha256',
			__( 'Catalog entry is missing a required sha256 digest.', 'odd' ),
			array( 'status' => 400 )
		);
	}

	if ( ! function_exists( 'download_url' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}

	$attempts = (int) apply_filters( 'odd_catalog_download_attempts', 2, $entry, $context );
	$attempts = max( 1, min( 5, $attempts ) );
	$timeout  = (int) apply_filters( 'odd_catalog_download_timeout', 20, $entry, $context );
	$timeout  = max( 5, min( 60, $timeout ) );
	$tmp      = null;
	$last     = null;
	for ( $i = 1; $i <= $attempts; $i++ ) {
		$tmp = download_url( (string) $download_url, $timeout );
		if ( ! is_wp_error( $tmp ) ) {
			break;
		}
		$last = $tmp;
		if ( $i >= $attempts || ! odd_catalog_is_transient_download_error( $tmp ) ) {
			break;
		}
		usleep( 150000 * $i );
	}
	if ( is_wp_error( $tmp ) ) {
		return new WP_Error(
			'download_failed',
			sprintf( /* translators: %s error message */ __( 'Could not download bundle: %s', 'odd' ), $last ? $last->get_error_message() : $tmp->get_error_message() ),
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
				__( 'The downloaded file is not a valid .wp archive.', 'odd' ),
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
					__( 'Bundle sha256 mismatch. Expected %1$s, downloaded %2$s.', 'odd' ),
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
 *      both the transient AND `odd_catalog_v1_stale` (the
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
function odd_catalog_load( $force = false ) {
	static $runtime = null;
	if ( ! $force && null !== $runtime ) {
		return $runtime;
	}

	if ( ! $force ) {
		$fresh = get_transient( ODD_CATALOG_TRANSIENT );
		if ( is_array( $fresh ) ) {
			$runtime = $fresh;
			odd_catalog_record_source( 'transient', $runtime );
			return $runtime;
		}
	}

	$url      = odd_catalog_url();
	$registry = odd_catalog_fetch_remote( $url );

	if ( ! is_wp_error( $registry ) ) {
		$normalised = odd_catalog_normalise( $registry );
		if ( ! odd_catalog_should_accept_empty_remote( $normalised, $registry ) ) {
			odd_catalog_update_meta(
				array(
					'source'             => 'empty',
					'url_host'           => (string) wp_parse_url( $url, PHP_URL_HOST ),
					'http_status'        => isset( $registry['_odd_http_status'] ) ? (int) $registry['_odd_http_status'] : 0,
					'bundle_count'       => 0,
					'generated_at'       => isset( $normalised['generated_at'] ) ? (string) $normalised['generated_at'] : '',
					'last_failure'       => time(),
					'last_error_code'    => 'empty_remote',
					'last_error_message' => __( 'Remote catalog returned zero bundles; keeping the last known good catalog.', 'odd' ),
					'empty_remote'       => true,
				)
			);
		} else {
			set_transient( ODD_CATALOG_TRANSIENT, $normalised, ODD_CATALOG_CACHE_TTL );
			update_option( ODD_CATALOG_STALE_OPTION, $normalised, false );
			$runtime = $normalised;
			odd_catalog_record_source(
				'remote',
				$runtime,
				array(
					'url_host'           => (string) wp_parse_url( $url, PHP_URL_HOST ),
					'http_status'        => isset( $registry['_odd_http_status'] ) ? (int) $registry['_odd_http_status'] : 0,
					'last_success'       => time(),
					'last_error_code'    => '',
					'last_error_message' => '',
					'empty_remote'       => false,
				)
			);
			return $runtime;
		}
	} else {
		odd_catalog_record_failure( $registry, $url );
	}

	// Remote failed. Fall back to the stale mirror so the Shop can
	// still render what we knew last time.
	$stale = get_option( ODD_CATALOG_STALE_OPTION, array() );
	if ( is_array( $stale ) && ! empty( $stale['bundles'] ) ) {
		$runtime = $stale;
		odd_catalog_record_source( 'stale_option', $runtime );
		return $runtime;
	}

	// No stale mirror: this is a fresh site whose very first catalog
	// fetch failed (Playground without network, air-gapped WP, or a
	// catalog host outage during activation). Fall through to the
	// frozen in-plugin fallback so the Shop still has something to
	// render and the starter pack can install.
	if ( function_exists( 'odd_catalog_fallback_load' ) ) {
		$fallback = odd_catalog_fallback_load();
		if ( ! empty( $fallback['bundles'] ) ) {
			$runtime = $fallback;
			odd_catalog_record_source( 'fallback_file', $runtime );
			return $runtime;
		}
	}

	$runtime = odd_catalog_empty_registry();
	odd_catalog_record_source( 'empty', $runtime );
	return $runtime;
}

/**
 * Hit the remote registry with wp_remote_get and return the decoded
 * array or a WP_Error.
 *
 * @param string $url
 * @return array|WP_Error
 */
function odd_catalog_fetch_remote( $url ) {
	if ( '' === $url ) {
		return new WP_Error( 'no_url', __( 'No catalog URL configured.', 'odd' ) );
	}
	$attempts = (int) apply_filters( 'odd_catalog_fetch_attempts', 2, $url );
	$attempts = max( 1, min( 5, $attempts ) );
	$timeout  = (int) apply_filters( 'odd_catalog_fetch_timeout', 5, $url );
	$timeout  = max( 2, min( 15, $timeout ) );
	$response = null;
	for ( $i = 1; $i <= $attempts; $i++ ) {
		$response = wp_remote_get(
			$url,
			array(
				'timeout' => $timeout,
				'headers' => array( 'Accept' => 'application/json' ),
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
	$data = json_decode( $body, true );
	if ( ! is_array( $data ) ) {
		return new WP_Error( 'bad_json', 'Catalog body did not parse as JSON.', array( 'http_status' => $code ) );
	}
	$data['_odd_http_status'] = $code;
	return $data;
}

/**
 * Normalise and sanitise a decoded registry so downstream callers
 * can depend on the shape. Silently drops malformed rows.
 *
 * @param array $data Decoded JSON.
 * @return array      {version:int, starter_pack:array, bundles:array}
 */
function odd_catalog_normalise( $data ) {
	$out = array(
		'version'      => isset( $data['version'] ) ? (int) $data['version'] : 1,
		'generated_at' => isset( $data['generated_at'] ) ? (string) $data['generated_at'] : '',
		'starter_pack' => array(
			'scenes'     => array(),
			'iconSets'   => array(),
			'cursorSets' => array(),
			'widgets'    => array(),
			'apps'       => array(),
		),
		'bundles'      => array(),
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

	$allowed_types = array( 'scene', 'icon-set', 'cursor-set', 'widget', 'app' );
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
		$out['bundles'][] = array(
			'type'         => $type,
			'slug'         => sanitize_key( (string) $entry['slug'] ),
			'name'         => sanitize_text_field( (string) $entry['name'] ),
			'version'      => isset( $entry['version'] ) ? sanitize_text_field( (string) $entry['version'] ) : '',
			'author'       => isset( $entry['author'] ) ? sanitize_text_field( (string) $entry['author'] ) : '',
			'description'  => isset( $entry['description'] ) ? wp_kses_post( (string) $entry['description'] ) : '',
			'franchise'    => isset( $entry['franchise'] ) ? sanitize_text_field( (string) $entry['franchise'] ) : '',
			'icon_url'     => isset( $entry['icon_url'] )
				? odd_url_current_scheme( esc_url_raw( (string) $entry['icon_url'] ) )
				: '',
			'card_url'     => isset( $entry['card_url'] )
				? odd_url_current_scheme( esc_url_raw( (string) $entry['card_url'] ) )
				: '',
			'download_url' => isset( $entry['download_url'] )
				? odd_url_current_scheme( esc_url_raw( (string) $entry['download_url'] ) )
				: '',
			'sha256'       => $sha,
			'size'         => isset( $entry['size'] ) ? (int) $entry['size'] : 0,
			'tags'         => isset( $entry['tags'] ) && is_array( $entry['tags'] )
				? array_values( array_filter( array_map( 'sanitize_text_field', $entry['tags'] ) ) )
				: array(),
			'accent'       => isset( $entry['accent'] ) ? sanitize_hex_color_no_hash( ltrim( (string) $entry['accent'], '#' ) ) : '',
		);
	}

	/**
	 * Filter the full bundle catalog after remote load + normalisation.
	 * Useful for enterprise deployments that pre-seed internal bundles.
	 *
	 * @param array $out Registry with keys version/starter_pack/bundles.
	 */
	return (array) apply_filters( 'odd_bundle_catalog', $out );
}

/**
 * Force a fresh fetch on next odd_catalog_load() (bypassing the
 * transient). Called by the "Refresh catalog" REST endpoint.
 */
function odd_catalog_refresh() {
	$lock_key = 'odd_catalog_refresh_lock';
	$lock     = odd_catalog_lock_acquire( $lock_key, 60 );
	if ( is_wp_error( $lock ) ) {
		odd_catalog_update_meta(
			array(
				'last_failure'       => time(),
				'last_error_code'    => $lock->get_error_code(),
				'last_error_message' => $lock->get_error_message(),
			)
		);
		return odd_catalog_load( false );
	}

	delete_transient( ODD_CATALOG_TRANSIENT );
	$registry = odd_catalog_load( true );
	odd_catalog_lock_release( $lock_key );
	return $registry;
}

/**
 * Return just the bundle rows from the loaded catalog.
 *
 * @return array<int, array<string, mixed>>
 */
function odd_bundle_catalog() {
	$registry = odd_catalog_load();
	return isset( $registry['bundles'] ) ? $registry['bundles'] : array();
}

/**
 * Return the starter-pack descriptor from the registry. Used by
 * odd/includes/starter-pack.php to pick which bundles to install on
 * first activation.
 *
 * @return array{scenes:string[],iconSets:string[],cursorSets:string[],widgets:string[],apps:string[]}
 */
function odd_catalog_starter_pack() {
	$registry = odd_catalog_load();
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
function odd_catalog_sha256_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	foreach ( odd_bundle_catalog() as $row ) {
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
function odd_catalog_row_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	foreach ( odd_bundle_catalog() as $row ) {
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
function odd_bundle_catalog_row_for_response( array $entry ) {
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
function odd_bundle_catalog_for_type( $type ) {
	$type      = sanitize_text_field( (string) $type );
	$installed = odd_bundle_catalog_installed_slugs();
	$rows      = array();
	foreach ( odd_bundle_catalog() as $entry ) {
		if ( $entry['type'] !== $type ) {
			continue;
		}
		$entry['installed'] = isset( $installed[ $entry['slug'] ] );
		$rows[]             = odd_bundle_catalog_row_for_response( $entry );
	}
	return $rows;
}

function odd_bundle_catalog_installed_slugs() {
	$installed = array();
	foreach ( odd_bundle_catalog_installed_versions() as $slug => $_v ) {
		$installed[ $slug ] = true;
	}
	return $installed;
}

function odd_bundle_catalog_installed_versions() {
	$installed = array();

	if ( function_exists( 'odd_apps_list' ) ) {
		foreach ( odd_apps_list() as $row ) {
			if ( ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	if ( function_exists( 'odd_icons_get_sets' ) ) {
		foreach ( odd_icons_get_sets() as $row ) {
			if ( ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	if ( function_exists( 'odd_cursors_get_sets' ) ) {
		foreach ( odd_cursors_get_sets() as $row ) {
			if ( ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	$scenes = apply_filters( 'odd_scene_registry', array() );
	if ( is_array( $scenes ) ) {
		foreach ( $scenes as $row ) {
			if ( is_array( $row ) && ! empty( $row['slug'] ) ) {
				$installed[ $row['slug'] ] = isset( $row['version'] ) ? (string) $row['version'] : '';
			}
		}
	}

	$widgets = apply_filters( 'odd_widget_registry', array() );
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

function odd_bundle_catalog_is_newer( $catalog_version, $installed_version ) {
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
				'callback'            => 'odd_bundle_rest_catalog',
				'permission_callback' => function () {
					return is_user_logged_in();
				},
			)
		);
		register_rest_route(
			'odd/v1',
			'/bundles/install-from-catalog',
			array(
				'methods'             => 'POST',
				'callback'            => 'odd_bundle_rest_install_from_catalog',
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
				'callback'            => function () {
					$rl = odd_bundle_rate_limit_check( 'bundle_catalog_refresh' );
					if ( is_wp_error( $rl ) ) {
						return $rl;
					}
					$registry = odd_catalog_refresh();
					return rest_ensure_response(
						array(
							'refreshed' => true,
							'count'     => isset( $registry['bundles'] ) ? count( $registry['bundles'] ) : 0,
							'meta'      => odd_catalog_meta(),
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
				'callback'            => function () {
					return rest_ensure_response( odd_catalog_meta() );
				},
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	},
	5
);

function odd_bundle_rest_catalog( WP_REST_Request $req ) {
	$type     = sanitize_text_field( (string) $req->get_param( 'type' ) );
	$versions = odd_bundle_catalog_installed_versions();
	$rows     = array();
	foreach ( odd_bundle_catalog() as $entry ) {
		if ( '' !== $type && $entry['type'] !== $type ) {
			continue;
		}
		$slug                       = $entry['slug'];
		$installed                  = array_key_exists( $slug, $versions );
		$installed_version          = $installed ? $versions[ $slug ] : '';
		$entry['installed']         = $installed;
		$entry['installed_version'] = $installed_version;
		$entry['update_available']  = $installed
			&& odd_bundle_catalog_is_newer( $entry['version'], $installed_version );
		$rows[]                     = odd_bundle_catalog_row_for_response( $entry );
	}
	$response = array( 'bundles' => $rows );
	if ( current_user_can( 'manage_options' ) ) {
		$response['meta'] = odd_catalog_meta();
	}
	return rest_ensure_response( $response );
}

function odd_bundle_rest_install_from_catalog( WP_REST_Request $req ) {
	$rl = odd_bundle_rate_limit_check( 'bundle_catalog_install' );
	if ( is_wp_error( $rl ) ) {
		return $rl;
	}

	$slug = sanitize_key( (string) $req->get_param( 'slug' ) );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Missing slug.', 'odd' ), array( 'status' => 400 ) );
	}

	$entry = odd_catalog_row_for( $slug );
	if ( null === $entry ) {
		return new WP_Error( 'not_in_catalog', __( 'Bundle is not in the catalog.', 'odd' ), array( 'status' => 404 ) );
	}

	$versions          = odd_bundle_catalog_installed_versions();
	$installed_version = isset( $versions[ $slug ] ) ? $versions[ $slug ] : null;
	$is_installed      = array_key_exists( $slug, $versions );
	$allow_update      = (bool) $req->get_param( 'allow_update' );
	if ( $is_installed ) {
		$newer = odd_bundle_catalog_is_newer( $entry['version'], (string) $installed_version );
		if ( ! $allow_update ) {
			return new WP_Error(
				$newer ? 'update_available' : 'already_installed',
				$newer
					? __( 'An update is available. Pass allow_update=1 to reinstall.', 'odd' )
					: __( 'Bundle is already installed.', 'odd' ),
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
				__( 'Catalog version is not newer than the installed version.', 'odd' ),
				array( 'status' => 409 )
			);
		}
		if ( function_exists( 'odd_bundle_uninstall' ) ) {
			$uninstall = odd_bundle_uninstall( $slug );
			if ( is_wp_error( $uninstall ) ) {
				return $uninstall;
			}
		}
	}

	$install = odd_catalog_install_entry( $entry );
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
		'entry_url' => odd_bundle_entry_url_for( $install['manifest'] ),
		'row'       => odd_bundle_panel_row_for( $install['manifest'] ),
	);
	if ( 'app' === $install['type'] && function_exists( 'odd_apps_serve_url_for_rest_payload' ) ) {
		$serve = odd_apps_serve_url_for_rest_payload( $install['slug'] );
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
function odd_catalog_install_entry( array $entry ) {
	$slug     = isset( $entry['slug'] ) ? sanitize_key( (string) $entry['slug'] ) : '';
	$lock_key = 'odd_catalog_install_lock_' . $slug;
	$lock     = odd_catalog_lock_acquire( $lock_key, 10 * MINUTE_IN_SECONDS );
	if ( is_wp_error( $lock ) ) {
		return $lock;
	}

	$tmp = odd_catalog_download_entry_file( $entry, 'install' );
	if ( is_wp_error( $tmp ) ) {
		odd_catalog_lock_release( $lock_key );
		return $tmp;
	}

	$download_url = isset( $entry['download_url'] ) ? (string) $entry['download_url'] : '';
	$filename     = wp_parse_url( $download_url, PHP_URL_PATH );
	$filename     = $filename ? basename( $filename ) : $entry['slug'] . '.wp';
	$matches      = odd_catalog_download_matches_entry( $tmp, $filename, $entry );
	if ( is_wp_error( $matches ) ) {
		wp_delete_file( $tmp );
		odd_catalog_lock_release( $lock_key );
		return $matches;
	}
	$result = odd_bundle_install( $tmp, $filename );
	wp_delete_file( $tmp );
	odd_catalog_lock_release( $lock_key );
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
function odd_catalog_download_matches_entry( $tmp_path, $filename, array $entry ) {
	list( $zip, $open_err ) = odd_content_archive_open( $tmp_path, $filename );
	if ( $open_err ) {
		return $open_err;
	}

	$manifest = odd_content_archive_read_manifest( $zip );
	$zip->close();
	if ( is_wp_error( $manifest ) ) {
		return $manifest;
	}

	$header = odd_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	$expected_slug = isset( $entry['slug'] ) ? sanitize_key( (string) $entry['slug'] ) : '';
	$expected_type = isset( $entry['type'] ) ? sanitize_text_field( (string) $entry['type'] ) : '';
	if ( $expected_slug !== $header['slug'] ) {
		return new WP_Error(
			'catalog_slug_mismatch',
			__( 'Downloaded bundle slug does not match the catalog entry.', 'odd' ),
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
			__( 'Downloaded bundle type does not match the catalog entry.', 'odd' ),
			array(
				'status'   => 400,
				'catalog'  => $expected_type,
				'manifest' => $header['type'],
			)
		);
	}

	return true;
}
