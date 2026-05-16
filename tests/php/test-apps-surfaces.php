<?php
/**
 * Tests for the per-app `surfaces` preference — which of Desktop
 * Mode's launch affordances (desktop icon, taskbar icon) an app
 * registers.
 *
 * Covers the helper API (`oddout_apps_set_surfaces`,
 * `oddout_apps_row_surfaces`), the REST toggle route extension, and
 * the `oddout_apps_register_surfaces()` dispatcher's forwarding into
 * `desktop_mode_register_window()` / `desktop_mode_register_icon()`.
 *
 * The Desktop Mode functions are stubbed at runtime via
 * `uopz_set_return` when available, and otherwise re-declared as
 * no-op capture shims in a pre-setup hook — same pattern used by
 * other ODD tests that exercise host-plugin surfaces.
 */

class Test_Apps_Surfaces extends ODDOUT_REST_Test_Case {

	/**
	 * @var string[] Slugs installed during a test, drained on tear_down.
	 */
	protected $installed = array();

	/**
	 * @var array Captured desktop_mode_register_* calls for assertion.
	 *            Shape: [ [ 'fn' => 'window'|'icon', 'id' => string, 'args' => array ] ].
	 */
	public static $calls = array();

	public function set_up() {
		parent::set_up();
		self::$calls = array();
	}

	public function tear_down() {
		foreach ( $this->installed as $slug ) {
			oddout_apps_uninstall( $slug );
		}
		$this->installed = array();
		self::$calls     = array();
		parent::tear_down();
	}

	/**
	 * Minimal .wp fixture: delegates to the standard install helper
	 * from Test_Apps_Install but without pulling the whole class in
	 * as a dependency (duplicates are cheap, coupling is not).
	 */
	protected function install_fixture( $slug, array $manifest_overrides = array() ) {
		$manifest = array_merge(
				array(
					'type'    => 'app',
					'name'    => 'Surfaces ' . $slug,
				'slug'    => $slug,
				'version' => '0.0.1',
				'entry'   => 'index.html',
			),
			$manifest_overrides
		);
		$path     = tempnam( sys_get_temp_dir(), 'oddapp_' ) . '.wp';
		$zip      = new ZipArchive();
		$zip->open( $path, ZipArchive::CREATE | ZipArchive::OVERWRITE );
		$zip->addFromString( 'manifest.json', wp_json_encode( $manifest ) );
		$zip->addFromString( 'index.html', '<!doctype html><h1>hi</h1>' );
		if ( ! empty( $manifest['icon'] ) && false === strpos( (string) $manifest['icon'], '://' ) ) {
			$zip->addFromString( (string) $manifest['icon'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#111"/></svg>' );
		}
		$zip->close();
		$res = oddout_apps_install( $path, $slug . '.wp' );
		@unlink( $path );
		$this->installed[] = $slug;
		return $res;
	}

	public function test_row_surfaces_defaults_when_missing_use_v1_defaults() {
		$s = oddout_apps_row_surfaces( array( 'slug' => 'default-surfaces' ) );
		$this->assertTrue( $s['desktop'], 'Default rows keep the desktop icon.' );
		$this->assertFalse( $s['taskbar'], 'Default rows do not add a taskbar icon.' );
	}

	public function test_row_surfaces_coerces_truthy_values_to_bool() {
		$s = oddout_apps_row_surfaces(
			array(
				'surfaces' => array(
					'desktop' => 1,
					'taskbar' => '1',
				),
			)
		);
		$this->assertSame( true, $s['desktop'] );
		$this->assertSame( true, $s['taskbar'] );
	}

	public function test_install_defaults_surfaces_when_manifest_is_silent() {
		$manifest = $this->install_fixture( 'surfaces-default' );
		$this->assertIsArray( $manifest );

		$row = $this->find_row( 'surfaces-default' );
		$this->assertSame(
			array(
				'desktop' => true,
				'taskbar' => false,
			),
			$row['surfaces']
		);
	}

	public function test_install_honors_manifest_surfaces_opt_in() {
		$this->install_fixture(
			'surfaces-manifest',
			array(
				'surfaces' => array(
					'desktop' => false,
					'taskbar' => true,
				),
			)
		);
		$row = $this->find_row( 'surfaces-manifest' );
		$this->assertFalse( $row['surfaces']['desktop'] );
		$this->assertTrue( $row['surfaces']['taskbar'] );
	}

	public function test_set_surfaces_merges_partial_payload() {
		$this->install_fixture( 'surfaces-partial' );

		// Only taskbar → desktop preserved from default.
		$this->assertTrue( oddout_apps_set_surfaces( 'surfaces-partial', array( 'taskbar' => true ) ) );
		$row = $this->find_row( 'surfaces-partial' );
		$this->assertTrue( $row['surfaces']['desktop'] );
		$this->assertTrue( $row['surfaces']['taskbar'] );

		// Only desktop → taskbar preserved.
		$this->assertTrue( oddout_apps_set_surfaces( 'surfaces-partial', array( 'desktop' => false ) ) );
		$row = $this->find_row( 'surfaces-partial' );
		$this->assertFalse( $row['surfaces']['desktop'] );
		$this->assertTrue( $row['surfaces']['taskbar'] );
	}

	public function test_set_surfaces_rejects_unknown_slug() {
		$res = oddout_apps_set_surfaces( 'no-such-app', array( 'desktop' => false ) );
		$this->assertWPError( $res );
		$this->assertSame( 'not_installed', $res->get_error_code() );
	}

	public function test_set_surfaces_rejects_non_array() {
		$this->install_fixture( 'surfaces-bad-payload' );
		$res = oddout_apps_set_surfaces( 'surfaces-bad-payload', 'not-an-array' );
		$this->assertWPError( $res );
		$this->assertSame( 'invalid_surfaces', $res->get_error_code() );
	}

	public function test_set_surfaces_fires_odd_app_surfaces_changed_action() {
		$this->install_fixture( 'surfaces-action' );

		$captured = array();
		add_action(
			'oddout_app_surfaces_changed',
			function ( $slug, $surfaces ) use ( &$captured ) {
				$captured[] = array(
					'slug'     => $slug,
					'surfaces' => $surfaces,
				);
			},
			10,
			2
		);

		oddout_apps_set_surfaces( 'surfaces-action', array( 'taskbar' => true ) );

		$this->assertCount( 1, $captured );
		$this->assertSame( 'surfaces-action', $captured[0]['slug'] );
		$this->assertTrue( $captured[0]['surfaces']['taskbar'] );
	}

	public function test_rest_toggle_accepts_surfaces_payload() {
		$this->login_as();
		$this->install_fixture( 'rest-surfaces' );

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/apps/rest-surfaces/toggle',
			array( 'surfaces' => array( 'taskbar' => true ) )
		);
		$this->assertSame( 200, $res->get_status() );
		$data = $res->get_data();
		$this->assertArrayHasKey( 'surfaces', $data );
		$this->assertTrue( $data['surfaces']['taskbar'] );
		$this->assertTrue( $data['surfaces']['desktop'], 'Partial payload should leave desktop untouched.' );
		$this->assertTrue( $data['enabled'] );
	}

	public function test_rest_toggle_rejects_non_object_surfaces() {
		$this->login_as();
		$this->install_fixture( 'rest-surfaces-bad' );

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/apps/rest-surfaces-bad/toggle',
			array( 'surfaces' => 'nope' )
		);
		$this->assertSame( 400, $res->get_status() );
	}

