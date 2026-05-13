<?php
/**
 * Test fixtures for catalog-backed ODD tests.
 *
 * The plugin ships no content of its own — scene and icon set
 * registries start empty and are populated at runtime by installed
 * `.wp` bundles (through filters in `includes/content/*.php`). Unit
 * tests that want something in those registries install a cheap
 * in-memory fixture via these helpers.
 */
class ODDOUT_Registry_Fixtures {

	/**
	 * Install a synthetic scene descriptor through the
	 * `oddout_scene_registry` filter. Resets the wallpaper registry's
	 * per-request caches so the new entry is visible to
	 * `oddout_wallpaper_scenes()` + `oddout_wallpaper_scene_slugs()`.
	 *
	 * The priority is `20` so tests that register their own filter at
	 * the default priority `10` still take precedence where needed.
	 *
	 * @param string $slug Bundle slug. Defaults to `flux` so legacy
	 *                     tests that hard-coded the old bundled scene
	 *                     keep passing.
	 * @return void
	 */
	public static function install_scene( $slug = 'flux' ) {
		add_filter(
			'oddout_scene_registry',
			static function ( $scenes ) use ( $slug ) {
				$scenes[] = array(
					'slug'          => $slug,
					'label'         => ucfirst( $slug ),
					'franchise'     => 'Fixtures',
					'tags'          => array( 'fixture' ),
					'fallbackColor' => '#112233',
					'previewUrl'    => 'https://example.test/' . rawurlencode( $slug ) . '/preview.webp',
					'wallpaperUrl'  => 'https://example.test/' . rawurlencode( $slug ) . '/wallpaper.webp',
				);
				return $scenes;
			},
			20
		);
		if ( function_exists( 'oddout_wallpaper_scenes_reset' ) ) {
			oddout_wallpaper_scenes_reset();
		}
	}

	/**
	 * Install a synthetic icon-set descriptor through the
	 * `oddout_icon_set_registry` filter. The filter runs after the disk
	 * scan, so we can inject a descriptor that skips the usual
	 * file-existence checks — `icons` values are treated as opaque
	 * URLs by the dock-item + desktop-icons filters.
	 *
	 * @param string $slug Set slug. Defaults to `filament` so legacy
	 *                     tests that hard-coded the old bundled set
	 *                     keep passing.
	 * @return void
	 */
	public static function install_iconset( $slug = 'filament' ) {
		add_filter(
			'oddout_icon_set_registry',
			static function ( $sets ) use ( $slug ) {
				$sets[ $slug ] = array(
					'slug'        => $slug,
					'label'       => ucfirst( $slug ),
					'franchise'   => 'Fixtures',
					'accent'      => '#888888',
					'description' => 'Test fixture',
					'preview'     => 'https://example.test/icons/' . rawurlencode( $slug ) . '/preview.svg',
					'icons'       => array(
						'dashboard'   => 'https://example.test/icons/' . rawurlencode( $slug ) . '/dashboard.svg',
						'posts'       => 'https://example.test/icons/' . rawurlencode( $slug ) . '/posts.svg',
						'pages'       => 'https://example.test/icons/' . rawurlencode( $slug ) . '/pages.svg',
						'recycle-bin' => 'https://example.test/icons/' . rawurlencode( $slug ) . '/recycle-bin.svg',
						'fallback'    => 'https://example.test/icons/' . rawurlencode( $slug ) . '/fallback.svg',
					),
					'source'      => 'fixture',
				);
				return $sets;
			},
			20
		);
		if ( function_exists( 'oddout_icons_get_sets' ) ) {
			oddout_icons_get_sets( true );
		}
	}

	/**
	 * Wipe registry memoisation so the next read sees filters that
	 * changed since the last call. Call this in tests that
	 * `remove_all_filters()` on either registry.
	 *
	 * @return void
	 */
	public static function reset_caches() {
		if ( function_exists( 'oddout_wallpaper_scenes_reset' ) ) {
			oddout_wallpaper_scenes_reset();
		}
		if ( function_exists( 'oddout_icons_get_sets' ) ) {
			oddout_icons_get_sets( true );
		}
	}
}
