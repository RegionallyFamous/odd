<?php
/**
 * ODD Shop and app-host asset registration.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'oddout_register_assets', 20 );

/**
 * Register assets before native OpenStation windows reference their handles.
 */
function oddout_register_assets() {
	if ( ! oddout_openstation_available() ) {
		return;
	}

	wp_register_script(
		'odd-panel',
		ODDOUT_URL . '/src/panel/index.js',
		array( 'openstation', 'wp-i18n' ),
		ODDOUT_VERSION,
		true
	);
	wp_register_style(
		'odd-panel-style',
		ODDOUT_URL . '/src/panel/styles.css',
		array( 'os-variables', 'dashicons' ),
		ODDOUT_VERSION
	);

	wp_set_script_translations( 'odd-panel', 'odd-outlandish-desktop-decorator', ODDOUT_DIR . 'languages' );
}

/**
 * Session-bound Shop state delivered through OpenStation's config API.
 *
 * @return array
 */
function oddout_shop_window_config() {
	$base = oddout_https_rest_url( 'odd/v1/' );
	return array(
		'version'       => ODDOUT_VERSION,
		'iconUrl'       => oddout_control_icon_url(),
		'canInstall'    => current_user_can( 'manage_options' ),
		'installedApps' => oddout_apps_list(),
		'catalogApps'   => oddout_bundle_catalog_for_type( 'app' ),
		'restNonce'     => wp_create_nonce( 'wp_rest' ),
		'rest'          => array(
			'apps'    => $base . 'apps',
			'catalog' => $base . 'bundles/catalog',
			'install' => $base . 'bundles/install-from-catalog',
			'refresh' => $base . 'bundles/refresh',
			'bundles' => $base . 'bundles/',
		),
	);
}
