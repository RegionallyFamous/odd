<?php
/**
 * Plugin Name:       ODD — Outlandish Desktop Decorator
 * Plugin URI:        https://github.com/RegionallyFamous/odd
 * Description:       App store and decorator for WP Desktop Mode: install wallpapers, icons, cursors, widgets, and apps from a safe catalog.
 * Version:           1.1.1
 * Requires at least: 6.8
 * Requires PHP:      8.1
 * Requires Plugins:  desktop-mode
 * Author:            regionallyfamous
 * Author URI:        https://github.com/regionallyfamous
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       odd-outlandish-desktop-decorator
 *
 * Requires the WordPress Desktop Mode plugin to be active:
 * https://github.com/WordPress/desktop-mode
 */

defined( 'ABSPATH' ) || exit;

define( 'ODDOUT_VERSION', '1.1.1' );
define( 'ODDOUT_DESKTOP_MODE_MIN_VERSION', '0.8.5' );
define( 'ODDOUT_DESKTOP_MODE_PLAYGROUND_VERSION', '0.8.5' );
define( 'ODDOUT_FILE', __FILE__ );
define( 'ODDOUT_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Return the writable ODD storage base under the current site's uploads folder.
 *
 * Installed catalog content is user data. Store it outside the plugin
 * directory so upgrades cannot delete it, and derive the path via
 * wp_upload_dir() for multisite/custom-content-dir compatibility.
 *
 * @return string Absolute directory path with trailing slash.
 */
function oddout_storage_base_dir() {
	$uploads = wp_upload_dir( null, false );
	$base    = isset( $uploads['basedir'] ) && is_string( $uploads['basedir'] ) ? $uploads['basedir'] : '';
	if ( '' === $base ) {
		$path   = isset( $uploads['path'] ) && is_string( $uploads['path'] ) ? $uploads['path'] : '';
		$subdir = isset( $uploads['subdir'] ) && is_string( $uploads['subdir'] ) ? $uploads['subdir'] : '';
		if ( '' !== $path && '' !== $subdir && substr( $path, -strlen( $subdir ) ) === $subdir ) {
			$path = substr( $path, 0, -strlen( $subdir ) );
		}
		$base = $path;
	}
	if ( '' === $base ) {
		return '';
	}
	return trailingslashit( $base ) . 'odd/';
}

/**
 * Return the public URL base matching oddout_storage_base_dir().
 *
 * @return string URL with trailing slash.
 */
function oddout_storage_base_url() {
	$uploads = wp_upload_dir( null, false );
	$base    = isset( $uploads['baseurl'] ) && is_string( $uploads['baseurl'] ) ? $uploads['baseurl'] : '';
	if ( '' === $base ) {
		$url    = isset( $uploads['url'] ) && is_string( $uploads['url'] ) ? $uploads['url'] : '';
		$subdir = isset( $uploads['subdir'] ) && is_string( $uploads['subdir'] ) ? $uploads['subdir'] : '';
		if ( '' !== $url && '' !== $subdir && substr( $url, -strlen( $subdir ) ) === $subdir ) {
			$url = substr( $url, 0, -strlen( $subdir ) );
		}
		$base = $url;
	}
	if ( '' === $base ) {
		return '';
	}
	return trailingslashit( oddout_url_current_scheme( $base ) ) . 'odd/';
}

function oddout_storage_dir( $bucket ) {
	$bucket = sanitize_key( (string) $bucket );
	$base   = oddout_storage_base_dir();
	return '' === $base || '' === $bucket ? $base : $base . $bucket . '/';
}

function oddout_storage_url( $bucket ) {
	$bucket = sanitize_key( (string) $bucket );
	$base   = oddout_storage_base_url();
	return '' === $base || '' === $bucket ? $base : $base . $bucket . '/';
}

/**
 * Write a file through the WordPress filesystem abstraction.
 *
 * @param string $path     Absolute destination path.
 * @param string $contents File bytes.
 * @return bool
 */
function oddout_write_file( $path, $contents ) {
	if ( '' === (string) $path ) {
		return false;
	}
	if ( ! function_exists( 'WP_Filesystem' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	global $wp_filesystem;
	if ( empty( $wp_filesystem ) ) {
		WP_Filesystem();
	}
	if ( empty( $wp_filesystem ) || ! method_exists( $wp_filesystem, 'put_contents' ) ) {
		return false;
	}
	return (bool) $wp_filesystem->put_contents( $path, (string) $contents, defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : 0644 );
}

/**
 * Emit exact bytes for authenticated asset endpoints.
 *
 * These responses are already constrained by MIME type, capability checks,
 * archive validation, and realpath confinement. Generic HTML/JS/CSS escaping
 * would corrupt app bundles, import maps, and generated stylesheets.
 *
 * @param string $body Response body.
 */
function oddout_emit_raw_response( $body ) {
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- This helper is used only after endpoint-specific MIME, auth, and path validation; escaping would corrupt HTML/JS/CSS/image response bytes.
	exit( (string) $body );
}

/**
 * True when HTTP_HOST is WordPress Playground (parent or playground-scoped).
 *
 * @return bool
 */
function oddout_is_playground_host() {
	$host = isset( $_SERVER['HTTP_HOST'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) ) : '';
	$host = preg_replace( '/:\d+$/', '', $host );
	if ( '' === $host ) {
		return false;
	}

	return 'playground.wordpress.net' === $host || ( strlen( $host ) > 25 && '.playground.wordpress.net' === substr( $host, -25 ) );
}

function oddout_request_uses_https() {
	if ( is_ssl() ) {
		return true;
	}

	$forwarded = isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) ) ) : '';
	if ( preg_match( '/(^|,\s*)https(\s*,|$)/', $forwarded ) ) {
		return true;
	}

	$https = isset( $_SERVER['HTTPS'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTPS'] ) ) ) : '';
	if ( in_array( $https, array( 'on', '1', 'https' ), true ) ) {
		return true;
	}

	$port = isset( $_SERVER['SERVER_PORT'] ) ? (string) absint( wp_unslash( $_SERVER['SERVER_PORT'] ) ) : '';
	if ( '443' === $port ) {
		return true;
	}

	return oddout_is_playground_host();
}

function oddout_url_current_scheme( $url ) {
	$url = (string) $url;
	if ( '' === $url ) {
		return '';
	}
	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) || ! isset( $parts['scheme'] ) || 'http' !== strtolower( (string) $parts['scheme'] ) ) {
		return $url;
	}
	return oddout_request_uses_https() ? set_url_scheme( $url, 'https' ) : $url;
}

