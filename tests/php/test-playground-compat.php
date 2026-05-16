<?php
/**
 * Playground hostname helper + compat wiring.
 */

class Test_ODD_Playground_Compat extends WP_UnitTestCase {

	public function test_odd_is_playground_host_positive_cases() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST'] = 'playground.wordpress.net';
			$this->assertTrue( oddout_is_playground_host() );

			$_SERVER['HTTP_HOST'] = 'scope-demo.playground.wordpress.net';
			$this->assertTrue( oddout_is_playground_host() );

			$_SERVER['HTTP_HOST'] = 'PLAYGROUND.WORDPRESS.NET';
			$this->assertTrue( oddout_is_playground_host() );

			$_SERVER['HTTP_HOST'] = 'playground.wordpress.net:8443';
			$this->assertTrue( oddout_is_playground_host() );
		} finally {
			$_SERVER = $server;
		}
	}

	public function test_odd_is_playground_host_negative_cases() {
		$server = $_SERVER;
		try {
			unset( $_SERVER['HTTP_HOST'] );
			$this->assertFalse( oddout_is_playground_host() );

			$_SERVER['HTTP_HOST'] = 'example.test';
			$this->assertFalse( oddout_is_playground_host() );

			$_SERVER['HTTP_HOST'] = 'not-playground.wordpress.net';
			$this->assertFalse( oddout_is_playground_host() );
		} finally {
			$_SERVER = $server;
		}
	}

	public function test_desktop_mode_shell_config_clears_pwa_urls_on_playground() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST'] = 'playground.wordpress.net';
			$config               = apply_filters(
				'desktop_mode_shell_config',
				array(
					'pwa' => array(
						'manifestUrl' => 'https://playground.example/desktop-mode/manifest.webmanifest',
						'swUrl'       => 'https://playground.example/desktop-mode/sw.js',
						'appName'     => 'Test Site',
					),
				)
			);

			$this->assertArrayHasKey( 'pwa', $config );
			$this->assertSame( '', $config['pwa']['manifestUrl'] );
			$this->assertSame( '', $config['pwa']['swUrl'] );
			$this->assertSame( 'Test Site', $config['pwa']['appName'] );
		} finally {
			$_SERVER = $server;
		}
	}

	public function test_desktop_mode_shell_config_does_not_clear_pwa_off_playground() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST'] = 'odd.example.test';
			$url_m                = 'https://odd.example.test/desktop-mode/manifest.webmanifest';
			$url_s                = 'https://odd.example.test/desktop-mode/sw.js';
			$config               = apply_filters(
				'desktop_mode_shell_config',
				array(
					'pwa' => array(
						'manifestUrl' => $url_m,
						'swUrl'       => $url_s,
					),
				)
			);

			$this->assertSame( $url_m, $config['pwa']['manifestUrl'] );
			$this->assertSame( $url_s, $config['pwa']['swUrl'] );
		} finally {
			$_SERVER = $server;
		}
	}

	public function test_playground_removes_dashboard_feed_widgets() {
		global $wp_meta_boxes;

		$server     = $_SERVER;
		$meta_boxes = $wp_meta_boxes;
		try {
			$_SERVER['HTTP_HOST'] = 'playground.wordpress.net';
			add_meta_box( 'dashboard_primary', 'News', '__return_empty_string', 'dashboard', 'side', 'core' );
			add_meta_box( 'dashboard_secondary', 'Planet', '__return_empty_string', 'dashboard', 'side', 'core' );

			do_action( 'wp_dashboard_setup' );

			$this->assertFalse( $wp_meta_boxes['dashboard']['side']['core']['dashboard_primary'] );
			$this->assertFalse( $wp_meta_boxes['dashboard']['side']['core']['dashboard_secondary'] );
		} finally {
			$_SERVER       = $server;
			$wp_meta_boxes = $meta_boxes;
		}
	}

	public function test_playground_adds_admin_bar_sandbox_navigation_override() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST'] = 'playground.wordpress.net';
			wp_register_script( 'desktop-mode-admin-bar', false, array(), 'test', true );

			oddout_playground_compat_admin_bar_navigation();

			$scripts = wp_scripts();
			$after   = isset( $scripts->registered['desktop-mode-admin-bar']->extra['after'] )
				? implode( "\n", $scripts->registered['desktop-mode-admin-bar']->extra['after'] )
				: '';

			$this->assertStringContainsString( 'data-odd-playground-toggle', $after );
			$this->assertStringContainsString( 'window.location.href = url', $after );
			$this->assertStringNotContainsString( 'window.top.location', $after );
		} finally {
			wp_deregister_script( 'desktop-mode-admin-bar' );
			$_SERVER = $server;
		}
	}
}
