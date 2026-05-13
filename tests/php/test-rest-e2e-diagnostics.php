<?php
/**
 * REST: GET /odd/v1/e2e-diagnostics
 */

class Test_REST_E2E_Diagnostics extends ODDOUT_REST_Test_Case {

	public function test_get_requires_login() {
		$this->log_out();
		$res = $this->dispatch_json( 'GET', '/odd/v1/e2e-diagnostics' );
		$this->assertSame( 401, $res->get_status(), 'Logged-out GET must 401.' );
	}

	public function test_get_forbidden_for_non_admin() {
		$sub = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$this->login_as( $sub );
		$res = $this->dispatch_json( 'GET', '/odd/v1/e2e-diagnostics' );
		$this->assertSame( 403, $res->get_status(), 'Subscriber must not access diagnostics.' );
	}

	public function test_get_returns_payload_for_admin() {
		$this->login_as();
		$res = $this->dispatch_json( 'GET', '/odd/v1/e2e-diagnostics' );
		$this->assertSame( 200, $res->get_status() );
		$data = $res->get_data();
		$this->assertIsArray( $data );
		$this->assertArrayHasKey( 'schema', $data );
		$this->assertSame( 1, $data['schema'] );
		// phpcs:ignore WordPress.WP.CapitalPDangit.MisspelledInText -- JSON field name from REST.
		$this->assertArrayHasKey( 'wordpress', $data );
		$this->assertArrayHasKey( 'version', $data['wordpress'] );
		$this->assertArrayHasKey( 'siteUrl', $data['wordpress'] );
		$this->assertArrayHasKey( 'odd', $data );
		$this->assertArrayHasKey( 'version', $data['odd'] );
		$this->assertSame( ODDOUT_VERSION, $data['odd']['version'] );
		$this->assertArrayHasKey( 'plugins', $data );
		$this->assertIsArray( $data['plugins'] );
		$this->assertArrayHasKey( 'wallpaper', $data );
		$this->assertArrayHasKey( 'sceneSlugs', $data['wallpaper'] );
	}
}
