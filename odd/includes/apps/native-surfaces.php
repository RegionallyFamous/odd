<?php
/**
 * ODD Apps — WP Desktop native-window + desktop-icon registration.
 *
 * For every enabled installed app we unconditionally register:
 *
 *   desktop_mode_register_window( 'odd-app-{slug}', [...] )
 *     Title bar reads the manifest's name; content renders through
 *     odd_apps_render_window_template() which injects a sandboxed
 *     iframe pointing at /wp-json/odd/v1/apps/serve/{slug}/. The
 *     window is always registered so that `wp.desktop.openWindow(
 *     'odd-app-{slug}' )` (from the Shop, slash commands, or a
 *     sibling plugin) always opens it — even when both visible
 *     surfaces below are off.
 *
 * The visible surfaces are opt-in per app and per user, via the
 * row's `surfaces` shape (see odd_apps_row_surfaces()):
 *
 *   surfaces.taskbar → forwarded to register_window() as
 *     `placement => 'dock'`; Desktop Mode renders the dock
 *     icon via its internal `rail.appendSystemItem({ onOpen: … })`
 *     path so no JS click handler is needed on our side. When false
 *     we pass `placement => 'none'` (window registered, no tile).
 *
 *   surfaces.desktop → gates register_icon() entirely. When false
 *     the paired desktop shortcut is not created and the user
 *     launches the window via the taskbar icon (or any other
 *     entry point listed above).
 *
 * Both IDs are prefixed `odd-app-` so the dock-filter can ignore
 * them when re-skinning icon sets (ODD-native chrome, not WP admin
 * menu icons).
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'init',
	function () {
		if ( ! defined( 'ODD_APPS_ENABLED' ) || ! ODD_APPS_ENABLED ) {
			return;
		}
		if ( ! odd_desktop_mode_available() ) {
			return;
		}

		foreach ( odd_apps_list() as $row ) {
			if ( empty( $row['enabled'] ) ) {
				continue;
			}
			odd_apps_register_surfaces( $row );
		}
	},
	20
);

function odd_apps_register_surfaces( $row ) {
	if ( ! odd_desktop_mode_available() ) {
		return;
	}

	$slug = sanitize_key( $row['slug'] );
	if ( '' === $slug ) {
		return;
	}
	$manifest = odd_apps_manifest_load( $slug );
	$surfaces = odd_apps_row_surfaces( $row );

	$window_id = 'odd-app-' . $slug;
	$icon_url  = odd_apps_icon_url( $slug, $manifest );
	$name      = isset( $row['name'] ) ? $row['name'] : $slug;

	$window_defaults = array(
		'title'      => $name,
		'icon'       => $icon_url,
		'script'     => 'odd-apps',
		'template'   => function () use ( $slug, $manifest ) {
			odd_apps_render_window_template( $slug, $manifest );
		},
		'width'      => 860,
		'height'     => 600,
		'min_width'  => 420,
		'min_height' => 320,
		// 'dock' → Desktop Mode appends a system tile whose onOpen
		// handler calls the window manager directly. 'none' registers
		// the window but leaves the rail untouched.
		'placement'  => $surfaces['taskbar'] ? 'dock' : 'none',
	);

	if ( isset( $manifest['window'] ) && is_array( $manifest['window'] ) ) {
		$w = $manifest['window'];
		foreach ( array( 'width', 'height', 'min_width', 'min_height' ) as $k ) {
			if ( isset( $w[ $k ] ) && is_numeric( $w[ $k ] ) ) {
				$window_defaults[ $k ] = (int) $w[ $k ];
			}
		}
		if ( ! empty( $w['title'] ) ) {
			$window_defaults['title'] = sanitize_text_field( (string) $w['title'] );
		}
	}

	desktop_mode_register_window( $window_id, $window_defaults );

	if ( ! $surfaces['desktop'] ) {
		// User opted out of a desktop shortcut for this app — the
		// taskbar icon (or any wp.desktop.openWindow() caller)
		// remains the launch path. Nothing to register.
		return;
	}

	$icon_defaults = array(
		'title'    => $name,
		'icon'     => $icon_url,
		'window'   => $window_id,
		'position' => 200,
	);
	if ( isset( $manifest['desktopIcon'] ) && is_array( $manifest['desktopIcon'] ) ) {
		$d = $manifest['desktopIcon'];
		if ( ! empty( $d['title'] ) ) {
			$icon_defaults['title'] = sanitize_text_field( (string) $d['title'] );
		}
		if ( isset( $d['position'] ) && is_numeric( $d['position'] ) ) {
			$icon_defaults['position'] = (int) $d['position'];
		}
	}

	desktop_mode_register_icon( 'odd-app-' . $slug, $icon_defaults );
}

/**
 * Template rendered inside the WP Desktop native window body.
 *
 * Contains a mount-point div; odd/src/apps/window-host.js sees the
 * `odd.window-opened` event with id `odd-app-{slug}` and installs a
 * sandboxed iframe into this div pointing at
 * /wp-json/odd/v1/apps/serve/{slug}/.
 *
 * Data attributes here are the only client-server handoff — no
 * inline script. That keeps CSP clean and means a broken panel JS
 * load leaves a visible placeholder rather than a silent window.
 */