/**
 * Add the active WordPress Playground `/scope:{id}/` prefix to generated URLs.
 *
 * Playground serves the same WordPress site under a scoped request path while
 * WordPress URL helpers usually keep returning unscoped paths. App iframes and
 * runtime module URLs must stay inside the active scope or they miss the
 * Playground worker and never reach WordPress.
 *
 * @param string $url Absolute URL generated by WordPress.
 * @return string URL aligned to the request scheme and active Playground scope.
 */
function oddout_url_with_playground_scope( $url ) {
	$url = oddout_url_current_scheme( $url );
	if ( '' === $url ) {
		return '';
	}

	$uri      = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$req_path = explode( '?', $uri, 2 )[0];
	if ( '' !== $req_path && '/' !== $req_path[0] ) {
		$req_path = '/' . $req_path;
	}

	if ( ! preg_match( '#^(/scope:[^/]+)(?:/|$)#', $req_path, $matches ) ) {
		return $url;
	}
	$scope_seg = $matches[1];

	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
		return $url;
	}

	$path = isset( $parts['path'] ) ? (string) $parts['path'] : '';
	if ( preg_match( '#(^|/)scope:[^/]+(?:/|$)#', $path ) ) {
		return $url;
	}
	if ( '' !== $path && '/' !== $path[0] ) {
		$path = '/' . $path;
	}
	$path = $scope_seg . ( '' !== $path ? $path : '/' );

	$scheme   = isset( $parts['scheme'] ) ? (string) $parts['scheme'] . '://' : '//';
	$user     = isset( $parts['user'] ) ? (string) $parts['user'] : '';
	$pass     = isset( $parts['pass'] ) ? ':' . (string) $parts['pass'] : '';
	$auth     = '' !== $user ? $user . $pass . '@' : '';
	$host     = (string) $parts['host'];
	$port     = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
	$query    = isset( $parts['query'] ) ? '?' . (string) $parts['query'] : '';
	$fragment = isset( $parts['fragment'] ) ? '#' . (string) $parts['fragment'] : '';

	return $scheme . $auth . $host . $port . $path . $query . $fragment;
}

