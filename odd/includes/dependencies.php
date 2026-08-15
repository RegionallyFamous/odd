<?php
/**
 * ODD — OpenStation dependency guards.
 *
 * ODD targets the current OpenStation public API directly. The WordPress.org
 * dependency slug remains `desktop-mode`, but runtime functions and JavaScript
 * live under the `openstation_*` and `wp.os` namespaces.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Public OpenStation functions required by the Apps-only runtime.
 *
 * @return string[]
 */
function oddout_openstation_required_functions() {
	return array(
		'openstation_is_enabled',
		'openstation_register_window',
		'openstation_register_icon',
	);
}

/**
 * Optional OpenStation capability groups used by ODD.
 *
 * @param string $capability Capability id.
 * @return string[]
 */
function oddout_openstation_capability_functions( $capability ) {
	$map = array(
		'core'           => oddout_openstation_required_functions(),
		'os_settings'    => array(
			'openstation_get_os_settings',
			'openstation_save_os_settings',
			'openstation_default_os_settings',
		),
		'registry'       => array( 'openstation_native_window_registry' ),
		'window_notices' => array( 'openstation_register_window_notice' ),
	);

	return isset( $map[ $capability ] ) ? $map[ $capability ] : array();
}

/**
 * Missing functions for a capability group.
 *
 * @param string $capability Capability id.
 * @return string[]
 */
function oddout_openstation_missing_functions( $capability = 'core' ) {
	$missing = array();
	foreach ( oddout_openstation_capability_functions( $capability ) as $function_name ) {
		if ( ! function_exists( $function_name ) ) {
			$missing[] = $function_name;
		}
	}
	return $missing;
}

/**
 * Minimum supported OpenStation version.
 *
 * @return string
 */
function oddout_openstation_min_version() {
	return defined( 'ODDOUT_OPENSTATION_MIN_VERSION' ) ? ODDOUT_OPENSTATION_MIN_VERSION : '1.1.0';
}

/**
 * Detected OpenStation version.
 *
 * @return string
 */
function oddout_openstation_version() {
	return defined( 'OPENSTATION_VERSION' ) ? (string) OPENSTATION_VERSION : '';
}

/**
 * Whether the detected host version meets ODD's baseline.
 *
 * @return bool
 */
function oddout_openstation_version_available() {
	$version = oddout_openstation_version();
	return '' !== $version && version_compare( $version, oddout_openstation_min_version(), '>=' );
}

/**
 * Whether the core OpenStation integration is ready.
 *
 * @return bool
 */
function oddout_openstation_available() {
	return oddout_openstation_version_available() && array() === oddout_openstation_missing_functions();
}

/**
 * Whether an optional OpenStation capability is ready.
 *
 * @param string $capability Capability id.
 * @return bool
 */
function oddout_openstation_supports( $capability ) {
	return oddout_openstation_version_available()
		&& array() === oddout_openstation_missing_functions( $capability );
}

add_action(
	'admin_notices',
	static function () {
		if ( oddout_openstation_available() || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		$missing = oddout_openstation_missing_functions();
		$version = oddout_openstation_version();
		?>
		<div class="notice notice-warning">
			<p>
				<?php
				printf(
					/* translators: 1: minimum OpenStation version, 2: detected version, 3: missing APIs. */
					esc_html__( 'ODD requires OpenStation %1$s or newer. Detected: %2$s. Missing APIs: %3$s.', 'odd-outlandish-desktop-decorator' ),
					esc_html( oddout_openstation_min_version() ),
					esc_html( '' === $version ? __( 'unknown', 'odd-outlandish-desktop-decorator' ) : $version ),
					esc_html( empty( $missing ) ? __( 'none', 'odd-outlandish-desktop-decorator' ) : implode( ', ', $missing ) )
				);
				?>
			</p>
		</div>
		<?php
	}
);