	public function test_rest_toggle_can_update_enabled_and_surfaces_in_one_call() {
		$this->login_as();
		$this->install_fixture( 'rest-surfaces-combo' );

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/apps/rest-surfaces-combo/toggle',
			array(
				'enabled'  => false,
				'surfaces' => array( 'taskbar' => true ),
			)
		);
		$this->assertSame( 200, $res->get_status() );
		$data = $res->get_data();
		$this->assertFalse( $data['enabled'] );
		$this->assertTrue( $data['surfaces']['taskbar'] );
	}

	public function test_apps_list_normalizes_surfaces_for_manual_rows() {
		// Inject a row directly — bypass the installer — to verify REST always
		// returns the complete v1 shape.
		$index               = oddout_apps_index_load();
		$index['manual-row'] = array(
			'slug'      => 'manual-row',
			'name'      => 'Manual Row',
			'version'   => '0.0.1',
			'enabled'   => true,
			'installed' => time(),
		);
		oddout_apps_index_save( $index );

		$rows    = oddout_apps_list();
		$matched = null;
		foreach ( $rows as $r ) {
			if ( 'manual-row' === $r['slug'] ) {
				$matched = $r;
				break;
			}
		}
		$this->assertNotNull( $matched );
		$this->assertArrayHasKey( 'surfaces', $matched );
		$this->assertTrue( $matched['surfaces']['desktop'] );
		$this->assertFalse( $matched['surfaces']['taskbar'] );

		// Tidy.
		unset( $index['manual-row'] );
		oddout_apps_index_save( $index );
	}

	public function test_register_surfaces_forwards_dock_placement_and_skips_icon_when_desktop_off() {
		$this->require_desktop_mode_stubs();

		$manifest = $this->install_fixture(
			'register-tbar-no-desk',
			array(
				'surfaces' => array(
					'desktop' => false,
					'taskbar' => true,
				),
			)
		);

		self::$calls = array();
		oddout_apps_register_surfaces( $this->find_row( 'register-tbar-no-desk' ) );

		$window = $this->find_call( 'window', 'odd-app-register-tbar-no-desk' );
		$this->assertNotNull( $window, 'register_window was not called.' );
		$this->assertSame( 'dock', $window['args']['placement'] );

		$icon = $this->find_call( 'icon', 'odd-app-register-tbar-no-desk' );
		$this->assertNull( $icon, 'register_icon must be skipped when surfaces.desktop is false.' );
	}

	public function test_register_surfaces_forwards_placement_none_when_taskbar_off() {
		$this->require_desktop_mode_stubs();
		$this->install_fixture(
			'register-desk-only',
			array(
				'surfaces' => array(
					'desktop' => true,
					'taskbar' => false,
				),
			)
		);

		self::$calls = array();
		oddout_apps_register_surfaces( $this->find_row( 'register-desk-only' ) );

		$window = $this->find_call( 'window', 'odd-app-register-desk-only' );
		$this->assertNotNull( $window );
		$this->assertSame( 'none', $window['args']['placement'] );

		$icon = $this->find_call( 'icon', 'odd-app-register-desk-only' );
		$this->assertNotNull( $icon, 'register_icon must run when surfaces.desktop is true.' );
	}

	public function test_register_surfaces_registers_both_when_both_surfaces_on() {
		$this->require_desktop_mode_stubs();
		$this->install_fixture(
			'register-both',
			array(
				'surfaces' => array(
					'desktop' => true,
					'taskbar' => true,
				),
			)
		);

		self::$calls = array();
		oddout_apps_register_surfaces( $this->find_row( 'register-both' ) );

		$window = $this->find_call( 'window', 'odd-app-register-both' );
		$icon   = $this->find_call( 'icon', 'odd-app-register-both' );

		$this->assertNotNull( $window );
		$this->assertNotNull( $icon );
		$this->assertSame( 'dock', $window['args']['placement'] );
	}

	public function test_register_surfaces_uses_manifest_icon_for_desktop_and_taskbar() {
		$this->require_desktop_mode_stubs();
		$this->install_fixture(
			'register-icon-match',
			array(
				'icon'     => 'icon.svg',
				'surfaces' => array(
					'desktop' => true,
					'taskbar' => true,
				),
			)
		);

		self::$calls = array();
		oddout_apps_register_surfaces( $this->find_row( 'register-icon-match' ) );

		$window = $this->find_call( 'window', 'odd-app-register-icon-match' );
		$icon   = $this->find_call( 'icon', 'odd-app-register-icon-match' );

		$this->assertNotNull( $window );
		$this->assertNotNull( $icon );
		$this->assertNotEmpty( $window['args']['icon'] );
		$this->assertSame( $window['args']['icon'], $icon['args']['icon'] );
		$this->assertStringContainsString( '/odd/v1/apps/icon/register-icon-match', $window['args']['icon'] );
	}

	public function test_register_surfaces_row_without_field_uses_v1_defaults() {
		$this->require_desktop_mode_stubs();
		$row = array(
			'slug'    => 'default-register',
			'name'    => 'Default Register',
			'enabled' => true,
			// No 'surfaces' key at all.
		);

		self::$calls = array();
		oddout_apps_register_surfaces( $row );

		$window = $this->find_call( 'window', 'odd-app-default-register' );
		$icon   = $this->find_call( 'icon', 'odd-app-default-register' );

		$this->assertNotNull( $window );
		$this->assertSame( 'none', $window['args']['placement'], 'Default surfaces: no taskbar icon.' );
		$this->assertNotNull( $icon, 'Default surfaces: desktop icon on.' );
	}

	/**
	 * Helpers ---------------------------------------------------- */

	protected function find_row( $slug ) {
		$index = oddout_apps_index_load();
		return isset( $index[ $slug ] ) ? $index[ $slug ] : null;
	}

	protected function find_call( $fn_name, $id ) {
		foreach ( self::$calls as $call ) {
			if ( $call['fn'] === $fn_name && $call['id'] === $id ) {
				return $call;
			}
		}
		return null;
	}

	/**
	 * Desktop Mode's register helpers are normally provided by the
	 * host plugin. In the ODD PHPUnit matrix the host isn't loaded,
	 * so we define our own capturing shims the first time a test
	 * asks for them, and skip the test if something else already
	 * defined them with real behavior.
	 */
	protected function require_desktop_mode_stubs() {
		// Stubs are defined once per PHP process — the first test
		// that asks for them installs capturing shims under the
		// host-plugin names. Later tests reuse them. If `ODDOUT_TEST_DM_STUBS`
		// is not defined but the real functions exist, the host is
		// loaded and we skip rather than overwrite its contracts.
		if ( defined( 'ODDOUT_TEST_DM_STUBS' ) ) {
			return;
		}
		if ( function_exists( 'desktop_mode_register_window' ) || function_exists( 'desktop_mode_register_icon' ) ) {
			$this->markTestSkipped( 'Host Desktop Mode plugin is loaded — placement forwarding is covered by its own tests.' );
			return;
		}
		define( 'ODDOUT_TEST_DM_STUBS', 1 );
		if ( ! defined( 'DESKTOP_MODE_VERSION' ) ) {
			define( 'DESKTOP_MODE_VERSION', '0.8.5' );
		}
		// phpcs:disable
		eval(
			'function desktop_mode_is_enabled() {' .
			'  return true;' .
			'}' .
			'function desktop_mode_register_window( $id, $args = array() ) {' .
			'  Test_Apps_Surfaces::$calls[] = array( "fn" => "window", "id" => $id, "args" => $args );' .
			'  return true;' .
			'}' .
			'function desktop_mode_register_icon( $id, $args = array() ) {' .
			'  Test_Apps_Surfaces::$calls[] = array( "fn" => "icon", "id" => $id, "args" => $args );' .
			'  return true;' .
			'}'
		);
		// phpcs:enable
	}
}
