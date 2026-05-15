<?php
/**
 * Tests for odd/includes/native-window.php — specifically the
 * desktop_mode_shell_config filter that governs how the ODD Shop
 * window participates in WP Desktop Mode's shell boot config.
 *
 * These exercise classes of behavior:
 *
 *  1. Registered native-window minimum size limits (420x420) on BOTH
 *     `nativeWindows[]` entries (snake_case and camelCase) AND any
 *     `session.windows[]` replayed at boot (shell variants differ).
 *  2. Preserving Desktop Mode persisted state values (fullscreen/maximized).
 *  3. `desktop_mode_file_serialize` (registered in dock-filter.php): themed
 *     shortcut snapshots + HTTPS preview URLs for Desktop Mode ≥0.9 placements.
 */

class Test_Native_Window extends WP_UnitTestCase {

	public function test_file_serialize_shortcut_http_icon_gains_preview_url() {
		$eye = 'https://example.test/wp-content/plugins/odd/assets/odd-eye.svg';

		$shape = apply_filters(
			'desktop_mode_file_serialize',
			array(
				'type'       => 'shortcut',
				'ref'        => 'odd',
				'title'      => 'ODD',
				'icon'       => $eye,
				'previewUrl' => '',
				'exists'     => true,
			),
			null
		);

		$this->assertSame( $eye, $shape['previewUrl'] );
		$this->assertSame( 'dashicons-media-default', $shape['icon'] );
	}

	public function test_file_serialize_leaves_explicit_preview_only() {
		$icon    = 'https://example.test/icon.svg';
		$preview = 'https://example.test/thumb.webp';

		$shape = apply_filters(
			'desktop_mode_file_serialize',
			array(
				'type'       => 'shortcut',
				'ref'        => 'odd',
				'title'      => 'ODD',
				'icon'       => $icon,
				'previewUrl' => $preview,
				'exists'     => true,
			),
			null
		);

		$this->assertSame( $preview, $shape['previewUrl'], 'Existing preview wins.' );
		$this->assertSame( $icon, $shape['icon'], 'Leave icon untouched when preview is set.' );
	}

	public function test_file_serialize_non_shortcut_icon_unchanged() {
		$icon = 'https://example.test/item.svg';
		$row  = array(
			'type'       => 'attachment',
			'ref'        => '7',
			'title'      => 'File',
			'icon'       => $icon,
			'previewUrl' => '',
			'exists'     => true,
		);
		$this->assertSame( $row, apply_filters( 'desktop_mode_file_serialize', $row, null ) );
	}

	public function test_native_window_entry_gets_camelcase_and_snakecase_mins() {
		$config = apply_filters(
			'desktop_mode_shell_config',
			array(
				'nativeWindows' => array(
					array(
						'id'        => 'odd',
						'title'     => 'ODD Shop',
						'placement' => 'dock',
					),
					array(
						'id'        => 'other',
						'title'     => 'Another',
						'placement' => 'dock',
					),
				),
			)
		);

		$odd = $config['nativeWindows'][0];

		$this->assertSame( 420, $odd['min_width'] );
		$this->assertSame( 420, $odd['min_height'] );
		$this->assertSame( 420, $odd['minWidth'] );
		$this->assertSame( 420, $odd['minHeight'] );
		$this->assertArrayNotHasKey( 'min_width', $config['nativeWindows'][1], 'Other windows must not be touched.' );
	}

	public function test_session_window_for_odd_preserves_user_size_within_bounds() {
		$config = apply_filters(
			'desktop_mode_shell_config',
			array(
				'session' => array(
					'windows' => array(
						array(
							'id'     => 'odd',
							'width'  => 500,
							'height' => 500,
						),
					),
				),
			)
		);

		$window = $config['session']['windows'][0];
		$this->assertSame( 500, $window['width'], 'Intentional user resize preserved.' );
		$this->assertSame( 500, $window['height'], 'Intentional user resize preserved.' );
		$this->assertSame( 'normal', $window['state'] );
		$this->assertSame( 420, $window['min_width'] );
		$this->assertSame( 420, $window['minWidth'] );
	}

	/**
	 * @dataProvider valid_window_states
	 */
	public function test_session_window_for_odd_preserves_valid_host_state( $state ) {
		$config = apply_filters(
			'desktop_mode_shell_config',
			array(
				'session' => array(
					'windows' => array(
						array(
							'id'     => 'odd',
							'state'  => $state,
							'width'  => 720,
							'height' => 520,
						),
					),
				),
			)
		);

		$window = $config['session']['windows'][0];
		$this->assertSame( $state, $window['state'] );
		$this->assertSame( 720, $window['width'], 'Fresh-start config no longer migrates old saved widths.' );
		$this->assertSame( 520, $window['height'], 'Fresh-start config no longer migrates old saved heights.' );
	}

	public function valid_window_states() {
		return array(
			'normal'     => array( 'normal' ),
			'minimized'  => array( 'minimized' ),
			'maximized'  => array( 'maximized' ),
			'fullscreen' => array( 'fullscreen' ),
		);
	}

	public function test_session_window_for_odd_normalizes_invalid_state() {
		$config = apply_filters(
			'desktop_mode_shell_config',
			array(
				'session' => array(
					'windows' => array(
						array(
							'id'     => 'odd',
							'state'  => 'bogus',
							'width'  => 500,
							'height' => 500,
						),
					),
				),
			)
		);

		$this->assertSame( 'normal', $config['session']['windows'][0]['state'] );
	}

	public function test_oversized_saved_widths_are_preserved() {
		$config = apply_filters(
			'desktop_mode_shell_config',
			array(
				'session' => array(
					'windows' => array(
						array(
							'id'     => 'odd',
							'width'  => 2400,
							'height' => 1400,
						),
					),
				),
			)
		);

		$window = $config['session']['windows'][0];
		$this->assertSame( 2400, $window['width'] );
		$this->assertSame( 1400, $window['height'] );
	}

	public function test_non_odd_session_windows_are_untouched() {
		$config = apply_filters(
			'desktop_mode_shell_config',
			array(
				'session' => array(
					'windows' => array(
						array(
							'id'     => 'plugins',
							'width'  => 720,
							'height' => 520,
						),
					),
				),
			)
		);

		$window = $config['session']['windows'][0];
		$this->assertSame( 720, $window['width'], 'Migrations must only touch the ODD window.' );
		$this->assertSame( 520, $window['height'], 'Migrations must only touch the ODD window.' );
		$this->assertArrayNotHasKey( 'min_width', $window );
	}
}
