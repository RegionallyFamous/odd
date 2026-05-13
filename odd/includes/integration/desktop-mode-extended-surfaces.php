<?php
/**
 * ODD × WP Desktop Mode 0.8+ — wallpapers, explorer, recycle, chrome.
 *
 * Optional surfaces gated by capability checks so ODD stays loadable against
 * older Desktop Mode drops that omit an API subset.
 */

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string,string>
 */
function oddout_dm_extended_window_theme_tokens() {
	return array(
		'--desktop-mode-window-bg'     => '#fbfbfd',
		'--desktop-mode-window-border' => 'rgba(106, 92, 255, 0.22)',
		'--desktop-mode-text'          => '#1d1d1f',
		'--desktop-mode-muted'         => '#6e6e73',
		'--desktop-mode-border'        => 'rgba(60, 60, 67, 0.18)',
		'--desktop-mode-accent'        => '#5856d6',
	);
}

add_action(
	'init',
	static function () {
		if ( ! function_exists( 'oddout_desktop_mode_supports' ) || ! oddout_desktop_mode_supports( 'window_chrome' ) ) {
			return;
		}
		if ( ! function_exists( 'desktop_mode_register_window_theme' ) ) {
			return;
		}
		desktop_mode_register_window_theme(
			array(
				'id'       => 'odd/shop-chrome',
				'label'    => __( 'ODD Shop', 'odd-outlandish-desktop-decorator' ),
				'priority' => 80,
				'tokens'   => oddout_dm_extended_window_theme_tokens(),
			)
		);
	},
	36
);

add_filter(
	'desktop_mode_recycle_bin_template_html',
	static function ( $html ) {
		$html = (string) $html;
		$tip  = sprintf(
			'<p class="desktop-mode-recycle-bin__odd-hint odd-dm-crosslink-hint">%s</p>',
			wp_kses_post(
				sprintf(
					/* translators: %s: branded product name. */
					__( 'Removed <strong>%s</strong> catalog wallpaper, icons, or apps? Re-install them anytime from <a href="#" class="odd-js-open-shop">Open ODD Shop</a>. Bin entries here remain WordPress content (posts, media, comments…).', 'odd-outlandish-desktop-decorator' ),
					'ODD'
				)
			)
		);
		$needle = '<div class="desktop-mode-recycle-bin__body"';
		$pos    = strpos( $html, $needle );
		if ( false !== $pos ) {
			return substr_replace( $html, $tip . "\n\t\t", $pos, 0 );
		}
		return $html . $tip;
	},
	15
);

add_filter(
	'desktop_mode_my_wordpress_template_html',
	static function ( $html ) {
		$html = (string) $html;
		$tip  = sprintf(
			'<div class="desktop-mode-my-wordpress__odd-hint odd-dm-crosslink-hint">%s</div>',
			wp_kses_post(
				sprintf(
					/* translators: %s: branded product name. */
					__( 'Browse catalogs and installers in <strong>%s Shop</strong> — <a href="#" class="odd-js-open-shop">open the shop window</a> while you work.', 'odd-outlandish-desktop-decorator' ),
					'ODD'
				)
			)
		);
		$needle = '<div class="desktop-mode-my-wordpress__body"';
		$pos    = strpos( $html, $needle );
		if ( false !== $pos ) {
			return substr_replace( $html, $tip . "\n\t\t", $pos, 0 );
		}
		return $html . $tip;
	},
	15
);
