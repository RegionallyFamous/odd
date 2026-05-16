<?php
/**
 * Tests for the universal .wp bundle installer — exercises round-trip
 * install/register/uninstall for icon-set (no-JS) and scene (JS) types,
 * plus the cross-type global slug uniqueness guarantee.
 *
 * The underlying per-type installers are smoke-tested through the same
 * dispatcher the REST endpoint + Shop chrome rely on, so a regression
 * in either the dispatcher routing or a single type's validator shows
 * up as a failing assertion here rather than a 500 in the browser.
 */

class Test_Bundle_Install extends ODDOUT_REST_Test_Case {

	/**
	 * @var array<array{slug:string, type:string}> Cleanup register.
	 */
	protected $installed = array();

	public function tear_down() {
		foreach ( $this->installed as $row ) {
			oddout_bundle_uninstall( $row['slug'] );
		}
		$this->installed = array();
		parent::tear_down();
	}

	protected function build_bundle_zip( array $manifest, array $files = array() ) {
		$path = tempnam( sys_get_temp_dir(), 'oddbundle_' ) . '.wp';
		$zip  = new ZipArchive();
		$this->assertTrue(
			true === $zip->open( $path, ZipArchive::CREATE | ZipArchive::OVERWRITE ),
			'Failed to open fixture zip for writing.'
		);
		$zip->addFromString( 'manifest.json', wp_json_encode( $manifest ) );
		foreach ( $files as $name => $body ) {
			$zip->addFromString( $name, $body );
		}
		$zip->close();
		return $path;
	}

	/**
	 * @return string Path to a minimal valid icon-set .wp archive.
	 */
	protected function make_iconset_zip( $slug = 'test-set', array $overrides = array() ) {
		$keys  = array(
			'dashboard',
			'posts',
			'pages',
			'media',
			'comments',
			'appearance',
			'plugins',
			'users',
			'tools',
			'settings',
			'profile',
			'links',
			'recycle-bin',
			'fallback',
			'os-settings',
			'import',
			'classic-admin',
		);
		$png   = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAw0lEQVR42u3awRXCIBBFUZhjmdqJWWkn2meswUCAwH0FwJ/HrDg/JQAAAKxJrnnY/bnvrYJ/3zkPI6Dl4LVF5KsOXktEzDB8SZ6YYfiSXDHL8EfzRVqcmOn1j+S0AbO9/r95bQABBKzN7ewLPq/yMx6bDSCAAAIIIIAAAggggAACCCCAAALSdT5EzvzMsAEEEEBAMwG1OjlpsMaIDejRzBqpL2QDevXzRmmLRc+S4ghVuejd1OzdE9QUTYt3hQEAAJblByY0PzQWCSylAAAAAElFTkSuQmCC' );
		$icons = array();
		$files = array();
		foreach ( $keys as $k ) {
			$rel           = isset( $overrides['icons'][ $k ] ) ? (string) $overrides['icons'][ $k ] : 'icons/' . $k . '.png';
			$icons[ $k ]   = $rel;
			$files[ $rel ] = $png;
		}
		if ( ! empty( $overrides['files'] ) && is_array( $overrides['files'] ) ) {
			foreach ( $overrides['files'] as $name => $body ) {
				$files[ $name ] = $body;
			}
		}
		return $this->build_bundle_zip(
			array(
				'type'    => 'icon-set',
				'slug'    => $slug,
				'name'    => 'Test Set',
				'label'   => 'Test Set',
				'version' => '1.0.0',
				'accent'  => '#ff00aa',
				'icons'   => $icons,
			),
			$files
		);
	}

	protected function make_scene_zip( $slug = 'test-scene' ) {
		return $this->build_bundle_zip(
			array(
				'type'          => 'scene',
				'slug'          => $slug,
				'name'          => 'Test Scene',
				'label'         => 'Test Scene',
				'version'       => '1.0.0',
				'category'     => 'Test',
				'tags'          => array( 'test' ),
				'fallbackColor' => '#112233',
				'added'         => '2025-01-01',
				'entry'         => 'scene.js',
				'preview'       => 'preview.webp',
				'wallpaper'     => 'wallpaper.webp',
			),
			array(
				'scene.js'       => "(function(){window.__odd=window.__odd||{};window.__odd.scenes=window.__odd.scenes||{};window.__odd.scenes['" . $slug . "']={setup:function(){},tick:function(){}};})();",
				'preview.webp'   => str_repeat( "\x00", 32 ),
				'wallpaper.webp' => str_repeat( "\x00", 32 ),
			)
		);
	}

