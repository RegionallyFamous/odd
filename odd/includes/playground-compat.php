<?php
/**
 * WordPress Playground (origin playground.wordpress.net) registers its own
 * service worker. OpenStation's PWA bootstrap also injects a manifest link,
 * probes existing registrations, and can register its own worker when no
 * other SW is present: a poor fit beside Playground's worker and noisy in
 * DevTools ("event handler ... initial evaluation", manifest 404, mixed paths).
 *
 * Playground also runs WordPress admin inside a sandboxed iframe. Browser
 * policy blocks OpenStation's admin-bar toggle from navigating `window.top`,
 * and Core's dashboard feed widgets try to fetch wordpress.org RSS feeds from
 * the Playground origin where CORS blocks them.
 *
 * Quiet that path only on Playground hosts; normal installs unchanged.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Drop OpenStation manifest tags on admin screens.
 */
function oddout_playground_compat_remove_openstation_pwa_head_tags() {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() ) {
		return;
	}
	if ( function_exists( 'openstation_pwa_render_head_tags' ) ) {
		remove_action( 'admin_head', 'openstation_pwa_render_head_tags', 1 );
	}
}
add_action( 'plugins_loaded', 'oddout_playground_compat_remove_openstation_pwa_head_tags', 30 );

/**
 * Remove Core dashboard feed widgets on Playground.
 *
 * WordPress fetches wordpress.org/news/feed/ and planet.wordpress.org/feed/
 * for these boxes. In Playground those requests originate from
 * playground.wordpress.net and are blocked by the feeds' CORS policy, so the
 * dashboard opens with noisy console errors unrelated to ODD.
 */
function oddout_playground_compat_remove_dashboard_feed_widgets() {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() ) {
		return;
	}
	remove_meta_box( 'dashboard_primary', 'dashboard', 'side' );
	remove_meta_box( 'dashboard_secondary', 'dashboard', 'side' );
}
add_action( 'wp_dashboard_setup', 'oddout_playground_compat_remove_dashboard_feed_widgets', 100 );

/**
 * Keep every shell-owned URL inside the active Playground scope.
 *
 * OpenStation's live registry refresh builds a hidden admin request from
 * `config.adminUrl`. An unscoped URL opens a different Playground instance,
 * so the refresh returns no newly installed app and the launcher appears only
 * after a manual page reload. Scope all shell navigation/REST URLs at the
 * server boundary instead of patching OpenStation internals in the browser.
 *
 * @param array $config OpenStation shell config.
 * @return array
 */
function oddout_playground_scope_openstation_config( $config ) {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() || ! is_array( $config ) ) {
		return $config;
	}

	$url_keys = array(
		'adminUrl',
		'currentPage',
		'defaultWindowUrl',
		'homeUrl',
		'logoutUrl',
		'mediaUrl',
		'portalUrl',
		'restUrl',
		'seenIntrosUrl',
		'sessionUrl',
	);
	foreach ( $url_keys as $key ) {
		if ( isset( $config[ $key ] ) && is_string( $config[ $key ] ) && '' !== $config[ $key ] ) {
			$config[ $key ] = oddout_url_with_playground_scope( $config[ $key ] );
		}
	}

	if ( isset( $config['pwa'] ) && is_array( $config['pwa'] ) ) {
		$config['pwa']['manifestUrl'] = '';
		$config['pwa']['swUrl']       = '';
	}
	return $config;
}
add_filter( 'openstation_shell_config', 'oddout_playground_scope_openstation_config', 50 );

/**
 * Playground's root worker is owned by playground.wordpress.net, so ODD keeps
 * OpenStation from replacing it.
 */
add_filter(
	'openstation_pwa_force_replace_sw',
	static function ( $force_replace ) {
		if ( function_exists( 'oddout_is_playground_host' ) && oddout_is_playground_host() ) {
			return false;
		}
		return $force_replace;
	},
	20
);

/**
 * Remove stale OpenStation service workers from older Playground sessions.
 *
 * ODD clears OpenStation's PWA URLs above, so new sessions should not register
 * its worker in Playground. Existing browser profiles can still carry one,
 * though, and Chrome will keep evaluating it until it is explicitly
 * unregistered. Leave Playground's own root worker alone.
 */
function oddout_playground_compat_unregister_openstation_service_worker() {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() ) {
		return;
	}
	wp_register_script( 'odd-playground-sw-cleanup', false, array(), ODDOUT_VERSION, true );
	wp_enqueue_script( 'odd-playground-sw-cleanup' );
	wp_add_inline_script(
		'odd-playground-sw-cleanup',
		<<<'JS'
(function(){
	if (!('serviceWorker' in navigator) || typeof navigator.serviceWorker.getRegistrations !== 'function') {
		return;
	}
	navigator.serviceWorker.getRegistrations().then(function(registrations){
		registrations.forEach(function(registration){
			var scope = String(registration && registration.scope || '');
			var worker = registration && (registration.active || registration.waiting || registration.installing);
			var script = String(worker && worker.scriptURL || '');
			var isOpenStationWorker =
				scope.indexOf('/openstation/') !== -1 ||
				script.indexOf('/openstation/sw.js') !== -1 ||
				script.indexOf('/wp-content/plugins/desktop-mode/assets/js/sw.js') !== -1;
			if (isOpenStationWorker && typeof registration.unregister === 'function') {
				registration.unregister().catch(function(){});
			}
		});
	}).catch(function(){});
})();
JS,
		'after'
	);
}
add_action( 'admin_enqueue_scripts', 'oddout_playground_compat_unregister_openstation_service_worker', 1 );
