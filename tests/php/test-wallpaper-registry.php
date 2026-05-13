<?php
/**
 * Wallpaper registry contract.
 *
 * The plugin ships no scenes. The registry is filter-driven
 * and populated at runtime by installed scene bundles (see
 * includes/content/scenes.php). These tests walk the catalog-source
 * tree at `_tools/catalog-sources/scenes/<slug>/meta.json` to prove
 * the on-disk content that WILL ship as remote bundles stays
 * well-formed, and then separately exercise the filter contract so
 * a bundle publishing a scene through `oddout_scene_registry` works.
 */

class Test_Wallpaper_Registry extends WP_UnitTestCase {

	/**
	 * Locate the catalog-sources scenes directory relative to the
	 * repo root (`dirname( __DIR__, 2 )` walks up from
	 * tests/php/ to the repo root).
	 */
	private function scenes_dir() {
		return dirname( __DIR__, 2 ) . '/_tools/catalog-sources/scenes';
	}

	private function read_source_scenes() {
		$dir = $this->scenes_dir();
		if ( ! is_dir( $dir ) ) {
			return array();
		}
		$scenes = array();
		foreach ( scandir( $dir ) as $name ) {
			if ( '.' === $name || '..' === $name ) {
				continue;
			}
			$path = $dir . '/' . $name;
			if ( ! is_dir( $path ) ) {
				continue;
			}
			$meta_path = $path . '/meta.json';
			if ( ! is_readable( $meta_path ) ) {
				continue;
			}
			$meta = json_decode( file_get_contents( $meta_path ), true );
			if ( ! is_array( $meta ) ) {
				continue;
			}
			$meta['__slug__'] = $name;
			$scenes[]         = $meta;
		}
		return $scenes;
	}

	public function test_scene_registry_default_is_empty() {
		// ODD no longer seeds scenes from the plugin. Without
		// installed bundles the registry starts empty; the built-in
		// "pending" fallback lives entirely in JS for first-paint.
		remove_all_filters( 'oddout_scene_registry' );
		oddout_wallpaper_scenes_reset();
		$scenes = oddout_wallpaper_scenes();
		$this->assertIsArray( $scenes );
		$this->assertCount( 0, $scenes, 'Empty plugin should ship zero scenes.' );
	}

	public function test_scene_registry_honours_filter() {
		remove_all_filters( 'oddout_scene_registry' );
		add_filter(
			'oddout_scene_registry',
			function ( $scenes ) {
				$scenes[] = array(
					'slug'          => 'sample',
					'label'         => 'Sample',
					'franchise'     => 'Test',
					'tags'          => array( 'fake' ),
					'fallbackColor' => '#112233',
					'previewUrl'    => 'https://example.com/sample/preview.webp',
					'wallpaperUrl'  => 'https://example.com/sample/wallpaper.webp',
				);
				return $scenes;
			}
		);
		oddout_wallpaper_scenes_reset();

		$slugs = oddout_wallpaper_scene_slugs();
		$this->assertContains( 'sample', $slugs );
		$this->assertSame( 'sample', oddout_wallpaper_default_scene() );
	}

	public function test_catalog_source_scenes_are_well_formed() {
		$scenes = $this->read_source_scenes();
		if ( empty( $scenes ) ) {
			$this->markTestSkipped( '_tools/catalog-sources/scenes/ is empty (dev checkout without sources).' );
		}
		foreach ( $scenes as $s ) {
			$slug = $s['__slug__'];
			$this->assertArrayHasKey( 'slug', $s, "meta.json missing slug for {$slug}" );
			$this->assertSame( $slug, $s['slug'], "folder/slug mismatch for {$slug}" );
			$this->assertArrayHasKey( 'label', $s );
			$this->assertArrayHasKey( 'franchise', $s );
			$this->assertArrayHasKey( 'tags', $s );
			$this->assertArrayHasKey( 'fallbackColor', $s );
			$this->assertIsArray( $s['tags'] );
			$this->assertMatchesRegularExpression( '/^#[0-9a-fA-F]{6}$/', $s['fallbackColor'] );
			$this->assertMatchesRegularExpression( '/^[a-z0-9][a-z0-9-]*$/', $s['slug'] );
		}
	}

	public function test_catalog_source_slugs_are_unique() {
		$scenes = $this->read_source_scenes();
		if ( empty( $scenes ) ) {
			$this->markTestSkipped( '_tools/catalog-sources/scenes/ is empty.' );
		}
		$slugs = array_column( $scenes, 'slug' );
		$this->assertCount( count( array_unique( $slugs ) ), $slugs, 'Duplicate slugs in catalog-sources/scenes.' );
	}

	public function test_catalog_source_scenes_have_assets_on_disk() {
		$scenes = $this->read_source_scenes();
		if ( empty( $scenes ) ) {
			$this->markTestSkipped( '_tools/catalog-sources/scenes/ is empty.' );
		}
		$dir = $this->scenes_dir();
		foreach ( $scenes as $s ) {
			$slug = $s['slug'];
			$this->assertFileExists( "{$dir}/{$slug}/scene.js", "Scene JS missing for {$slug}." );
			$this->assertFileExists( "{$dir}/{$slug}/preview.webp", "Preview missing for {$slug}." );
			$this->assertFileExists( "{$dir}/{$slug}/wallpaper.webp", "Wallpaper missing for {$slug}." );
		}
	}
}
