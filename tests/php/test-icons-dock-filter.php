<?php
/**
 * Tests for the dock-item + desktop-icons filters in
 * odd/includes/icons/dock-filter.php.
 */

class Test_Icons_Dock_Filter extends WP_UnitTestCase {

	/**
	 * @var int
	 */
	protected $user_id;

	public function set_up() {
		parent::set_up();
		// oddout_icons_set_active_slug() writes to user meta and no-ops
		// when no user is logged in, so every filter test that wants
		// an active set has to run as a real user.
		$this->user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->user_id );

		// The plugin ships no icon sets. Tests need to install
		// one through the `oddout_icon_set_registry` filter so
		// `pick_set_with_fallback()` finds something.
		ODDOUT_Registry_Fixtures::install_iconset( 'filament' );
	}

	public function tear_down() {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * Return the first icon set slug that has at least one mapping
	 * and a fallback — safe to run the filter tests against.
	 */
	protected function pick_set_with_fallback() {
		foreach ( oddout_icons_get_sets() as $set ) {
			if ( ! empty( $set['icons']['fallback'] ) ) {
				return $set['slug'];
			}
		}
		$this->fail( 'Fixture safety: no icon set with a fallback icon installed.' );
	}

	public function test_menu_slug_to_key_mapping() {
		$this->assertSame( 'dashboard', oddout_icons_slug_to_key( 'index.php' ) );
		$this->assertSame( 'posts', oddout_icons_slug_to_key( 'edit.php' ) );
		$this->assertSame( 'pages', oddout_icons_slug_to_key( 'edit.php?post_type=page' ) );
		$this->assertSame( 'media', oddout_icons_slug_to_key( 'upload.php' ) );
		$this->assertSame( 'settings', oddout_icons_slug_to_key( 'options-general.php' ) );
		$this->assertSame( 'recycle-bin', oddout_icons_slug_to_key( 'desktop-mode-recycle-bin' ) );
		$this->assertSame( 'posts', oddout_icons_slug_to_key( 'edit.php?post_type=book' ), 'CPT edit screen routes to posts key.' );
		$this->assertSame( '', oddout_icons_slug_to_key( 'something-else' ) );
		$this->assertSame( '', oddout_icons_slug_to_key( '' ) );
	}

	public function test_dock_item_filter_rewrites_icon_for_known_menu_slug() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$item_before = array(
			'icon' => 'original.svg',
			'menu' => 'Posts',
		);
		$item_after  = apply_filters( 'desktop_mode_dock_item', $item_before, 'edit.php' );

		$this->assertIsArray( $item_after );
		$this->assertArrayHasKey( 'icon', $item_after );
		$this->assertNotSame( 'original.svg', $item_after['icon'], 'Icon must be rewritten for a mapped slug.' );
	}

	public function test_dock_item_filter_falls_back_for_unknown_menu_slug() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$item_before = array( 'icon' => 'original.svg' );
		$item_after  = apply_filters( 'desktop_mode_dock_item', $item_before, 'third-party-plugin.php' );

		$this->assertIsArray( $item_after );
		$this->assertNotSame( 'original.svg', $item_after['icon'], 'Unknown slug should still hit the set fallback.' );
	}

	public function test_dock_item_filter_is_noop_when_no_set_active() {
		oddout_icons_set_active_slug( 'none' );

		$item_before = array( 'icon' => 'original.svg' );
		$item_after  = apply_filters( 'desktop_mode_dock_item', $item_before, 'edit.php' );

		$this->assertSame( 'original.svg', $item_after['icon'], 'No active set = icon unchanged.' );
	}

	public function test_desktop_icons_filter_skips_odd_control_panel() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$registry_before = array(
			'odd'   => array(
				'id'     => 'odd',
				'icon'   => 'odd-gear.svg',
				'window' => '',
			),
			'posts' => array(
				'id'     => 'posts',
				'icon'   => 'original-posts.svg',
				'window' => 'edit.php',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertSame( 'odd-gear.svg', $registry_after['odd']['icon'], 'ODD Shop icon must be preserved.' );
		$this->assertNotSame( 'original-posts.svg', $registry_after['posts']['icon'], 'Regular desktop icon gets re-themed.' );
	}

	public function test_desktop_icons_filter_uses_recycle_bin_icon_dm07_ids() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$registry_before = array(
			'desktop-mode-recycle-bin' => array(
				'id'     => 'desktop-mode-recycle-bin',
				'title'  => 'Recycle Bin',
				'icon'   => 'original-trash.svg',
				'window' => 'desktop-mode-recycle-bin',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertStringContainsString( '/recycle-bin.svg', $registry_after['desktop-mode-recycle-bin']['icon'] );
	}

	public function test_desktop_icons_filter_falls_back_when_recycle_bin_icon_is_missing() {
		ODDOUT_Registry_Fixtures::reset_caches();
		add_filter(
			'oddout_icon_set_registry',
			static function ( $sets ) {
				$sets['minimal'] = array(
					'slug'  => 'minimal',
					'label' => 'Minimal',
					'icons' => array(
						'fallback' => 'https://example.test/icons/minimal/fallback.svg',
					),
				);
				return $sets;
			},
			30
		);
		oddout_icons_get_sets( true );
		oddout_icons_set_active_slug( 'minimal' );

		$registry_before = array(
			'trash' => array(
				'id'     => 'legacy-trash',
				'title'  => 'Recycle Bin',
				'icon'   => 'original-trash.svg',
				'window' => 'desktop-mode-recycle-bin',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertSame( 'https://example.test/icons/minimal/fallback.svg', $registry_after['trash']['icon'] );
	}

	public function test_desktop_icons_filter_skips_odd_app_shortcuts() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$registry_before = array(
			'odd-app-board' => array(
				'id'     => 'odd-app-board',
				'icon'   => 'board-icon.svg',
				'window' => 'odd-app-board',
			),
			'posts'         => array(
				'id'     => 'posts',
				'icon'   => 'original-posts.svg',
				'window' => 'edit.php',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertSame( 'board-icon.svg', $registry_after['odd-app-board']['icon'], 'App desktop icon must stay app-specific.' );
		$this->assertNotSame( 'original-posts.svg', $registry_after['posts']['icon'], 'Regular desktop icon still gets re-themed.' );
	}

	public function test_desktop_icons_filter_handles_empty_registry() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$this->assertSame( array(), apply_filters( 'desktop_mode_icons', array() ) );
	}

	public function test_code_editor_taskbar_icon_matches_themed_desktop_icon() {
		$config_before = array(
			'desktopIcons'  => array(
				array(
					'id'     => 'wpdc-editor',
					'window' => 'wpdc-editor',
					'icon'   => 'themed-code.svg',
				),
			),
			'nativeWindows' => array(
				array(
					'id'        => 'wpdc-editor',
					'title'     => 'Code',
					'icon'      => 'dashicons-editor-code',
					'placement' => 'dock',
				),
				array(
					'id'        => 'another-window',
					'title'     => 'Another',
					'icon'      => 'dashicons-admin-generic',
					'placement' => 'dock',
				),
			),
		);

		$config_after = apply_filters( 'desktop_mode_shell_config', $config_before );

		$this->assertSame( 'themed-code.svg', $config_after['nativeWindows'][0]['icon'] );
		$this->assertSame( 'dashicons-admin-generic', $config_after['nativeWindows'][1]['icon'] );
	}

	public function test_shortcut_overlay_rewrites_recycle_bin_icon_like_registry_snapshot() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$shape    = array(
			'type'       => 'shortcut',
			'ref'        => 'desktop-mode-recycle-bin',
			'title'      => 'Recycle Bin',
			'icon'       => 'dashicons-trash',
			'previewUrl' => '',
			'exists'     => true,
		);
		$snapshot = array(
			'id'     => 'desktop-mode-recycle-bin',
			'title'  => 'Recycle Bin',
			'icon'   => 'dashicons-trash',
			'window' => 'desktop-mode-recycle-bin',
		);
		$after    = oddout_icons_overlay_desktop_icons_on_shortcut_shape( $shape, $snapshot );

		$this->assertStringStartsWith(
			'http',
			$after['icon'],
			'Recycle bin shortcut must inherit `desktop_mode_icons` SVG URLs for the active set.'
		);
	}

	public function test_shortcut_https_icon_mirrored_into_preview_for_file_tiles() {
		$icon = 'https://example.test/bin.svg';

		$shapein = array(
			'type'       => 'shortcut',
			'ref'        => 'desktop-mode-recycle-bin',
			'title'      => 'Recycle Bin',
			'icon'       => $icon,
			'previewUrl' => '',
			'exists'     => true,
		);
		$out     = oddout_icons_mirror_https_shortcut_icon_into_preview_if_needed( $shapein );

		$this->assertSame( $icon, $out['previewUrl'] );
		$this->assertSame( 'dashicons-media-default', $out['icon'] );
	}
}
