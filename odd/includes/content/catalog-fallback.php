<?php
/**
 * ODD — frozen catalog fallback.
 *
 * Every release zip ships a snapshot of the public registry at
 * `odd/data/fallback-registry.json`, refreshed deliberately for an ODD plugin
 * release rather than by normal catalog-only builds. When
 * `oddout_catalog_load()` has no fresh transient and no stale mirror
 * option — the classic "first install with no outbound network"
 * scenario, e.g. Playground without network or an air-gapped WP
 * site — it falls through to this module instead of returning an
 * empty registry.
 *
 * The fallback is read-only. Remote loads still overwrite the
 * transient + stale-option tiers; this is only consulted as the final
 * tier before "empty registry".
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_CATALOG_FALLBACK_PATH' ) ) {
	define( 'ODDOUT_CATALOG_FALLBACK_PATH', ODDOUT_DIR . 'data/fallback-registry.json' );
}

/**
 * Resolve the bundled fallback registry path. Filterable so enterprise
 * deployments can swap in their own pre-seeded registry.
 *
 * @return string Absolute filesystem path.
 */
function oddout_catalog_fallback_path() {
	return (string) apply_filters( 'oddout_catalog_fallback_path', ODDOUT_CATALOG_FALLBACK_PATH );
}

/** Whether a fallback path is the immutable registry shipped by this plugin. */
function oddout_catalog_fallback_path_is_plugin_owned( $path ) {
	$actual   = realpath( (string) $path );
	$expected = realpath( ODDOUT_CATALOG_FALLBACK_PATH );
	return false !== $actual && false !== $expected && hash_equals( $expected, $actual );
}

/**
 * Read the bundled fallback registry from disk. Returns a normalised
 * registry array, or an empty registry when the file is missing or
 * unreadable. Never throws.
 *
 * @return array {version:int, bundles:array}
 */
function oddout_catalog_fallback_load() {
	static $cached = null;
	if ( null !== $cached ) {
		return $cached;
	}
	$empty = array(
		'version'      => 1,
		'generated_at' => '',
		'bundles'      => array(),
	);

	$path = oddout_catalog_fallback_path();
	if ( '' === $path || ! is_readable( $path ) ) {
		$cached = $empty;
		return $cached;
	}
	$body = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( '' === $body || false === $body ) {
		$cached = $empty;
		return $cached;
	}
	$data = json_decode( $body, true );
	if ( ! is_array( $data ) ) {
		$cached = $empty;
		return $cached;
	}

	if ( function_exists( 'oddout_catalog_normalise' ) ) {
		$trusted_source = oddout_catalog_fallback_path_is_plugin_owned( $path ) ? 'frozen_fallback' : '';
		$cached         = oddout_catalog_normalise( $data, $trusted_source );
	} else {
		$cached = $empty;
	}
	return $cached;
}

/**
 * Whether the bundled fallback registry is available on disk with
 * at least one bundle row. Callers use this to decide whether falling
 * back is useful or whether they should just surface "no catalog".
 */
function oddout_catalog_fallback_available() {
	$registry = oddout_catalog_fallback_load();
	return isset( $registry['bundles'] ) && is_array( $registry['bundles'] ) && ! empty( $registry['bundles'] );
}
