<?php
/**
 * ODD Shop native OpenStation window and launcher.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'oddout_register_shop_surfaces', 30 );

/**
 * Register the single Apps-only Shop surface.
 */
function oddout_register_shop_surfaces() {
	if ( ! oddout_openstation_available() || ! current_user_can( 'read' ) ) {
		return;
	}

	$icon = oddout_control_icon_url();
	openstation_register_window(
		'odd',
		array(
			'title'        => __( 'ODD Shop', 'odd-outlandish-desktop-decorator' ),
			'icon'         => $icon,
			'script'       => 'odd-panel',
			'style'        => 'odd-panel-style',
			'template'     => 'oddout_render_panel_template',
			'width'        => 920,
			'height'       => 640,
			'min_width'    => 560,
			'min_height'   => 440,
			'placement'    => 'none',
			'capabilities' => array( 'read' ),
			'config'       => oddout_shop_window_config(),
		)
	);

	openstation_register_icon(
		'odd',
		array(
			'title'        => __( 'ODD Shop', 'odd-outlandish-desktop-decorator' ),
			'icon'         => $icon,
			'window'       => 'odd',
			'position'     => 100,
			'capabilities' => array( 'read' ),
		)
	);

	oddout_shop_seed_visibility();
	oddout_register_shop_window_notice();
}

/**
 * Ensure the Shop is discoverable on first run without overriding a choice.
 */
function oddout_shop_seed_visibility() {
	$user_id = get_current_user_id();
	if ( $user_id <= 0 || ! oddout_openstation_supports( 'os_settings' ) ) {
		return;
	}

	$settings = openstation_get_os_settings( $user_id );
	if ( ! is_array( $settings ) ) {
		$settings = openstation_default_os_settings();
	}
	if ( ! is_array( $settings ) ) {
		return;
	}
	if ( empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
		$settings['itemVisibility'] = array();
	}
	if ( ! array_key_exists( 'odd', $settings['itemVisibility'] ) ) {
		$settings['itemVisibility']['odd'] = 'desktop';
		openstation_save_os_settings( $user_id, $settings );
	}
}

/**
 * Show a native warning when the verified remote catalog is unavailable.
 */
function oddout_register_shop_window_notice() {
	if ( ! current_user_can( 'manage_options' ) || ! oddout_openstation_supports( 'window_notices' ) || ! function_exists( 'oddout_catalog_meta' ) ) {
		return;
	}
	$meta = oddout_catalog_meta();
	if ( empty( $meta['last_error_message'] ) && empty( $meta['last_error_code'] ) ) {
		return;
	}

	openstation_register_window_notice(
		array(
			'id'      => 'odd/catalog-health',
			'tone'    => 'warning',
			'icon'    => 'dashicons-warning',
			'order'   => 35,
			'message' => __( 'ODD is using its saved app catalog because the newest catalog could not be verified.', 'odd-outlandish-desktop-decorator' ),
			'match'   => array( 'window' => 'odd' ),
		)
	);
}

/**
 * Visible template before the Shop app mounts.
 */
function oddout_render_panel_template() {
	?>
	<div class="odd-shop" data-odd-shop>
		<div class="odd-shop__loading">
			<span class="dashicons dashicons-update" aria-hidden="true"></span>
			<?php esc_html_e( 'Opening ODD Shop…', 'odd-outlandish-desktop-decorator' ); ?>
		</div>
	</div>
	<?php
}

/**
 * ODD brand icon used by OpenStation.
 *
 * @return string
 */
function oddout_control_icon_url() {
	return oddout_url_current_scheme( ODDOUT_URL . 'assets/odd-eye.svg' );
}
