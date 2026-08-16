<?php
/**
 * Apps-only runtime contract tests.
 */

class ODDOUT_Apps_Only_Test extends WP_UnitTestCase {
	public function test_catalog_allows_only_apps() {
		$this->assertSame( array( 'app' ), oddout_catalog_allowed_types() );
		$this->assertSame( array( 'odd-notes', 'workbench' ), oddout_catalog_allowed_slugs() );
	}

	public function test_catalog_keeps_workbench_and_drops_unapproved_apps() {
		$registry = oddout_catalog_normalise(
			array(
				'version' => 1,
				'bundles' => array(
					array(
						'type' => 'app',
						'slug' => 'workbench',
						'name' => 'ODD Workbench',
					),
					array(
						'type' => 'app',
						'slug' => 'unapproved-app',
						'name' => 'Unapproved App',
					),
				),
			)
		);

		$this->assertSame( array( 'workbench' ), wp_list_pluck( $registry['bundles'], 'slug' ) );
	}

	public function test_apps_list_publishes_workbench_and_hides_unapproved_apps() {
		$original = oddout_apps_index_load();
		oddout_apps_index_save(
			array(
				'odd-notes'      => array(
					'slug'    => 'odd-notes',
					'name'    => 'ODD Notes',
					'version' => '1.3.0',
				),
				'workbench'      => array(
					'slug'    => 'workbench',
					'name'    => 'ODD Workbench',
					'version' => '1.0.0',
				),
				'unapproved-app' => array(
					'slug'    => 'unapproved-app',
					'name'    => 'Unapproved App',
					'version' => '1.0.0',
				),
			)
		);

		try {
			$this->assertSame( array( 'odd-notes', 'workbench' ), wp_list_pluck( oddout_apps_list(), 'slug' ) );
		} finally {
			oddout_apps_index_save( $original );
		}
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
		$source_path = dirname( ODDOUT_DIR ) . '/_tools/catalog-sources/apps/odd-notes/src/api.ts';
		$source      = file_get_contents( $source_path );

		$this->assertIsString( $source );
		$this->assertStringContainsString( "method: 'POST'", $source );
		$this->assertStringNotContainsString( "method: 'PATCH'", $source );
	}

	public function test_notes_draft_scope_is_stable_per_installation() {
		delete_option( 'oddout_notes_draft_scope' );
		$first  = oddout_notes_draft_scope();
		$second = oddout_notes_draft_scope();

		$this->assertSame( $first, $second );
		$this->assertMatchesRegularExpression( '/^[a-f0-9-]{36}$/i', $first );
	}

	public function test_stale_idempotent_note_mutation_matches_current_copy() {
		$current = array(
			'title'     => 'Already saved',
			'body'      => 'WordPress has these words.',
			'color'     => 'butter',
			'tags'      => array( 'odd', 'notes' ),
			'favorite'  => false,
			'archived'  => false,
			'onDesktop' => false,
			'public'    => false,
		);
		$input   = $current + array(
			'version'     => 1,
			'updatedAtMs' => 123,
		);

		$service = new ODDOUT_Notes_Service();
		$method  = new ReflectionMethod( $service, 'input_matches_note' );
		$method->setAccessible( true );

		$this->assertTrue( $method->invoke( $service, $input, $current ) );
		$input['body'] = 'A genuinely different draft.';
		$this->assertFalse( $method->invoke( $service, $input, $current ) );
	}
}
