<?php
/**
 * Register installed ODD apps as native OpenStation windows and launchers.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'oddout_apps_register_enabled_surfaces', 40 );

/**
 * Register every enabled app after both plugins have registered their assets.
 */
function oddout_apps_register_enabled_surfaces() {
	if ( ! ODDOUT_APPS_ENABLED || ! oddout_openstation_available() ) {
		return;
	}

	foreach ( oddout_apps_list() as $row ) {
		if ( ! empty( $row['enabled'] ) ) {
			oddout_apps_register_surfaces( $row );
		}
	}
}

/**
 * Register one installed app.
 *
 * Native catalog apps declare bundle-owned assets in manifest.native. Older
 * iframe apps retain the sandboxed host fallback.
 *
 * @param array $row Installed app index row.
 */
function oddout_apps_register_surfaces( $row ) {
	$slug = isset( $row['slug'] ) ? sanitize_key( (string) $row['slug'] ) : '';
	if ( 'odd-notes' !== $slug || ! oddout_openstation_available() ) {
		return;
	}

	$manifest = oddout_apps_manifest_load( $slug );
	if ( empty( $manifest['native']['script'] ) ) {
		return;
	}
	$window_id = 'odd-app-' . $slug;
	$name      = isset( $row['name'] ) ? sanitize_text_field( (string) $row['name'] ) : $slug;
	$icon_url  = oddout_apps_icon_url( $slug, $manifest );
	$script    = 'odd-app-' . $slug;
	$style     = '';
	$template  = 'oddout_notes_render_template';
	$config    = array();

	if ( ! empty( $manifest['native']['script'] ) ) {
		wp_register_script(
			$script,
			oddout_apps_asset_url( $slug, $manifest['native']['script'] ),
			array( 'openstation', 'wp-i18n' ),
			isset( $manifest['version'] ) ? (string) $manifest['version'] : ODDOUT_VERSION,
			true
		);

		if ( ! empty( $manifest['native']['style'] ) ) {
			$style = $script;
			wp_register_style(
				$style,
				oddout_apps_asset_url( $slug, $manifest['native']['style'] ),
				array( 'os-variables', 'dashicons' ),
				isset( $manifest['version'] ) ? (string) $manifest['version'] : ODDOUT_VERSION
			);
		}

		if ( function_exists( 'oddout_notes_render_template' ) ) {
			$config = oddout_notes_window_config();
		} else {
			return;
		}
	}

	$window = array(
		'title'        => $name,
		'icon'         => $icon_url,
		'script'       => $script,
		'template'     => $template,
		'width'        => 860,
		'height'       => 600,
		'min_width'    => 420,
		'min_height'   => 320,
		'placement'    => 'none',
		'capabilities' => array( oddout_apps_normalize_capability( isset( $row['capability'] ) ? $row['capability'] : '', $slug ) ),
		'config'       => $config,
	);
	if ( '' !== $style ) {
		$window['style'] = $style;
	}

	if ( isset( $manifest['window'] ) && is_array( $manifest['window'] ) ) {
		foreach ( array( 'width', 'height', 'min_width', 'min_height' ) as $key ) {
			if ( isset( $manifest['window'][ $key ] ) && is_numeric( $manifest['window'][ $key ] ) ) {
				$window[ $key ] = (int) $manifest['window'][ $key ];
			}
		}
		if ( ! empty( $manifest['window']['title'] ) ) {
			$window['title'] = sanitize_text_field( (string) $manifest['window']['title'] );
		}
	}

	openstation_register_window( $window_id, $window );
	openstation_register_icon(
		$window_id,
		array(
			'title'        => $name,
			'icon'         => $icon_url,
			'window'       => $window_id,
			'position'     => isset( $manifest['desktopIcon']['position'] ) ? (int) $manifest['desktopIcon']['position'] : 200,
			'capabilities' => $window['capabilities'],
		)
	);
}

/**
 * URL for an authenticated asset inside an installed app bundle.
 *
 * @param string $slug App slug.
 * @param string $path Relative asset path.
 * @return string
 */
function oddout_apps_asset_url( $slug, $path ) {
	return trailingslashit( oddout_apps_cookieauth_url_for( $slug ) ) . ltrim( (string) $path, '/' );
}

/**
 * Fallback template for sandboxed iframe apps.
 *
 * @param string $slug App slug.
 * @param array  $manifest App manifest.
 */
function oddout_apps_render_window_template( $slug, $manifest ) {
	$serve_url = add_query_arg( '_wpnonce', wp_create_nonce( 'wp_rest' ), oddout_apps_cookieauth_url_for( $slug ) );
	$name      = isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug;
	?>
	<div class="odd-app-host" data-odd-app data-odd-app-slug="<?php echo esc_attr( $slug ); ?>" data-odd-app-src="<?php echo esc_url( $serve_url ); ?>">
		<?php /* translators: %s: app name. */ ?>
		<p><?php printf( esc_html__( 'Loading %s…', 'odd-outlandish-desktop-decorator' ), esc_html( $name ) ); ?></p>
	</div>
	<?php
}

/**
 * Resolve an app icon for OpenStation.
 *
 * @param string $slug App slug.
 * @param array  $manifest App manifest.
 * @return string
 */
function oddout_apps_icon_url( $slug, $manifest ) {
	$icon = isset( $manifest['icon'] ) ? (string) $manifest['icon'] : '';
	if ( 0 === stripos( $icon, 'http://' ) || 0 === stripos( $icon, 'https://' ) ) {
		return esc_url( $icon, array( 'http', 'https' ) );
	}
	if ( '' !== $icon && function_exists( 'oddout_apps_icon_file_path' ) && '' !== oddout_apps_icon_file_path( $slug, $manifest ) ) {
		return oddout_https_rest_url( 'odd/v1/apps/icon/' . sanitize_key( $slug ) );
	}
	return 'dashicons-admin-generic';
}
