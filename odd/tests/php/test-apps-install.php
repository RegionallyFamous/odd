<?php
/**
 * Tests for the app install/uninstall pipeline and its REST surface.
 *
 * Fixture strategy: each test builds a fresh `.wp` ZIP in a tmp dir
 * (cheap at this scale and avoids committing binaries). Every test
 * uninstalls any app it creates in tearDown() to keep the odd-apps
 * directory and index clean.
 */

class Test_Apps_Install extends ODD_REST_Test_Case {

	/**
	 * @var string[] Slugs installed during a test, drained on tear_down.
	 */
	protected $installed = array();

	public function tear_down() {
		foreach ( $this->installed as $slug ) {
			odd_apps_uninstall( $slug );
		}
		$this->installed = array();
		parent::tear_down();
	}

	/**
	 * Build a .wp zip in a tempfile and return its path.
	 *
	 * @param array $manifest manifest.json contents.
	 * @param array $files    Additional entries: ['index.html' => '...', 'foo/bar.txt' => '...'].
	 * @param array $opts     { symlink: ['name' => 'target'], traversal: true, entry_missing: true }.
	 * @return string
	 */
	protected function build_wp_zip( array $manifest, array $files = array(), array $opts = array() ) {
		$path = tempnam( sys_get_temp_dir(), 'oddapp_' ) . '.wp';
		$zip  = new ZipArchive();
		$this->assertTrue(
			true === $zip->open( $path, ZipArchive::CREATE | ZipArchive::OVERWRITE ),
			'Failed to open fixture zip for writing.'
		);
		$zip->addFromString( 'manifest.json', wp_json_encode( $manifest ) );
		foreach ( $files as $name => $body ) {
			$zip->addFromString( $name, $body );
		}
		if ( ! empty( $opts['traversal'] ) ) {
			// ZipArchive rewrites leading `../`, so inject a name via raw index stat.
			$zip->addFromString( '../escape.txt', 'nope' );
		}
		$zip->close();
		return $path;
	}

	protected function install_fixture( $slug = 'hello-odd', array $overrides = array() ) {
		$manifest = array_merge(
			array(
				'name'    => 'Hello ODD',
				'slug'    => $slug,
				'version' => '0.0.1',
				'entry'   => 'index.html',
			),
			$overrides
		);
		$zip      = $this->build_wp_zip( $manifest, array( 'index.html' => '<!doctype html><h1>hi</h1>' ) );
		$res      = odd_apps_install( $zip, $slug . '.wp' );
		@unlink( $zip );
		return $res;
	}

	protected function with_request_uri( $request_uri, callable $callback ) {
		$prev = isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : null;
		if ( null === $request_uri ) {
			unset( $_SERVER['REQUEST_URI'] );
		} else {
			$_SERVER['REQUEST_URI'] = $request_uri;
		}

		try {
			return $callback();
		} finally {
			if ( null === $prev ) {
				unset( $_SERVER['REQUEST_URI'] );
			} else {
				$_SERVER['REQUEST_URI'] = $prev;
			}
		}
	}

	protected function assert_url_path_has_scope_and_suffix( $url, $scope, $suffix ) {
		$parts = wp_parse_url( $url );
		$this->assertIsArray( $parts, $url );
		$path = isset( $parts['path'] ) ? (string) $parts['path'] : '';
		$this->assertSame( 0, strpos( $path, '/' . $scope . '/' ), $url );
		$this->assertSame( 1, substr_count( $path, '/' . $scope . '/' ), $url );
		$this->assertSame( $suffix, substr( $path, 0 - strlen( $suffix ) ), $url );
	}

	protected function assert_rest_url_has_scope_and_route( $url, $scope, $route ) {
		$parts = wp_parse_url( $url );
		$this->assertIsArray( $parts, $url );
		$path = isset( $parts['path'] ) ? (string) $parts['path'] : '';
		$this->assertSame( 0, strpos( $path, '/' . $scope . '/' ), $url );
		$this->assertSame( 1, substr_count( $path, '/' . $scope . '/' ), $url );

		parse_str( isset( $parts['query'] ) ? (string) $parts['query'] : '', $query );
		$expected_route = '/' . ltrim( (string) $route, '/' );
		if ( isset( $query['rest_route'] ) ) {
			$this->assertSame( $expected_route, $query['rest_route'], $url );
			return;
		}

		$this->assertSame( '/wp-json' . $expected_route, substr( $path, 0 - strlen( '/wp-json' . $expected_route ) ), $url );
	}

