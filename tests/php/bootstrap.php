<?php
/**
 * PHPUnit bootstrap for the ODD plugin.
 *
 * Expects two environment variables set by CI (or locally):
 *
 *   WP_PHPUNIT__DIR    path to wp-phpunit/wp-phpunit (provided by composer)
 *   WP_PHPUNIT__TESTS_CONFIG optional path to a wp-tests-config.php. Local runs
 *                            use /tmp/wp-tests-config.php when the installer
 *                            created that file.
 *
 * This runs the plugin inside a real WordPress install under wp-phpunit so
 * REST, filters, and user-meta all behave exactly like production.
 */

$_tests_dir = getenv( 'WP_PHPUNIT__DIR' );
if ( false === $_tests_dir || '' === $_tests_dir ) {
	$_tests_dir = __DIR__ . '/../../vendor/wp-phpunit/wp-phpunit';
}

$_tests_config = getenv( 'WP_PHPUNIT__TESTS_CONFIG' );
if ( false === $_tests_config || '' === $_tests_config ) {
	$_core_dir          = getenv( 'WP_CORE_DIR' );
	$_local_core_dir    = is_string( $_core_dir ) && '' !== $_core_dir ? $_core_dir : '/tmp/wordpress';
	$_local_tests_config = dirname( $_local_core_dir ) . '/wp-tests-config.php';
	if ( is_readable( $_local_tests_config ) ) {
		$_tests_config = $_local_tests_config;
	}
}
if ( is_string( $_tests_config ) && is_readable( $_tests_config ) && ! defined( 'WP_TESTS_CONFIG_FILE_PATH' ) ) {
	define( 'WP_TESTS_CONFIG_FILE_PATH', $_tests_config );
}

if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
	fwrite( STDERR, "Could not locate wp-phpunit at {$_tests_dir}.\n" );
	fwrite( STDERR, "Run `composer install` first, or set WP_PHPUNIT__DIR.\n" );
	exit( 1 );
}

require_once dirname( __DIR__, 2 ) . '/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php';
require_once $_tests_dir . '/includes/functions.php';

/**
 * Load the ODD plugin before tests run so its hooks + REST routes
 * register on `plugins_loaded`.
 */
tests_add_filter(
	'muplugins_loaded',
	static function () {
		require dirname( __DIR__, 2 ) . '/odd/odd.php';
	}
);

require $_tests_dir . '/includes/bootstrap.php';
