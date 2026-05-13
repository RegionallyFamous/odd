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
	$default     = oddout_cursors_css_cursor( $set, 'default', 'default' );
	$pointer     = oddout_cursors_css_cursor( $set, 'pointer', 'pointer' );
	$text        = oddout_cursors_css_cursor( $set, 'text', 'text' );
	$grab        = oddout_cursors_css_cursor( $set, 'grab', 'grab' );
	$grabbing    = oddout_cursors_css_cursor( $set, 'grabbing', 'grabbing' );
	$crosshair   = oddout_cursors_css_cursor( $set, 'crosshair', 'crosshair' );
	$not_allowed = oddout_cursors_css_cursor( $set, 'not-allowed', 'not-allowed' );
	$wait        = oddout_cursors_css_cursor( $set, 'wait', 'wait' );
	$help        = oddout_cursors_css_cursor( $set, 'help', 'help' );
	$progress    = oddout_cursors_css_cursor( $set, 'progress', 'progress' );

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
			'html, body, #wpwrap, #wpcontent, #wpbody, #wpbody-content, .desktop-mode, .desktop-mode-shell, #desktop-mode-shell, [data-odd-cursor-root] { cursor: var(--odd-cursor-default); }',
			'[data-window-id], [data-windowid], [data-desktop-window-id], [data-native-window-id], .desktop-mode-window, .desktop-window { cursor: var(--odd-cursor-default); }',
			'[data-odd-cursor="default"] { cursor: var(--odd-cursor-default); }',
			'[data-odd-cursor="pointer"] { cursor: var(--odd-cursor-pointer); }',
			'[data-odd-cursor="text"] { cursor: var(--odd-cursor-text); }',
			'[data-odd-cursor="grab"] { cursor: var(--odd-cursor-grab); }',
			'[data-odd-cursor="grabbing"] { cursor: var(--odd-cursor-grabbing); }',
			'[data-odd-cursor="crosshair"] { cursor: var(--odd-cursor-crosshair); }',
			'[data-odd-cursor="not-allowed"] { cursor: var(--odd-cursor-not-allowed); }',
			'[data-odd-cursor="wait"] { cursor: var(--odd-cursor-wait); }',
			'[data-odd-cursor="progress"] { cursor: var(--odd-cursor-progress); }',
			'[data-odd-cursor="help"] { cursor: var(--odd-cursor-help); }',
			'a, button, .button, .button-primary, .button-secondary, [role="button"], summary, label[for], input[type="button"], input[type="submit"], input[type="reset"], select, option, .ab-item, .components-button { cursor: var(--odd-cursor-pointer); }',
			'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"], [contenteditable=""], .CodeMirror, .components-text-control__input, .components-textarea-control__input, .block-editor-rich-text__editable, .editor-post-title__input { cursor: var(--odd-cursor-text); }',
			'[draggable="true"], [data-drag], [data-drag-handle], .ui-sortable-handle, .components-draggable { cursor: var(--odd-cursor-grab); }',
			'body.is-dragging, body.odd-is-dragging, body.desktop-mode-is-dragging, .is-dragging, .dragging, [aria-grabbed="true"] { cursor: var(--odd-cursor-grabbing); }',
			':disabled, [disabled], [aria-disabled="true"], .disabled, .is-disabled, .components-disabled, .odd-is-disabled { cursor: var(--odd-cursor-not-allowed); }',
			'body.is-busy, body.odd-is-busy, .is-busy, .updating-message, .spinner.is-active, .components-spinner, [aria-busy="true"] { cursor: var(--odd-cursor-progress); }',
			'body.odd-is-waiting, .odd-is-waiting, .waiting { cursor: var(--odd-cursor-wait); }',
			'[data-cursor="help"], abbr[title], .help, .dashicons-editor-help, .components-guide, .components-tooltip, [aria-describedby] { cursor: var(--odd-cursor-help); }',
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
