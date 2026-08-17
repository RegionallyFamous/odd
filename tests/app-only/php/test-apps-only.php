<?php
/**
 * Apps-only runtime contract tests.
 */

class ODDOUT_Apps_Only_Test extends WP_UnitTestCase {
	public function test_catalog_allows_only_apps() {
		$this->assertSame( array( 'app' ), oddout_catalog_allowed_types() );
		$this->assertNull( oddout_catalog_allowed_slugs() );
	}

	public function test_catalog_accepts_new_apps_without_a_plugin_allowlist_update() {
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
						'slug' => 'future-app',
						'name' => 'ODD Future App',
					),
				),
			)
		);

		$this->assertSame( array( 'workbench', 'future-app' ), wp_list_pluck( $registry['bundles'], 'slug' ) );
	}

	public function test_apps_list_publishes_every_valid_installed_app() {
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
				'future-app'     => array(
					'slug'    => 'future-app',
					'name'    => 'ODD Future App',
					'version' => '1.0.0',
				),
			)
		);

		try {
			$this->assertSame( array( 'future-app', 'odd-notes', 'workbench' ), wp_list_pluck( oddout_apps_list(), 'slug' ) );
		} finally {
			oddout_apps_index_save( $original );
		}
	}

	public function test_host_can_narrow_the_catalog_slug_policy() {
		$policy = static function () {
			return array( 'workbench' );
		};
		add_filter( 'oddout_catalog_allowed_slugs', $policy );

		try {
			$registry = oddout_catalog_normalise(
				array(
					'version' => 1,
					'bundles' => array(
						array( 'type' => 'app', 'slug' => 'workbench', 'name' => 'ODD Workbench' ),
						array( 'type' => 'app', 'slug' => 'future-app', 'name' => 'ODD Future App' ),
					),
				)
			);
			$this->assertSame( array( 'workbench' ), wp_list_pluck( $registry['bundles'], 'slug' ) );
		} finally {
			remove_filter( 'oddout_catalog_allowed_slugs', $policy );
		}
	}

	public function test_iframe_app_template_renders_a_sandboxed_frame() {
		ob_start();
		oddout_apps_render_window_template(
			'workbench',
			array(
				'name' => 'ODD Workbench',
			)
		);
		$html = ob_get_clean();

		$this->assertStringContainsString( '<iframe', $html );
		$this->assertStringContainsString( 'data-odd-app-slug="workbench"', $html );
		$this->assertStringContainsString( 'title="ODD Workbench"', $html );
		$this->assertStringContainsString( 'sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads"', $html );
		$this->assertStringContainsString( 'allow="clipboard-read; clipboard-write"', $html );
		$this->assertStringContainsString( 'position:relative;width:100%;height:100%;min-height:0', $html );
		$this->assertStringContainsString( 'display:block;width:100%;height:100%', $html );
		$this->assertStringNotContainsString( 'inset:', $html );
	}

	public function test_iframe_app_survives_openstation_template_escaping() {
		$source = '<iframe class="odd-app-frame" title="Workbench" src="https://example.test/odd-app/workbench/" sandbox="allow-scripts allow-same-origin" loading="eager" referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write" style="width:100%" onclick="alert(1)"></iframe>';
		$clean  = wp_kses(
			$source,
			oddout_apps_allow_iframe_template_html( wp_kses_allowed_html( 'post' ) )
		);

		$this->assertStringContainsString( '<iframe', $clean );
		$this->assertStringContainsString( 'src="https://example.test/odd-app/workbench/"', $clean );
		$this->assertStringContainsString( 'sandbox="allow-scripts allow-same-origin"', $clean );
		$this->assertStringContainsString( 'allow="clipboard-read; clipboard-write"', $clean );
		$this->assertStringNotContainsString( 'onclick=', $clean );
	}

	public function test_odd_notes_uses_read_capability() {
		$this->assertSame( 'read', oddout_apps_normalize_capability( 'read', 'odd-notes' ) );
		$this->assertSame( 'manage_options', oddout_apps_normalize_capability( 'read', 'untrusted-app' ) );
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

	public function test_playground_shell_urls_stay_inside_the_active_scope() {
		$original_host = isset( $_SERVER['HTTP_HOST'] ) ? $_SERVER['HTTP_HOST'] : null;
		$original_uri  = isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : null;
		$_SERVER['HTTP_HOST']    = 'playground.wordpress.net';
		$_SERVER['REQUEST_URI']  = '/scope:odd-live-test/wp-admin/index.php?desktop_mode_portal=1';

		try {
			$config = oddout_playground_scope_openstation_config(
				array(
					'adminUrl'   => 'http://playground.wordpress.net/wp-admin/',
					'currentPage'=> 'http://playground.wordpress.net/wp-admin/index.php',
					'restUrl'    => 'http://playground.wordpress.net/wp-json/',
					'pwa'        => array(
						'manifestUrl' => 'http://playground.wordpress.net/manifest.webmanifest',
						'swUrl'       => 'http://playground.wordpress.net/sw.js',
					),
				)
			);

			$this->assertSame( 'https://playground.wordpress.net/scope:odd-live-test/wp-admin/', $config['adminUrl'] );
			$this->assertSame( 'https://playground.wordpress.net/scope:odd-live-test/wp-admin/index.php', $config['currentPage'] );
			$this->assertSame( 'https://playground.wordpress.net/scope:odd-live-test/wp-json/', $config['restUrl'] );
			$this->assertSame( '', $config['pwa']['manifestUrl'] );
			$this->assertSame( '', $config['pwa']['swUrl'] );
		} finally {
			if ( null === $original_host ) {
				unset( $_SERVER['HTTP_HOST'] );
			} else {
				$_SERVER['HTTP_HOST'] = $original_host;
			}
			if ( null === $original_uri ) {
				unset( $_SERVER['REQUEST_URI'] );
			} else {
				$_SERVER['REQUEST_URI'] = $original_uri;
			}
		}
	}

	public function test_non_playground_shell_config_is_unchanged() {
		$original_host = isset( $_SERVER['HTTP_HOST'] ) ? $_SERVER['HTTP_HOST'] : null;
		$_SERVER['HTTP_HOST'] = 'example.test';
		$config = array( 'adminUrl' => 'http://example.test/wp-admin/' );

		try {
			$this->assertSame( $config, oddout_playground_scope_openstation_config( $config ) );
		} finally {
			if ( null === $original_host ) {
				unset( $_SERVER['HTTP_HOST'] );
			} else {
				$_SERVER['HTTP_HOST'] = $original_host;
			}
		}
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

		$this->assertTrue( $method->invoke( $service, $input, $current ) );
		$input['body'] = 'A genuinely different draft.';
		$this->assertFalse( $method->invoke( $service, $input, $current ) );
	}
}
