<?php
/**
 * ODD cursors — active set stylesheet endpoint.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'odd/v1',
			'/cursors/active\.css',
			array(
				'methods'             => 'GET',
				'callback'            => 'oddout_cursors_rest_active_css',
				'args'                => array(
					'set' => array(
						'description'       => __( 'Optional cursor set slug to preview.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'string',
						'required'          => false,
						'pattern'           => '^[a-z0-9-]+$',
						'sanitize_callback' => 'sanitize_key',
						'validate_callback' => static function ( $value ) {
							return null === $value || '' === $value || ( is_string( $value ) && (bool) preg_match( '/^[a-z0-9-]+$/', $value ) );
						},
					),
				),
				'permission_callback' => '__return_true',
			)
		);
		// Public cursor-effect asset endpoint for installed preview art.
		register_rest_route(
			'odd/v1',
			'/cursors/asset/(?P<slug>[a-z0-9-]+)',
			array(
				'methods'             => 'GET',
				'callback'            => 'oddout_cursors_rest_asset',
				'args'                => array(
					'slug' => array(
						'description'       => __( 'Cursor set slug.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'string',
						'pattern'           => '^[a-z0-9-]+$',
						'sanitize_callback' => 'sanitize_key',
						'validate_callback' => static function ( $value ) {
							return is_string( $value ) && (bool) preg_match( '/^[a-z0-9-]+$/', $value );
						},
					),
					'file' => array(
						'description'       => __( 'SVG cursor file path relative to the cursor set root.', 'odd-outlandish-desktop-decorator' ),
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => static function ( $value ) {
							return is_string( $value ) ? ltrim( $value, '/' ) : '';
						},
						'validate_callback' => 'oddout_cursors_rest_asset_file_is_valid',
					),
				),
				'permission_callback' => '__return_true',
			)
		);
	}
);

function oddout_cursors_rest_asset_file_is_valid( $value ) {
	if ( ! is_string( $value ) ) {
		return false;
	}
	$value = ltrim( $value, '/' );
	if (
		'' === $value ||
		strlen( $value ) > 256 ||
		false !== strpos( $value, '..' ) ||
		false !== strpos( $value, '\\' ) ||
		false !== strpos( $value, "\0" )
	) {
		return false;
	}
	return (bool) preg_match( '#^[a-zA-Z0-9._/-]+\.svg$#', $value );
}

function oddout_cursors_css_url_value( array $cursor, $fallback ) {
	$url     = isset( $cursor['url'] ) ? esc_url_raw( (string) $cursor['url'] ) : '';
	$hotspot = isset( $cursor['hotspot'] ) && is_array( $cursor['hotspot'] ) ? array_values( $cursor['hotspot'] ) : array( 0, 0 );
	$x       = isset( $hotspot[0] ) ? (int) $hotspot[0] : 0;
	$y       = isset( $hotspot[1] ) ? (int) $hotspot[1] : 0;
	if ( '' === $url ) {
		return $fallback;
	}
	$url = function_exists( 'oddout_cursors_url_current_scheme' ) ? oddout_cursors_url_current_scheme( $url ) : $url;
	return sprintf( 'url("%s") %d %d, %s', esc_url_raw( $url ), $x, $y, $fallback );
}

function oddout_cursors_css_cursor( array $set, $kind, $fallback ) {
	$cursors = isset( $set['cursors'] ) && is_array( $set['cursors'] ) ? $set['cursors'] : array();
	if ( isset( $cursors[ $kind ] ) && is_array( $cursors[ $kind ] ) ) {
		return oddout_cursors_css_url_value( $cursors[ $kind ], $fallback );
	}
	if ( 'default' !== $kind && isset( $cursors['default'] ) && is_array( $cursors['default'] ) ) {
		return oddout_cursors_css_url_value( $cursors['default'], $fallback );
	}
	return $fallback;
}

function oddout_cursors_scope_selector_list( $selectors ) {
	$selectors = array_filter( array_map( 'trim', explode( ',', (string) $selectors ) ) );
	$scopes    = array( 'body.desktop-mode-active', '[data-odd-cursor-root]' );
	$out       = array();
	foreach ( $scopes as $scope ) {
		foreach ( $selectors as $selector ) {
			$out[] = $scope . ' ' . $selector;
			if ( 0 === strpos( $selector, 'body.' ) || 0 === strpos( $selector, 'body[' ) ) {
				$out[] = ( 'body.desktop-mode-active' === $scope ? 'body.desktop-mode-active' : '[data-odd-cursor-root]' ) . substr( $selector, 4 );
			}
		}
	}
	return implode( ', ', array_values( array_unique( $out ) ) );
}

function oddout_cursors_effect_tokens( array $set ) {
	$effects   = isset( $set['effects'] ) && is_array( $set['effects'] ) ? $set['effects'] : array();
	$accent    = isset( $effects['accent'] ) ? (string) $effects['accent'] : ( isset( $set['accent'] ) ? (string) $set['accent'] : '' );
	$recipe    = isset( $effects['recipe'] ) ? sanitize_key( (string) $effects['recipe'] ) : '';
	$recipes   = function_exists( 'oddout_cursors_allowed_recipes' ) ? oddout_cursors_allowed_recipes() : array( 'signal-bloom', 'gel-pop', 'paper-sparks', 'solar-orbit', 'moonlight-focus' );
	$out       = array(
		'accent' => '' !== $accent ? $accent : '#42d9d2',
		'spark'  => isset( $effects['spark'] ) ? (string) $effects['spark'] : '#ff4f8b',
		'warm'   => isset( $effects['warm'] ) ? (string) $effects['warm'] : '#f6b73c',
		'ink'    => isset( $effects['ink'] ) ? (string) $effects['ink'] : '#19091f',
		'recipe' => in_array( $recipe, $recipes, true ) ? $recipe : 'default',
	);
	$fallbacks = array(
		'accent' => '#42d9d2',
		'spark'  => '#ff4f8b',
		'warm'   => '#f6b73c',
		'ink'    => '#19091f',
	);
	foreach ( $out as $key => $value ) {
		if ( 'recipe' === $key ) {
			continue;
		}
		if ( ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $value ) ) {
			$out[ $key ] = $fallbacks[ $key ];
		}
	}
	return $out;
}

function oddout_cursors_build_css( array $set ) {
	$effects      = oddout_cursors_effect_tokens( $set );
	$default      = oddout_cursors_css_cursor( $set, 'default', 'default' );
	$pointer      = oddout_cursors_css_cursor( $set, 'pointer', 'pointer' );
	$text         = oddout_cursors_css_cursor( $set, 'text', 'text' );
	$grab         = oddout_cursors_css_cursor( $set, 'grab', 'grab' );
	$grabbing     = oddout_cursors_css_cursor( $set, 'grabbing', 'grabbing' );
	$crosshair    = oddout_cursors_css_cursor( $set, 'crosshair', 'crosshair' );
	$not_allowed  = oddout_cursors_css_cursor( $set, 'not-allowed', 'not-allowed' );
	$wait         = oddout_cursors_css_cursor( $set, 'wait', 'wait' );
	$help         = oddout_cursors_css_cursor( $set, 'help', 'help' );
	$progress     = oddout_cursors_css_cursor( $set, 'progress', 'progress' );
	$roots        = '.desktop-mode, .desktop-mode-shell, #desktop-mode-shell, .desktop-mode-shell__body, #desktop-mode-area, .desktop-mode-area, .desktop-mode-icons, #desktop-mode-wallpaper, .desktop-mode-wallpaper, #desktop-mode-side-dock, .desktop-mode-dock, .desktop-mode-widgets, .desktop-mode-widgets__list, #wp-desktop-shell, .wp-desktop-shell, .wp-desktop-shell__body, #wp-desktop-area, .wp-desktop-area, #wp-desktop-wallpaper, .wp-desktop-wallpaper, #wp-desktop-dock, .wp-desktop-dock, #wp-desktop-widgets, .wp-desktop-widgets, .wp-desktop-widgets__list';
	$windows      = '[data-window-id], [data-windowid], [data-desktop-window-id], [data-native-window-id], .desktop-mode-window, .desktop-mode-window__body, .desktop-mode-window__iframe, .desktop-window, .wp-desktop-window, .wp-desktop-window__body, .wp-desktop-window__iframe';
	$pointers     = 'a, button, .button, .button-primary, .button-secondary, [role="button"], summary, label[for], input[type="button"], input[type="submit"], input[type="reset"], select, option, .ab-item, .components-button, wpd-button, wpd-notice, wpd-tile, wpd-ribbon, wpd-progress-bar, wpd-context-menu-item, wpd-context-menu-option, wpd-menu-item, [data-desktop-mode-drop-target], .desktop-mode-drop-overlay, .desktop-mode-drop-zone, .desktop-mode-icon, .desktop-mode-file-tile, .desktop-mode-dock__item, .desktop-mode-dock__button, .desktop-mode-window__btn, .desktop-mode-window__tab, .desktop-mode-window__control, .desktop-mode-widgets__card-redock, .desktop-mode-widgets__card-close, .desktop-mode-widgets__add, .wp-desktop-icon, .wp-desktop-dock__item, .wp-desktop-dock__item-primary, .wp-desktop-dock__item-new, .wp-desktop-window__btn, .wp-desktop-window__tab, .wp-desktop-window__meta-btn, .wp-desktop-window__menu-btn, .wp-desktop-window__menu-item, .wp-desktop-widgets__card-redock, .wp-desktop-widgets__card-close, .wp-desktop-widgets__add';
	$pointer_deep = 'body.desktop-mode-active .desktop-mode-icon *, body.desktop-mode-active .desktop-mode-file-tile *, body.desktop-mode-active .desktop-mode-dock__item *, body.desktop-mode-active .desktop-mode-dock__button *, body.desktop-mode-active .desktop-mode-window__btn *, body.desktop-mode-active .desktop-mode-window__tab *, body.desktop-mode-active .desktop-mode-window__control *, body.desktop-mode-active .wp-desktop-icon *, body.desktop-mode-active .wp-desktop-dock__item *, body.desktop-mode-active .wp-desktop-dock__item-primary *, body.desktop-mode-active .wp-desktop-dock__item-new *, body.desktop-mode-active .wp-desktop-window__btn *, body.desktop-mode-active .wp-desktop-window__tab *, body.desktop-mode-active .wp-desktop-window__meta-btn *, body.desktop-mode-active .wp-desktop-window__menu-btn *, body.desktop-mode-active .wp-desktop-window__menu-item *';
	$grab_targets = '[draggable="true"], [data-drag], [data-drag-handle], .ui-sortable-handle, .components-draggable, .desktop-mode-window__titlebar, .desktop-mode-window__resize-handle, .desktop-mode-widgets__chrome, .desktop-mode-widgets__grip, .desktop-mode-widgets__resize, .wp-desktop-window__titlebar, .wp-desktop-window__resize-handle, .wp-desktop-widgets__chrome, .wp-desktop-widgets__grip, .wp-desktop-widgets__resize';
	$text_targets = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"], [contenteditable=""], .CodeMirror, .components-text-control__input, .components-textarea-control__input, .block-editor-rich-text__editable, .editor-post-title__input';
	$disabled     = ':disabled, [disabled], [aria-disabled="true"], .disabled, .is-disabled, .components-disabled, .odd-is-disabled';
	$busy         = 'body.is-busy, body.odd-is-busy, .is-busy, .updating-message, .spinner.is-active, .components-spinner, [aria-busy="true"]';
	$waiting      = 'body.odd-is-waiting, .odd-is-waiting, .waiting';
	$help_targets = '[data-cursor="help"], abbr[title], .help, .dashicons-editor-help, .components-guide, .components-tooltip, [aria-describedby]';

	return implode(
		"\n",
		array(
			'/* ODD cursor effects: ' . ( isset( $set['slug'] ) ? sanitize_key( (string) $set['slug'] ) : 'active' ) . ' */',
			':root {',
			'	--odd-cursor-default: ' . $default . ';',
			'	--odd-cursor-pointer: ' . $pointer . ';',
			'	--odd-cursor-text: ' . $text . ';',
			'	--odd-cursor-grab: ' . $grab . ';',
			'	--odd-cursor-grabbing: ' . $grabbing . ';',
			'	--odd-cursor-crosshair: ' . $crosshair . ';',
			'	--odd-cursor-not-allowed: ' . $not_allowed . ';',
			'	--odd-cursor-wait: ' . $wait . ';',
			'	--odd-cursor-help: ' . $help . ';',
			'	--odd-cursor-progress: ' . $progress . ';',
			'	--odd-live-cursor-accent: ' . $effects['accent'] . ';',
			'	--odd-live-cursor-spark: ' . $effects['spark'] . ';',
			'	--odd-live-cursor-warm: ' . $effects['warm'] . ';',
			'	--odd-live-cursor-ink: ' . $effects['ink'] . ';',
			'	--odd-live-cursor-recipe: ' . $effects['recipe'] . ';',
			'}',
			'[data-odd-cursor-root], ' . oddout_cursors_scope_selector_list( $roots ) . ' { cursor: default !important; }',
			oddout_cursors_scope_selector_list( $windows ) . ' { cursor: default !important; }',
			'[data-odd-cursor-root][data-odd-cursor="default"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="default"]' ) . ' { cursor: default !important; }',
			'[data-odd-cursor-root][data-odd-cursor="pointer"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="pointer"]' ) . ' { cursor: pointer !important; }',
			'[data-odd-cursor-root][data-odd-cursor="text"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="text"]' ) . ' { cursor: text !important; }',
			'[data-odd-cursor-root][data-odd-cursor="grab"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="grab"]' ) . ' { cursor: grab !important; }',
			'[data-odd-cursor-root][data-odd-cursor="grabbing"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="grabbing"]' ) . ' { cursor: grabbing !important; }',
			'[data-odd-cursor-root][data-odd-cursor="crosshair"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="crosshair"]' ) . ' { cursor: crosshair !important; }',
			'[data-odd-cursor-root][data-odd-cursor="not-allowed"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="not-allowed"]' ) . ' { cursor: not-allowed !important; }',
			'[data-odd-cursor-root][data-odd-cursor="wait"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="wait"]' ) . ' { cursor: wait !important; }',
			'[data-odd-cursor-root][data-odd-cursor="progress"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="progress"]' ) . ' { cursor: progress !important; }',
			'[data-odd-cursor-root][data-odd-cursor="help"], ' . oddout_cursors_scope_selector_list( '[data-odd-cursor="help"]' ) . ' { cursor: help !important; }',
			oddout_cursors_scope_selector_list( $pointers ) . ' { cursor: pointer !important; }',
			$pointer_deep . ' { cursor: pointer !important; }',
			oddout_cursors_scope_selector_list( $text_targets ) . ' { cursor: text !important; }',
			oddout_cursors_scope_selector_list( $grab_targets ) . ' { cursor: grab !important; }',
			oddout_cursors_scope_selector_list( 'body.is-dragging, body.odd-is-dragging, body.desktop-mode-is-dragging, .is-dragging, .dragging, [aria-grabbed="true"], .desktop-mode-window--dragging, .desktop-mode-window--resizing, .desktop-mode-window--snap-drag, .wp-desktop-window--dragging, .wp-desktop-window--resizing, .wp-desktop-window--snap-drag' ) . ' { cursor: grabbing !important; }',
			oddout_cursors_scope_selector_list( $disabled ) . ' { cursor: not-allowed !important; }',
			oddout_cursors_scope_selector_list( $busy ) . ' { cursor: progress !important; }',
			oddout_cursors_scope_selector_list( $waiting ) . ' { cursor: wait !important; }',
			oddout_cursors_scope_selector_list( $help_targets ) . ' { cursor: help !important; }',
			'',
		)
	);
}

