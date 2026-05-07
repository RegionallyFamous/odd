<?php
/**
 * @coversNothing
 */
class ODD_Desktop_Mode_Extended_Surfaces_Test extends WP_UnitTestCase {

	public function test_recycle_hint_injects_into_body_anchor() {
		$html_in = '<div class="desktop-mode-recycle-bin"><div class="desktop-mode-recycle-bin__toolbar"></div><div class="desktop-mode-recycle-bin__body" data-desktop-mode-recycle-bin-body></div></div>';
		$html    = apply_filters( 'desktop_mode_recycle_bin_template_html', $html_in );

		$this->assertTrue( strpos( $html, 'desktop-mode-recycle-bin__odd-hint' ) !== false, 'Recycle hint markup present.' );
		$this->assertTrue( strpos( $html, 'odd-js-open-shop' ) !== false, 'Shop bridge class present.' );
	}

	public function test_my_wordpress_hint_injects_into_body_anchor() {
		$html_in = '<div><header data-desktop-mode-my-wordpress-breadcrumbs></header><div class="desktop-mode-my-wordpress__body" data-desktop-mode-my-wordpress-body></div></div>';
		$html    = apply_filters( 'desktop_mode_my_wordpress_template_html', $html_in );

		$this->assertTrue( strpos( $html, 'desktop-mode-my-wordpress__odd-hint' ) !== false );
	}

	public function test_dm_tokens_helper_returns_odd_keys_only() {
		$tokens = odd_dm_extended_window_theme_tokens();

		foreach ( array_keys( $tokens ) as $var ) {
			$this->assertStringStartsWith( '--', $var );
		}
	}
}
