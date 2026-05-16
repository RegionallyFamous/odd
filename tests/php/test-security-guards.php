<?php
/**
 * Security guardrails for REST permissions and path confinement.
 */

class Test_Security_REST_Permissions extends ODDOUT_REST_Test_Case {

	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		set_transient(
			ODDOUT_CATALOG_TRANSIENT,
			array(
				'api_version' => defined( 'ODDOUT_CATALOG_API_VERSION' ) ? ODDOUT_CATALOG_API_VERSION : '2.3.0',
				'bundles'     => array(),
			),
			HOUR_IN_SECONDS
		);
	}

	public function test_catalog_is_user_local_read_and_privileged_mutation() {
		$this->log_out();
		$res = $this->dispatch_json( 'GET', '/odd/v1/bundles/catalog' );
		$this->assertSame( 401, $res->get_status(), 'Logged-out users cannot read the catalog REST shape.' );

		$this->login_as( $this->subscriber_id );
		$res = $this->dispatch_json( 'GET', '/odd/v1/bundles/catalog' );
		$this->assertSame( 200, $res->get_status(), 'Subscribers can read the user-facing catalog.' );

		$res = $this->dispatch_json( 'POST', '/odd/v1/bundles/refresh' );
		$this->assertSame( 403, $res->get_status(), 'Subscribers cannot refresh the remote catalog.' );

		$res = $this->dispatch_json( 'GET', '/odd/v1/bundles/catalog-meta' );
		$this->assertSame( 403, $res->get_status(), 'Subscribers cannot read catalog diagnostics metadata.' );

		$this->login_as();
		$res = $this->dispatch_json( 'GET', '/odd/v1/bundles/catalog-meta' );
		$this->assertSame( 200, $res->get_status(), 'Admins can read catalog diagnostics metadata.' );
	}

	public function test_app_diagnostics_are_admin_only() {
		$this->log_out();
		$res = $this->dispatch_json( 'GET', '/odd/v1/apps/diag/demo' );
		$this->assertSame( 401, $res->get_status() );

		$this->login_as( $this->subscriber_id );
		$res = $this->dispatch_json( 'GET', '/odd/v1/apps/diag/demo' );
		$this->assertSame( 403, $res->get_status() );

		$this->login_as();
		$res = $this->dispatch_json( 'GET', '/odd/v1/apps/diag/demo' );
		$this->assertNotSame( 403, $res->get_status() );
	}

	public function test_app_store_payload_size_is_limited() {
		$this->login_as( $this->subscriber_id );
		$res = $this->dispatch_json(
			'PUT',
			'/odd/v1/apps/store/demo/state',
			array(
				'value' => str_repeat( 'x', 70 * 1024 ),
			)
		);

		$this->assertSame( 400, $res->get_status() );
		$this->assertSame( 'rest_invalid_param', $res->get_data()['code'] );
	}
}

class Test_Security_Path_Guards extends WP_UnitTestCase {

	public function test_app_relative_paths_reject_traversal_and_backslashes() {
		$this->assertTrue( oddout_apps_relative_path_is_safe( 'assets/app.js' ) );
		$this->assertFalse( oddout_apps_relative_path_is_safe( '../secret.js' ) );
		$this->assertFalse( oddout_apps_relative_path_is_safe( '/secret.js' ) );
		$this->assertFalse( oddout_apps_relative_path_is_safe( 'assets\\secret.js' ) );
		$this->assertFalse( oddout_apps_relative_path_is_safe( "assets/app.js\0.txt" ) );
	}

	public function test_realpath_confinement_is_boundary_aware() {
		$this->assertTrue( oddout_apps_realpath_is_inside( '/tmp/odd/apps/demo/index.html', '/tmp/odd/apps/demo' ) );
		$this->assertFalse( oddout_apps_realpath_is_inside( '/tmp/odd/apps/demo-copy/index.html', '/tmp/odd/apps/demo' ) );
	}

	public function test_archive_entry_paths_reject_backslashes_and_absolute_paths() {
		$this->assertTrue( oddout_content_archive_entry_path_is_safe( 'assets/icon.webp' ) );
		$this->assertTrue( oddout_content_archive_entry_path_is_safe( 'assets/' ) );
		$this->assertFalse( oddout_content_archive_entry_path_is_safe( '../manifest.json' ) );
		$this->assertFalse( oddout_content_archive_entry_path_is_safe( '/manifest.json' ) );
		$this->assertFalse( oddout_content_archive_entry_path_is_safe( 'assets\\icon.webp' ) );
		$this->assertFalse( oddout_content_archive_entry_path_is_safe( "assets/icon.webp\0" ) );
	}
}
