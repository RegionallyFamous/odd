<?php
/**
 * Tests for the native Desktop Mode icon filters in
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
		$this->assertSame( 'odd', oddout_icons_slug_to_key( 'odd' ) );
		$this->assertSame( 'my-wordpress', oddout_icons_slug_to_key( 'desktop-mode-my-wordpress' ) );
		$this->assertSame( 'my-wordpress', oddout_icons_slug_to_key( 'my-wordpress' ) );
		$this->assertSame( 'content-graph', oddout_icons_slug_to_key( 'desktop-mode-content-graph' ) );
		$this->assertSame( 'content-graph', oddout_icons_slug_to_key( 'content-graph' ) );
		$this->assertSame( 'recycle-bin', oddout_icons_slug_to_key( 'desktop-mode-recycle-bin' ) );
		$this->assertSame( 'fallback', oddout_icons_slug_to_key( 'fallback' ) );
		$this->assertSame( '', oddout_icons_slug_to_key( 'edit.php?post_type=book' ), 'Admin menu slugs are no longer icon-set keys.' );
		$this->assertSame( '', oddout_icons_slug_to_key( 'something-else' ) );
		$this->assertSame( '', oddout_icons_slug_to_key( '' ) );
	}

	public function test_dock_item_filter_leaves_rail_icons_on_desktop_mode_defaults() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$item_before = array(
			'icon' => 'original.png',
			'menu' => 'Posts',
		);
		$item_after  = apply_filters( 'desktop_mode_dock_item', $item_before, 'edit.php' );

		$this->assertIsArray( $item_after );
		$this->assertArrayHasKey( 'icon', $item_after );
		$this->assertSame( 'original.png', $item_after['icon'], 'Icon sets should not rewrite rail/dock icons.' );
	}

	public function test_dock_item_filter_does_not_fallback_for_unknown_menu_slug() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$item_before = array( 'icon' => 'original.png' );
		$item_after  = apply_filters( 'desktop_mode_dock_item', $item_before, 'third-party-plugin.php' );

		$this->assertIsArray( $item_after );
		$this->assertSame( 'original.png', $item_after['icon'], 'Unknown dock items stay on Desktop Mode defaults too.' );
	}

	public function test_dock_item_filter_is_noop_when_no_set_active() {
		oddout_icons_set_active_slug( 'none' );

		$item_before = array( 'icon' => 'original.png' );
		$item_after  = apply_filters( 'desktop_mode_dock_item', $item_before, 'edit.php' );

		$this->assertSame( 'original.png', $item_after['icon'], 'No active set = icon unchanged.' );
	}

	public function test_desktop_icons_filter_themes_odd_control_panel() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$registry_before = array(
			'odd'          => array(
				'id'     => 'odd',
				'icon'   => 'odd-gear.png',
				'window' => '',
			),
			'my-wordpress' => array(
				'id'     => 'desktop-mode-my-wordpress',
				'title'  => 'My WordPress',
				'icon'   => 'original-my-wordpress.png',
				'window' => 'desktop-mode-my-wordpress',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertStringEndsWith( '/odd.webp', $registry_after['odd']['icon'], 'ODD Shop desktop icon is part of the active set.' );
		$this->assertNotSame( 'original-my-wordpress.png', $registry_after['my-wordpress']['icon'], 'Desktop Mode shortcut gets re-themed.' );
		$this->assertStringEndsWith( '/my-wordpress.webp', $registry_after['my-wordpress']['icon'] );
	}

	public function test_desktop_icons_filter_uses_recycle_bin_icon_dm07_ids() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$registry_before = array(
			'desktop-mode-recycle-bin' => array(
				'id'     => 'desktop-mode-recycle-bin',
				'title'  => 'Recycle Bin',
				'icon'   => 'original-trash.png',
				'window' => 'desktop-mode-recycle-bin',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertStringContainsString( '/recycle-bin.webp', $registry_after['desktop-mode-recycle-bin']['icon'] );
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
						'fallback' => 'https://example.test/icons/minimal/fallback.webp',
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
				'id'     => 'baseline-trash',
				'title'  => 'Recycle Bin',
				'icon'   => 'original-trash.png',
				'window' => 'desktop-mode-recycle-bin',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertSame( 'https://example.test/icons/minimal/fallback.webp', $registry_after['trash']['icon'] );
	}

	public function test_desktop_icons_filter_skips_odd_app_shortcuts() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$registry_before = array(
			'odd-app-board' => array(
				'id'     => 'odd-app-board',
				'icon'   => 'board-icon.png',
				'window' => 'odd-app-board',
			),
			'content-graph' => array(
				'id'     => 'desktop-mode-content-graph',
				'title'  => 'Content Graph',
				'icon'   => 'original-content-graph.png',
				'window' => 'desktop-mode-content-graph',
			),
		);
		$registry_after  = apply_filters( 'desktop_mode_icons', $registry_before );

		$this->assertSame( 'board-icon.png', $registry_after['odd-app-board']['icon'], 'App desktop icon must stay app-specific.' );
		$this->assertNotSame( 'original-content-graph.png', $registry_after['content-graph']['icon'], 'Desktop Mode shortcut still gets re-themed.' );
		$this->assertStringEndsWith( '/content-graph.webp', $registry_after['content-graph']['icon'] );
	}

	public function test_desktop_icons_filter_handles_empty_registry() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$this->assertSame( array(), apply_filters( 'desktop_mode_icons', array() ) );
	}

	public function test_code_editor_taskbar_icon_stays_on_desktop_mode_default() {
		$config_before = array(
			'desktopIcons'  => array(
				array(
					'id'     => 'wpdc-editor',
					'window' => 'wpdc-editor',
					'icon'   => 'themed-code.png',
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

		$this->assertSame( 'dashicons-editor-code', $config_after['nativeWindows'][0]['icon'] );
		$this->assertSame( 'dashicons-admin-generic', $config_after['nativeWindows'][1]['icon'] );
	}

	public function test_recycle_bin_taskbar_icon_uses_active_set() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$config_before = array(
			'nativeWindows' => array(
				array(
					'id'        => 'desktop-mode-recycle-bin',
					'title'     => 'Recycle Bin',
					'icon'      => 'dashicons-trash',
					'placement' => 'dock',
				),
				array(
					'id'        => 'wpdc-editor',
					'title'     => 'Code',
					'icon'      => 'dashicons-editor-code',
					'placement' => 'dock',
				),
			),
		);

		$config_after = apply_filters( 'desktop_mode_shell_config', $config_before );

		$this->assertStringEndsWith( '/recycle-bin.webp', $config_after['nativeWindows'][0]['icon'] );
		$this->assertSame( 'dashicons-editor-code', $config_after['nativeWindows'][1]['icon'] );
	}

	public function test_shell_config_themes_odd_native_window_icon_only() {
		$set_slug = $this->pick_set_with_fallback();
		oddout_icons_set_active_slug( $set_slug );

		$config_before = array(
			'systemTiles'   => array(
				array(
					'id'    => 'desktop-mode-os-settings',
					'title' => 'OS Settings',
					'icon'  => 'dashicons-desktop',
				),
				array(
					'id'    => 'desktop-mode-pwa-install',
					'title' => 'Install My WordPress Website as an app',
					'icon'  => 'dashicons-download',
				),
				array(
					'id'    => 'desktop-mode-bug-report',
					'title' => 'Report a bug',
					'icon'  => 'dashicons-buddicons-replies',
				),
				array(
					'id'    => 'desktop-mode-exit',
					'title' => 'Exit Desktop Mode',
					'icon'  => 'dashicons-exit',
				),
			),
			'nativeWindows' => array(
				array(
					'id'        => 'desktop-mode-posts',
					'title'     => 'Posts',
					'icon'      => 'dashicons-admin-post',
					'placement' => 'none',
				),
				array(
					'id'        => 'desktop-mode-plugins',
					'title'     => 'Plugins',
					'icon'      => 'dashicons-admin-plugins',
					'placement' => 'none',
				),
				array(
					'id'        => 'odd',
					'title'     => 'ODD Shop',
					'icon'      => 'odd-eye.svg',
					'placement' => 'dock',
				),
			),
		);

		$config_after = apply_filters( 'desktop_mode_shell_config', $config_before );

		$this->assertSame( 'dashicons-desktop', $config_after['systemTiles'][0]['icon'] );
		$this->assertSame( 'dashicons-download', $config_after['systemTiles'][1]['icon'] );
		$this->assertSame( 'dashicons-buddicons-replies', $config_after['systemTiles'][2]['icon'] );
		$this->assertSame( 'dashicons-exit', $config_after['systemTiles'][3]['icon'] );
		$this->assertSame( 'dashicons-admin-post', $config_after['nativeWindows'][0]['icon'] );
		$this->assertSame( 'dashicons-admin-plugins', $config_after['nativeWindows'][1]['icon'] );
		$this->assertStringEndsWith( '/odd.webp', $config_after['nativeWindows'][2]['icon'] );
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
			'Recycle bin shortcut must inherit `desktop_mode_icons` image URLs for the active set.'
		);
	}

	public function test_shortcut_https_icon_mirrored_into_preview_for_file_tiles() {
		$icon = 'https://example.test/bin.png';

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
