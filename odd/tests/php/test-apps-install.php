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

	public function test_iframe_effective_rest_root_inserts_playground_scope_before_wp_json() {
		$prev                   = isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : null;
		$_SERVER['REQUEST_URI'] = '/scope:pg-scope-xyz/odd-app/ledger/?_wpnonce=fake';

		try {
			$root = odd_apps_iframe_effective_rest_root();
			$this->assertStringContainsString( '/scope:pg-scope-xyz/', $root );
			$this->assertStringContainsString( 'wp-json', $root );
			$this->assertStringContainsString( '/scope:pg-scope-xyz/wp-json', $root );
		} finally {
			if ( null === $prev ) {
				unset( $_SERVER['REQUEST_URI'] );
			} else {
				$_SERVER['REQUEST_URI'] = $prev;
			}
		}
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
