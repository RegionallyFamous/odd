<?php
/**
 * ODD — host-plugin dependency guards.
 *
 * ODD is an add-on for WP Desktop Mode v0.8.0+. In normal installs WordPress
 * loads Desktop Mode first, then ODD. In Playground or manual installs, though,
 * the host plugin can fail to download or activate. Keep ODD loadable in that
 * state so recovery is possible, but never call host APIs unless the baseline
 * host is present.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Minimum set of WP Desktop Mode APIs that ODD needs before it can
 * safely register windows, icons, widgets, or wallpapers. Checked on
 * every integration touchpoint — see oddout_desktop_mode_available().
 */
function oddout_desktop_mode_required_functions() {
	return array(
		'desktop_mode_is_enabled',
		'desktop_mode_register_window',
		'desktop_mode_register_icon',
	);
}

/**
 * OS-settings helpers are a secondary Desktop Mode API group used by
 * the starter-pack runner to seed the host wallpaper selection. They
 * are optional — older Desktop Mode builds don't expose them — so
 * they live in their own capability group and callers use
 * oddout_desktop_mode_supports( 'os_settings' ) before invoking them.
 */
function oddout_desktop_mode_capability_functions( $capability ) {
	$map = array(
		'core'          => oddout_desktop_mode_required_functions(),
		'os_settings'   => array(
			'desktop_mode_get_os_settings',
			'desktop_mode_save_os_settings',
			'desktop_mode_default_os_settings',
		),
		'registry'      => array(
			'desktop_mode_native_window_registry',
		),
		'wallpaper'     => array(
			'desktop_mode_register_wallpaper',
		),
		'commands'      => array(
			'desktop_mode_register_command_script',
		),
		'settings'      => array(
			'desktop_mode_register_settings_tab_script',
			'desktop_mode_register_settings_tab',
		),
		'titlebar'      => array(
			'desktop_mode_register_titlebar_button_script',
		),
		'dock_rail'     => array(
			'desktop_mode_register_dock_rail_renderer_script',
		),
		'debug'         => array(
			'desktop_mode_debug_publish',
			'desktop_mode_debug_session_for_request',
		),
		'ai'            => array(
			'desktop_mode_register_ai_tool',
		),
		// Window-chrome framework — wordpress.org desktop-mode 0.8.0+
		// (includes/window-chrome.php). Optional; extensions use
		// oddout_desktop_mode_supports( 'window_chrome' ) before registering themes / controls / slots.
		'window_chrome' => array(
			'desktop_mode_register_window_theme_script',
			'desktop_mode_register_window_theme',
			'desktop_mode_register_window_control_script',
			'desktop_mode_register_window_control',
			'desktop_mode_register_window_slot_script',
			'desktop_mode_register_window_slot',
			'desktop_mode_register_window_chrome_script',
			'desktop_mode_register_window_chrome',
		),
	);
	return isset( $map[ $capability ] ) ? $map[ $capability ] : array();
}

function oddout_desktop_mode_missing_functions( $capability = 'core' ) {
	$missing = array();
	foreach ( oddout_desktop_mode_capability_functions( $capability ) as $fn ) {
		if ( ! function_exists( $fn ) ) {
			$missing[] = $fn;
		}
	}
	return $missing;
}

function oddout_desktop_mode_min_version() {
	return defined( 'ODDOUT_DESKTOP_MODE_MIN_VERSION' ) ? ODDOUT_DESKTOP_MODE_MIN_VERSION : '0.8.0';
}

function oddout_desktop_mode_version() {
	return defined( 'DESKTOP_MODE_VERSION' ) ? (string) DESKTOP_MODE_VERSION : '';
}

function oddout_desktop_mode_version_available() {
	$version = oddout_desktop_mode_version();
	return '' !== $version && version_compare( $version, oddout_desktop_mode_min_version(), '>=' );
}

/**
 * Whether the core Desktop Mode integration surface is available.
 * Pass a capability slug to check a secondary group (e.g. `os_settings`).
 */
function oddout_desktop_mode_available() {
	return oddout_desktop_mode_version_available() && array() === oddout_desktop_mode_missing_functions( 'core' );
}

function oddout_desktop_mode_supports( $capability ) {
	return oddout_desktop_mode_version_available() && array() === oddout_desktop_mode_missing_functions( $capability );
}

add_action(
	'admin_notices',
	static function () {
		if ( oddout_desktop_mode_available() || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		$missing      = oddout_desktop_mode_missing_functions();
		$version      = oddout_desktop_mode_version();
		$min_version  = oddout_desktop_mode_min_version();
		$version_note = oddout_desktop_mode_version_available()
			? ''
			: sprintf(
				/* translators: 1: detected WP Desktop Mode version, 2: minimum required version. */
				__( ' Detected version: %1$s. Required version: %2$s or newer.', 'odd-outlandish-desktop-decorator' ),
				'' === $version ? __( 'unknown', 'odd-outlandish-desktop-decorator' ) : $version,
				$min_version
			);
		?>
		<div class="notice notice-warning">
			<p>
				<?php
				printf(
					/* translators: 1: minimum WP Desktop Mode version, 2: comma-separated missing function names, 3: version note. */
					esc_html__( 'ODD requires WP Desktop Mode %1$s or newer. Desktop surfaces are paused until the host plugin is installed, active, and current. Missing APIs: %2$s.%3$s', 'odd-outlandish-desktop-decorator' ),
					esc_html( $min_version ),
					esc_html( empty( $missing ) ? __( 'none', 'odd-outlandish-desktop-decorator' ) : implode( ', ', $missing ) ),
					esc_html( $version_note )
				);
				?>
			</p>
		</div>
		<?php
	}
);