	protected function make_widget_zip( $slug = 'test-widget', array $overrides = array() ) {
		$manifest = array_merge(
			array(
				'type'          => 'widget',
				'slug'          => $slug,
				'name'          => 'Test Widget',
				'label'         => 'Test Widget',
				'version'       => '1.0.0',
				'description'   => 'Widget fixture.',
				'entry'         => 'widget.js',
				'css'           => array( 'widget.css' ),
				'icon'          => 'dashicons-clock',
				'movable'       => true,
				'resizable'     => true,
				'minWidth'      => 240,
				'minHeight'     => 180,
				'maxWidth'      => 520,
				'maxHeight'     => 420,
				'defaultWidth'  => 280,
				'defaultHeight' => 220,
				'capabilities'  => array( 'read' ),
			),
			$overrides
		);
		return $this->build_bundle_zip(
			$manifest,
			array(
				'widget.js'  => "(function(){window.desktopModeWidgets=window.desktopModeWidgets||{};window.desktopModeWidgets['odd/" . $slug . "']=function(){return function(){};};})();",
				'widget.css' => '.test-widget{display:block;}',
			)
		);
	}

	public function test_iconset_round_trip_install_register_uninstall() {
		$zip = $this->make_iconset_zip( 'test-set' );
		$res = oddout_bundle_install( $zip, 'test-set.wp' );
		@unlink( $zip );
		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'icon-set install returned non-array' );
		$this->assertSame( 'icon-set', $res['type'] );
		$this->installed[] = array(
			'slug' => 'test-set',
			'type' => 'icon-set',
		);

		$sets  = oddout_icons_get_sets( true );
		$slugs = wp_list_pluck( $sets, 'slug' );
		$this->assertContains( 'test-set', $slugs, 'installed icon set must surface in the icon registry' );
		$set = $sets['test-set'];
		foreach ( $set['icons'] as $key => $url ) {
			$this->assertMatchesRegularExpression( '/\.(png|webp)$/', $url, "Icon {$key} must resolve to a raster asset." );
			$this->assertStringNotContainsString( '.svg', $url, "Icon {$key} must not resolve to SVG." );
		}
		$this->assertStringContainsString( '/icons/dashboard.png', $set['icons']['dashboard'] );
		$this->assertStringContainsString( '/icons/fallback.png', $set['icons']['fallback'] );

		$uninstall = oddout_bundle_uninstall( 'test-set' );
		$this->assertTrue( true === $uninstall || is_array( $uninstall ), is_wp_error( $uninstall ) ? $uninstall->get_error_message() : 'uninstall failed' );
		$this->installed = array();

