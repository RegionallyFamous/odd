<?php
/**
 * ODD — native window + desktop icon registration.
 *
 * Registers the ODD Shop (user-facing name; window id stays `odd`
 * for WP Desktop Mode session state, tests, slash
 * commands, and third-party extensions) as a WP Desktop Mode native
 * window — content renders in the parent DOM, not an iframe — see
 * /wp-desktop-mode/docs/native-windows-proposal.md — and pairs it
 * with a clickable desktop-wallpaper shortcut tile.
 *
 * Double-clicking the desktop icon registered below is the canonical
 * entry point. Slash commands (`/odd-panel`) and widgets (Now Playing
 * "Open ODD" button, Postcard click) also call
 *   wp.desktop.openWindow( 'odd' )
 * so every surface lands on the same single-instance window.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'init',
	function () {
		if ( ! oddout_desktop_mode_available() ) {
			return;
		}

		$icon_url = oddout_control_icon_url();
		$uid      = get_current_user_id();

		if ( function_exists( 'desktop_mode_register_wallpaper' ) ) {
			desktop_mode_register_wallpaper(
				'odd',
				array(
					'label'   => __( 'ODD', 'odd-outlandish-desktop-decorator' ),
					'preview' => 'linear-gradient(135deg, #10121a 0%, #2b1b4a 58%, #352b11 100%)',
					'type'    => 'canvas',
					'script'  => 'odd',
				)
			);
		}

		desktop_mode_register_window(
			'odd',
			array(
				'title'      => __( 'ODD Shop', 'odd-outlandish-desktop-decorator' ),
				'icon'       => $icon_url,
				'script'     => 'odd-panel',
				'template'   => 'oddout_render_panel_template',
				'width'      => 1080,
				'height'     => 720,
				'min_width'  => 420,
				'min_height' => 420,
				'placement'  => oddout_shop_taskbar_enabled( $uid ) ? 'dock' : 'none',
			)
		);

		desktop_mode_register_icon(
			'odd',
			array(
				'title'    => __( 'ODD', 'odd-outlandish-desktop-decorator' ),
				'icon'     => $icon_url,
				'window'   => 'odd',
				'position' => oddout_shop_desktop_pinned_position( $uid ),
				'pinned'   => oddout_shop_desktop_pinned( $uid ),
			)
		);
	}
);

/**
 * Guarantee that the ODD Shop window advertises the intended size limits
 * in every config surface WP Desktop Mode might read — `nativeWindows[]`
 * (the registered-window array the shell boots with) and
 * `session.windows[]` (persisted per-user resize state).
 */
add_filter(
	'desktop_mode_shell_config',
	function ( $config ) {
		if ( ! is_array( $config ) ) {
			return $config;
		}

		$min_w        = 420;
		$min_h        = 420;
		$default_w    = 1080;
		$default_h    = 720;
		$valid_states = array( 'normal', 'minimized', 'maximized', 'fullscreen' );

		// Native-window registry → some shell builds use these to
		// derive resize-handle limits, so reassert on every boot and
		// carry the values in both snake_case and camelCase.
		if ( ! empty( $config['nativeWindows'] ) && is_array( $config['nativeWindows'] ) ) {
			foreach ( $config['nativeWindows'] as $i => $entry ) {
				if ( ! is_array( $entry ) ) {
					continue;
				}
				$id      = isset( $entry['id'] ) ? (string) $entry['id'] : '';
				$base_id = isset( $entry['baseId'] ) ? (string) $entry['baseId'] : '';
				if ( 'odd' !== $id && 'odd' !== $base_id ) {
					continue;
				}
				$config['nativeWindows'][ $i ]['min_width']  = $min_w;
				$config['nativeWindows'][ $i ]['min_height'] = $min_h;
				$config['nativeWindows'][ $i ]['minWidth']   = $min_w;
				$config['nativeWindows'][ $i ]['minHeight']  = $min_h;
			}
		}

		if ( empty( $config['session']['windows'] ) || ! is_array( $config['session']['windows'] ) ) {
			return $config;
		}

		foreach ( $config['session']['windows'] as $i => $window ) {
			if ( ! is_array( $window ) ) {
				continue;
			}
			$id      = isset( $window['id'] ) ? (string) $window['id'] : '';
			$base_id = isset( $window['baseId'] ) ? (string) $window['baseId'] : '';
			$url     = isset( $window['url'] ) ? (string) $window['url'] : '';

			if ( 'odd' !== $id && 'odd' !== $base_id && '#odd' !== $url ) {
				continue;
			}

			$width  = isset( $window['width'] ) ? (int) $window['width'] : $default_w;
			$height = isset( $window['height'] ) ? (int) $window['height'] : $default_h;
			$state  = isset( $window['state'] ) ? (string) $window['state'] : 'normal';

			if ( ! in_array( $state, $valid_states, true ) ) {
				$state = 'normal';
			}

			$config['session']['windows'][ $i ]['state']      = $state;
			$config['session']['windows'][ $i ]['width']      = max( $min_w, $width );
			$config['session']['windows'][ $i ]['height']     = max( $min_h, $height );
			$config['session']['windows'][ $i ]['min_width']  = $min_w;
			$config['session']['windows'][ $i ]['min_height'] = $min_h;
			$config['session']['windows'][ $i ]['minWidth']   = $min_w;
			$config['session']['windows'][ $i ]['minHeight']  = $min_h;
		}

		return $config;
	}
);

