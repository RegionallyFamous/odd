<?php
/**
 * Apps-only runtime contract tests.
 */

class ODDOUT_Apps_Only_Test extends WP_UnitTestCase {
	/**
	 * Build the fixture manifest for one shared parity case.
	 *
	 * @param array $base Base manifest.
	 * @param array $fixture_case Fixture case.
	 * @return array
	 */
	private function manifest_for_parity_case( array $base, array $fixture_case ) {
		if ( isset( $fixture_case['overrides'] ) && is_array( $fixture_case['overrides'] ) ) {
			$base = array_replace( $base, $fixture_case['overrides'] );
		}
		if ( ! empty( $fixture_case['omit'] ) ) {
			unset( $base[ $fixture_case['field'] ] );
			return $base;
		}
		if ( ! empty( $fixture_case['emptyObject'] ) ) {
			$value = (object) array();
		} elseif ( array_key_exists( 'repeat', $fixture_case ) ) {
			$value = str_repeat( $fixture_case['repeat'], (int) $fixture_case['count'] );
		} else {
			$value = $fixture_case['value'];
		}
		if ( ! empty( $fixture_case['nestedField'] ) ) {
			$base[ $fixture_case['field'] ][ $fixture_case['nestedField'] ] = $value;
		} else {
			$base[ $fixture_case['field'] ] = $value;
		}
		return $base;
	}

	/**
	 * Exercise a manifest through the public bundle validation/install entry.
	 * Valid cases can seed an existing slug so success is demonstrated by
	 * reaching the post-validation slug conflict without mutating app files.
	 *
	 * @param array $manifest             Manifest under test.
	 * @param bool  $stop_after_validation Whether to seed a slug conflict.
	 * @return array|WP_Error
	 */
	private function install_manifest_through_public_bundle_path( array $manifest, $stop_after_validation = false, array $archive_files = array() ) {
		$tmp_path = $this->create_transaction_archive( $manifest, $archive_files );
		$original = null;
		if ( $stop_after_validation ) {
			$original = oddout_apps_index_load();
			$slug     = sanitize_key( (string) $manifest['slug'] );
			$blocked  = $original;
			$blocked[ $slug ] = array(
				'slug'    => $slug,
				'name'    => 'Existing parity fixture',
				'version' => '1.0.0',
			);
			oddout_apps_index_save( $blocked );
		}
		try {
			return oddout_bundle_install( $tmp_path, 'manifest-parity.wp' );
		} finally {
			wp_delete_file( $tmp_path );
			if ( is_array( $original ) ) {
				oddout_apps_index_save( $original );
			}
		}
	}