	protected function assert_rest_root_has_scope( $url, $scope ) {
		$parts = wp_parse_url( $url );
		$this->assertIsArray( $parts, $url );
		$path = isset( $parts['path'] ) ? (string) $parts['path'] : '';
		$this->assertSame( 0, strpos( $path, '/' . $scope . '/' ), $url );
		$this->assertSame( 1, substr_count( $path, '/' . $scope . '/' ), $url );

		parse_str( isset( $parts['query'] ) ? (string) $parts['query'] : '', $query );
		if ( array_key_exists( 'rest_route', $query ) ) {
			return;
		}

		$this->assertStringContainsString( '/wp-json', $path, $url );
	}

	public function test_install_happy_path_writes_index_row() {
		$res = $this->install_fixture( 'hello-odd' );
		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'install returned non-array' );
		$this->installed[] = 'hello-odd';

		$list  = odd_apps_list();
		$slugs = wp_list_pluck( $list, 'slug' );
		$this->assertContains( 'hello-odd', $slugs );
	}

	public function test_install_rejects_wrong_extension() {
		$zip = $this->build_wp_zip(
			array(
				'name'    => 'X',
				'slug'    => 'x',
				'version' => '0.0.1',
			),
			array( 'index.html' => '<h1>x</h1>' )
		);
		$res = odd_apps_install( $zip, 'x.zip' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'invalid_extension', $res->get_error_code() );
	}

	public function test_install_rejects_missing_manifest_field() {
		$zip = $this->build_wp_zip(
			array( 'name' => 'X' ), // no slug, no version
			array( 'index.html' => '<h1>x</h1>' )
		);
		$res = odd_apps_install( $zip, 'x.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'missing_manifest_field', $res->get_error_code() );
	}

	public function test_install_rejects_invalid_slug() {
		$zip = $this->build_wp_zip(
			array(
				'name'    => 'X',
				'slug'    => 'BAD SLUG!!',
				'version' => '1.0.0',
			),
			array( 'index.html' => '<h1>x</h1>' )
		);
		$res = odd_apps_install( $zip, 'x.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'invalid_slug', $res->get_error_code() );
	}

	public function test_install_rejects_forbidden_file_type() {
		$zip = $this->build_wp_zip(
			array(
				'name'    => 'X',
				'slug'    => 'forbidden-x',
				'version' => '1.0.0',
			),
			array(
				'index.html' => '<h1>x</h1>',
				'evil.php'   => '<?php echo "pwned"; ?>',
			)
		);
		$res = odd_apps_install( $zip, 'forbidden-x.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'forbidden_file_type', $res->get_error_code() );
	}

	public function test_install_rejects_missing_entry_file() {
		$zip = $this->build_wp_zip(
			array(
				'name'    => 'X',
				'slug'    => 'missing-entry',
				'version' => '1.0.0',
				'entry'   => 'nope.html',
			),
			array( 'index.html' => '<h1>x</h1>' )
		);
		$res = odd_apps_install( $zip, 'missing-entry.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'missing_entry', $res->get_error_code() );
	}

	public function test_install_rejects_traversal_entry_in_manifest() {
		$zip = $this->build_wp_zip(
			array(
				'name'    => 'X',
				'slug'    => 'traversal-entry',
				'version' => '1.0.0',
				'entry'   => '../../../etc/passwd',
			),
			array( 'index.html' => '<h1>x</h1>' )
		);
		$res = odd_apps_install( $zip, 'traversal-entry.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'invalid_entry', $res->get_error_code() );
	}

	public function test_install_rejects_duplicate_slug() {
		$this->install_fixture( 'dup-app' );
		$this->installed[] = 'dup-app';

		$res = $this->install_fixture( 'dup-app' );
		$this->assertWPError( $res );
		$this->assertSame( 'slug_exists', $res->get_error_code() );
	}

	public function test_uninstall_is_idempotent_for_missing_slug() {
		$res = odd_apps_uninstall( 'never-installed' );
		$this->assertTrue( $res );
	}

	public function test_set_enabled_errors_for_missing_app() {
		$res = odd_apps_set_enabled( 'no-such-app', false );
		$this->assertWPError( $res );
		$this->assertSame( 'not_installed', $res->get_error_code() );
	}

	public function test_rest_apps_list_requires_read_cap() {
		$this->log_out();
		$res = $this->dispatch_json( 'GET', '/odd/v1/apps' );
		$this->assertContains( $res->get_status(), array( 401, 403 ) );
	}

	public function test_rest_apps_list_returns_installed() {
		$this->login_as();
		$this->install_fixture( 'rest-list-app' );
		$this->installed[] = 'rest-list-app';

		$res = $this->dispatch_json( 'GET', '/odd/v1/apps' );
		$this->assertSame( 200, $res->get_status() );
		$slugs = wp_list_pluck( $res->get_data()['apps'], 'slug' );
		$this->assertContains( 'rest-list-app', $slugs );
	}

	public function test_app_manifest_capability_cannot_broaden_serve_access_by_default() {
		$this->login_as();
		$res = $this->install_fixture( 'low-cap-app', array( 'capability' => 'read' ) );
		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'install returned non-array' );
		$this->installed[] = 'low-cap-app';

		$index = odd_apps_index_load();
		$this->assertSame( 'manage_options', $index['low-cap-app']['capability'] );

		$sub = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $sub );

		$serve = $this->dispatch_json( 'GET', '/odd/v1/apps/serve/low-cap-app' );
		$this->assertContains( $serve->get_status(), array( 401, 403 ) );
	}

	public function test_app_capability_filter_can_allow_deliberate_lower_privilege_apps() {
		add_filter(
			'odd_app_allowed_capabilities',
			static function ( $allowed ) {
				$allowed[] = 'read';
				return $allowed;
			}
		);

		$this->assertSame( 'read', odd_apps_normalize_capability( 'read' ) );
		remove_all_filters( 'odd_app_allowed_capabilities' );
	}

	public function test_rest_delete_requires_manage_options() {
		$this->install_fixture( 'subscriber-delete-target' );
		$this->installed[] = 'subscriber-delete-target';

		$sub = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $sub );

		$res = $this->dispatch_json( 'DELETE', '/odd/v1/apps/subscriber-delete-target' );
		$this->assertContains( $res->get_status(), array( 401, 403 ) );
	}

	public function test_rest_toggle_flips_enabled_flag() {
		$this->login_as();
		$this->install_fixture( 'toggle-me' );
		$this->installed[] = 'toggle-me';

		$res = $this->dispatch_json( 'POST', '/odd/v1/apps/toggle-me/toggle', array( 'enabled' => false ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertFalse( $res->get_data()['enabled'] );

		$res = $this->dispatch_json( 'POST', '/odd/v1/apps/toggle-me/toggle', array( 'enabled' => true ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertTrue( $res->get_data()['enabled'] );
	}

	public function test_app_cookieauth_csp_keeps_compat_allowances_but_blocks_plugins() {
		$csp = odd_apps_cookieauth_csp( 'csp-app', array() );

		$this->assertStringContainsString( "script-src 'self' 'unsafe-inline' https:", $csp );
		$this->assertStringContainsString( "object-src 'none'", $csp );
		$this->assertStringContainsString( "frame-ancestors 'self'", $csp );
		$this->assertStringContainsString( "worker-src 'self' blob:", $csp );
	}

	public function test_odd_apps_is_html_mime_matches_charset_suffix() {
		$this->assertTrue( odd_apps_is_html_mime( 'text/html; charset=utf-8' ) );
		$this->assertTrue( odd_apps_is_html_mime( 'TEXT/HTML' ) );
		$this->assertTrue( odd_apps_is_html_mime( 'application/xhtml+xml; charset=utf-8' ) );
		$this->assertFalse( odd_apps_is_html_mime( 'application/javascript; charset=utf-8' ) );
	}

	public function test_cookieauth_strip_home_prefix_root_untouched() {
		$this->assertSame( '/odd-app/board/', odd_apps_cookieauth_strip_home_path_prefix( '/odd-app/board/', '/' ) );
		$this->assertSame( '/odd-app/board/', odd_apps_cookieauth_strip_home_path_prefix( '/odd-app/board/', '' ) );
	}

	public function test_cookieauth_strip_home_prefix_subdirectory_and_runtime() {
		$this->assertSame(
			'/odd-app/board/',
			odd_apps_cookieauth_strip_home_path_prefix( '/blog/odd-app/board/', '/blog' )
		);
		$this->assertSame(
			'/odd-app/board/',
			odd_apps_cookieauth_strip_home_path_prefix( '/blog/odd-app/board/', '/blog/' )
		);
		$this->assertSame(
			'/odd-app-runtime/react.js',
			odd_apps_cookieauth_strip_home_path_prefix( '/scoped/wp/odd-app-runtime/react.js', '/scoped/wp' )
		);
	}

	public function test_cookieauth_strip_home_prefix_requires_segment_boundary() {
		$this->assertSame(
			'/bloggers/page/',
			odd_apps_cookieauth_strip_home_path_prefix( '/bloggers/page/', '/blog' )
		);
	}

	public function test_cookieauth_strip_home_prefix_exact_home_maps_to_slash() {
		$this->assertSame(
			'/',
			odd_apps_cookieauth_strip_home_path_prefix( '/blog', '/blog' )
		);
	}

	public function test_cookieauth_strip_playground_scope_prefix() {
		$this->assertSame(
			'/odd-app/board/',
			odd_apps_cookieauth_strip_playground_scope_prefix( '/scope:brave-quiet-road/odd-app/board/' )
		);
		$this->assertSame(
			'/odd-app-runtime/react.js',
			odd_apps_cookieauth_strip_playground_scope_prefix( '/scope:x9/odd-app-runtime/react.js' )
		);
		$this->assertSame( '/', odd_apps_cookieauth_strip_playground_scope_prefix( '/scope:only' ) );
		$this->assertSame( '/odd-app/foo/', odd_apps_cookieauth_strip_playground_scope_prefix( '/odd-app/foo/' ) );
		$this->assertSame(
			'/odd-app/board/',
			odd_apps_cookieauth_strip_playground_scope_prefix( '/scope:kind_modern_forest.v1/odd-app/board/' )
		);
	}

	public function test_url_with_playground_scope_preserves_parts_and_avoids_duplicates() {
		$this->with_request_uri(
			'/scope:pg-scope-xyz/wp-admin/index.php?desktop_mode_portal=1',
			function () {
				$url   = odd_url_with_playground_scope( 'http://example.test/wp/odd-app/board/?foo=bar#frag' );
				$parts = wp_parse_url( $url );

				$this->assertSame( 'example.test', $parts['host'] );
				$this->assertSame( '/scope:pg-scope-xyz/wp/odd-app/board/', $parts['path'] );
				$this->assertSame( 'foo=bar', $parts['query'] );
				$this->assertSame( 'frag', $parts['fragment'] );

				$already_scoped = odd_url_with_playground_scope( 'https://example.test/scope:existing/odd-app/board/' );
				$already_parts  = wp_parse_url( $already_scoped );
				$this->assertSame( '/scope:existing/odd-app/board/', $already_parts['path'] );
			}
		);
	}

	public function test_url_with_playground_scope_noops_without_scope_request() {
		$this->with_request_uri(
			'/wp-admin/index.php',
			function () {
				$url   = odd_url_with_playground_scope( 'https://example.test/odd-app/board/' );
				$parts = wp_parse_url( $url );

				$this->assertSame( '/odd-app/board/', $parts['path'] );
			}
		);
	}

	public function test_cookieauth_url_for_includes_playground_scope() {
		$this->with_request_uri(
			'/scope:pg-scope-xyz/wp-admin/index.php?desktop_mode_portal=1',
			function () {
				$this->assert_url_path_has_scope_and_suffix(
					odd_apps_cookieauth_url_for( 'board' ),
					'scope:pg-scope-xyz',
					'/odd-app/board/'
				);
			}
		);
	}

	public function test_runtime_importmap_urls_include_playground_scope() {
		$this->with_request_uri(
			'/scope:pg-scope-xyz/odd-app/board/',
			function () {
				$html = odd_apps_runtime_importmap_html();
				$this->assertSame( 1, preg_match( '#<script type="importmap">(.+)</script>#', $html, $matches ) );

				$decoded = json_decode( $matches[1], true );
				$this->assertIsArray( $decoded );
				$imports = isset( $decoded['imports'] ) ? $decoded['imports'] : array();

				$this->assertArrayHasKey( 'react', $imports );
				$this->assertArrayHasKey( 'react-dom', $imports );
				$this->assertArrayHasKey( 'react-dom/client', $imports );
				$this->assertArrayHasKey( 'react/jsx-runtime', $imports );
				$this->assert_url_path_has_scope_and_suffix(
					$imports['react'],
					'scope:pg-scope-xyz',
					'/odd-app-runtime/react.js'
				);
				$this->assert_url_path_has_scope_and_suffix(
					$imports['react-dom'],
					'scope:pg-scope-xyz',
					'/odd-app-runtime/react-dom.js'
				);
				$this->assert_url_path_has_scope_and_suffix(
					$imports['react-dom/client'],
					'scope:pg-scope-xyz',
					'/odd-app-runtime/react-dom-client.js'
				);
				$this->assert_url_path_has_scope_and_suffix(
					$imports['react/jsx-runtime'],
					'scope:pg-scope-xyz',
					'/odd-app-runtime/react-jsx-runtime.js'
				);
			}
		);
	}

	public function test_runtime_bare_import_rewrite_uses_scoped_runtime_base() {
		$this->with_request_uri(
			'/scope:pg-scope-xyz/odd-app/board/',
			function () {
				$result = odd_apps_rewrite_runtime_bare_imports(
					'import React from "react";'
					. 'import{jsx}from"react/jsx-runtime";'
					. 'import"react-dom";'
					. 'export*from"react-dom/client";'
				);

				$this->assertStringContainsString( '/scope:pg-scope-xyz/', $result );
				$this->assertStringContainsString( '/odd-app-runtime/react.js"', $result );
				$this->assertStringContainsString( '/odd-app-runtime/react-jsx-runtime.js"', $result );
				$this->assertStringContainsString( '/odd-app-runtime/react-dom.js"', $result );
				$this->assertStringContainsString( '/odd-app-runtime/react-dom-client.js"', $result );
			}
		);
	}

	public function test_https_rest_url_includes_playground_scope() {
		$this->with_request_uri(
			'/scope:pg-scope-xyz/wp-admin/index.php?desktop_mode_portal=1',
			function () {
				$this->assert_rest_url_has_scope_and_route(
					odd_https_rest_url( 'odd/v1/apps' ),
					'scope:pg-scope-xyz',
					'odd/v1/apps'
				);
			}
		);
	}

	public function test_iframe_effective_rest_root_inserts_playground_scope_before_wp_json() {
		$this->with_request_uri(
			'/scope:pg-scope-xyz/odd-app/ledger/?_wpnonce=fake',
			function () {
				$root = odd_apps_iframe_effective_rest_root();
				$this->assert_rest_root_has_scope( $root, 'scope:pg-scope-xyz' );
			}
		);
	}

	public function test_app_diag_reports_scoped_urls_transforms_and_asset_probes() {
		$zip = $this->build_wp_zip(
			array(
				'name'    => 'Diag App',
				'slug'    => 'diag-app',
				'version' => '0.0.1',
				'entry'   => 'index.html',
			),
			array(
				'index.html'    => '<!doctype html><html><head><base href="/">'
					. '<script type="module" src="./assets/app.js"></script>'
					. '</head><body><div id="root"></div></body></html>',
				'assets/app.js' => 'import React from "react"; console.log(React);',
			)
		);
		$res = odd_apps_install( $zip, 'diag-app.wp' );
		@unlink( $zip );
		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'install returned non-array' );
		$this->installed[] = 'diag-app';
		$this->login_as();

		$this->with_request_uri(
			'/scope:pg-scope-xyz/wp-admin/index.php?desktop_mode_portal=1',
			function () {
				$response = $this->dispatch_json( 'GET', '/odd/v1/apps/diag/diag-app' );
				$this->assertSame( 200, $response->get_status() );
					$data = $response->get_data();

					$this->assertSame( 2, $data['schema'] );
					$this->assertSame( 'diag-app', $data['slug'] );
					$this->assertArrayHasKey( 'summary', $data );
					$this->assertSame( 'pass', $data['summary']['status'] );
					$this->assertStringContainsString( '/scope:pg-scope-xyz/odd-app/diag-app/', $data['serve']['url'] );
					$this->assertSame( 0, strpos( $data['serve']['rest_root']['path'], '/scope:pg-scope-xyz/' ) );
					$this->assertTrue( $data['serve']['regex_matches'] );
					$this->assertTrue( $data['entry']['transformed']['hasImportmap'] );
					$this->assertTrue( $data['entry']['transformed']['hasFetchBootstrap'] );
					$this->assertFalse( $data['entry']['transformed']['hasBaseTag'] );
				$this->assertNotEmpty( $data['asset_probes'] );
				$this->assertTrue( $data['asset_probes'][0]['exists'] );
				$this->assertTrue( $data['asset_probes'][0]['bareReactImportsBeforeRewrite'] );
				$this->assertFalse( $data['asset_probes'][0]['bareReactImportsAfterRewrite'] );
			}
		);
	}

	public function test_prepare_app_html_output_strips_base_and_rewrites_root_asset_refs() {
		$raw = '<!DOCTYPE html><html><head><base href="/">'
			. '<link rel="stylesheet" href="/assets/index.css">'
			. '<script type="module" src="/chunks/main.js"></script>'
			. '<script type="module" src="/@vite/client"></script>'
			. '</head><body></body></html>';

		$result = odd_apps_prepare_app_html_output( $raw );

		$this->assertStringNotContainsString( '<base', $result );
		$this->assertStringContainsString( 'href="./assets/index.css"', $result );
		$this->assertStringContainsString( 'src="./chunks/main.js"', $result );
		$this->assertStringContainsString( 'src="./@vite/client"', $result );
		$this->assertStringContainsString( 'odd_apps_iframe_fetch_bootstrap', $result );
		$this->assertStringContainsString( 'I.slice(j)', $result );
		$this->assertStringContainsString( 'wp-json', $result );
	}
}