/**
 * Panel template — the shell clones this into the native window body
 * when the JS render callback hasn't finished hydrating yet, and keeps
 * it around as a fallback if the plugin's script failed to load. Once
 * odd/src/panel/index.js runs, it replaces the contents with the live
 * UI and attaches listeners.
 */
function oddout_render_panel_template() {
	?>
	<div class="odd-panel odd-shop" data-odd-panel data-odd-shop></div>
	<?php
}

/**
 * The ODD mark — a googly eye with an off-axis gaze.
 *
 * Shipped as a real SVG file (`assets/odd-eye.svg`) so it can go
 * straight into an `<img src>`. Data-URIs would be cleaner in theory
 * but WP Desktop Mode's `desktop_mode_sanitize_dock_icon` only allows
 * dashicon classes and http(s) URLs — anything else is silently
 * swapped for `dashicons-admin-generic`, which is how we ended up
 * with a cog on the desktop for a while.
 */
function oddout_control_icon_url() {
	$url = plugins_url( 'assets/odd-eye.svg', ODDOUT_FILE );
	$url = (string) oddout_url_current_scheme( $url );
	// Desktop Mode 0.8+ only instantiates an <img> when icon is an absolute
	// http(s) URL; root-relative fallbacks from plugins_url() would render
	// as a blank dashicon tile.
	if ( ! preg_match( '#\Ahttps?://#i', $url ) ) {
		$url = home_url( '/' . ltrim( $url, '/' ) );
	}
	return $url;
}

/**
 * Whether the ODD Shop should be shown as a Desktop Mode dock item.
 *
 * The desktop shortcut remains registered either way. This only
 * controls native-window placement, which Desktop Mode reads during
 * shell boot, so changing it requires a soft reload.
 */
function oddout_shop_taskbar_enabled( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if ( $uid <= 0 ) {
		return false;
	}
	$value = get_user_meta( $uid, 'oddout_shop_taskbar', true );
	if ( '' === $value ) {
		return true;
	}
	return (bool) $value;
}

function oddout_shop_set_taskbar_enabled( $uid, $enabled ) {
	$uid = (int) $uid;
	if ( $uid <= 0 ) {
		return false;
	}
	update_user_meta( $uid, 'oddout_shop_taskbar', $enabled ? 1 : 0 );
	return oddout_shop_taskbar_enabled( $uid );
}

/**
 * Desktop wallpaper shortcut: pin beside My WordPress (Desktop Mode ≥0.8 files layer).
 *
 * @param int $uid User ID.
 * @return bool
 */
function oddout_shop_desktop_pinned( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if ( $uid <= 0 ) {
		return false;
	}
	return (bool) get_user_meta( $uid, 'oddout_shop_desktop_pinned', true );
}

function oddout_shop_set_desktop_pinned( $uid, $enabled ) {
	$uid = (int) $uid;
	if ( $uid <= 0 ) {
		return false;
	}
	update_user_meta( $uid, 'oddout_shop_desktop_pinned', $enabled ? 1 : 0 );
	return oddout_shop_desktop_pinned( $uid );
}

/**
 * Pinned launcher spots use `-1`; free icons keep a late sort slot.
 *
 * @param int $uid User ID.
 * @return int
 */
function oddout_shop_desktop_pinned_position( $uid = 0 ) {
	return oddout_shop_desktop_pinned( $uid ) ? -2 : 100;
}