function oddout_cursors_rest_active_css( WP_REST_Request $request ) {
	$slug = $request->get_param( 'set' );
	$slug = is_string( $slug ) ? sanitize_key( $slug ) : oddout_cursors_get_active_slug();
	$set  = '' === $slug ? null : oddout_cursors_get_set( $slug );
	$css  = $set ? oddout_cursors_build_css( $set ) : '';
	$etag = '"' . md5( ( defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0' ) . '|' . $slug . '|' . $css ) . '"';

	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}

	header( 'Content-Type: text/css; charset=UTF-8' );
	header( 'Cache-Control: private, max-age=300, must-revalidate' );
	header( 'ETag: ' . $etag );
	header( 'X-Content-Type-Options: nosniff' );
	$if_none_match = isset( $_SERVER['HTTP_IF_NONE_MATCH'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_IF_NONE_MATCH'] ) ) : '';
	if ( trim( $if_none_match ) === $etag ) {
		status_header( 304 );
		exit;
	}
	oddout_emit_raw_response( $css );
	exit;
}

function oddout_cursors_rest_asset( WP_REST_Request $request ) {
	$slug = sanitize_key( (string) $request->get_param( 'slug' ) );
	$file = (string) $request->get_param( 'file' );
	$path = function_exists( 'oddout_cursorsets_asset_path' ) ? oddout_cursorsets_asset_path( $slug, $file ) : '';
	if ( '' === $path || ! is_readable( $path ) ) {
		return new WP_Error(
			'cursor_asset_not_found',
			__( 'Cursor asset not found.', 'odd-outlandish-desktop-decorator' ),
			array( 'status' => 404 )
		);
	}
	$body = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $body ) {
		return new WP_Error(
			'cursor_asset_unreadable',
			__( 'Cursor asset could not be read.', 'odd-outlandish-desktop-decorator' ),
			array( 'status' => 404 )
		);
	}

	while ( ob_get_level() > 0 ) {
		@ob_end_clean();
	}

	header( 'Content-Type: image/svg+xml; charset=UTF-8' );
	header( 'Cache-Control: public, max-age=86400' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Referrer-Policy: no-referrer' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	oddout_emit_raw_response( $body );
	exit;
}