		$slugs = wp_list_pluck( oddout_icons_get_sets( true ), 'slug' );
		$this->assertNotContains( 'test-set', $slugs, 'uninstalled icon set must vanish from the registry' );
	}

	public function test_scene_round_trip_install_register_uninstall() {
		$zip = $this->make_scene_zip( 'test-scene' );
		$res = oddout_bundle_install( $zip, 'test-scene.wp' );
		@unlink( $zip );
		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'scene install returned non-array' );
		$this->assertSame( 'scene', $res['type'] );
		$this->installed[] = array(
			'slug' => 'test-scene',
			'type' => 'scene',
		);

		$scenes = apply_filters( 'oddout_scene_registry', array() );
		$found  = false;
		foreach ( $scenes as $s ) {
			if ( isset( $s['slug'] ) && 'test-scene' === $s['slug'] ) {
				$found = true;
				break; }
		}
		$this->assertTrue( $found, 'installed scene must surface in oddout_scene_registry' );

		$uninstall = oddout_bundle_uninstall( 'test-scene' );
		$this->assertTrue( true === $uninstall || is_array( $uninstall ), is_wp_error( $uninstall ) ? $uninstall->get_error_message() : 'uninstall failed' );
		$this->installed = array();
	}

	public function test_widget_round_trip_preserves_desktop_mode_metadata() {
		$zip = $this->make_widget_zip( 'test-widget' );
		$res = oddout_bundle_install( $zip, 'test-widget.wp' );
		@unlink( $zip );

		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'widget install returned non-array' );
		$this->assertSame( 'widget', $res['type'] );
		$this->installed[] = array(
			'slug' => 'test-widget',
			'type' => 'widget',
		);

		$manifest = $res['manifest'];
		$this->assertSame( 'odd/test-widget', $manifest['id'] );
		$this->assertSame( 520, $manifest['maxWidth'] );
		$this->assertSame( 420, $manifest['maxHeight'] );
		$this->assertSame( array( 'read' ), $manifest['capabilities'] );
		$this->assertNotEmpty( oddout_bundle_style_urls_for( $manifest ) );

		$index = oddout_widgets_index_load();
		$this->assertArrayHasKey( 'test-widget', $index );
		$this->assertSame( 520, $index['test-widget']['maxWidth'] );
		$this->assertSame( 'dashicons-clock', $index['test-widget']['icon'] );

		$row_without_css = $index['test-widget'];
		unset( $row_without_css['css'] );
		$this->assertSame(
			array( 'widget.css' ),
			oddout_widget_stylesheet_paths_for( 'test-widget', $row_without_css ),
			'Installed widget styles must be recoverable from the canonical manifest when the index row is thin.'
		);
	}

	public function test_widget_default_css_is_discovered_for_thin_existing_installs() {
		$zip = $this->make_widget_zip( 'thin-widget', array( 'css' => array() ) );
		$res = oddout_bundle_install( $zip, 'thin-widget.wp' );
		@unlink( $zip );

		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'widget install returned non-array' );
		$this->installed[] = array(
			'slug' => 'thin-widget',
			'type' => 'widget',
		);
		$this->assertSame( array( 'widget.css' ), $res['manifest']['css'] );

		$index = oddout_widgets_index_load();
		unset( $index['thin-widget']['css'] );
		oddout_widgets_index_save( $index );

		$manifest = $res['manifest'];
		unset( $manifest['css'] );
		oddout_write_file( oddout_widgets_dir_for( 'thin-widget' ) . 'manifest.json', wp_json_encode( $manifest ) );

		$row_without_css = $index['thin-widget'];
		$this->assertSame(
			array( 'widget.css' ),
			oddout_widget_stylesheet_paths_for( 'thin-widget', $row_without_css ),
			'Existing installed widgets with only widget.css on disk must still load their companion stylesheet.'
		);

		$urls = oddout_widget_stylesheet_urls_for( 'thin-widget', $row_without_css );
		$this->assertCount( 1, $urls );
		$this->assertMatchesRegularExpression( '#/widgets/thin-widget/widget\.css\?ver=\d+$#', $urls[0] );

		$loader = oddout_widget_stylesheet_loader_script( 'thin-widget', $row_without_css );
		$this->assertStringContainsString( 'data-odd-widget-style-url', $loader );
		$this->assertStringContainsString( 'data-odd-widget-style-slug', $loader );
	}

	public function test_widget_zero_max_dimensions_remain_unbounded() {
		$zip = $this->make_widget_zip(
			'unbounded-widget',
			array(
				'maxWidth'  => 0,
				'maxHeight' => 0,
			)
		);
		$res = oddout_bundle_install( $zip, 'unbounded-widget.wp' );
		@unlink( $zip );

		$this->assertIsArray( $res, is_wp_error( $res ) ? $res->get_error_message() : 'widget install returned non-array' );
		$this->installed[] = array(
			'slug' => 'unbounded-widget',
			'type' => 'widget',
		);
		$this->assertSame( 0, $res['manifest']['maxWidth'] );
		$this->assertSame( 0, $res['manifest']['maxHeight'] );
	}

	public function test_global_slug_uniqueness_across_types() {
		$zip1 = $this->make_iconset_zip( 'shared-slug' );
		$res1 = oddout_bundle_install( $zip1, 'shared-slug.wp' );
		@unlink( $zip1 );
		$this->assertIsArray( $res1 );
		$this->installed[] = array(
			'slug' => 'shared-slug',
			'type' => 'icon-set',
		);

		// Second install with a different type but the same slug must
		// be rejected by the global uniqueness gate, not by a per-type
		// "already installed" check.
		$zip2 = $this->make_scene_zip( 'shared-slug' );
		$res2 = oddout_bundle_install( $zip2, 'shared-slug.wp' );
		@unlink( $zip2 );
		$this->assertWPError( $res2, 'second install with same slug must be rejected' );
		$this->assertSame( 'slug_exists', $res2->get_error_code() );
	}

	public function test_invalid_extension_rejected() {
		$zip = $this->make_iconset_zip( 'ignore-me' );
		$res = oddout_bundle_install( $zip, 'ignore-me.zip' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'invalid_extension', $res->get_error_code() );
	}

	public function test_iconset_rejects_svg_icons() {
		$keys  = array(
			'dashboard',
			'posts',
			'pages',
			'media',
			'comments',
			'appearance',
			'plugins',
			'users',
			'tools',
			'settings',
			'profile',
			'links',
			'recycle-bin',
			'fallback',
			'os-settings',
			'import',
			'classic-admin',
		);
		$icons = array();
		foreach ( $keys as $key ) {
			$icons[ $key ] = 'icons/' . $key . '.svg';
		}

		$zip = $this->build_bundle_zip(
			array(
				'type'    => 'icon-set',
				'slug'    => 'svg-icons',
				'name'    => 'SVG Icons',
				'label'   => 'SVG Icons',
				'version' => '1.0.0',
				'accent'  => '#ff00aa',
				'icons'   => $icons,
			),
			array(
				'icons/dashboard.svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
			)
		);
		$res = oddout_bundle_install( $zip, 'svg-icons.wp' );
		@unlink( $zip );

		$this->assertWPError( $res );
		$this->assertSame( 'invalid_icon_ext', $res->get_error_code() );
	}

	public function test_iconset_rejects_malformed_raster_icons() {
		$zip = $this->make_iconset_zip(
			'bad-raster',
			array(
				'files' => array(
					'icons/dashboard.png' => 'not a png',
				),
			)
		);
		$res = oddout_bundle_install( $zip, 'bad-raster.wp' );
		@unlink( $zip );

		$this->assertWPError( $res );
		$this->assertSame( 'invalid_icon_image', $res->get_error_code() );
	}

	public function test_iconset_rejects_oversized_raster_icons() {
		$zip = $this->make_iconset_zip(
			'oversized-raster',
			array(
				'files' => array(
					'icons/dashboard.png' => random_bytes( 768 * 1024 + 1 ),
				),
			)
		);
		$res = oddout_bundle_install( $zip, 'oversized-raster.wp' );
		@unlink( $zip );

		$this->assertWPError( $res );
		$this->assertSame( 'icon_too_large', $res->get_error_code() );
	}

	public function test_path_traversal_entries_are_rejected_before_extract() {
		$zip = $this->build_bundle_zip(
			array(
				'type'    => 'widget',
				'slug'    => 'bad-path',
				'name'    => 'Bad Path',
				'version' => '1.0.0',
			),
			array(
				'../escape.txt' => 'nope',
			)
		);
		$res = oddout_bundle_install( $zip, 'bad-path.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'path_traversal', $res->get_error_code() );
	}

	public function test_server_executable_entries_are_rejected() {
		$zip = $this->build_bundle_zip(
			array(
				'type'    => 'widget',
				'slug'    => 'bad-php',
				'name'    => 'Bad PHP',
				'version' => '1.0.0',
			),
			array(
				'payload.php' => '<?php echo "nope";',
			)
		);
		$res = oddout_bundle_install( $zip, 'bad-php.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'forbidden_file_type', $res->get_error_code() );
	}

	public function test_catalog_entry_requires_https_and_sha256() {
		$missing_sha = oddout_catalog_download_entry_file(
			array(
				'type'         => 'widget',
				'slug'         => 'missing-sha',
				'download_url' => 'https://example.com/missing-sha.wp',
			)
		);
		$this->assertWPError( $missing_sha );
		$this->assertSame( 'missing_sha256', $missing_sha->get_error_code() );

		$insecure = oddout_catalog_download_entry_file(
			array(
				'type'         => 'widget',
				'slug'         => 'insecure',
				'download_url' => 'http://example.com/insecure.wp',
				'sha256'       => str_repeat( 'a', 64 ),
			)
		);
		$this->assertWPError( $insecure );
		$this->assertSame( 'insecure_download', $insecure->get_error_code() );
	}

	public function test_bundle_requires_explicit_manifest_type() {
		$zip = $this->build_bundle_zip(
			array(
				'slug'    => 'missing-type-app',
				'name'    => 'Missing Type',
				'version' => '1.0.0',
				'entry'   => 'index.html',
			),
			array( 'index.html' => '<h1>missing type</h1>' )
		);
		$res = oddout_bundle_install( $zip, 'missing-type-app.wp' );
		@unlink( $zip );
		$this->assertWPError( $res );
		$this->assertSame( 'missing_manifest_field', $res->get_error_code() );
	}

	public function test_catalog_download_manifest_type_must_match_catalog_row() {
		$zip = $this->make_scene_zip( 'mismatch-scene' );
		$res = oddout_catalog_download_matches_entry(
			$zip,
			'mismatch-scene.wp',
			array(
				'slug' => 'mismatch-scene',
				'type' => 'app',
			)
		);
		@unlink( $zip );

		$this->assertWPError( $res );
		$this->assertSame( 'catalog_type_mismatch', $res->get_error_code() );
	}

	public function test_catalog_download_manifest_slug_must_match_catalog_row() {
		$zip = $this->make_scene_zip( 'actual-scene' );
		$res = oddout_catalog_download_matches_entry(
			$zip,
			'actual-scene.wp',
			array(
				'slug' => 'advertised-scene',
				'type' => 'scene',
			)
		);
		@unlink( $zip );

		$this->assertWPError( $res );
		$this->assertSame( 'catalog_slug_mismatch', $res->get_error_code() );
	}

	public function test_catalog_download_manifest_version_must_match_catalog_row() {
		$zip = $this->make_scene_zip( 'versioned-scene' );
		$res = oddout_catalog_download_matches_entry(
			$zip,
			'versioned-scene.wp',
			array(
				'slug'    => 'versioned-scene',
				'type'    => 'scene',
				'version' => '2.0.0',
			)
		);
		@unlink( $zip );

		$this->assertWPError( $res );
		$this->assertSame( 'catalog_version_mismatch', $res->get_error_code() );
	}
}