function odd_apps_render_window_template( $slug, $manifest ) {
	// Apps are served from /odd-app/{slug}/{path} via a direct
	// request-URI match on `init` (priority 1), not from the REST
	// namespace. Going through REST worked for the initial
	// index.html load (we could tack a _wpnonce onto the query
	// string) but the browser does not propagate that nonce to
	// sub-requests for ./assets/*.js etc., so WP core's
	// rest_cookie_check_errors unsets the current user and 403s
	// every asset — the iframe paints blank white.
	//
	// See odd/includes/apps/serve-cookieauth.php for the endpoint.
	// A fresh rest nonce is still appended so apps that want to call
	// back into /wp-json/odd/v1/ from their own code can read it via
	// `new URLSearchParams( window.location.search ).get( '_wpnonce' )`
	// and send it as X-WP-Nonce on their outgoing fetches.
	$base_url  = odd_apps_cookieauth_url_for( $slug );
	$serve_url = add_query_arg(
		array(
			'_wpnonce' => wp_create_nonce( 'wp_rest' ),
		),
		$base_url
	);
	$serve_url = esc_url( $serve_url );
	$name      = isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug;
	?>
	<div
		class="odd-app-host"
		data-odd-app
		data-odd-app-slug="<?php echo esc_attr( $slug ); ?>"
		data-odd-app-src="<?php echo esc_attr( $serve_url ); ?>"
		style="position:absolute;inset:0;background:#101014;"
	>
		<div class="odd-app-host__loading" style="position:absolute;inset:0;display:grid;place-items:center;color:#d0d0e0;font:13px/1.4 -apple-system,system-ui,sans-serif;opacity:.8">
			<?php
			/* translators: %s: app name */
			printf( esc_html__( 'Loading %s…', 'odd' ), esc_html( $name ) );
			?>
		</div>
	</div>
	<?php
}

function odd_apps_icon_url( $slug, $manifest ) {
	$icon = isset( $manifest['icon'] ) ? (string) $manifest['icon'] : '';
	if ( '' === $icon ) {
		return '';
	}
	// Absolute URL (http / https) — the manifest author is hosting
	// the icon themselves. Validate it: allow only http/https schemes,
	// strip anything that esc_url rejects. Shields the dock from a
	// compromised .wp bundle trying to smuggle in `javascript:` URIs
	// or other exotic schemes. For the common case (a bundle shipping
	// its icon on disk), we prefer the REST-served route below —
	// cheaper, same-origin, and gated by our own realpath logic.
	if ( 0 === stripos( $icon, 'http://' ) || 0 === stripos( $icon, 'https://' ) ) {
		$safe = esc_url( $icon, array( 'http', 'https' ) );
		if ( '' === $safe ) {
			return '';
		}
		return function_exists( 'odd_url_current_scheme' ) ? odd_url_current_scheme( $safe ) : $safe;
	}
	// data: URIs would be ideal but WP Desktop Mode's dock sanitizer
	// only accepts dashicon classes or http(s) URLs (see
	// desktop_mode_sanitize_dock_icon). Anything else falls back to
	// a generic cog — so we always return a real URL.
	//
	// Relative path inside the app bundle → route through the public
	// icon endpoint. `<img>` tags don't send X-WP-Nonce, so the
	// standard capability-gated /apps/serve route would 401 when the
	// dock renders the tile. The /apps/icon route serves only the
	// manifest's declared icon with no auth.
	if ( function_exists( 'odd_apps_icon_file_path' ) && '' === odd_apps_icon_file_path( $slug, $manifest ) ) {
		if ( function_exists( 'odd_apps_repair_from_catalog' ) ) {
			$repair = odd_apps_repair_from_catalog( $slug, $icon );
			if ( true === $repair ) {
				clearstatcache();
			}
		}
		if ( '' === odd_apps_icon_file_path( $slug, $manifest ) ) {
			return '';
		}
	}
	return odd_https_rest_url( 'odd/v1/apps/icon/' . $slug );
}
