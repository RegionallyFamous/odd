<?php
/**
 * Tests for the central WP Desktop Mode dependency guard.
 *
 * The guard is the backbone of ODD's "never fatal when the host is
 * absent" promise (see reliability_first_d455d5d9 plan). These tests
 * exercise:
 *
 *   1. The guard helpers themselves — required vs optional host APIs,
 *      missing-function reporting, capability groups.
 *   2. Integration touchpoints that must no-op when host APIs are
 *      absent: oddout_apps_register_surfaces(), the OS-settings seeder
 *      in the starter pack runner, and the hooks registered from
 *      includes/native-window.php / includes/apps/native-surfaces.php.
 *
 * The default wp-phpunit matrix runs WITHOUT the Desktop Mode plugin
 * loaded, so most cases end up exercising the degraded path directly.
 * When a previous test in the process has eval-declared capturing
 * stubs (see test-apps-surfaces.php), we short-circuit the degraded
 * branch and skip instead — mixing eval'd stubs across tests would
 * leak state.
 */

class Test_Dependency_Guards extends WP_UnitTestCase {

	public function test_required_functions_list_is_stable() {
		$required = oddout_desktop_mode_required_functions();
		$this->assertIsArray( $required );
		$this->assertContains( 'desktop_mode_is_enabled', $required );
		$this->assertContains( 'desktop_mode_register_window', $required );
		$this->assertContains( 'desktop_mode_register_icon', $required );
	}

	public function test_capability_groups_are_defined() {
		$core           = oddout_desktop_mode_capability_functions( 'core' );
		$os_settings    = oddout_desktop_mode_capability_functions( 'os_settings' );
		$registry       = oddout_desktop_mode_capability_functions( 'registry' );
		$commands       = oddout_desktop_mode_capability_functions( 'commands' );
		$settings       = oddout_desktop_mode_capability_functions( 'settings' );
		$titlebar       = oddout_desktop_mode_capability_functions( 'titlebar' );
		$dock_rail      = oddout_desktop_mode_capability_functions( 'dock_rail' );
		$host_widgets   = oddout_desktop_mode_capability_functions( 'host_widgets' );
		$desktop_files  = oddout_desktop_mode_capability_functions( 'desktop_files' );
		$shared_folders = oddout_desktop_mode_capability_functions( 'shared_folders' );
		$presence       = oddout_desktop_mode_capability_functions( 'presence' );
		$heartbeat      = oddout_desktop_mode_capability_functions( 'heartbeat' );
		$debug          = oddout_desktop_mode_capability_functions( 'debug' );
		$ai             = oddout_desktop_mode_capability_functions( 'ai' );
		$window_chrome  = oddout_desktop_mode_capability_functions( 'window_chrome' );
		$unknown        = oddout_desktop_mode_capability_functions( 'does-not-exist' );
		$this->assertNotEmpty( $core );
		$this->assertContains( 'desktop_mode_get_os_settings', $os_settings );
		$this->assertContains( 'desktop_mode_save_os_settings', $os_settings );
		$this->assertContains( 'desktop_mode_default_os_settings', $os_settings );
		$this->assertContains( 'desktop_mode_native_window_registry', $registry );
		$this->assertContains( 'desktop_mode_register_command_script', $commands );
		$this->assertContains( 'desktop_mode_register_settings_tab_script', $settings );
		$this->assertContains( 'desktop_mode_register_settings_tab', $settings );
		$this->assertContains( 'desktop_mode_register_titlebar_button_script', $titlebar );
		$this->assertContains( 'desktop_mode_register_dock_rail_renderer_script', $dock_rail );
		$this->assertContains( 'desktop_mode_register_widget', $host_widgets );
		$this->assertContains( 'desktop_mode_register_file_type', $desktop_files );
		$this->assertContains( 'desktop_mode_register_file_opener', $desktop_files );
		$this->assertContains( 'desktop_mode_files_sharing_enabled_for', $shared_folders );
		$this->assertContains( 'desktop_mode_presence_snapshot', $presence );
		$this->assertContains( 'desktop_mode_register_heartbeat_widget', $heartbeat );
		$this->assertContains( 'desktop_mode_debug_publish', $debug );
		$this->assertContains( 'desktop_mode_debug_session_for_request', $debug );
		$this->assertContains( 'desktop_mode_register_ai_tool', $ai );
		$this->assertContains( 'desktop_mode_register_window_theme', $window_chrome );
		$this->assertContains( 'desktop_mode_register_window_chrome', $window_chrome );
		$this->assertSame( array(), $unknown, 'Unknown capabilities return an empty list, not null.' );
	}

