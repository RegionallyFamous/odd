<?php
/**
 * Register installed ODD apps as native OpenStation windows and launchers.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'oddout_apps_register_enabled_surfaces', 40 );
add_filter( 'openstation_native_window_allowed_html', 'oddout_apps_allow_iframe_template_html' );

/**
 * Preserve the sandboxed app frame when OpenStation escapes native templates.
 *
 * OpenStation intentionally omits iframes from its default KSES allowlist.
 * ODD's browser apps use a narrowly configured iframe as their native-window
 * body, so the host template needs this explicit, attribute-level opt-in.
 *
 * @param array $allowed OpenStation's wp_kses-shaped allowlist.
 * @return array
 */
function oddout_apps_allow_iframe_template_html( $allowed ) {
	if ( ! is_array( $allowed ) ) {
		$allowed = array();
	}
	$allowed['iframe'] = array_merge(
		isset( $allowed['iframe'] ) && is_array( $allowed['iframe'] ) ? $allowed['iframe'] : array(),
		array(
			'class'          => true,
			'title'          => true,
			'src'            => true,
			'sandbox'        => true,
			'loading'        => true,
			'referrerpolicy' => true,
			'allow'          => true,
			'style'          => true,
		)
	);
	return $allowed;
}

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
 * Native apps declare bundle-owned assets in manifest.native. Browser apps
 * use the sandboxed iframe template.
 *
 * @param array $row Installed app index row.
 */
function oddout_apps_register_surfaces( $row ) {
	$slug = isset( $row['slug'] ) ? sanitize_key( (string) $row['slug'] ) : '';
	if ( '' === $slug || ! oddout_openstation_available() ) {
		return;
	}

	$manifest = oddout_apps_manifest_load( $slug );
	if ( empty( $manifest ) ) {
		return;
	}
	$window_id = 'odd-app-' . $slug;
	$name      = isset( $row['name'] ) ? sanitize_text_field( (string) $row['name'] ) : $slug;
	$icon_url  = oddout_apps_icon_url( $slug, $manifest );
	$script    = '';
	$style     = '';
	$template  = static function () use ( $slug, $manifest ) {
		oddout_apps_render_window_template( $slug, $manifest );
	};
	$config    = array();

	if ( ! empty( $manifest['native']['script'] ) ) {
		if ( 'odd-notes' !== $slug || ! function_exists( 'oddout_notes_render_template' ) ) {
			return;
		}
		$script   = 'odd-app-' . $slug;
		$template = 'oddout_notes_render_template';
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

		$config = oddout_notes_window_config();
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
		$geometry = array(
			'width'      => array(
				'manifest_key' => 'width',
				'min'          => 320,
				'max'          => 1600,
			),
			'height'     => array(
				'manifest_key' => 'height',
				'min'          => 240,
				'max'          => 1200,
			),
			'min_width'  => array(
				'manifest_key' => 'minWidth',
				'min'          => 240,
				'max'          => 1600,
			),
			'min_height' => array(
				'manifest_key' => 'minHeight',
				'min'          => 180,
				'max'          => 1200,
			),
		);
		foreach ( $geometry as $window_key => $limits ) {
			$manifest_key = $limits['manifest_key'];
			$value        = isset( $manifest['window'][ $manifest_key ] )
				? $manifest['window'][ $manifest_key ]
				: ( isset( $manifest['window'][ $window_key ] ) ? $manifest['window'][ $window_key ] : null );
			if ( is_numeric( $value ) ) {
				$window[ $window_key ] = max( $limits['min'], min( $limits['max'], (int) $value ) );
			}
		}
		if ( ! empty( $manifest['window']['title'] ) ) {
			$window['title'] = sanitize_text_field( (string) $manifest['window']['title'] );
		}
		if ( isset( $manifest['window']['resizable'] ) && is_bool( $manifest['window']['resizable'] ) ) {
			$window['resizable'] = $manifest['window']['resizable'];
		}
	}

	openstation_register_window( $window_id, $window );
	openstation_register_icon(
		$window_id,
		array(
			'title'        => $name,
			'icon'         => $icon_url,
			'window'       => $window_id,
			'position'     => isset( $manifest['desktopIcon']['position'] ) ? max( 0, min( 10000, (int) $manifest['desktopIcon']['position'] ) ) : 200,
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
	<div class="odd-app-host" data-odd-app data-odd-app-slug="<?php echo esc_attr( $slug ); ?>" data-odd-app-src="<?php echo esc_url( $serve_url ); ?>" style="position:relative;width:100%;height:100%;min-height:0;background:#101014;">
		<iframe
			class="odd-app-frame"
			title="<?php echo esc_attr( $name ); ?>"
			src="<?php echo esc_url( $serve_url ); ?>"
			sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads"
			loading="eager"
			referrerpolicy="no-referrer"
			allow="clipboard-read; clipboard-write"
			style="display:block;width:100%;height:100%;border:0;background:#101014;"
		></iframe>
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
	if ( '' !== $icon && function_exists( 'oddout_apps_icon_file_path' ) && '' !== oddout_apps_icon_file_path( $slug, $manifest ) ) {
		return oddout_https_rest_url( 'odd/v1/apps/icon/' . sanitize_key( $slug ) );
	}
	return 'dashicons-admin-generic';
}
