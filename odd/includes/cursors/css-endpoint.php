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
				'permission_callback' => '__return_true',
			)
		);
		// Public cursor SVG endpoint. CSS cursor images load without
		// REST nonce headers, and the callback only serves sanitized
		// SVG files from an installed cursor set directory.
		register_rest_route(
			'odd/v1',
			'/cursors/asset/(?P<slug>[a-z0-9-]+)',
			array(
				'methods'             => 'GET',
				'callback'            => 'oddout_cursors_rest_asset',
				'permission_callback' => '__return_true',
			)
		);
	}
);

function oddout_cursors_css_url_value( array $cursor, $fallback ) {
	$url     = isset( $cursor['url'] ) ? esc_url_raw( (string) $cursor['url'] ) : '';
	$hotspot = isset( $cursor['hotspot'] ) && is_array( $cursor['hotspot'] ) ? array_values( $cursor['hotspot'] ) : array( 0, 0 );
	$x       = isset( $hotspot[0] ) ? (int) $hotspot[0] : 0;
	$y       = isset( $hotspot[1] ) ? (int) $hotspot[1] : 0;
	if ( '' === $url ) {
		return $fallback;
	}
	$url = oddout_cursors_url_current_scheme( $url );
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

function oddout_cursors_build_css( array $set ) {
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
	$roots        = 'html, body, #wpwrap, #wpcontent, #wpbody, #wpbody-content, .desktop-mode, .desktop-mode-shell, #desktop-mode-shell, .desktop-mode-shell__body, #desktop-mode-area, .desktop-mode-area, .desktop-mode-icons, #desktop-mode-wallpaper, .desktop-mode-wallpaper, #desktop-mode-side-dock, .desktop-mode-dock, .desktop-mode-widgets, .desktop-mode-widgets__list, #wp-desktop-shell, .wp-desktop-shell, .wp-desktop-shell__body, #wp-desktop-area, .wp-desktop-area, #wp-desktop-wallpaper, .wp-desktop-wallpaper, #wp-desktop-dock, .wp-desktop-dock, #wp-desktop-widgets, .wp-desktop-widgets, .wp-desktop-widgets__list, [data-odd-cursor-root]';
	$windows      = '[data-window-id], [data-windowid], [data-desktop-window-id], [data-native-window-id], .desktop-mode-window, .desktop-mode-window__body, .desktop-mode-window__iframe, .desktop-window, .wp-desktop-window, .wp-desktop-window__body, .wp-desktop-window__iframe';
	$pointers     = 'a, button, .button, .button-primary, .button-secondary, [role="button"], summary, label[for], input[type="button"], input[type="submit"], input[type="reset"], select, option, .ab-item, .components-button, .desktop-mode-icon, .desktop-mode-file-tile, .desktop-mode-dock__item, .desktop-mode-dock__button, .desktop-mode-window__btn, .desktop-mode-window__tab, .desktop-mode-window__control, .desktop-mode-widgets__card-redock, .desktop-mode-widgets__card-close, .desktop-mode-widgets__add, .wp-desktop-icon, .wp-desktop-dock__item, .wp-desktop-dock__item-primary, .wp-desktop-dock__item-new, .wp-desktop-window__btn, .wp-desktop-window__tab, .wp-desktop-window__meta-btn, .wp-desktop-window__menu-btn, .wp-desktop-window__menu-item, .wp-desktop-widgets__card-redock, .wp-desktop-widgets__card-close, .wp-desktop-widgets__add';
	$grab_targets = '[draggable="true"], [data-drag], [data-drag-handle], .ui-sortable-handle, .components-draggable, .desktop-mode-window__titlebar, .desktop-mode-window__resize-handle, .desktop-mode-widgets__chrome, .desktop-mode-widgets__grip, .desktop-mode-widgets__resize, .wp-desktop-window__titlebar, .wp-desktop-window__resize-handle, .wp-desktop-widgets__chrome, .wp-desktop-widgets__grip, .wp-desktop-widgets__resize';

	return implode(
		"\n",
		array(
			'/* ODD custom cursors: ' . ( isset( $set['slug'] ) ? sanitize_key( (string) $set['slug'] ) : 'active' ) . ' */',
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
			'}',
			$roots . ' { cursor: var(--odd-cursor-default) !important; }',
			$windows . ' { cursor: var(--odd-cursor-default) !important; }',
			'body.desktop-mode-active [data-odd-cursor-root], body.desktop-mode-active #desktop-mode-shell, body.desktop-mode-active #desktop-mode-area, body.desktop-mode-active #wp-desktop-shell, body.desktop-mode-active #wp-desktop-area { cursor: var(--odd-cursor-default) !important; }',
			'[data-odd-cursor="default"], body.desktop-mode-active [data-odd-cursor="default"] { cursor: var(--odd-cursor-default) !important; }',
			'[data-odd-cursor="pointer"], body.desktop-mode-active [data-odd-cursor="pointer"] { cursor: var(--odd-cursor-pointer) !important; }',
			'[data-odd-cursor="text"], body.desktop-mode-active [data-odd-cursor="text"] { cursor: var(--odd-cursor-text) !important; }',
			'[data-odd-cursor="grab"], body.desktop-mode-active [data-odd-cursor="grab"] { cursor: var(--odd-cursor-grab) !important; }',
			'[data-odd-cursor="grabbing"], body.desktop-mode-active [data-odd-cursor="grabbing"] { cursor: var(--odd-cursor-grabbing) !important; }',
			'[data-odd-cursor="crosshair"], body.desktop-mode-active [data-odd-cursor="crosshair"] { cursor: var(--odd-cursor-crosshair) !important; }',
			'[data-odd-cursor="not-allowed"], body.desktop-mode-active [data-odd-cursor="not-allowed"] { cursor: var(--odd-cursor-not-allowed) !important; }',
			'[data-odd-cursor="wait"], body.desktop-mode-active [data-odd-cursor="wait"] { cursor: var(--odd-cursor-wait) !important; }',
			'[data-odd-cursor="progress"], body.desktop-mode-active [data-odd-cursor="progress"] { cursor: var(--odd-cursor-progress) !important; }',
			'[data-odd-cursor="help"], body.desktop-mode-active [data-odd-cursor="help"] { cursor: var(--odd-cursor-help) !important; }',
			$pointers . ' { cursor: var(--odd-cursor-pointer) !important; }',
			'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"], [contenteditable=""], .CodeMirror, .components-text-control__input, .components-textarea-control__input, .block-editor-rich-text__editable, .editor-post-title__input { cursor: var(--odd-cursor-text) !important; }',
			$grab_targets . ' { cursor: var(--odd-cursor-grab) !important; }',
			'body.is-dragging, body.odd-is-dragging, body.desktop-mode-is-dragging, .is-dragging, .dragging, [aria-grabbed="true"], .desktop-mode-window--dragging, .desktop-mode-window--resizing, .desktop-mode-window--snap-drag, .wp-desktop-window--dragging, .wp-desktop-window--resizing, .wp-desktop-window--snap-drag { cursor: var(--odd-cursor-grabbing) !important; }',
			':disabled, [disabled], [aria-disabled="true"], .disabled, .is-disabled, .components-disabled, .odd-is-disabled { cursor: var(--odd-cursor-not-allowed) !important; }',
			'body.is-busy, body.odd-is-busy, .is-busy, .updating-message, .spinner.is-active, .components-spinner, [aria-busy="true"] { cursor: var(--odd-cursor-progress) !important; }',
			'body.odd-is-waiting, .odd-is-waiting, .waiting { cursor: var(--odd-cursor-wait) !important; }',
			'[data-cursor="help"], abbr[title], .help, .dashicons-editor-help, .components-guide, .components-tooltip, [aria-describedby] { cursor: var(--odd-cursor-help) !important; }',
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
	oddout_emit_raw_response( $body );
	exit;
}