	public function test_available_matches_missing_report() {
		$missing   = oddout_desktop_mode_missing_functions( 'core' );
		$available = oddout_desktop_mode_available();
		$this->assertSame( oddout_desktop_mode_version_available() && array() === $missing, $available );
	}

	public function test_desktop_mode_minimum_version_is_085() {
		$this->assertSame( '0.8.5', oddout_desktop_mode_min_version() );
		if ( defined( 'DESKTOP_MODE_VERSION' ) ) {
			$this->assertSame(
				version_compare( DESKTOP_MODE_VERSION, '0.8.5', '>=' ),
				oddout_desktop_mode_version_available()
			);
		} else {
			$this->assertSame( '', oddout_desktop_mode_version() );
			$this->assertFalse( oddout_desktop_mode_version_available() );
		}
	}

	public function test_supports_matches_missing_report_for_os_settings() {
		$missing   = oddout_desktop_mode_missing_functions( 'os_settings' );
		$supported = oddout_desktop_mode_supports( 'os_settings' );
		$this->assertSame( oddout_desktop_mode_version_available() && array() === $missing, $supported );
	}

	public function test_guard_fully_resolves_when_host_absent() {
		if ( oddout_desktop_mode_available() ) {
			$this->markTestSkipped( 'Host Desktop Mode loaded; degraded-path test skipped.' );
		}
		$missing = oddout_desktop_mode_missing_functions( 'core' );
		$this->assertNotEmpty( $missing );
		foreach ( $missing as $fn ) {
			$this->assertFalse( function_exists( $fn ), 'Missing function must actually be missing.' );
		}
	}

	public function test_apps_register_surfaces_is_noop_without_host() {
		if ( defined( 'ODDOUT_TEST_DM_STUBS' ) || oddout_desktop_mode_available() ) {
			$this->markTestSkipped( 'Host APIs are present (stubs or real); degraded-path test skipped.' );
		}
		// The call below would normally hit desktop_mode_register_window/
		// desktop_mode_register_icon. With the guard, it must exit
		// silently instead of fatalling on a missing function.
		oddout_apps_register_surfaces(
			array(
				'slug'    => 'guard-test-app',
				'enabled' => true,
				'name'    => 'Guarded App',
			)
		);
		$this->assertTrue( true, 'Reached this assertion without fatal.' );
	}

	public function test_starter_seed_host_wallpaper_is_noop_without_host() {
		if ( oddout_desktop_mode_supports( 'os_settings' ) ) {
			$this->markTestSkipped( 'Host OS-settings API available; degraded-path test skipped.' );
		}
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->assertFalse( oddout_starter_seed_host_wallpaper( $user_id ) );
	}

	public function test_ensure_host_engine_selected_is_noop_without_host() {
		if ( oddout_desktop_mode_supports( 'os_settings' ) || oddout_desktop_mode_supports( 'wallpaper' ) ) {
			$this->markTestSkipped( 'Host OS-settings + wallpaper APIs available; degraded-path test skipped.' );
		}
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->assertFalse( oddout_wallpaper_ensure_host_engine_selected( $user_id ) );
	}

	public function test_admin_notice_renders_when_host_is_missing() {
		if ( oddout_desktop_mode_available() ) {
			$this->markTestSkipped( 'Host Desktop Mode loaded; admin notice suppressed.' );
		}
		$admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin_id );

		ob_start();
		do_action( 'admin_notices' );
		$buffer = ob_get_clean();
		$this->assertStringContainsString( 'ODD requires WP Desktop Mode 0.8.5 or newer', $buffer );
	}

	public function test_desktop_mode_optional_capability_groups_cover_rc_surfaces() {
		$this->assertContains( 'desktop_mode_register_window_notice', oddout_desktop_mode_capability_functions( 'window_notices' ) );
		$this->assertContains( 'desktop_mode_pwa_force_replace_sw', oddout_desktop_mode_capability_functions( 'pwa' ) );
	}

	public function test_init_hook_does_not_call_missing_host_apis() {
		if ( oddout_desktop_mode_available() ) {
			$this->markTestSkipped( 'Host Desktop Mode loaded; degraded-path test skipped.' );
		}
		// Re-firing init is safe here: the guard makes every
		// Desktop Mode integration no-op, so the only observable
		// signal is "no fatal".
		do_action( 'init' );
		$this->assertTrue( true, 'init dispatched without touching missing host APIs.' );
	}
}