/**
 * `rest_url()` uses `site_url()`; when the DB still has `http://`, mixed-content
 * warnings appear on HTTPS (Playground, TLS proxies). Playground may also serve
 * the site under `/scope:{id}/`, so align to the active request prefix too.
 *
 * @param string $path Optional path appended to the REST root (e.g. `odd/v1/prefs`).
 * @return string
 */
function oddout_https_rest_url( $path = '' ) {
	return oddout_url_with_playground_scope( rest_url( $path ) );
}

define( 'ODDOUT_URL', untrailingslashit( oddout_url_current_scheme( plugins_url( '', __FILE__ ) ) ) );

require_once ODDOUT_DIR . 'includes/dependencies.php';
require_once ODDOUT_DIR . 'includes/playground-compat.php';
require_once ODDOUT_DIR . 'includes/extensions.php';
require_once ODDOUT_DIR . 'includes/migrations.php';
require_once ODDOUT_DIR . 'includes/wallpaper/registry.php';
require_once ODDOUT_DIR . 'includes/wallpaper/prefs.php';
require_once ODDOUT_DIR . 'includes/icons/registry.php';
require_once ODDOUT_DIR . 'includes/icons/dock-filter.php';
require_once ODDOUT_DIR . 'includes/cursors/registry.php';
require_once ODDOUT_DIR . 'includes/cursors/css-endpoint.php';
require_once ODDOUT_DIR . 'includes/cursors/inject.php';
require_once ODDOUT_DIR . 'includes/rest.php';
require_once ODDOUT_DIR . 'includes/accents.php';
require_once ODDOUT_DIR . 'includes/toasts.php';
require_once ODDOUT_DIR . 'includes/native-window.php';
require_once ODDOUT_DIR . 'includes/integration/desktop-mode-ai.php';
require_once ODDOUT_DIR . 'includes/integration/desktop-mode-extended-surfaces.php';
require_once ODDOUT_DIR . 'includes/apps/bootstrap.php';
// Universal bundle installer. Requires the Apps bootstrap above so the App type
// module can delegate to oddout_apps_validate_archive() / oddout_apps_install().
require_once ODDOUT_DIR . 'includes/content/bootstrap.php';
require_once ODDOUT_DIR . 'includes/starter-pack.php';
require_once ODDOUT_DIR . 'includes/e2e-diagnostics.php';
require_once ODDOUT_DIR . 'includes/enqueue.php';

/**
 * Wire every registered ODD script handle up to `wp_set_script_translations`
 * so strings wrapped with
 * `wp.i18n.__()` in the panel / widgets honour the active locale.
 *
 * The JSON files live at `languages/odd-outlandish-desktop-decorator-<locale>-<handle-md5>.json`
 * when they exist. `languages/odd-outlandish-desktop-decorator.pot` is generated at release time
 * by `odd/bin/make-pot` and is the source template that translators
 * fork.
 */
add_action(
	'wp_enqueue_scripts',
	static function () {
		$langs_dir = ODDOUT_DIR . 'languages';
		foreach ( array( 'odd-panel', 'odd-commands', 'odd-api' ) as $handle ) {
			if ( wp_script_is( $handle, 'registered' ) ) {
				wp_set_script_translations( $handle, 'odd-outlandish-desktop-decorator', $langs_dir );
			}
		}
	},
	99
);
add_action(
	'admin_enqueue_scripts',
	static function () {
		$langs_dir = ODDOUT_DIR . 'languages';
		foreach ( array( 'odd-panel', 'odd-commands', 'odd-api' ) as $handle ) {
			if ( wp_script_is( $handle, 'registered' ) ) {
				wp_set_script_translations( $handle, 'odd-outlandish-desktop-decorator', $langs_dir );
			}
		}
	},
	99
);
