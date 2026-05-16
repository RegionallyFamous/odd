<?php
/**
 * Tests for cursor-set registry, prefs, and CSS rendering.
 */

class Test_Cursors extends WP_UnitTestCase {
	/**
	 * @var string
	 */
	private $temp_upload_base = '';

	public function tear_down() {
		remove_all_filters( 'oddout_cursor_set_registry' );
		remove_all_filters( 'upload_dir' );
		delete_transient( oddout_cursors_registry_transient_key() );
		oddout_cursors_get_sets( true );
		if ( '' !== $this->temp_upload_base && is_dir( $this->temp_upload_base ) ) {
			$this->remove_dir( $this->temp_upload_base );
		}
		$this->temp_upload_base = '';
		parent::tear_down();
	}

	private function remove_dir( $dir ) {
		$dir = (string) $dir;
		if ( '' === $dir || ! is_dir( $dir ) ) {
			return;
		}
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::CHILD_FIRST
		);
		foreach ( $iterator as $file ) {
			if ( $file->isDir() ) {
				rmdir( $file->getPathname() );
			} else {
				unlink( $file->getPathname() );
			}
		}
		rmdir( $dir );
	}

	private function add_fixture_cursor_set() {
		add_filter(
			'oddout_cursor_set_registry',
			static function ( $sets ) {
				$sets['test-cursors'] = array(
					'slug'        => 'test-cursors',
					'label'       => 'Test Cursors',
					'category'   => 'Tests',
					'accent'      => '#38e8ff',
					'description' => 'Fixture cursor set.',
					'version'     => '1.0.0',
					'preview'     => 'https://example.com/preview.svg',
					'effects'     => array(
						'accent' => '#38e8ff',
						'spark'  => '#ff4f8b',
						'warm'   => '#f6b73c',
						'ink'    => '#19091f',
						'recipe' => 'signal-bloom',
					),
					'cursors'     => array(),
					'source'      => 'test',
				);
				return $sets;
			}
		);
		oddout_cursors_get_sets( true );
	}

	public function test_registry_accepts_filtered_cursor_sets() {
		$this->add_fixture_cursor_set();
		$set = oddout_cursors_get_set( 'test-cursors' );
		$this->assertIsArray( $set );
		$this->assertSame( 'Test Cursors', $set['label'] );
		$this->assertSame( '#38e8ff', $set['effects']['accent'] );
		$this->assertSame( array(), $set['cursors'] );
	}

	public function test_active_cursor_set_is_per_user_and_validated() {
		$this->add_fixture_cursor_set();
		$user_id = self::factory()->user->create();
		wp_set_current_user( $user_id );

		$this->assertTrue( oddout_cursors_set_active_slug( 'test-cursors', $user_id ) );
		$this->assertSame( 'test-cursors', oddout_cursors_get_active_slug( $user_id ) );
		$this->assertFalse( oddout_cursors_set_active_slug( 'missing-cursors', $user_id ) );
	}

	public function test_css_builder_outputs_native_cursor_rules_and_effect_tokens() {
		$this->add_fixture_cursor_set();
		$css = oddout_cursors_build_css( oddout_cursors_get_set( 'test-cursors' ) );

		$this->assertStringNotContainsString( 'url(', $css );
		$this->assertStringContainsString( '--odd-cursor-default: default;', $css );
		$this->assertStringContainsString( '--odd-cursor-pointer: pointer;', $css );
		$this->assertStringContainsString( '--odd-live-cursor-accent: #38e8ff;', $css );
		$this->assertStringContainsString( '--odd-live-cursor-spark: #ff4f8b;', $css );
		$this->assertStringContainsString( '--odd-live-cursor-recipe: signal-bloom;', $css );
		$this->assertStringContainsString( '[data-odd-cursor="text"]', $css );
		$this->assertStringContainsString( 'body.desktop-mode-active [data-odd-cursor="pointer"]', $css );
		$this->assertStringContainsString( '.desktop-mode-icon', $css );
		$this->assertStringContainsString( 'body.desktop-mode-active .desktop-mode-icon *', $css );
		$this->assertStringContainsString( '#wp-desktop-area', $css );
		$this->assertStringContainsString( '.wp-desktop-icon', $css );
		$this->assertStringContainsString( '.wp-desktop-window__titlebar', $css );
		$this->assertStringContainsString( 'input:not([type="button"])', $css );
		$this->assertStringContainsString( 'cursor: pointer !important;', $css );
		$this->assertStringNotContainsString( 'cursor: var(--odd-cursor-pointer) !important;', $css );
	}

	public function test_cursor_css_keeps_descendant_roles_out_of_the_cascade_contract() {
		$this->add_fixture_cursor_set();
		$css = oddout_cursors_build_css( oddout_cursors_get_set( 'test-cursors' ) );

		$this->assertStringNotContainsString( '[data-odd-cursor="grab"] *', $css );
		$this->assertStringNotContainsString( '[data-odd-cursor="pointer"] *', $css );
	}

	public function test_native_window_chrome_gets_cursor_coverage() {
		$this->add_fixture_cursor_set();
		$css = oddout_cursors_build_css( oddout_cursors_get_set( 'test-cursors' ) );

		$this->assertStringContainsString(
			'[data-window-id], [data-windowid], [data-desktop-window-id], [data-native-window-id]',
			$css
		);
		$this->assertStringContainsString( '.wp-desktop-window', $css );
		$this->assertStringNotContainsString( '.native-window-titlebar { cursor: var(--odd-cursor-grab); }', $css );
		$this->assertStringNotContainsString( '[aria-label="Close"]', $css );
	}

	public function test_cursor_stylesheet_version_and_shell_contract_include_active_tokens() {
		$this->add_fixture_cursor_set();
		$user_id = self::factory()->user->create();
		wp_set_current_user( $user_id );
		oddout_cursors_set_active_slug( 'test-cursors', $user_id );

		$version  = oddout_cursors_stylesheet_version( 'test-cursors' );
		$contract = oddout_cursors_shell_contract( 'test-cursors' );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertSame( 'test-cursors', $contract['slug'] );
		$this->assertSame( $version, $contract['version'] );
		$this->assertStringContainsString( 'set=test-cursors', $contract['stylesheet'] );
		$this->assertSame( '#38e8ff', $contract['tokens']['accent'] );
		$this->assertSame( '#ff4f8b', $contract['tokens']['spark'] );
		$this->assertSame( 'signal-bloom', $contract['tokens']['recipe'] );
	}

	public function test_cursor_stylesheet_version_uses_living_effects_contract() {
		$this->add_fixture_cursor_set();
		$version       = oddout_cursors_stylesheet_version( 'test-cursors' );
		$pre_hover_parts = array(
			defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0',
			'desktop-hover2',
			'test-cursors',
			'1.0.0',
			'default:stale-cursor-url:2,3',
		);
		$pre_hover_digest = substr( md5( implode( '|', $pre_hover_parts ) ), 0, 16 );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertNotSame( $pre_hover_digest, $version );
	}

	public function test_cursor_stylesheet_urls_upgrade_for_playground_https_proxy() {
		$server = $_SERVER;
		try {
			unset( $_SERVER['HTTPS'], $_SERVER['HTTP_X_FORWARDED_PROTO'], $_SERVER['SERVER_PORT'] );
			$_SERVER['HTTP_HOST'] = 'playground.wordpress.net';

			$this->assertSame(
				'https://playground.wordpress.net/scope:test/wp-json/odd/v1/cursors/active.css?set=fancy',
				oddout_cursors_url_current_scheme( 'http://playground.wordpress.net/scope:test/wp-json/odd/v1/cursors/active.css?set=fancy' )
			);
			$this->assertSame(
				'https://example.com/wp-json/odd/v1/cursors/active.css?set=fancy',
				oddout_cursors_url_current_scheme( 'https://example.com/wp-json/odd/v1/cursors/active.css?set=fancy' )
			);
		} finally {
			$_SERVER = $server;
		}
	}

	public function test_installed_cursor_previews_use_rest_asset_endpoint_when_upload_baseurl_is_empty() {
		$this->temp_upload_base = trailingslashit( sys_get_temp_dir() ) . 'odd-cursor-uploads-' . wp_generate_uuid4();
		$set_dir                = $this->temp_upload_base . '/odd/cursor-sets/fancy';
		wp_mkdir_p( $set_dir );
		file_put_contents(
			$set_dir . '/manifest.json',
			wp_json_encode(
				array(
					'name'    => 'Fancy Cursors',
					'label'   => 'Fancy Cursors',
					'version' => '1.0.0',
					'preview' => 'preview.svg',
					'effects' => array(
						'accent' => '#6ee7ff',
						'spark'  => '#ff4f8b',
						'recipe' => 'moonlight-focus',
					),
					'cursors' => array(),
				)
			)
		);
		file_put_contents( $set_dir . '/preview.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>' );

		add_filter(
			'upload_dir',
			function ( $uploads ) {
				$uploads['basedir'] = '';
				$uploads['baseurl'] = '';
				$uploads['path']    = $this->temp_upload_base . '/2026/05';
				$uploads['url']     = 'https://cdn.example.test/uploads/2026/05';
				$uploads['subdir']  = '/2026/05';
				return $uploads;
			}
		);

		$sets = oddout_cursors_get_sets( true );
		$url  = oddout_cursorsets_asset_url( 'fancy', 'preview.svg' );

		$this->assertArrayHasKey( 'fancy', $sets );
		$this->assertSame( realpath( $set_dir . '/preview.svg' ), oddout_cursorsets_asset_path( 'fancy', 'preview.svg' ) );
		$this->assertStringNotContainsString( '/uploads/odd/', $url );
		$this->assertStringContainsString( 'file=preview.svg', $url );
		$this->assertSame(
			$url,
			$sets['fancy']['preview']
		);
		$this->assertSame( '#6ee7ff', $sets['fancy']['effects']['accent'] );
		$this->assertSame( 'moonlight-focus', $sets['fancy']['effects']['recipe'] );
		$this->assertStringContainsString(
			'--odd-live-cursor-accent: #6ee7ff;',
			oddout_cursors_build_css( $sets['fancy'] )
		);
	}

	public function test_cursor_rest_asset_route_is_registered_publicly() {
		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		do_action( 'rest_api_init' );

		$this->assertArrayHasKey( '/odd/v1/cursors/asset/(?P<slug>[a-z0-9-]+)', $wp_rest_server->get_routes() );
	}

	public function test_shared_url_scheme_helper_respects_https_proxy_headers() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST']              = 'example.test';
			$_SERVER['HTTP_X_FORWARDED_PROTO'] = 'http, https';
			unset( $_SERVER['HTTPS'], $_SERVER['SERVER_PORT'] );

			$this->assertTrue( oddout_request_uses_https() );
			$this->assertSame(
				'https://example.test/wp-content/plugins/odd/src/panel/index.js',
				oddout_url_current_scheme( 'http://example.test/wp-content/plugins/odd/src/panel/index.js' )
			);
		} finally {
			$_SERVER = $server;
		}
	}

	public function test_shared_url_scheme_helper_preserves_plain_http_without_https_signal() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST'] = 'example.test';
			unset( $_SERVER['HTTPS'], $_SERVER['HTTP_X_FORWARDED_PROTO'], $_SERVER['SERVER_PORT'] );

			$this->assertFalse( oddout_request_uses_https() );
			$this->assertSame(
				'http://example.test/wp-content/plugins/odd/src/panel/index.js',
				oddout_url_current_scheme( 'http://example.test/wp-content/plugins/odd/src/panel/index.js' )
			);
		} finally {
			$_SERVER = $server;
		}
	}

	/**
	 * REST URLs from `rest_url()` follow `siteurl`; align to HTTPS when the request is HTTPS.
	 */
	public function test_odd_https_rest_url_upgrades_like_plugins_url() {
		$server = $_SERVER;
		try {
			$_SERVER['HTTP_HOST']              = 'example.test';
			$_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
			unset( $_SERVER['HTTPS'], $_SERVER['SERVER_PORT'] );

			$url = oddout_https_rest_url( 'odd/v1/prefs' );
			$this->assertStringStartsWith( 'https://', $url );
			$parts = wp_parse_url( $url );
			$this->assertIsArray( $parts, $url );
			parse_str( isset( $parts['query'] ) ? (string) $parts['query'] : '', $query );
			if ( isset( $query['rest_route'] ) ) {
				$this->assertSame( '/odd/v1/prefs', $query['rest_route'] );
			} else {
				$this->assertStringContainsString( '/wp-json/odd/v1/prefs', isset( $parts['path'] ) ? (string) $parts['path'] : '' );
			}
		} finally {
			$_SERVER = $server;
		}
	}
}
