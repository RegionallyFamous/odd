<?php
/**
 * ODD — accent-color presets for WP Desktop Mode's OS Settings.
 *
 * Adds one swatch per installed icon set via the `desktop_mode_accent_colors`
 * filter. Each swatch uses the set's declared `accent` hex so picking
 * "Filament" in the icon picker and "Filament" in the accent picker
 * keeps the chrome coherent.
 *
 * IDs are namespaced `odd-<slug>` so they never collide with WP
 * Desktop Mode's built-in swatches.
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'desktop_mode_accent_colors',
	function ( $colors ) {
		if ( ! is_array( $colors ) ) {
			$colors = array();
		}
		if ( ! function_exists( 'oddout_icons_get_sets' ) ) {
			return $colors;
		}

		foreach ( oddout_icons_get_sets() as $set ) {
			$accent = isset( $set['accent'] ) ? $set['accent'] : '';
			$slug   = isset( $set['slug'] ) ? $set['slug'] : '';
			$label  = isset( $set['label'] ) ? $set['label'] : '';
			if ( ! $slug || ! $accent ) {
				continue;
			}
			if ( ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $accent ) ) {
				continue;
			}

			$colors[] = array(
				'id'    => 'odd-' . $slug,
				'label' => sprintf( /* translators: %s: icon set label. */ __( 'ODD · %s', 'odd-outlandish-desktop-decorator' ), $label ? $label : $slug ),
				'value' => $accent,
			);
		}

		return $colors;
	}
);
