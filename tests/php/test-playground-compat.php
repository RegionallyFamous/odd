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
}
