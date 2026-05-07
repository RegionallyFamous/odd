<?php
/**
 * Plugin Name:       ODD — Outlandish Desktop Decorator
 * Plugin URI:        https://github.com/RegionallyFamous/odd
 * Description:       App store and decorator for WP Desktop Mode: install wallpapers, icons, cursors, widgets, and apps from a safe catalog.
 * Version:           1.0.3
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            regionallyfamous
 * Author URI:        https://github.com/regionallyfamous
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       odd
 *
 * Requires the WordPress Desktop Mode plugin to be active:
 * https://github.com/WordPress/desktop-mode
 */

defined( 'ABSPATH' ) || exit;

define( 'ODD_VERSION', '1.0.3' );
define( 'ODD_DESKTOP_MODE_MIN_VERSION', '0.7.2' );
define( 'ODD_FILE', __FILE__ );
define( 'ODD_DIR', plugin_dir_path( __FILE__ ) );

/**
 * True when HTTP_HOST is WordPress Playground (parent or playground-scoped).
 *
 * @return bool
 */
function odd_is_playground_host() {
	$host = isset( $_SERVER['HTTP_HOST'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) ) : '';
	$host = preg_replace( '/:\d+$/', '', $host );
	if ( '' === $host ) {
		return false;
	}

	return 'playground.wordpress.net' === $host || ( strlen( $host ) > 25 && '.playground.wordpress.net' === substr( $host, -25 ) );
}

function odd_request_uses_https() {
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

	return odd_is_playground_host();
}

function odd_url_current_scheme( $url ) {
	$url = (string) $url;
	if ( '' === $url ) {
		return '';
	}
	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) || ! isset( $parts['scheme'] ) || 'http' !== strtolower( (string) $parts['scheme'] ) ) {
		return $url;
	}
	return odd_request_uses_https() ? set_url_scheme( $url, 'https' ) : $url;
}

define( 'ODD_URL', untrailingslashit( odd_url_current_scheme( plugins_url( '', __FILE__ ) ) ) );

require_once ODD_DIR . 'includes/dependencies.php';
require_once ODD_DIR . 'includes/playground-compat.php';
require_once ODD_DIR . 'includes/extensions.php';
require_once ODD_DIR . 'includes/migrations.php';
require_once ODD_DIR . 'includes/wallpaper/registry.php';
require_once ODD_DIR . 'includes/wallpaper/prefs.php';
require_once ODD_DIR . 'includes/icons/registry.php';
require_once ODD_DIR . 'includes/icons/dock-filter.php';
require_once ODD_DIR . 'includes/cursors/registry.php';
require_once ODD_DIR . 'includes/cursors/css-endpoint.php';
require_once ODD_DIR . 'includes/cursors/inject.php';
require_once ODD_DIR . 'includes/rest.php';
require_once ODD_DIR . 'includes/accents.php';
require_once ODD_DIR . 'includes/toasts.php';
require_once ODD_DIR . 'includes/native-window.php';
require_once ODD_DIR . 'includes/integration/desktop-mode-ai.php';
require_once ODD_DIR . 'includes/integration/desktop-mode-extended-surfaces.php';
require_once ODD_DIR . 'includes/apps/bootstrap.php';
// Universal bundle installer. Requires the Apps bootstrap above so
// the App type module can delegate to odd_apps_validate_archive() /
// odd_apps_install() for back-compat.
require_once ODD_DIR . 'includes/content/bootstrap.php';
require_once ODD_DIR . 'includes/starter-pack.php';
require_once ODD_DIR . 'includes/e2e-diagnostics.php';
require_once ODD_DIR . 'includes/enqueue.php';

/**
 * Wire every registered ODD script handle up to `wp_set_script_translations`
 * so strings wrapped with
 * `wp.i18n.__()` in the panel / widgets honour the active locale.
 *
 * The JSON files live at `languages/odd-<locale>-<handle-md5>.json`
 * when they exist. `languages/odd.pot` is generated at release time
 * by `odd/bin/make-pot` and is the source template that translators
 * fork.
 */
add_action(
	'wp_enqueue_scripts',
	static function () {
		$langs_dir = ODD_DIR . 'languages';
		foreach ( array( 'odd-panel', 'odd-commands', 'odd-api' ) as $handle ) {
			if ( wp_script_is( $handle, 'registered' ) ) {
				wp_set_script_translations( $handle, 'odd', $langs_dir );
			}
		}
	},
	99
);
add_action(
	'admin_enqueue_scripts',
	static function () {
		$langs_dir = ODD_DIR . 'languages';
		foreach ( array( 'odd-panel', 'odd-commands', 'odd-api' ) as $handle ) {
			if ( wp_script_is( $handle, 'registered' ) ) {
				wp_set_script_translations( $handle, 'odd', $langs_dir );
			}
		}
	},
	99
);