	/**
	 * Validate a manifest in a minimal stored .wp archive.
	 *
	 * Stored entries prevent deliberately repetitive boundary strings from
	 * triggering the compression-ratio guard before manifest validation.
	 *
	 * @param array $manifest Manifest under test.
	 * @return array|WP_Error
	 */
	private function validate_manifest_archive( array $manifest, array $archive_files = array() ) {
		$tmp_path = wp_tempnam( 'odd-manifest-parity.wp' );
		$this->assertNotFalse( $tmp_path );

		$zip = new ZipArchive();
		$this->assertTrue( $zip->open( $tmp_path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) );
		$this->assertTrue( $zip->addFromString( 'manifest.json', wp_json_encode( $manifest ) ) );
		$this->assertTrue( $zip->addFromString( 'index.html', '<!doctype html><html><body></body></html>' ) );
		$this->assertTrue( $zip->addFromString( 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>' ) );
		foreach ( $archive_files as $path => $contents ) {
			$this->assertTrue( $zip->addFromString( (string) $path, (string) $contents ) );
		}
		foreach ( array_merge( array( 'manifest.json', 'index.html', 'icon.svg' ), array_keys( $archive_files ) ) as $entry ) {
			$this->assertTrue( $zip->setCompressionName( $entry, ZipArchive::CM_STORE ) );
		}
		$this->assertTrue( $zip->close() );

		try {
			return oddout_apps_validate_archive( $tmp_path, 'manifest-parity.wp' );
		} finally {
			wp_delete_file( $tmp_path );
		}
	}

	/**
	 * Create a minimal valid app archive for transaction tests.
	 *
	 * @param array $manifest Manifest to store at the archive root.
	 * @return string Temporary archive path.
	 */
	private function create_transaction_archive( array $manifest, array $archive_files = array() ) {
		$tmp_path = wp_tempnam( 'odd-transaction.wp' );
		$this->assertNotFalse( $tmp_path );

		$zip = new ZipArchive();
		$this->assertTrue( $zip->open( $tmp_path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) );
		$this->assertTrue( $zip->addFromString( 'manifest.json', wp_json_encode( $manifest ) ) );
		$this->assertTrue( $zip->addFromString( 'index.html', '<!doctype html><html><body>transaction candidate</body></html>' ) );
		$this->assertTrue( $zip->addFromString( 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>' ) );
		foreach ( $archive_files as $path => $contents ) {
			$this->assertTrue( $zip->addFromString( (string) $path, (string) $contents ) );
		}
		foreach ( array_merge( array( 'manifest.json', 'index.html', 'icon.svg' ), array_keys( $archive_files ) ) as $entry ) {
			$this->assertTrue( $zip->setCompressionName( $entry, ZipArchive::CM_STORE ) );
		}
		$this->assertTrue( $zip->close() );

		return $tmp_path;
	}

	/**
	 * Build a portable nested relative path with an exact byte length.
	 *
	 * @param int    $length Total path length.
	 * @param string $suffix Final filename suffix.
	 * @return string
	 */
	private function relative_path_with_length( $length, $suffix ) {
		$remaining = (int) $length - strlen( $suffix );
		$parts     = array();
		while ( $remaining > 120 ) {
			$parts[]   = str_repeat( 'a', 120 );
			$remaining -= 121;
		}
		$parts[] = str_repeat( 'a', $remaining ) . $suffix;
		return implode( '/', $parts );
	}

	private function restore_option_fixture( $key, $value ) {
		if ( false === $value ) {
			delete_option( $key );
		} else {
			update_option( $key, $value, false );
		}
	}

	private function restore_transient_fixture( $key, $value, $expiration ) {
		if ( false === $value ) {
			delete_transient( $key );
		} else {
			set_transient( $key, $value, $expiration );
		}
	}

	private function catalog_registry_fixture( $hash ) {
		$registry = json_decode( file_get_contents( ODDOUT_DIR . 'data/fallback-registry.json' ), true );
		$this->assertIsArray( $registry );
		$registry['_oddout_registry_sha256'] = (string) $hash;
		$registry['_oddout_accepted_at']     = time();
		return $registry;
	}

	public function test_archive_manifest_validation_matches_schema_parity_fixtures() {
		$fixtures_dir = dirname( ODDOUT_DIR ) . '/tests/fixtures';

		$base  = json_decode( file_get_contents( $fixtures_dir . '/manifests/app-ok.json' ), true );
		$cases = json_decode( file_get_contents( $fixtures_dir . '/manifest-parity-cases.json' ), true );

		$this->assertIsArray( $base );
		$this->assertIsArray( $cases );
		foreach ( $cases['invalid'] as $case ) {
			$manifest      = $this->manifest_for_parity_case( $base, $case );
			$archive_files = isset( $case['archiveFiles'] ) && is_array( $case['archiveFiles'] ) ? $case['archiveFiles'] : array();
			$result        = $this->validate_manifest_archive( $manifest, $archive_files );
			$this->assertWPError( $result, $case['label'] );
			$this->assertSame( $case['phpError'], $result->get_error_code(), $case['label'] );

			$public = $this->install_manifest_through_public_bundle_path( $manifest, false, $archive_files );
			$this->assertWPError( $public, $case['label'] . ' (public bundle path)' );
			$this->assertSame( isset( $case['publicError'] ) ? $case['publicError'] : $case['phpError'], $public->get_error_code(), $case['label'] . ' (public bundle path)' );
		}
		foreach ( $cases['valid'] as $case ) {
			$manifest      = $this->manifest_for_parity_case( $base, $case );
			$archive_files = isset( $case['archiveFiles'] ) && is_array( $case['archiveFiles'] ) ? $case['archiveFiles'] : array();
			$result        = $this->validate_manifest_archive( $manifest, $archive_files );
			$this->assertIsArray( $result, $case['label'] );
			if ( ! empty( $case['assertNativeOptionalKeysOmitted'] ) ) {
				$this->assertSame( $manifest['native'], $result['native'], $case['label'] );
			}

			$public = $this->install_manifest_through_public_bundle_path( $manifest, true, $archive_files );
			$this->assertWPError( $public, $case['label'] . ' (public bundle path)' );
			$this->assertSame( 'slug_exists', $public->get_error_code(), $case['label'] . ' (public validation accepted the manifest)' );
		}
	}

	public function test_public_native_install_preserves_safe_double_dot_paths_without_inventing_optional_fields() {
		$fixtures_dir = dirname( ODDOUT_DIR ) . '/tests/fixtures';
		$base         = json_decode( file_get_contents( $fixtures_dir . '/manifests/app-ok.json' ), true );
		$cases        = json_decode( file_get_contents( $fixtures_dir . '/manifest-parity-cases.json' ), true );
		$fixture_case = null;
		foreach ( $cases['valid'] as $case ) {
			if ( ! empty( $case['assertNativeOptionalKeysOmitted'] ) ) {
				$fixture_case = $case;
				break;
			}
		}
		$this->assertIsArray( $fixture_case );
		$manifest      = $this->manifest_for_parity_case( $base, $fixture_case );
		$archive_files = $fixture_case['archiveFiles'];
		$normalised    = $this->validate_manifest_archive( $manifest, $archive_files );
		$this->assertIsArray( $normalised );
		$this->assertSame( $manifest['native'], $normalised['native'] );
		$this->assertSame( 'foo..bar.html', $normalised['entry'] );
		$this->assertSame( 'icon..alt.svg', $normalised['icon'] );

		$slug         = 'odd-notes';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$backup       = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.phpunit-native-parity-' . wp_generate_password( 8, false );
		$original     = oddout_apps_index_load();
		$old_manifest = oddout_apps_manifest_load( $slug );
		$tmp_path     = $this->create_transaction_archive( $manifest, $archive_files );
		$had_final    = is_dir( $final );
		$moved_final  = false;

		try {
			if ( $had_final ) {
				$this->assertTrue( rename( $final, $backup ) );
				$moved_final = true;
			}
			$without = $original;
			unset( $without[ $slug ] );
			oddout_apps_index_save( $without );
			oddout_apps_manifest_delete( $slug );

			$public = oddout_bundle_install( $tmp_path, 'odd-notes-native-parity.wp' );
			$this->assertIsArray( $public );
			$this->assertSame( $slug, $public['slug'] );
			$this->assertSame( $manifest['native'], $public['manifest']['native'] );
			$this->assertSame( 'foo..bar.html', $public['manifest']['entry'] );
			$this->assertSame( 'icon..alt.svg', $public['manifest']['icon'] );
			$this->assertArrayNotHasKey( 'style', $public['manifest']['native'] );
			$this->assertArrayNotHasKey( 'template', $public['manifest']['native'] );

			$stored = oddout_apps_manifest_load( $slug );
			$this->assertSame( $manifest['native'], $stored['native'] );
			$this->assertSame( 'foo..bar.html', $stored['entry'] );
			$this->assertSame( 'icon..alt.svg', $stored['icon'] );
			$this->assertArrayNotHasKey( 'style', $stored['native'] );
			$this->assertArrayNotHasKey( 'template', $stored['native'] );
		} finally {
			wp_delete_file( $tmp_path );
			if ( ! $had_final || $moved_final ) {
				oddout_apps_rrmdir( $final );
			}
			oddout_apps_manifest_delete( $slug );
			delete_option( oddout_apps_transaction_option_key( $slug ) );
			delete_option( oddout_apps_install_lock_key( $slug ) );
			delete_option( oddout_apps_index_lock_key() );
			oddout_apps_index_save( $original );
			if ( $old_manifest ) {
				oddout_apps_manifest_save( $slug, $old_manifest );
			}
			if ( $moved_final ) {
				$this->assertTrue( rename( $backup, $final ) );
			}
		}
	}

	public function test_archive_parent_component_is_rejected_without_banning_safe_double_dots() {
		$fixtures_dir = dirname( ODDOUT_DIR ) . '/tests/fixtures';
		$manifest     = json_decode( file_get_contents( $fixtures_dir . '/manifests/app-ok.json' ), true );
		$tmp_path     = $this->create_transaction_archive( $manifest, array( '../escape.txt' => 'unsafe traversal fixture' ) );

		$this->assertTrue( oddout_content_archive_entry_path_is_safe( 'assets/foo..bar.js' ) );
		$this->assertFalse( oddout_content_archive_entry_path_is_safe( 'assets/../escape.js' ) );
		$this->assertSame( 'assets/foo..bar.js', oddout_content_sanitize_relative_path( 'assets/foo..bar.js' ) );
		$this->assertSame( '', oddout_content_sanitize_relative_path( 'assets/../escape.js' ) );

		try {
			$internal = oddout_apps_validate_archive( $tmp_path, 'parent-component.wp' );
			$this->assertWPError( $internal );
			$this->assertSame( 'path_traversal', $internal->get_error_code() );

			$public = oddout_bundle_install( $tmp_path, 'parent-component.wp' );
			$this->assertWPError( $public );
			$this->assertSame( 'path_traversal', $public->get_error_code() );
		} finally {
			wp_delete_file( $tmp_path );
		}
	}

	public function test_rest_and_cookieauth_serve_path_guard_allows_safe_double_dots_but_rejects_parent_components() {
		$rest_path_arg = oddout_apps_rest_path_arg();
		$rest_validate = $rest_path_arg['validate_callback'];
		$safe_paths    = array( 'foo..bar.html', 'icon..alt.svg', 'assets/foo..bar.js' );
		$unsafe_paths  = array( '..', '../escape.js', 'assets/../escape.js', 'assets/..' );

		foreach ( $safe_paths as $path ) {
			$this->assertTrue( oddout_apps_relative_path_is_safe( $path ), $path . ' (cookie-auth shared guard)' );
			$this->assertTrue( $rest_validate( $path ), $path . ' (REST route validator)' );
		}
		foreach ( $unsafe_paths as $path ) {
			$this->assertFalse( oddout_apps_relative_path_is_safe( $path ), $path . ' (cookie-auth shared guard)' );
			$this->assertFalse( $rest_validate( $path ), $path . ' (REST route validator)' );
		}

		$cookieauth  = new ReflectionFunction( 'oddout_apps_serve_cookieauth' );
		$rest        = new ReflectionFunction( 'oddout_apps_rest_serve' );
		$source      = file( ODDOUT_DIR . 'includes/apps/serve-cookieauth.php' );
		$rest_source = file( ODDOUT_DIR . 'includes/apps/rest.php' );
		$this->assertStringContainsString(
			'oddout_apps_relative_path_is_safe( $path )',
			implode( '', array_slice( $source, $cookieauth->getStartLine() - 1, $cookieauth->getEndLine() - $cookieauth->getStartLine() + 1 ) )
		);
		$this->assertStringContainsString(
			'oddout_apps_relative_path_is_safe( $path )',
			implode( '', array_slice( $rest_source, $rest->getStartLine() - 1, $rest->getEndLine() - $rest->getStartLine() + 1 ) )
		);
	}

	public function test_installed_app_serve_path_allows_a_safe_path_longer_than_512_bytes() {
		$fixtures_dir = dirname( ODDOUT_DIR ) . '/tests/fixtures';
		$manifest     = json_decode( file_get_contents( $fixtures_dir . '/manifests/app-ok.json' ), true );
		$slug         = 'long-serve-path';
		$entry        = $this->relative_path_with_length( 600, '.html' );
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$backup       = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.phpunit-long-serve-' . wp_generate_password( 8, false );
		$original     = oddout_apps_index_load();
		$old_manifest = oddout_apps_manifest_load( $slug );
		$had_final    = is_dir( $final );
		$moved_final  = false;

		$manifest['slug']  = $slug;
		$manifest['name']  = 'Long serve path';
		$manifest['entry'] = $entry;
		$tmp_path          = $this->create_transaction_archive(
			$manifest,
			array( $entry => '<!doctype html><html><body>long serve path</body></html>' )
		);

		try {
			if ( $had_final ) {
				$this->assertTrue( rename( $final, $backup ) );
				$moved_final = true;
			}
			$without = $original;
			unset( $without[ $slug ] );
			oddout_apps_index_save( $without );
			oddout_apps_manifest_delete( $slug );

			$this->assertGreaterThan( 512, strlen( $entry ) );
			$this->assertTrue( oddout_apps_relative_path_is_safe( $entry ) );
			$this->assertTrue( oddout_apps_rest_path_arg()['validate_callback']( $entry ) );

			$installed = oddout_bundle_install( $tmp_path, 'long-serve-path.wp' );
			$this->assertIsArray( $installed );
			$this->assertSame( $entry, $installed['manifest']['entry'] );

			$probe = oddout_apps_diag_file_probe( $slug, $entry );
			$this->assertTrue( $probe['exists'] );
			$this->assertTrue( $probe['readable'] );
			$this->assertStringContainsString( 'long serve path', $probe['head'] );
		} finally {
			wp_delete_file( $tmp_path );
			oddout_apps_rrmdir( $final );
			oddout_apps_manifest_delete( $slug );
			delete_option( oddout_apps_transaction_option_key( $slug ) );
			delete_option( oddout_apps_install_lock_key( $slug ) );
			delete_option( oddout_apps_index_lock_key() );
			oddout_apps_index_save( $original );
			if ( $old_manifest ) {
				oddout_apps_manifest_save( $slug, $old_manifest );
			}
			if ( $moved_final ) {
				$this->assertTrue( rename( $backup, $final ) );
			}
		}
	}

	public function test_html_asset_paths_reject_percent_encoding_but_preserve_query_and_fragment_handling() {
		$fixtures_dir = dirname( ODDOUT_DIR ) . '/tests/fixtures';
		$manifest = json_decode( file_get_contents( $fixtures_dir . '/manifests/app-ok.json' ), true );

		$manifest['entry'] = 'encoded.html';
		$files = array(
			'encoded.html'  => '<!doctype html><script src="assets/app%2Ejs"></script>',
			'assets/app.js' => 'window.encodedFixture = true;',
		);

		$tmp_path = $this->create_transaction_archive( $manifest, $files );

		try {
			$internal = oddout_apps_validate_archive( $tmp_path, 'encoded-asset.wp' );
			$this->assertWPError( $internal );
			$this->assertSame( 'unsafe_asset_path', $internal->get_error_code() );

			$public = oddout_bundle_install( $tmp_path, 'encoded-asset.wp' );
			$this->assertWPError( $public );
			$this->assertSame( 'unsafe_asset_path', $public->get_error_code() );
		} finally {
			wp_delete_file( $tmp_path );
		}

		$files['encoded.html'] = '<!doctype html><script src="assets/app.js?label=app%20js#ready"></script>';
		$tmp_path              = $this->create_transaction_archive( $manifest, $files );
		try {
			$this->assertIsArray( oddout_apps_validate_archive( $tmp_path, 'query-fragment-asset.wp' ) );
			$public = $this->install_manifest_through_public_bundle_path( $manifest, true, $files );
			$this->assertWPError( $public );
			$this->assertSame( 'slug_exists', $public->get_error_code() );
		} finally {
			wp_delete_file( $tmp_path );
		}
	}

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
		$this->assertStringContainsString( 'data-odd-app-trust="verified-same-origin"', $html );
		$this->assertStringNotContainsString( 'allow-top-navigation', oddout_apps_iframe_sandbox_tokens() );
	}

	public function test_entry_html_receives_one_versioned_runtime_before_app_scripts() {
		$html     = '<!doctype html><html><head><script src="assets/app.js"></script></head><body></body></html>';
		$injected = oddout_apps_inject_runtime( $html, 'pantry' );

		$this->assertSame( 2, substr_count( $injected, 'data-odd-app-api="1"' ) );
		$this->assertStringContainsString( '"apiVersion":1', $injected );
		$this->assertStringContainsString( '"slug":"pantry"', $injected );
		$this->assertLessThan( strpos( $injected, 'assets/app.js' ), strpos( $injected, 'odd-browser-api-config' ) );
		$this->assertSame( $injected, oddout_apps_inject_runtime( $injected, 'pantry' ) );
	}

	public function test_app_store_requires_installed_enabled_capability_bound_app() {
		$original_index = oddout_apps_index_load();
		$original_user  = get_current_user_id();
		$subscriber     = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$request        = new WP_REST_Request( 'GET', '/odd/v1/apps/store/workbench/data' );
		$request->set_param( 'slug', 'workbench' );

		try {
			oddout_apps_index_save( array() );
			wp_set_current_user( $subscriber );
			$result = oddout_apps_rest_store_permission( $request );
			$this->assertWPError( $result );
			$this->assertSame( 'app_store_unavailable', $result->get_error_code() );

			oddout_apps_index_save(
				array(
					'workbench' => array(
						'slug'       => 'workbench',
						'enabled'    => true,
						'capability' => 'manage_options',
					),
				)
			);
			$result = oddout_apps_rest_store_permission( $request );
			$this->assertWPError( $result );
			$this->assertSame( 'app_store_forbidden', $result->get_error_code() );

			$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
			wp_set_current_user( $admin );
			$this->assertTrue( oddout_apps_rest_store_permission( $request ) );

			$disabled                             = oddout_apps_index_load();
			$disabled['workbench']['enabled']     = false;
			oddout_apps_index_save( $disabled );
			$result = oddout_apps_rest_store_permission( $request );
			$this->assertWPError( $result );
			$this->assertSame( 'app_store_unavailable', $result->get_error_code() );
		} finally {
			wp_set_current_user( $original_user );
			oddout_apps_index_save( $original_index );
		}
	}

	public function test_app_store_rejects_segment_value_and_shape_quota_overflow() {
		$too_many = array();
		for ( $i = 0; $i <= ODDOUT_APPS_KV_MAX_SEGMENTS; $i++ ) {
			$too_many[ 'segment-' . $i ] = $i;
		}
		$result = oddout_apps_kv_validate_stores( array( 'workbench' => $too_many ) );
		$this->assertWPError( $result );
		$this->assertSame( 'app_store_segment_quota', $result->get_error_code() );

		$this->assertFalse( oddout_apps_rest_store_value_is_valid( str_repeat( 'x', ODDOUT_APPS_KV_MAX_VALUE_BYTES + 1 ) ) );
		$deep = 'leaf';
		for ( $i = 0; $i <= ODDOUT_APPS_KV_MAX_DEPTH; $i++ ) {
			$deep = array( $deep );
		}
		$this->assertFalse( oddout_apps_rest_store_value_is_valid( $deep ) );

		$segment_arg = oddout_apps_rest_segment_arg();
		$this->assertFalse( $segment_arg['validate_callback']( str_repeat( 'a', ODDOUT_APPS_KV_MAX_SEGMENT_BYTES + 1 ) ) );
	}

	public function test_app_store_mutations_are_rate_limited_per_user() {
		$original_user = get_current_user_id();
		$admin         = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$limit         = static function ( $max, $action ) {
			return 'app_store_mutation' === $action ? 1 : $max;
		};
		$key = 'oddout_rl_v2_app_store_mutation_' . $admin . '_' . (int) floor( time() / 60 );
		add_filter( 'oddout_bundle_rate_limit_max', $limit, 10, 2 );
		delete_transient( $key );

		try {
			wp_set_current_user( $admin );
			$this->assertTrue( oddout_apps_rest_store_mutation_rate_limit() );
			$result = oddout_apps_rest_store_mutation_rate_limit();
			$this->assertWPError( $result );
			$this->assertSame( 'rest_too_many_requests', $result->get_error_code() );
		} finally {
			delete_transient( $key );
			remove_filter( 'oddout_bundle_rate_limit_max', $limit, 10 );
			wp_set_current_user( $original_user );
		}
	}

	public function test_app_replacement_promotion_can_restore_working_copy() {
		$slug    = 'transaction-test';
		$final   = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		wp_mkdir_p( $final );
		wp_mkdir_p( $staging );
		oddout_write_file( $final . '/version.txt', 'working' );
		oddout_write_file( $staging . '/version.txt', 'candidate' );

		try {
			$token = oddout_apps_promote_staged_archive( $staging, $slug );
			$this->assertIsArray( $token );
			$this->assertSame( 'candidate', file_get_contents( $final . '/version.txt' ) );
			oddout_apps_rollback_promoted_archive( $token );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
		}
	}

	public function test_interrupted_app_transaction_restores_files_and_metadata() {
		$slug     = 'transaction-recovery';
		$final    = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$backup   = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-phpunit';
		$old_row  = array( 'slug' => $slug, 'name' => 'Working', 'version' => '1.0.0', 'enabled' => false );
		$old_full = $old_row + array( 'type' => 'app', 'installed' => 123 );
		$original = oddout_apps_index_load();
		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $backup );
		wp_mkdir_p( $final );
		wp_mkdir_p( $backup );
		oddout_write_file( $final . '/version.txt', 'candidate' );
		oddout_write_file( $backup . '/version.txt', 'working' );
		oddout_apps_index_save( array( $slug => array( 'slug' => $slug, 'version' => '2.0.0' ) ) );
		oddout_apps_manifest_save( $slug, array( 'slug' => $slug, 'version' => '2.0.0' ) );
		update_option(
			oddout_apps_transaction_option_key( $slug ),
			array(
				'phase'        => 'promoted',
				'old_row'      => $old_row,
				'old_manifest' => $old_full,
				'promotion'    => array( 'final' => $final, 'backup' => $backup ),
			),
			false
		);

		try {
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_full, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( oddout_apps_transaction_option_key( $slug ), false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $backup );
			oddout_apps_manifest_delete( $slug );
			delete_option( oddout_apps_transaction_option_key( $slug ) );
			oddout_apps_index_save( $original );
		}
	}

	public function test_prepared_transaction_recovers_after_the_first_rename() {
		$slug         = 'transaction-first-rename';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging      = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$backup       = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-phpunit';
		$journal_key  = oddout_apps_transaction_option_key( $slug );
		$lock_key     = oddout_apps_install_lock_key( $slug );
		$old_row      = array( 'slug' => $slug, 'name' => 'Working', 'version' => '1.0.0', 'enabled' => false );
		$old_manifest = $old_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );
		$original     = oddout_apps_index_load();

		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		oddout_apps_rrmdir( $backup );
		wp_mkdir_p( $staging );
		wp_mkdir_p( $backup );
		oddout_write_file( $staging . '/version.txt', 'candidate' );
		oddout_write_file( $backup . '/version.txt', 'working' );
		oddout_apps_index_save( array( $slug => array( 'slug' => $slug, 'version' => '2.0.0' ) ) );
		oddout_apps_manifest_save( $slug, array( 'slug' => $slug, 'version' => '2.0.0' ) );
		update_option(
			$journal_key,
			array(
				'phase'        => 'backup_created',
				'old_row'      => $old_row,
				'old_manifest' => $old_manifest,
				'staging'      => $staging,
				'promotion'    => array(
					'staging'   => $staging,
					'final'     => $final,
					'backup'    => $backup,
					'had_final' => true,
				),
			),
			false
		);
		update_option( $lock_key, (string) ( time() - 11 * MINUTE_IN_SECONDS ), false );

		try {
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertDirectoryDoesNotExist( $staging );
			$this->assertDirectoryDoesNotExist( $backup );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
			oddout_apps_rrmdir( $backup );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_prepared_transaction_recovers_after_the_second_rename() {
		$slug         = 'transaction-second-rename';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging      = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$backup       = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-phpunit';
		$journal_key  = oddout_apps_transaction_option_key( $slug );
		$lock_key     = oddout_apps_install_lock_key( $slug );
		$old_row      = array( 'slug' => $slug, 'name' => 'Working', 'version' => '1.0.0', 'enabled' => true );
		$old_manifest = $old_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );
		$original     = oddout_apps_index_load();

		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		oddout_apps_rrmdir( $backup );
		wp_mkdir_p( $final );
		wp_mkdir_p( $backup );
		oddout_write_file( $final . '/version.txt', 'candidate' );
		oddout_write_file( $backup . '/version.txt', 'working' );
		oddout_apps_index_save( array( $slug => array( 'slug' => $slug, 'version' => '2.0.0' ) ) );
		oddout_apps_manifest_save( $slug, array( 'slug' => $slug, 'version' => '2.0.0' ) );
		update_option(
			$journal_key,
			array(
				'phase'        => 'promoted',
				'old_row'      => $old_row,
				'old_manifest' => $old_manifest,
				'staging'      => $staging,
				'promotion'    => array(
					'staging'   => $staging,
					'final'     => $final,
					'backup'    => $backup,
					'had_final' => true,
				),
			),
			false
		);
		update_option( $lock_key, (string) ( time() - 11 * MINUTE_IN_SECONDS ), false );

		try {
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertDirectoryDoesNotExist( $backup );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
			oddout_apps_rrmdir( $backup );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_metadata_committed_transaction_finishes_cleanup_without_rollback() {
		$slug              = 'transaction-metadata-committed';
		$final             = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging           = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$backup            = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-phpunit';
		$journal_key       = oddout_apps_transaction_option_key( $slug );
		$lock_key          = oddout_apps_install_lock_key( $slug );
		$candidate_row      = array( 'slug' => $slug, 'name' => 'Candidate', 'version' => '2.0.0', 'enabled' => false );
		$candidate_manifest = $candidate_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );
		$original          = oddout_apps_index_load();

		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		oddout_apps_rrmdir( $backup );
		wp_mkdir_p( $final );
		wp_mkdir_p( $backup );
		oddout_write_file( $final . '/version.txt', 'candidate' );
		oddout_write_file( $backup . '/version.txt', 'working' );
		oddout_apps_index_save( array( $slug => $candidate_row ) );
		oddout_apps_manifest_save( $slug, $candidate_manifest );
		update_option(
			$journal_key,
			array(
				'phase'     => 'metadata_committed',
				'old_row'   => array( 'slug' => $slug, 'version' => '1.0.0' ),
				'promotion' => array(
					'staging'   => $staging,
					'final'     => $final,
					'backup'    => $backup,
					'had_final' => true,
				),
			),
			false
		);
		update_option( $lock_key, (string) ( time() - 11 * MINUTE_IN_SECONDS ), false );

		try {
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'candidate', file_get_contents( $final . '/version.txt' ) );
			$this->assertDirectoryDoesNotExist( $backup );
			$this->assertSame( $candidate_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $candidate_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
			oddout_apps_rrmdir( $backup );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_global_index_lock_blocks_other_slug_writer_and_release_requires_owner_token() {
		$first_slug       = 'transaction-index-lock-first';
		$second_slug      = 'transaction-index-lock-second';
		$first_lock_key   = oddout_apps_install_lock_key( $first_slug );
		$second_lock_key  = oddout_apps_install_lock_key( $second_slug );
		$index_lock_key   = oddout_apps_index_lock_key();
		$original         = oddout_apps_index_load();
		$first_row        = array( 'slug' => $first_slug, 'name' => 'First', 'version' => '1.0.0', 'enabled' => true );
		$second_row       = array( 'slug' => $second_slug, 'name' => 'Second', 'version' => '1.0.0', 'enabled' => false );
		$seeded           = $original;
		$seeded[ $first_slug ]  = $first_row;
		$seeded[ $second_slug ] = $second_row;

		delete_option( $first_lock_key );
		delete_option( $second_lock_key );
		delete_option( $index_lock_key );
		oddout_apps_index_save( $seeded );

		try {
			$owner = oddout_apps_atomic_lock_acquire( $index_lock_key );
			$this->assertIsString( $owner );

			$result = oddout_apps_set_enabled( $second_slug, true );
			$this->assertWPError( $result );
			$this->assertSame( 'app_change_in_progress', $result->get_error_code() );
			$this->assertSame( $seeded, oddout_apps_index_load() );
			$this->assertFalse( get_option( $second_lock_key, false ) );

			$next_owner = time() . '|phpunit-next-owner';
			$this->assertTrue( update_option( $index_lock_key, $next_owner, false ) );
			$this->assertFalse( oddout_apps_atomic_lock_release( $index_lock_key, $owner ) );
			$this->assertSame( $next_owner, get_option( $index_lock_key, false ) );
			$this->assertTrue( oddout_apps_atomic_lock_release( $index_lock_key, $next_owner ) );
			$this->assertFalse( get_option( $index_lock_key, false ) );
		} finally {
			delete_option( $first_lock_key );
			delete_option( $second_lock_key );
			delete_option( $index_lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_recovery_is_idempotent_after_backup_was_already_restored() {
		$slug         = 'transaction-idempotent-recovery';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging      = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$backup       = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-phpunit';
		$journal_key  = oddout_apps_transaction_option_key( $slug );
		$lock_key     = oddout_apps_install_lock_key( $slug );
		$old_row      = array( 'slug' => $slug, 'name' => 'Working', 'version' => '1.0.0', 'enabled' => true );
		$old_manifest = $old_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );
		$candidate     = array( 'slug' => $slug, 'name' => 'Candidate', 'version' => '2.0.0', 'enabled' => false );
		$original      = oddout_apps_index_load();
		$seeded        = $original;
		$seeded[ $slug ] = $candidate;

		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		oddout_apps_rrmdir( $backup );
		wp_mkdir_p( $final );
		oddout_write_file( $final . '/version.txt', 'working' );
		$old_fingerprint = oddout_apps_tree_fingerprint( $final );
		oddout_apps_index_save( $seeded );
		oddout_apps_manifest_save( $slug, $candidate );
		update_option(
			$journal_key,
			array(
				'phase'        => 'promoted',
				'old_row'      => $old_row,
				'old_manifest' => $old_manifest,
				'staging'      => $staging,
				'promotion'    => array(
					'staging'         => $staging,
					'final'           => $final,
					'backup'          => $backup,
					'had_final'       => true,
					'old_fingerprint' => $old_fingerprint,
				),
			),
			false
		);
		update_option( $lock_key, ( time() - 11 * MINUTE_IN_SECONDS ) . '|crashed-owner', false );

		try {
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );

			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
			oddout_apps_rrmdir( $backup );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			delete_option( oddout_apps_index_lock_key() );
			oddout_apps_index_save( $original );
		}
	}

	public function test_fresh_owner_token_blocks_recovery_until_released() {
		$slug         = 'transaction-fresh-owner';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging      = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$backup       = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.backup-' . $slug . '-phpunit';
		$journal_key  = oddout_apps_transaction_option_key( $slug );
		$lock_key     = oddout_apps_install_lock_key( $slug );
		$old_row      = array( 'slug' => $slug, 'name' => 'Working', 'version' => '1.0.0', 'enabled' => true );
		$old_manifest = $old_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );
		$candidate     = array( 'slug' => $slug, 'name' => 'Candidate', 'version' => '2.0.0', 'enabled' => false );
		$original      = oddout_apps_index_load();
		$seeded        = $original;
		$seeded[ $slug ] = $candidate;

		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		oddout_apps_rrmdir( $backup );
		wp_mkdir_p( $final );
		wp_mkdir_p( $backup );
		oddout_write_file( $final . '/version.txt', 'candidate' );
		oddout_write_file( $backup . '/version.txt', 'working' );
		oddout_apps_index_save( $seeded );
		oddout_apps_manifest_save( $slug, $candidate );
		$journal = array(
			'phase'        => 'promoted',
			'old_row'      => $old_row,
			'old_manifest' => $old_manifest,
			'staging'      => $staging,
			'promotion'    => array(
				'staging'         => $staging,
				'final'           => $final,
				'backup'          => $backup,
				'had_final'       => true,
				'old_fingerprint' => oddout_apps_tree_fingerprint( $backup ),
			),
		);
		update_option( $journal_key, $journal, false );
		$owner = oddout_apps_atomic_lock_acquire( $lock_key );

		try {
			$this->assertIsString( $owner );
			$result = oddout_apps_recover_transaction( $slug );
			$this->assertWPError( $result );
			$this->assertSame( 'install_in_progress', $result->get_error_code() );
			$this->assertSame( 'candidate', file_get_contents( $final . '/version.txt' ) );
			$this->assertSame( 'working', file_get_contents( $backup . '/version.txt' ) );
			$this->assertSame( $journal, get_option( $journal_key ) );
			$this->assertSame( $candidate, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $candidate, oddout_apps_manifest_load( $slug ) );
			$this->assertSame( $owner, get_option( $lock_key, false ) );

			$this->assertTrue( oddout_apps_atomic_lock_release( $lock_key, $owner ) );
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertDirectoryDoesNotExist( $backup );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
			oddout_apps_rrmdir( $backup );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			delete_option( oddout_apps_index_lock_key() );
			oddout_apps_index_save( $original );
		}
	}

	public function test_stale_recovery_cleans_predeclared_extracting_staging_tree() {
		$slug         = 'transaction-extracting-recovery';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$staging      = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$journal_key  = oddout_apps_transaction_option_key( $slug );
		$lock_key     = oddout_apps_install_lock_key( $slug );
		$old_row      = array( 'slug' => $slug, 'name' => 'Working', 'version' => '1.0.0', 'enabled' => true );
		$old_manifest = $old_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );
		$candidate     = array( 'slug' => $slug, 'name' => 'Candidate', 'version' => '2.0.0', 'enabled' => false );
		$original      = oddout_apps_index_load();
		$seeded        = $original;
		$seeded[ $slug ] = $candidate;

		oddout_apps_rrmdir( $final );
		oddout_apps_rrmdir( $staging );
		wp_mkdir_p( $final );
		oddout_write_file( $final . '/version.txt', 'working' );
		oddout_apps_index_save( $seeded );
		oddout_apps_manifest_save( $slug, $candidate );
		update_option(
			$journal_key,
			array(
				'phase'        => 'extracting',
				'old_row'      => $old_row,
				'old_manifest' => $old_manifest,
				'staging'      => $staging,
			),
			false
		);
		wp_mkdir_p( $staging . '/nested' );
		oddout_write_file( $staging . '/nested/partial.txt', 'partial extraction' );
		update_option( $lock_key, ( time() - 11 * MINUTE_IN_SECONDS ) . '|crashed-owner', false );

		try {
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertDirectoryDoesNotExist( $staging );
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertSame( $old_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $old_manifest, oddout_apps_manifest_load( $slug ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_rrmdir( $staging );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			delete_option( oddout_apps_index_lock_key() );
			oddout_apps_index_save( $original );
		}
	}

	public function test_stale_owner_cannot_advance_or_delete_successor_transaction() {
		$slug           = 'transaction-lease-takeover';
		$staging        = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-phpunit';
		$journal_key    = oddout_apps_transaction_option_key( $slug );
		$slug_lock_key  = oddout_apps_install_lock_key( $slug );
		$index_lock_key = oddout_apps_index_lock_key();
		$original       = oddout_apps_index_load();
		$candidate      = array( 'slug' => $slug, 'name' => 'Candidate', 'version' => '2.0.0', 'enabled' => true );
		$old_owner      = wp_generate_uuid4();
		$new_owner      = wp_generate_uuid4();

		oddout_apps_rrmdir( $staging );
		delete_option( $journal_key );
		delete_option( $slug_lock_key );
		delete_option( $index_lock_key );
		wp_mkdir_p( $staging );
		oddout_write_file( $staging . '/partial.txt', 'old owner staging' );
		$seeded          = $original;
		$seeded[ $slug ] = $candidate;
		oddout_apps_index_save( $seeded );
		oddout_apps_manifest_save( $slug, $candidate );

		try {
			$this->assertIsString( oddout_apps_atomic_lock_acquire( $slug_lock_key, 600, false, $old_owner ) );
			$this->assertIsString( oddout_apps_atomic_lock_acquire( $index_lock_key, 600, false, $old_owner ) );
			$journal = array(
				'phase'        => 'extracting',
				'old_row'      => null,
				'old_manifest' => array(),
				'staging'      => $staging,
			);
			$this->assertTrue( oddout_apps_journal_write( $journal_key, $journal, $old_owner ) );

			update_option( $slug_lock_key, ( time() - 11 * MINUTE_IN_SECONDS ) . '|' . $old_owner, false );
			update_option( $index_lock_key, ( time() - 11 * MINUTE_IN_SECONDS ) . '|' . $old_owner, false );
			$this->assertIsString( oddout_apps_atomic_lock_acquire( $slug_lock_key, 600, true, $new_owner ) );
			$this->assertIsString( oddout_apps_atomic_lock_acquire( $index_lock_key, 600, true, $new_owner ) );

			$claimed = oddout_apps_journal_claim( $journal_key, $new_owner );
			$this->assertIsArray( $claimed );
			$this->assertSame( $new_owner, $claimed['owner'] );
			$this->assertSame( 'extracting', $claimed['phase'] );
			$this->assertFalse( oddout_apps_journal_phase( $journal_key, 'promoted', $old_owner ) );
			$this->assertFalse( oddout_apps_journal_delete( $journal_key, $old_owner ) );
			$this->assertWPError( oddout_apps_mutation_lease_refresh( $slug, $old_owner ) );
			$this->assertSame( $claimed, get_option( $journal_key ) );
			$this->assertDirectoryExists( $staging );
			$this->assertSame( $candidate, oddout_apps_index_load()[ $slug ] );

			$this->assertTrue( oddout_apps_atomic_lock_release( $index_lock_key, $new_owner ) );
			$this->assertTrue( oddout_apps_atomic_lock_release( $slug_lock_key, $new_owner ) );
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertDirectoryDoesNotExist( $staging );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertArrayNotHasKey( $slug, oddout_apps_index_load() );
			$this->assertSame( array(), oddout_apps_manifest_load( $slug ) );
		} finally {
			oddout_apps_atomic_lock_release( $index_lock_key, $new_owner );
			oddout_apps_atomic_lock_release( $slug_lock_key, $new_owner );
			oddout_apps_atomic_lock_release( $index_lock_key, $old_owner );
			oddout_apps_atomic_lock_release( $slug_lock_key, $old_owner );
			oddout_apps_rrmdir( $staging );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $slug_lock_key );
			delete_option( $index_lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_failed_staging_cleanup_retains_recovery_journal() {
		$slug          = 'transaction-cleanup-failure';
		$staging_prefix = rtrim( ODDOUT_APPS_DIR, '/\\' ) . '/.tmp-' . $slug . '-';
		$journal_key   = oddout_apps_transaction_option_key( $slug );
		$slug_lock_key = oddout_apps_install_lock_key( $slug );
		$original      = oddout_apps_index_load();
		$tmp_path      = wp_tempnam( 'odd-invalid-transaction.wp' );
		$manifest      = array(
			'slug'       => $slug,
			'name'       => 'Cleanup failure',
			'type'       => 'app',
			'version'    => '1.0.0',
			'entry'      => 'index.html',
			'icon'       => 'icon.svg',
			'capability' => 'read',
		);
		$fail_cleanup = static function ( $fail, $staging ) use ( $staging_prefix ) {
			return 0 === strpos( (string) $staging, $staging_prefix ) ? true : $fail;
		};

		$this->assertNotFalse( $tmp_path );
		oddout_write_file( $tmp_path, 'not a zip archive' );
		delete_option( $journal_key );
		delete_option( $slug_lock_key );
		delete_option( oddout_apps_index_lock_key() );
		add_filter( 'oddout_apps_staging_cleanup_should_fail', $fail_cleanup, 10, 2 );

		try {
			$result = oddout_apps_install_validated_archive( $tmp_path, $manifest );
			$this->assertWPError( $result );
			$this->assertSame( 'transaction_staging_cleanup_failed', $result->get_error_code() );
			$journal = get_option( $journal_key, false );
			$this->assertIsArray( $journal );
			$this->assertSame( 'extracting', $journal['phase'] );
			$this->assertStringStartsWith( $staging_prefix, $journal['staging'] );
			$this->assertDirectoryExists( $journal['staging'] );

			remove_filter( 'oddout_apps_staging_cleanup_should_fail', $fail_cleanup, 10 );
			$this->assertTrue( oddout_apps_recover_transaction( $slug ) );
			$this->assertDirectoryDoesNotExist( $journal['staging'] );
			$this->assertFalse( get_option( $journal_key, false ) );
		} finally {
			remove_filter( 'oddout_apps_staging_cleanup_should_fail', $fail_cleanup, 10 );
			$journal = get_option( $journal_key, array() );
			if ( is_array( $journal ) && ! empty( $journal['staging'] ) ) {
				oddout_apps_rrmdir( $journal['staging'] );
			}
			wp_delete_file( $tmp_path );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $slug_lock_key );
			delete_option( oddout_apps_index_lock_key() );
			oddout_apps_index_save( $original );
		}
	}

	public function test_repair_locks_fence_stale_owners_and_serialize_cross_slug_metadata() {
		$first_slug      = 'repair-meta-first';
		$second_slug     = 'repair-meta-second';
		$repair_lock_key = oddout_apps_repair_lock_key( $first_slug );
		$original_meta   = get_option( ODDOUT_APPS_REPAIR_META_OPTION, false );

		delete_option( $repair_lock_key );
		delete_option( ODDOUT_APPS_REPAIR_META_LOCK_OPTION );
		delete_option( ODDOUT_APPS_REPAIR_META_OPTION );

		try {
			$first = oddout_apps_repair_record( $first_slug, array( 'status' => 'failed', 'at' => 101 ) );
			$this->assertIsArray( $first );
			$this->assertSame( 'failed', $first['status'] );

			$meta_owner = oddout_apps_atomic_lock_acquire( ODDOUT_APPS_REPAIR_META_LOCK_OPTION );
			$this->assertIsString( $meta_owner );
			$blocked = oddout_apps_repair_record( $second_slug, array( 'status' => 'repaired', 'at' => 202 ) );
			$this->assertWPError( $blocked );
			$this->assertSame( 'repair_meta_busy', $blocked->get_error_code() );
			$this->assertArrayHasKey( $first_slug, oddout_apps_repair_meta_all() );
			$this->assertArrayNotHasKey( $second_slug, oddout_apps_repair_meta_all() );
			$this->assertTrue( oddout_apps_atomic_lock_release( ODDOUT_APPS_REPAIR_META_LOCK_OPTION, $meta_owner ) );

			$second = oddout_apps_repair_record( $second_slug, array( 'status' => 'repaired', 'at' => 202 ) );
			$this->assertIsArray( $second );
			$stored = oddout_apps_repair_meta_all();
			$this->assertSame( 'failed', $stored[ $first_slug ]['status'] );
			$this->assertSame( 'repaired', $stored[ $second_slug ]['status'] );

			$old_owner = oddout_apps_repair_lock_acquire( $first_slug );
			$this->assertIsString( $old_owner );
			update_option( $repair_lock_key, ( time() - ODDOUT_APPS_REPAIR_LOCK_TTL - 1 ) . '|' . oddout_apps_lock_owner_id( $old_owner ), false );
			$new_owner = oddout_apps_repair_lock_acquire( $first_slug );
			$this->assertIsString( $new_owner );
			$this->assertFalse( oddout_apps_repair_lock_release( $first_slug, $old_owner ) );
			$this->assertTrue( oddout_apps_lock_same_owner( get_option( $repair_lock_key, false ), $new_owner ) );
			$this->assertTrue( oddout_apps_repair_lock_release( $first_slug, $new_owner ) );
			$this->assertFalse( get_option( $repair_lock_key, false ) );
		} finally {
			delete_option( $repair_lock_key );
			delete_option( ODDOUT_APPS_REPAIR_META_LOCK_OPTION );
			if ( false === $original_meta ) {
				delete_option( ODDOUT_APPS_REPAIR_META_OPTION );
			} else {
				update_option( ODDOUT_APPS_REPAIR_META_OPTION, $original_meta, false );
			}
		}
	}

	public function test_app_mutators_fail_closed_while_an_install_lock_is_held() {
		$slug         = 'transaction-lock-conflict';
		$final        = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$lock_key     = oddout_apps_install_lock_key( $slug );
		$original     = oddout_apps_index_load();
		$working_row  = array(
			'slug'      => $slug,
			'name'      => 'Lock Conflict',
			'version'   => '1.0.0',
			'enabled'   => false,
			'surfaces'  => array( 'desktop' => false, 'taskbar' => true ),
			'installed' => 123,
		);
		$working_full = $working_row + array( 'type' => 'app', 'entry' => 'index.html', 'icon' => 'icon.svg' );

		oddout_apps_rrmdir( $final );
		wp_mkdir_p( $final );
		oddout_write_file( $final . '/version.txt', 'working' );
		oddout_apps_index_save( array( $slug => $working_row ) );
		oddout_apps_manifest_save( $slug, $working_full );
		update_option( $lock_key, (string) time(), false );

		try {
			$results = array(
				oddout_apps_uninstall( $slug ),
				oddout_apps_set_enabled( $slug, true ),
				oddout_apps_set_surfaces( $slug, array( 'desktop' => true, 'taskbar' => false ) ),
			);
			foreach ( $results as $result ) {
				$this->assertWPError( $result );
				$this->assertSame( 'install_in_progress', $result->get_error_code() );
				$this->assertSame( 409, $result->get_error_data()['status'] );
			}
			$this->assertSame( 'working', file_get_contents( $final . '/version.txt' ) );
			$this->assertSame( $working_row, oddout_apps_index_load()[ $slug ] );
			$this->assertSame( $working_full, oddout_apps_manifest_load( $slug ) );
			$this->assertNotFalse( get_option( $lock_key, false ) );
		} finally {
			oddout_apps_rrmdir( $final );
			oddout_apps_manifest_delete( $slug );
			delete_option( $lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_successful_update_preserves_enabled_surfaces_and_install_time_in_result() {
		$slug          = 'transaction-preserve-settings';
		$final         = rtrim( oddout_apps_dir_for( $slug ), '/\\' );
		$journal_key   = oddout_apps_transaction_option_key( $slug );
		$lock_key      = oddout_apps_install_lock_key( $slug );
		$original      = oddout_apps_index_load();
		$installed_at  = 123456;
		$old_row       = array(
			'slug'        => $slug,
			'name'        => 'Transaction Preserve',
			'version'     => '1.0.0',
			'enabled'     => false,
			'icon'        => 'icon.svg',
			'description' => 'Working copy',
			'capability'  => 'manage_options',
			'surfaces'    => array( 'desktop' => false, 'taskbar' => true ),
			'installed'   => $installed_at,
		);
		$old_manifest  = $old_row + array(
			'type'   => 'app',
			'entry'  => 'index.html',
			'window' => array( 'width' => 640, 'height' => 480, 'minWidth' => 320, 'minHeight' => 240, 'resizable' => true ),
		);
		$new_manifest  = array(
			'type'        => 'app',
			'slug'        => $slug,
			'name'        => 'Transaction Preserve',
			'version'     => '2.0.0',
			'description' => 'Candidate copy',
			'entry'       => 'index.html',
			'icon'        => 'icon.svg',
			'window'      => array( 'width' => 640, 'height' => 480, 'minWidth' => 320, 'minHeight' => 240, 'resizable' => true ),
			'surfaces'    => array( 'desktop' => true, 'taskbar' => false ),
		);
		$tmp_path      = $this->create_transaction_archive( $new_manifest );

		oddout_apps_rrmdir( $final );
		wp_mkdir_p( $final );
		oddout_write_file( $final . '/index.html', '<!doctype html><html><body>working copy</body></html>' );
		oddout_write_file( $final . '/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>' );
		oddout_apps_index_save( array( $slug => $old_row ) );
		oddout_apps_manifest_save( $slug, $old_manifest );

		try {
			$result = oddout_apps_install( $tmp_path, $slug . '.wp', array( 'operation' => 'update' ) );
			$this->assertIsArray( $result );
			$this->assertSame( '2.0.0', $result['version'] );
			$this->assertFalse( $result['enabled'] );
			$this->assertSame( array( 'desktop' => false, 'taskbar' => true ), $result['surfaces'] );
			$this->assertSame( $installed_at, $result['installed'] );
			$this->assertSame( $result, oddout_apps_manifest_load( $slug ) );
			$this->assertSame( $result['surfaces'], oddout_apps_index_load()[ $slug ]['surfaces'] );
			$this->assertFalse( oddout_apps_index_load()[ $slug ]['enabled'] );
			$this->assertStringContainsString( 'transaction candidate', file_get_contents( $final . '/index.html' ) );
			$this->assertFalse( get_option( $journal_key, false ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			wp_delete_file( $tmp_path );
			oddout_apps_rrmdir( $final );
			oddout_apps_manifest_delete( $slug );
			delete_option( $journal_key );
			delete_option( $lock_key );
			oddout_apps_index_save( $original );
		}
	}

	public function test_app_store_mutation_fails_closed_while_user_tree_lock_is_held() {
		$original_user = get_current_user_id();
		$admin         = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$lock_key      = 'oddout_apps_kv_lock_' . $admin;
		$original_tree = array( 'stores' => array( 'pantry' => array( 'preferences' => array( 'favorites' => array( 7 ) ) ) ) );
		$request       = new WP_REST_Request( 'PUT', '/odd/v1/apps/store/pantry/preferences' );
		$request->set_param( 'slug', 'pantry' );
		$request->set_param( 'segment', 'preferences' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'value' => array( 'favorites' => array( 9 ) ) ) ) );

		update_user_meta( $admin, ODDOUT_APPS_KV_USER_META, $original_tree );
		update_option( $lock_key, (string) time(), false );
		try {
			wp_set_current_user( $admin );
			$result = oddout_apps_rest_store_put( $request );
			$this->assertWPError( $result );
			$this->assertSame( 'app_store_busy', $result->get_error_code() );
			$this->assertSame( 409, $result->get_error_data()['status'] );
			$this->assertSame( $original_tree, get_user_meta( $admin, ODDOUT_APPS_KV_USER_META, true ) );
			$this->assertNotFalse( get_option( $lock_key, false ) );
		} finally {
			delete_option( $lock_key );
			delete_user_meta( $admin, ODDOUT_APPS_KV_USER_META );
			wp_set_current_user( $original_user );
		}
	}

	public function test_app_store_stale_lock_release_cannot_delete_new_owner_or_lose_other_segments() {
		$original_user = get_current_user_id();
		$admin         = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$lock_key      = 'oddout_apps_kv_lock_' . $admin;
		$original_tree = array(
			'stores' => array(
				'pantry'    => array(
					'patterns'    => array( 'before' ),
					'preferences' => array( 'favorites' => array( 7 ) ),
				),
				'workbench' => array(
					'state' => array( 'keep' => true ),
				),
			),
		);
		$new_value     = array( 'after' );
		$expected_tree = $original_tree;
		$expected_tree['stores']['pantry']['patterns'] = $new_value;
		$request = new WP_REST_Request( 'PUT', '/odd/v1/apps/store/pantry/patterns' );
		$request->set_param( 'slug', 'pantry' );
		$request->set_param( 'segment', 'patterns' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'value' => $new_value ) ) );

		update_user_meta( $admin, ODDOUT_APPS_KV_USER_META, $original_tree );
		update_option( $lock_key, ( time() - 31 ) . '|stale-owner', false );
		try {
			wp_set_current_user( $admin );
			$lock_a = oddout_apps_kv_mutation_lock_acquire( $admin );
			$this->assertIsArray( $lock_a );
			$this->assertSame( $lock_key, $lock_a['key'] );
			$this->assertIsString( $lock_a['owner'] );

			$owner_b = time() . '|phpunit-owner-b';
			$this->assertTrue( update_option( $lock_key, $owner_b, false ) );
			$stale_resume = oddout_apps_kv_mutation_lease_refresh( $lock_a );
			$this->assertWPError( $stale_resume );
			$this->assertSame( 'app_store_busy', $stale_resume->get_error_code() );
			$this->assertSame( $original_tree, get_user_meta( $admin, ODDOUT_APPS_KV_USER_META, true ) );
			$this->assertFalse( oddout_apps_kv_mutation_lock_release( $lock_a ) );
			$this->assertSame( $owner_b, get_option( $lock_key, false ) );

			$blocked = oddout_apps_rest_store_put( $request );
			$this->assertWPError( $blocked );
			$this->assertSame( 'app_store_busy', $blocked->get_error_code() );
			$this->assertSame( 409, $blocked->get_error_data()['status'] );
			$this->assertSame( $original_tree, get_user_meta( $admin, ODDOUT_APPS_KV_USER_META, true ) );
			$this->assertSame( $owner_b, get_option( $lock_key, false ) );

			$this->assertTrue(
				oddout_apps_kv_mutation_lock_release(
					array(
						'key'   => $lock_key,
						'owner' => $owner_b,
					)
				)
			);
			$saved = oddout_apps_rest_store_put( $request );
			$this->assertInstanceOf( WP_REST_Response::class, $saved );
			$this->assertSame( array( 'value' => $new_value ), $saved->get_data() );
			$this->assertSame( $expected_tree, get_user_meta( $admin, ODDOUT_APPS_KV_USER_META, true ) );
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			delete_option( $lock_key );
			delete_user_meta( $admin, ODDOUT_APPS_KV_USER_META );
			wp_set_current_user( $original_user );
		}
	}

	public function test_update_and_repair_version_semantics_fail_before_extraction() {
		$original = oddout_apps_index_load();
		$manifest = array(
			'type'    => 'app',
			'slug'    => 'operation-test',
			'name'    => 'Operation Test',
			'version' => '1.0.0',
		);
		oddout_apps_index_save(
			array(
				'operation-test' => array(
					'slug'       => 'operation-test',
					'name'       => 'Operation Test',
					'version'    => '1.0.0',
					'enabled'    => false,
					'surfaces'   => array( 'desktop' => false, 'taskbar' => true ),
					'installed'  => 123,
				),
			)
		);

		try {
			$result = oddout_apps_install_validated_archive( '/does/not/exist.wp', $manifest, array( 'operation' => 'update' ) );
			$this->assertWPError( $result );
			$this->assertSame( 'no_newer_version', $result->get_error_code() );

			$manifest['version'] = '1.0.1';
			$result = oddout_apps_install_validated_archive( '/does/not/exist.wp', $manifest, array( 'operation' => 'repair' ) );
			$this->assertWPError( $result );
			$this->assertSame( 'repair_version_mismatch', $result->get_error_code() );
		} finally {
			oddout_apps_index_save( $original );
		}
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

	public function test_numeric_only_app_storage_identifiers_round_trip_as_object_keys() {
		$original_user = get_current_user_id();
		$admin         = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$put           = new WP_REST_Request( 'PUT', '/odd/v1/apps/store/0/0' );
		$put->set_param( 'slug', '0' );
		$put->set_param( 'segment', '0' );
		$put->set_header( 'Content-Type', 'application/json' );
		$put->set_body( wp_json_encode( array( 'value' => array( 'saved' => true ) ) ) );
		$get = new WP_REST_Request( 'GET', '/odd/v1/apps/store/0/0' );
		$get->set_param( 'slug', '0' );
		$get->set_param( 'segment', '0' );
		$keys = new WP_REST_Request( 'GET', '/odd/v1/apps/store/0' );
		$keys->set_param( 'slug', '0' );

		try {
			wp_set_current_user( $admin );
			$result = oddout_apps_rest_store_put( $put );
			$this->assertInstanceOf( WP_REST_Response::class, $result );
			$this->assertSame( array( 'value' => array( 'saved' => true ) ), $result->get_data() );
			$this->assertSame( array( 'value' => array( 'saved' => true ) ), oddout_apps_rest_store_get( $get )->get_data() );
			$this->assertSame( array( '0' ), oddout_apps_rest_store_keys( $keys )->get_data() );

			$stored = get_user_meta( $admin, ODDOUT_APPS_KV_USER_META, true );
			$this->assertSame( array( 'saved' => true ), $stored['stores']['~0']['~0'] );
			$this->assertStringContainsString( '"~0"', wp_json_encode( $stored ) );
		} finally {
			delete_user_meta( $admin, ODDOUT_APPS_KV_USER_META );
			delete_option( 'oddout_apps_kv_lock_' . $admin );
			wp_set_current_user( $original_user );
		}
	}

	public function test_versioned_php_extension_is_rejected_by_internal_and_public_archive_paths() {
		$manifest = array(
			'type'    => 'app',
			'slug'    => 'php8-fixture',
			'name'    => 'PHP 8 Fixture',
			'version' => '1.0.0',
			'entry'   => 'index.html',
			'icon'    => 'icon.svg',
		);
		$tmp_path = $this->create_transaction_archive( $manifest );
		$zip      = new ZipArchive();
		$this->assertTrue( $zip->open( $tmp_path ) );
		$this->assertTrue( $zip->addFromString( 'assets/exploit.php8', '<?php echo "unsafe";' ) );
		$this->assertTrue( $zip->close() );

		try {
			$internal = oddout_apps_validate_archive( $tmp_path, 'php8-fixture.wp' );
			$this->assertWPError( $internal );
			$this->assertSame( 'forbidden_file_type', $internal->get_error_code() );

			$public = oddout_bundle_install( $tmp_path, 'php8-fixture.wp' );
			$this->assertWPError( $public );
			$this->assertSame( 'forbidden_file_type', $public->get_error_code() );
		} finally {
			wp_delete_file( $tmp_path );
		}
	}

	public function test_catalog_stale_owner_cannot_refresh_or_release_successor_lease() {
		$lock_key = 'oddout_catalog_phpunit_lock';
		delete_option( $lock_key );
		update_option( $lock_key, ( time() - 61 ) . '|catalog-stale-owner', false );

		try {
			$lock_a = oddout_catalog_lock_acquire( $lock_key, 60 );
			$this->assertIsArray( $lock_a );
			$owner_b = time() . '|catalog-owner-b';
			$this->assertTrue( update_option( $lock_key, $owner_b, false ) );

			$refresh = oddout_catalog_lock_refresh( $lock_a );
			$this->assertWPError( $refresh );
			$this->assertSame( 'catalog_operation_lost', $refresh->get_error_code() );
			$this->assertFalse( oddout_catalog_lock_release( $lock_a ) );
			$this->assertSame( $owner_b, get_option( $lock_key, false ) );
			$this->assertTrue(
				oddout_catalog_lock_release(
					array(
						'key'   => $lock_key,
						'owner' => $owner_b,
					)
				)
			);
			$this->assertFalse( get_option( $lock_key, false ) );
		} finally {
			delete_option( $lock_key );
		}
	}

	public function test_catalog_cache_miss_loser_returns_local_copy_without_fetch_or_write() {
		$lock_key          = 'oddout_catalog_refresh_lock';
		$original_stale     = get_option( ODDOUT_CATALOG_STALE_OPTION, false );
		$original_transient = get_transient( ODDOUT_CATALOG_TRANSIENT );
		$original_meta      = get_option( ODDOUT_CATALOG_META_OPTION, false );
		$registry           = json_decode( file_get_contents( ODDOUT_DIR . 'data/fallback-registry.json' ), true );
		$registry['_oddout_registry_sha256'] = str_repeat( 'a', 64 );
		$registry['_oddout_accepted_at']     = time();
		$requests = 0;
		$block_http = static function () use ( &$requests ) {
			++$requests;
			return new WP_Error( 'unexpected_http', 'The cache-miss loser must not fetch.' );
		};

		delete_transient( ODDOUT_CATALOG_TRANSIENT );
		update_option( ODDOUT_CATALOG_STALE_OPTION, $registry, false );
		delete_option( $lock_key );
		$winner = oddout_catalog_lock_acquire( $lock_key, 10 * MINUTE_IN_SECONDS );
		$this->assertIsArray( $winner );
		add_filter( 'pre_http_request', $block_http, 10, 3 );

		try {
			$result = oddout_catalog_load( false );
			$this->assertSame( 0, $requests );
			$this->assertSame( oddout_catalog_registry_hash( $registry ), oddout_catalog_registry_hash( $result ) );
			$this->assertSame( $original_meta, get_option( ODDOUT_CATALOG_META_OPTION, false ) );
			$this->assertSame( $winner['owner'], get_option( $lock_key, false ) );
		} finally {
			remove_filter( 'pre_http_request', $block_http, 10 );
			oddout_catalog_lock_release( $winner );
			if ( false === $original_stale ) {
				delete_option( ODDOUT_CATALOG_STALE_OPTION );
			} else {
				update_option( ODDOUT_CATALOG_STALE_OPTION, $original_stale, false );
			}
			if ( false === $original_transient ) {
				delete_transient( ODDOUT_CATALOG_TRANSIENT );
			} else {
				set_transient( ODDOUT_CATALOG_TRANSIENT, $original_transient, ODDOUT_CATALOG_CACHE_TTL );
			}
			if ( false === $original_meta ) {
				delete_option( ODDOUT_CATALOG_META_OPTION );
			} else {
				update_option( ODDOUT_CATALOG_META_OPTION, $original_meta, false );
			}
			delete_option( $lock_key );
		}
	}

	public function test_catalog_rollback_busy_contract_preserves_concurrent_registry() {
		$lock_key          = 'oddout_catalog_refresh_lock';
		$original_stale     = get_option( ODDOUT_CATALOG_STALE_OPTION, false );
		$original_fresh     = get_transient( ODDOUT_CATALOG_TRANSIENT );
		$original_rollbacks = get_option( ODDOUT_CATALOG_ROLLBACK_OPTION, false );
		$current             = $this->catalog_registry_fixture( str_repeat( 'a', 64 ) );
		$previous            = $this->catalog_registry_fixture( str_repeat( 'b', 64 ) );
		$snapshots           = array(
			array(
				'sha256'       => oddout_catalog_registry_hash( $previous ),
				'accepted_at'  => time() - 60,
				'generated_at' => '',
				'bundle_count' => oddout_catalog_registry_bundle_count( $previous ),
				'registry'     => $previous,
			),
		);

		delete_option( $lock_key );
		update_option( ODDOUT_CATALOG_STALE_OPTION, $current, false );
		set_transient( ODDOUT_CATALOG_TRANSIENT, $current, ODDOUT_CATALOG_CACHE_TTL );
		update_option( ODDOUT_CATALOG_ROLLBACK_OPTION, $snapshots, false );
		$winner = oddout_catalog_lock_acquire( $lock_key, 10 * MINUTE_IN_SECONDS );
		$this->assertIsArray( $winner );

		try {
			$result = oddout_catalog_restore_previous_snapshot( 0 );
			$this->assertWPError( $result );
			$this->assertSame( 'catalog_operation_in_progress', $result->get_error_code() );
			$this->assertSame( 409, $result->get_error_data()['status'] );
			$this->assertSame( str_repeat( 'a', 64 ), oddout_catalog_registry_hash( get_option( ODDOUT_CATALOG_STALE_OPTION ) ) );
			$this->assertSame( str_repeat( 'a', 64 ), oddout_catalog_registry_hash( get_transient( ODDOUT_CATALOG_TRANSIENT ) ) );
			$this->assertSame( $snapshots, get_option( ODDOUT_CATALOG_ROLLBACK_OPTION ) );
			$this->assertSame( $winner['owner'], get_option( $lock_key, false ) );
		} finally {
			oddout_catalog_lock_release( $winner );
			$this->restore_option_fixture( ODDOUT_CATALOG_STALE_OPTION, $original_stale );
			$this->restore_transient_fixture( ODDOUT_CATALOG_TRANSIENT, $original_fresh, ODDOUT_CATALOG_CACHE_TTL );
			$this->restore_option_fixture( ODDOUT_CATALOG_ROLLBACK_OPTION, $original_rollbacks );
			delete_option( $lock_key );
		}
	}

	public function test_catalog_rollback_stale_owner_cannot_replace_successor_registry() {
		$lock_key          = 'oddout_catalog_refresh_lock';
		$original_stale     = get_option( ODDOUT_CATALOG_STALE_OPTION, false );
		$original_fresh     = get_transient( ODDOUT_CATALOG_TRANSIENT );
		$original_meta      = get_option( ODDOUT_CATALOG_META_OPTION, false );
		$original_rollbacks = get_option( ODDOUT_CATALOG_ROLLBACK_OPTION, false );
		$current             = $this->catalog_registry_fixture( str_repeat( 'c', 64 ) );
		$previous            = $this->catalog_registry_fixture( str_repeat( 'd', 64 ) );
		$snapshots           = array(
			array(
				'sha256'       => oddout_catalog_registry_hash( $previous ),
				'accepted_at'  => time() - 60,
				'generated_at' => '',
				'bundle_count' => oddout_catalog_registry_bundle_count( $previous ),
				'registry'     => $previous,
			),
		);
		$successor_owner     = time() . '|catalog-rollback-successor';
		$snapshot_filter_key = 'option_' . ODDOUT_CATALOG_ROLLBACK_OPTION;
		$steal_lease         = null;
		$steal_lease         = static function ( $value ) use ( &$steal_lease, $snapshot_filter_key, $lock_key, $successor_owner ) {
			remove_filter( $snapshot_filter_key, $steal_lease, 10 );
			update_option( $lock_key, $successor_owner, false );
			return $value;
		};

		delete_option( $lock_key );
		update_option( ODDOUT_CATALOG_STALE_OPTION, $current, false );
		set_transient( ODDOUT_CATALOG_TRANSIENT, $current, ODDOUT_CATALOG_CACHE_TTL );
		update_option( ODDOUT_CATALOG_META_OPTION, array( 'sentinel' => 'unchanged' ), false );
		update_option( ODDOUT_CATALOG_ROLLBACK_OPTION, $snapshots, false );
		add_filter( $snapshot_filter_key, $steal_lease, 10, 1 );

		try {
			$result = oddout_catalog_restore_previous_snapshot( 0 );
			$this->assertWPError( $result );
			$this->assertSame( 'catalog_operation_lost', $result->get_error_code() );
			$this->assertSame( str_repeat( 'c', 64 ), oddout_catalog_registry_hash( get_option( ODDOUT_CATALOG_STALE_OPTION ) ) );
			$this->assertSame( str_repeat( 'c', 64 ), oddout_catalog_registry_hash( get_transient( ODDOUT_CATALOG_TRANSIENT ) ) );
			$this->assertSame( array( 'sentinel' => 'unchanged' ), get_option( ODDOUT_CATALOG_META_OPTION ) );
			$this->assertSame( $snapshots, get_option( ODDOUT_CATALOG_ROLLBACK_OPTION ) );
			$this->assertSame( $successor_owner, get_option( $lock_key, false ) );
		} finally {
			remove_filter( $snapshot_filter_key, $steal_lease, 10 );
			$this->restore_option_fixture( ODDOUT_CATALOG_STALE_OPTION, $original_stale );
			$this->restore_transient_fixture( ODDOUT_CATALOG_TRANSIENT, $original_fresh, ODDOUT_CATALOG_CACHE_TTL );
			$this->restore_option_fixture( ODDOUT_CATALOG_META_OPTION, $original_meta );
			$this->restore_option_fixture( ODDOUT_CATALOG_ROLLBACK_OPTION, $original_rollbacks );
			delete_option( $lock_key );
		}
	}

	public function test_catalog_update_check_busy_loser_does_not_fetch_or_write() {
		$lock_key      = 'oddout_catalog_refresh_lock';
		$original_meta  = get_option( ODDOUT_CATALOG_META_OPTION, false );
		$original_check = get_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT );
		$baseline_meta  = array_merge( oddout_catalog_default_meta(), array( 'registry_sha256' => str_repeat( 'e', 64 ) ) );
		$sentinel_check = array( 'sentinel' => 'winner-result' );
		$requests       = 0;
		$block_http     = static function () use ( &$requests ) {
			++$requests;
			return new WP_Error( 'unexpected_http', 'A lock loser must not fetch the remote catalog.' );
		};

		delete_option( $lock_key );
		update_option( ODDOUT_CATALOG_META_OPTION, $baseline_meta, false );
		set_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT, $sentinel_check, ODDOUT_CATALOG_UPDATE_CHECK_TTL );
		$winner = oddout_catalog_lock_acquire( $lock_key, 10 * MINUTE_IN_SECONDS );
		$this->assertIsArray( $winner );
		add_filter( 'pre_http_request', $block_http, 10, 3 );

		try {
			$result = oddout_catalog_check_remote_updates( true );
			$this->assertWPError( $result );
			$this->assertSame( 'catalog_operation_in_progress', $result->get_error_code() );
			$this->assertSame( 409, $result->get_error_data()['status'] );
			$this->assertSame( 0, $requests );
			$this->assertSame( $baseline_meta, get_option( ODDOUT_CATALOG_META_OPTION ) );
			$this->assertSame( $sentinel_check, get_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT ) );
			$this->assertSame( $winner['owner'], get_option( $lock_key, false ) );
		} finally {
			remove_filter( 'pre_http_request', $block_http, 10 );
			oddout_catalog_lock_release( $winner );
			$this->restore_option_fixture( ODDOUT_CATALOG_META_OPTION, $original_meta );
			$this->restore_transient_fixture( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT, $original_check, ODDOUT_CATALOG_UPDATE_CHECK_TTL );
			delete_option( $lock_key );
		}
	}

	public function test_catalog_update_check_old_slow_fetch_cannot_overwrite_new_fast_result() {
		$lock_key       = 'oddout_catalog_refresh_lock';
		$original_meta   = get_option( ODDOUT_CATALOG_META_OPTION, false );
		$original_check  = get_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT );
		$baseline_meta   = array_merge( oddout_catalog_default_meta(), array( 'registry_sha256' => str_repeat( 'f', 64 ) ) );
		$successor_meta  = array_merge(
			oddout_catalog_default_meta(),
			array(
				'source'                  => 'remote',
				'registry_sha256'         => str_repeat( '1', 64 ),
				'remote_update_available' => false,
				'remote_registry_sha256'  => str_repeat( '1', 64 ),
				'last_update_check'        => time(),
			)
		);
		$successor_check = array( 'sentinel' => 'new-fast-result' );
		$remote_registry = json_decode( file_get_contents( ODDOUT_DIR . 'data/fallback-registry.json' ), true );
		$remote_body     = wp_json_encode( $remote_registry );
		$url             = oddout_catalog_url();
		$successor_owner = time() . '|catalog-check-successor';
		$requests        = 0;
		$skip_signature  = static function () {
			return false;
		};
		$one_attempt     = static function () {
			return 1;
		};
		$finish_newer    = static function ( $preempt, $args, $request_url ) use ( &$requests, $url, $remote_body, $lock_key, $successor_owner, $successor_meta, $successor_check ) {
			if ( $url !== $request_url ) {
				return $preempt;
			}
			++$requests;
			update_option( $lock_key, $successor_owner, false );
			update_option( ODDOUT_CATALOG_META_OPTION, $successor_meta, false );
			set_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT, $successor_check, ODDOUT_CATALOG_UPDATE_CHECK_TTL );
			return array(
				'headers'  => array(),
				'body'     => $remote_body,
				'response' => array(
					'code'    => 200,
					'message' => 'OK',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		};

		delete_option( $lock_key );
		update_option( ODDOUT_CATALOG_META_OPTION, $baseline_meta, false );
		delete_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT );
		add_filter( 'oddout_catalog_signature_required', $skip_signature, 10, 2 );
		add_filter( 'oddout_catalog_fetch_attempts', $one_attempt, 10, 2 );
		add_filter( 'pre_http_request', $finish_newer, 10, 3 );

		try {
			$result = oddout_catalog_check_remote_updates( true );
			$this->assertWPError( $result );
			$this->assertSame( 'catalog_operation_lost', $result->get_error_code() );
			$this->assertSame( 1, $requests );
			$this->assertSame( $successor_meta, get_option( ODDOUT_CATALOG_META_OPTION ) );
			$this->assertSame( $successor_check, get_transient( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT ) );
			$this->assertSame( $successor_owner, get_option( $lock_key, false ) );
		} finally {
			remove_filter( 'pre_http_request', $finish_newer, 10 );
			remove_filter( 'oddout_catalog_fetch_attempts', $one_attempt, 10 );
			remove_filter( 'oddout_catalog_signature_required', $skip_signature, 10 );
			$this->restore_option_fixture( ODDOUT_CATALOG_META_OPTION, $original_meta );
			$this->restore_transient_fixture( ODDOUT_CATALOG_UPDATE_CHECK_TRANSIENT, $original_check, ODDOUT_CATALOG_UPDATE_CHECK_TTL );
			delete_option( $lock_key );
		}
	}
}
