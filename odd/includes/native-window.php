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
 * "Open ODD" button, Postcard click) also call the shared ODD
 * client API when available, falling back to:
 *   wp.desktop.openWindow( 'odd' )
 * so every surface lands on the same single-instance window.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Preferred first-run geometry for the ODD Shop native window.
 *
 * Desktop Mode owns actual window creation and persists user changes.
 * ODD only provides a top-friendly default and a small stale-session
 * guard so the Shop cannot keep reopening halfway down the desktop.
 */
function oddout_shop_window_geometry() {
	return array(
		'x'          => 96,
		'y'          => 16,
		'max_y'      => 24,
		'width'      => 1040,
		'height'     => 640,
		'min_width'  => 420,
		'min_height' => 420,
	);
}

add_action(
	'init',
	function () {
		if ( ! oddout_desktop_mode_available() ) {
			return;
		}

		$icon_url = oddout_control_icon_url();
		$uid      = get_current_user_id();
		oddout_shop_seed_taskbar_visibility( $uid );

		if ( function_exists( 'desktop_mode_register_wallpaper' ) ) {
			desktop_mode_register_wallpaper(
				'odd',
				array(
					'label'   => __( 'ODD', 'odd-outlandish-desktop-decorator' ),
					'preview' => 'linear-gradient(135deg, #10121a 0%, #2b1b4a 58%, #352b11 100%)',
					'type'    => 'canvas',
					'script'  => 'odd-live-bootstrap',
				)
			);
		}

		$geometry = oddout_shop_window_geometry();

		desktop_mode_register_window(
			'odd',
			array(
				'title'      => __( 'ODD Shop', 'odd-outlandish-desktop-decorator' ),
				'icon'       => $icon_url,
				'script'     => 'odd-live-bootstrap',
				'style'      => 'odd-panel-style',
				'template'   => 'oddout_render_panel_template',
				'x'          => (int) $geometry['x'],
				'y'          => (int) $geometry['y'],
				'width'      => (int) $geometry['width'],
				'height'     => (int) $geometry['height'],
				'min_width'  => (int) $geometry['min_width'],
				'min_height' => (int) $geometry['min_height'],
				// Desktop Mode's itemVisibility setting owns whether
				// the paired `odd` launcher appears on desktop, taskbar,
				// both, or neither. ODD registers the window only.
				'placement'  => 'none',
			)
		);

		desktop_mode_register_icon(
			'odd',
			array(
				'title'    => __( 'ODD', 'odd-outlandish-desktop-decorator' ),
				'icon'     => $icon_url,
				'window'   => 'odd',
				'position' => 100,
				// Desktop Mode `pinned` means a system-owned shortcut that
				// skips user context menus; ODD stays user-movable.
				'pinned'   => false,
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
function oddout_shop_normalize_window_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}

	$geometry     = oddout_shop_window_geometry();
	$min_w        = (int) $geometry['min_width'];
	$min_h        = (int) $geometry['min_height'];
	$default_w    = (int) $geometry['width'];
	$default_h    = (int) $geometry['height'];
	$default_x    = (int) $geometry['x'];
	$default_y    = (int) $geometry['y'];
	$max_y        = (int) $geometry['max_y'];
	$valid_states = array( 'normal', 'minimized', 'maximized', 'fullscreen' );

	// Native-window registry -> some shell builds use these to derive
	// resize-handle limits, so reassert on every boot and carry the
	// values in both snake_case and camelCase.
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
			$config['nativeWindows'][ $i ]['width']      = $default_w;
			$config['nativeWindows'][ $i ]['height']     = $default_h;
			$config['nativeWindows'][ $i ]['x']          = isset( $entry['x'] ) ? max( 0, (int) $entry['x'] ) : $default_x;
			$config['nativeWindows'][ $i ]['y']          = isset( $entry['y'] ) ? min( $max_y, max( 0, (int) $entry['y'] ) ) : $default_y;
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
		$x      = isset( $window['x'] ) ? max( 0, (int) $window['x'] ) : $default_x;
		$y      = isset( $window['y'] ) ? min( $max_y, max( 0, (int) $window['y'] ) ) : $default_y;

		if ( ! in_array( $state, $valid_states, true ) ) {
			$state = 'normal';
		}

		$config['session']['windows'][ $i ]['state']      = $state;
		$config['session']['windows'][ $i ]['x']          = $x;
		$config['session']['windows'][ $i ]['y']          = $y;
		$config['session']['windows'][ $i ]['width']      = max( $min_w, $width );
		$config['session']['windows'][ $i ]['height']     = max( $min_h, $height );
		$config['session']['windows'][ $i ]['min_width']  = $min_w;
		$config['session']['windows'][ $i ]['min_height'] = $min_h;
		$config['session']['windows'][ $i ]['minWidth']   = $min_w;
		$config['session']['windows'][ $i ]['minHeight']  = $min_h;
	}

	return $config;
}
add_filter( 'desktop_mode_shell_config', 'oddout_shop_normalize_window_config', 20 );

add_filter(
	'desktop_mode_arrange_menu_items',
	function ( $items ) {
		$items   = is_array( $items ) ? $items : array();
		$items[] = array(
			'id'          => 'oddout-shuffle-wallpaper',
			'title'       => __( 'Shuffle ODD wallpaper', 'odd-outlandish-desktop-decorator' ),
			'description' => __( 'Pick another installed ODD scene.', 'odd-outlandish-desktop-decorator' ),
			'position'    => 20,
		);
		$items[] = array(
			'id'          => 'oddout-tidy-widgets',
			'title'       => __( 'Gather ODD widgets', 'odd-outlandish-desktop-decorator' ),
			'description' => __( 'Redock floating ODD widgets and add installed ODD widgets to the desktop.', 'odd-outlandish-desktop-decorator' ),
			'position'    => 21,
		);
		$items[] = array(
			'id'          => 'oddout-open-shop',
			'title'       => __( 'Open ODD Shop', 'odd-outlandish-desktop-decorator' ),
			'description' => __( 'Open the ODD workspace.', 'odd-outlandish-desktop-decorator' ),
			'position'    => 22,
		);
		$items[] = array(
			'id'          => 'oddout-reset-decorations',
			'title'       => __( 'Reset ODD decorations', 'odd-outlandish-desktop-decorator' ),
			'description' => __( 'Reset active ODD icon and cursor decorations.', 'odd-outlandish-desktop-decorator' ),
			'position'    => 23,
		);
		return $items;
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
 * Stored ODD preference for the Shop taskbar launcher.
 *
 * @param int $uid User ID.
 * @return bool
 */
function oddout_shop_fallback_taskbar_enabled( $uid = 0 ) {
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

/**
 * Reads the ODD Shop taskbar visibility from Desktop Mode OS settings.
 *
 * @param int $uid User ID.
 * @return bool|null Null when Desktop Mode has no explicit value.
 */
function oddout_shop_core_taskbar_enabled( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if ( $uid <= 0 || ! function_exists( 'desktop_mode_get_os_settings' ) ) {
		return null;
	}
	$settings = desktop_mode_get_os_settings( $uid );
	if ( ! is_array( $settings ) || empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
		return null;
	}
	if ( ! array_key_exists( 'odd', $settings['itemVisibility'] ) ) {
		return null;
	}
	$placement = (string) $settings['itemVisibility']['odd'];
	if ( in_array( $placement, array( 'both', 'dock' ), true ) ) {
		return true;
	}
	if ( in_array( $placement, array( 'desktop', 'hidden' ), true ) ) {
		return false;
	}
	return null;
}

/**
 * Writes the ODD Shop taskbar visibility through Desktop Mode OS settings.
 *
 * @param int  $uid     User ID.
 * @param bool $enabled Whether to show the ODD Shop in the taskbar.
 * @return bool
 */
function oddout_shop_set_core_taskbar_enabled( $uid, $enabled ) {
	$uid = (int) $uid;
	if (
		$uid <= 0 ||
		! function_exists( 'desktop_mode_get_os_settings' ) ||
		! function_exists( 'desktop_mode_save_os_settings' )
	) {
		return false;
	}
	$settings = desktop_mode_get_os_settings( $uid );
	if ( ! is_array( $settings ) ) {
		return false;
	}
	if ( empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
		$settings['itemVisibility'] = array();
	}
	$settings['itemVisibility']['odd'] = $enabled ? 'both' : 'desktop';
	return (bool) desktop_mode_save_os_settings( $uid, $settings );
}

/**
 * One-way seed for users who only have the older ODD preference.
 *
 * @param int $uid User ID.
 * @return bool True when Desktop Mode settings were updated.
 */
function oddout_shop_seed_taskbar_visibility( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if (
		$uid <= 0 ||
		null !== oddout_shop_core_taskbar_enabled( $uid ) ||
		! function_exists( 'desktop_mode_get_os_settings' ) ||
		! function_exists( 'desktop_mode_save_os_settings' )
	) {
		return false;
	}
	return oddout_shop_set_core_taskbar_enabled( $uid, oddout_shop_fallback_taskbar_enabled( $uid ) );
}

/**
 * Stored/default preference for showing the ODD Shop in the taskbar.
 *
 * Current runtimes use Desktop Mode's `itemVisibility.odd` setting for
 * live placement. Keep this user_meta value as install/default metadata
 * for older clients, REST responses, and workspace export/import.
 */
function oddout_shop_taskbar_enabled( $uid = 0 ) {
	$uid = $uid ? (int) $uid : get_current_user_id();
	if ( $uid <= 0 ) {
		return false;
	}
	$core = oddout_shop_core_taskbar_enabled( $uid );
	if ( null !== $core ) {
		return $core;
	}
	return oddout_shop_fallback_taskbar_enabled( $uid );
}

function oddout_shop_set_taskbar_enabled( $uid, $enabled ) {
	$uid = (int) $uid;
	if ( $uid <= 0 ) {
		return false;
	}
	update_user_meta( $uid, 'oddout_shop_taskbar', $enabled ? 1 : 0 );
	oddout_shop_set_core_taskbar_enabled( $uid, $enabled );
	return oddout_shop_taskbar_enabled( $uid );
}
