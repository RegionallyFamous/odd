<?php
/**
 * WordPress Playground (origin playground.wordpress.net) registers its own
 * service worker. Desktop Mode's PWA bootstrap also injects a manifest link,
 * probes existing registrations, and would register /desktop-mode/sw.js when no
 * other SW is present: a poor fit beside Playground's worker and noisy in
 * DevTools ("event handler ... initial evaluation", manifest 404, mixed paths).
 *
 * Playground also runs WordPress admin inside a sandboxed iframe. Browser
 * policy blocks Desktop Mode's admin-bar toggle from navigating `window.top`,
 * and Core's dashboard feed widgets try to fetch wordpress.org RSS feeds from
 * the Playground origin where CORS blocks them.
 *
 * Quiet that path only on Playground hosts; normal installs unchanged.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Drops Desktop Mode manifest tags on admin screens.
 */
function oddout_playground_compat_remove_dm_pwa_head_tags() {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_pwa_render_head_tags' ) ) {
		remove_action( 'admin_head', 'desktop_mode_pwa_render_head_tags', 1 );
	}
}
add_action( 'plugins_loaded', 'oddout_playground_compat_remove_dm_pwa_head_tags', 30 );

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

add_filter(
	'desktop_mode_shell_config',
	static function ( $config ) {
		if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() || ! is_array( $config ) ) {
			return $config;
		}
		if ( isset( $config['pwa'] ) && is_array( $config['pwa'] ) ) {
			$config['pwa']['manifestUrl'] = '';
			$config['pwa']['swUrl']       = '';
		}
		return $config;
	},
	50
);

/**
 * In Playground, keep Desktop Mode's admin-bar toggle inside the sandboxed
 * frame instead of asking the browser to navigate the top window.
 */
function oddout_playground_compat_admin_bar_navigation() {
	if ( ! function_exists( 'oddout_is_playground_host' ) || ! oddout_is_playground_host() ) {
		return;
	}
	if ( ! wp_script_is( 'desktop-mode-admin-bar', 'registered' ) && ! wp_script_is( 'desktop-mode-admin-bar', 'enqueued' ) ) {
		return;
	}
	wp_add_inline_script(
		'desktop-mode-admin-bar',
		<<<'JS'
(function(){
	var toggle = document.getElementById('wp-admin-bar-desktop-mode-toggle');
	if (!toggle || toggle.getAttribute('data-odd-playground-toggle') === '1') {
		return;
	}
	toggle.setAttribute('data-odd-playground-toggle', '1');
	toggle.addEventListener('click', function(e){
		var cfg = window.desktopModeAdminBar || {};
		if (!cfg.ajaxUrl || !cfg.nonce) {
			return;
		}
		e.preventDefault();
		e.stopImmediatePropagation();
		var isActive = !!cfg.active;
		var fallback = isActive ? cfg.classicUrl : cfg.portalUrl;
		var body = new URLSearchParams();
		body.set('action', 'save-desktop-mode');
		body.set('nonce', cfg.nonce);
		body.set('enabled', isActive ? '' : '1');
		function navigate(url) {
			if (typeof url === 'string' && url) {
				window.location.href = url;
			}
		}
		var xhr = new XMLHttpRequest();
		xhr.open('POST', cfg.ajaxUrl, true);
		xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
		xhr.onload = function(){
			var target = fallback;
			try {
				var resp = JSON.parse(xhr.responseText);
				if (resp && resp.success && resp.data && resp.data.redirect) {
					target = resp.data.redirect;
				}
			} catch (err) {}
			navigate(target);
		};
		xhr.onerror = function(){
			navigate(fallback);
		};
		xhr.send(body.toString());
	}, true);
})();
JS,
		'after'
	);
}
add_action( 'admin_enqueue_scripts', 'oddout_playground_compat_admin_bar_navigation', 100 );
