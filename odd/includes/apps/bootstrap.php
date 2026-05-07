<?php
/**
 * ODD Apps — bootstrap.
 *
 * Single file required from odd.php so the apps engine comes online
 * in one explicit line. Order:
 *
 *   storage.php              option + filesystem helpers
 *   loader.php               zip validate + extract
 *   registry.php             install/uninstall API + odd_app_registry
 *   rest.php                 /odd/v1/apps/* routes
 *   serve-cookieauth.php    /odd-app/* file delivery
 *   embed-output.php        rewrite catalog JS/HTML for ODD REST + iframe bootstrap
 *   native-surfaces.php      desktop_mode_register_icon + _window per app
 *
 * Feature flag:
 *
 *   define( 'ODD_APPS_ENABLED', true );
 *
 * is the single gate for the whole feature. The constant is also
 * re-derivable through the `odd_apps_enabled` filter so test harnesses
 * can toggle without editing wp-config.php. The flag ships ON; the
 * constant exists so a host can hard-disable apps without editing
 * plugin files.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODD_APPS_ENABLED' ) ) {
	// Ships ON. Third-party code or wp-config can still set the
	// constant explicitly to false to disable the apps engine
	// across the whole install.
	define( 'ODD_APPS_ENABLED', (bool) apply_filters( 'odd_apps_enabled', true ) );
}

// Always-loaded files.
//
// Every runtime submodule is required on every request. A previous
// lazy-loading split saved a small include cost but left installed apps
// "registered but never templated" for request shapes we didn't predict.
//
// The cost of always requiring these files is one filestat and one
// compile per request — negligible compared to the cost of a
// hard-to-diagnose blank-window regression.
require_once ODD_DIR . 'includes/apps/storage.php';
require_once ODD_DIR . 'includes/apps/registry.php';
require_once ODD_DIR . 'includes/apps/loader.php';
require_once ODD_DIR . 'includes/apps/repair.php';
require_once ODD_DIR . 'includes/apps/rest.php';
require_once ODD_DIR . 'includes/apps/serve-cookieauth.php';
require_once ODD_DIR . 'includes/apps/embed-output.php';
require_once ODD_DIR . 'includes/apps/native-surfaces.php';
