<?php
/**
 * Apps-only runtime contract tests.
 */

class ODDOUT_Apps_Only_Test extends WP_UnitTestCase {
	public function test_catalog_allows_only_apps() {
		$this->assertSame( array( 'app' ), oddout_catalog_allowed_types() );
		$this->assertSame( array( 'odd-notes' ), oddout_catalog_allowed_slugs() );
	}

	public function test_odd_notes_uses_read_capability() {
		$this->assertSame( 'read', oddout_apps_normalize_capability( 'read', 'odd-notes' ) );
		$this->assertSame( 'manage_options', oddout_apps_normalize_capability( 'read', 'untrusted-app' ) );
	}

	public function test_legacy_runtime_modules_are_not_loaded() {
		$this->assertFalse( function_exists( 'oddout_wallpaper_scenes' ) );
		$this->assertFalse( function_exists( 'oddout_icons_get_sets' ) );
		$this->assertFalse( function_exists( 'oddout_cursors_get_sets' ) );
	}

	public function test_notes_identifiers_are_stable() {
		$this->assertSame( 'odd-notes', oddout_notes_slug() );
		$this->assertSame( 'odd-app-odd-notes', oddout_notes_window_id() );
	}

	public function test_notes_rest_decodes_raw_json_when_transport_drops_content_type() {
		$payload = array(
			'title'       => 'Transport-safe note',
			'body'        => 'This mutation must not disappear.',
			'color'       => 'lilac',
			'tags'        => array( 'playground', 'odd' ),
			'favorite'    => true,
			'archived'    => false,
			'onDesktop'   => true,
			'public'      => true,
			'version'     => 3,
			'updatedAtMs' => 123456789,
		);
		$request = new WP_REST_Request( 'PATCH', '/odd-notes/v1/notes/42' );
		$request->set_header( 'Content-Type', 'text/plain' );
		$request->set_body( wp_json_encode( $payload ) );

		$controller = new ODDOUT_Notes_REST_Controller( new ODDOUT_Notes_Service() );
		$method     = new ReflectionMethod( $controller, 'json_input' );
		$method->setAccessible( true );

		$this->assertSame( $payload, $method->invoke( $controller, $request ) );
	}

	public function test_notes_updates_use_playground_safe_editable_post_transport() {
		$script_path = dirname( ODDOUT_DIR ) . '/_tools/catalog-sources/apps/odd-notes/bundle-src/assets/js/odd-notes.min.js';
		$script      = file_get_contents( $script_path );

		$this->assertIsString( $script );
		$this->assertStringContainsString( 'return de(`notes/${o}`,{method:"POST",body:e,signal:t})', $script );
		$this->assertStringNotContainsString( 'method:"PATCH"', $script );
	}
}
