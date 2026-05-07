<?php
/**
 * ODD Apps — storage primitives.
 *
 * Two-tier option layout:
 *
 *   odd_apps_index          Flat { slug => index_entry }. Autoload = no.
 *                           index_entry contains: name, slug, version,
 *                           enabled, icon (relative path inside the app
 *                           dir), menu_title, capability.
 *
 *   odd_app_{slug}          Full manifest + runtime fields for one app.
 *                           Loaded lazily when the app is served or
 *                           when the panel opens its details pane.
 *
 * File layout on disk:
 *
 *   wp-content/odd-apps/{slug}/...   Extracted app bundle.
 *   wp-content/odd-apps/.htaccess    Direct-access block (first install).
 *
 * Storage is intentionally boring: nothing clever, no custom tables, no
 * transient caches. If you need to know what's installed, read the
 * index; if you need a manifest, read the per-slug option.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODD_APPS_DIR' ) ) {
	define( 'ODD_APPS_DIR', trailingslashit( WP_CONTENT_DIR ) . 'odd-apps/' );
}
if ( ! defined( 'ODD_APPS_OPTION_INDEX' ) ) {
	define( 'ODD_APPS_OPTION_INDEX', 'odd_apps_index' );
}
if ( ! defined( 'ODD_APPS_OPTION_PREFIX' ) ) {
	define( 'ODD_APPS_OPTION_PREFIX', 'odd_app_' );
}
if ( ! defined( 'ODD_APPS_MAX_UNCOMPRESSED' ) ) {
	// 25 MB uncompressed cap per app — leaves headroom for larger front-end
	// bundles without letting a rogue upload exhaust server disk.
	define( 'ODD_APPS_MAX_UNCOMPRESSED', 25 * 1024 * 1024 );
}

/**
 * Return the on-disk directory for a given app slug, with trailing slash.
 * Never returns a path outside ODD_APPS_DIR.
 */
function odd_apps_dir_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return '';
	}
	return ODD_APPS_DIR . $slug . '/';
}

/**
 * Ensure the wp-content/odd-apps/ directory exists and carries a
 * baseline .htaccess that forbids direct file access (everything
 * should go through the REST server so capability checks apply).
 */
function odd_apps_ensure_storage() {
	if ( ! is_dir( ODD_APPS_DIR ) ) {
		wp_mkdir_p( ODD_APPS_DIR );
	}
	$htaccess = ODD_APPS_DIR . '.htaccess';
	if ( ! file_exists( $htaccess ) && wp_is_writable( ODD_APPS_DIR ) ) {
		// Cover both Apache 2.4 (`Require all denied`) and 2.2
		// (`Order allow,deny` + `Deny from all`). The `<IfModule>`
		// gates keep each block silent on the wrong server version.
		$contents = "# Managed by ODD. App bundles are served only via /wp-json/odd/v1/apps/serve/.\n" .
					"<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n" .
					"<IfModule !mod_authz_core.c>\n\tOrder allow,deny\n\tDeny from all\n</IfModule>\n";
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents,WordPress.WP.AlternativeFunctions.file_put_contents_file_put_contents
		@file_put_contents( $htaccess, $contents );
	}
}

/**
 * Read the flat index. Returns an empty array before any install.
 */
function odd_apps_index_load() {
	$raw = get_option( ODD_APPS_OPTION_INDEX, array() );
	if ( ! is_array( $raw ) ) {
		return array();
	}
	return $raw;
}

function odd_apps_index_save( $index ) {
	update_option( ODD_APPS_OPTION_INDEX, is_array( $index ) ? $index : array(), false );
}

/**
 * Full manifest + runtime for a single slug. Returns an empty array
 * if the slug is not installed.
 */
function odd_apps_manifest_load( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return array();
	}
	$raw = get_option( ODD_APPS_OPTION_PREFIX . $slug, array() );
	return is_array( $raw ) ? $raw : array();
}

function odd_apps_manifest_save( $slug, $manifest ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || ! is_array( $manifest ) ) {
		return false;
	}
	return update_option( ODD_APPS_OPTION_PREFIX . $slug, $manifest, false );
}

function odd_apps_manifest_delete( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return false;
	}
	return delete_option( ODD_APPS_OPTION_PREFIX . $slug );
}

/**
 * Check whether a slug is installed (fast path — index-only lookup).
 */
function odd_apps_exists( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = odd_apps_index_load();
	return isset( $index[ $slug ] );
}
