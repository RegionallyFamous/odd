<?php
/**
 * REST: /odd/v1/prefs
 *
 * Contract tests for GET + POST covering happy path, bad inputs, permission
 * paths, sanitization and clamping.
 */

class Test_REST_Prefs extends ODD_REST_Test_Case {

	public function set_up() {
		parent::set_up();
		// The plugin ships no scenes / icon sets of its own.
		// Seed a fixture scene + icon set so the prefs controller has
		// a non-empty catalog to serialize and validate against.
		ODD_Registry_Fixtures::install_scene( 'flux' );
		ODD_Registry_Fixtures::install_iconset( 'filament' );
	}

	public function test_get_requires_login() {
		$this->log_out();
		$res = $this->dispatch_json( 'GET', '/odd/v1/prefs' );
		$this->assertSame( 401, $res->get_status(), 'Logged-out GET must 401.' );
	}

	public function test_get_returns_full_shape_for_logged_in_user() {
		$this->login_as();

		$res = $this->dispatch_json( 'GET', '/odd/v1/prefs' );
		$this->assertSame( 200, $res->get_status() );

		$data = $res->get_data();
		foreach (
			array(
				'wallpaper',
				'favorites',
				'recents',
				'shuffle',
				'screensaver',
				'audioReactive',
				'shopTaskbar',
				'shopDesktopPinned',
				'theme',
				'chaosMode',
				'iconSet',
				'scenes',
				'sets',
			) as $key
		) {
			$this->assertArrayHasKey( $key, $data, "Missing {$key} in prefs response." );
		}

		$this->assertIsArray( $data['scenes'] );
		$this->assertNotEmpty( $data['scenes'], 'Scenes catalog must not be empty.' );
		$this->assertIsArray( $data['sets'] );
		$this->assertIsArray( $data['shuffle'] );
		$this->assertArrayHasKey( 'enabled', $data['shuffle'] );
		$this->assertArrayHasKey( 'minutes', $data['shuffle'] );
		$this->assertIsArray( $data['screensaver'] );
		$this->assertArrayHasKey( 'enabled', $data['screensaver'] );
		$this->assertArrayHasKey( 'minutes', $data['screensaver'] );
		$this->assertArrayHasKey( 'scene', $data['screensaver'] );
		$this->assertTrue( $data['shopTaskbar'] );
		$this->assertFalse( $data['shopDesktopPinned'] );
		$this->assertSame( 'auto', $data['theme'] );
		$this->assertFalse( $data['chaosMode'] );
	}

	public function test_post_accepts_valid_wallpaper() {
		$this->login_as();

		$slugs = odd_wallpaper_scene_slugs();
		$this->assertNotEmpty( $slugs, 'Fixture safety: scene catalog must not be empty.' );
		$target = $slugs[0];

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'wallpaper' => $target ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertSame( $target, $res->get_data()['wallpaper'] );
		$this->assertSame( $target, get_user_meta( $this->admin_id, 'odd_wallpaper', true ) );
	}

	public function test_post_rejects_unknown_wallpaper_slug() {
		$this->login_as();
		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'wallpaper' => '../etc/passwd' ) );
		$this->assertSame( 400, $res->get_status() );
		$this->assertSame( 'odd_invalid_wallpaper', $res->get_data()['code'] );
	}

	public function test_post_clamps_shuffle_minutes() {
		$this->login_as();

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/prefs',
			array(
				'shuffle' => array(
					'enabled' => true,
					'minutes' => 9999,
				),
			)
		);
		$this->assertSame( 200, $res->get_status() );
		$s = $res->get_data()['shuffle'];
		$this->assertTrue( $s['enabled'] );
		$this->assertLessThanOrEqual( 240, $s['minutes'], 'Shuffle minutes must clamp to <= 240.' );
		$this->assertGreaterThanOrEqual( 1, $s['minutes'] );
	}

	public function test_post_sanitizes_screensaver_scene_whitelist() {
		$this->login_as();

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/prefs',
			array(
				'screensaver' => array(
					'enabled' => true,
					'minutes' => 300,
					'scene'   => '../etc/passwd',
				),
			)
		);
		$this->assertSame( 200, $res->get_status() );
		$s = $res->get_data()['screensaver'];
		$this->assertTrue( $s['enabled'] );
		$this->assertLessThanOrEqual( 120, $s['minutes'], 'Screensaver minutes clamp to <= 120.' );
		$this->assertGreaterThanOrEqual( 1, $s['minutes'] );
		$this->assertSame( 'current', $s['scene'], 'Unknown scene falls back to "current".' );
	}

	public function test_post_accepts_random_screensaver_scene() {
		$this->login_as();

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/prefs',
			array(
				'screensaver' => array(
					'enabled' => true,
					'minutes' => 10,
					'scene'   => 'random',
				),
			)
		);
		$this->assertSame( 200, $res->get_status() );
		$this->assertSame( 'random', $res->get_data()['screensaver']['scene'] );
	}

	public function test_post_updates_shop_taskbar_preference() {
		$this->login_as();

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'shopTaskbar' => true ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertTrue( $res->get_data()['shopTaskbar'] );
		$this->assertSame( '1', get_user_meta( $this->admin_id, 'odd_shop_taskbar', true ) );

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'shopTaskbar' => false ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertFalse( $res->get_data()['shopTaskbar'] );
		$this->assertSame( '0', get_user_meta( $this->admin_id, 'odd_shop_taskbar', true ) );
	}

	public function test_post_updates_shop_desktop_pinned_preference() {
		$this->login_as();

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'shopDesktopPinned' => true ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertTrue( $res->get_data()['shopDesktopPinned'] );
		$this->assertSame( '1', get_user_meta( $this->admin_id, 'odd_shop_desktop_pinned', true ) );

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'shopDesktopPinned' => false ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertFalse( $res->get_data()['shopDesktopPinned'] );
		$this->assertSame( '0', get_user_meta( $this->admin_id, 'odd_shop_desktop_pinned', true ) );
	}

	public function test_post_round_trips_shop_theme_preference() {
		$this->login_as();

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'theme' => 'dark' ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertSame( 'dark', $res->get_data()['theme'] );
		$this->assertSame( 'dark', get_user_meta( $this->admin_id, 'odd_shop_theme', true ) );

		$res = $this->dispatch_json( 'GET', '/odd/v1/prefs' );
		$this->assertSame( 200, $res->get_status() );
		$this->assertSame( 'dark', $res->get_data()['theme'] );
	}

	public function test_post_rejects_invalid_shop_theme_preference() {
		$this->login_as();

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'theme' => 'sepia' ) );
		$this->assertSame( 400, $res->get_status() );
		$this->assertSame( 'odd_invalid_theme', $res->get_data()['code'] );
	}

	public function test_post_caps_favorites_at_50() {
		$this->login_as();

		$slugs = odd_wallpaper_scene_slugs();
		$fav   = array();
		for ( $i = 0; $i < 120; $i++ ) {
			$fav[] = $slugs[ $i % count( $slugs ) ];
		}

		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'favorites' => $fav ) );
		$this->assertSame( 200, $res->get_status() );
		$this->assertLessThanOrEqual( 50, count( $res->get_data()['favorites'] ) );
	}

	public function test_post_rejects_invalid_icon_set() {
		$this->login_as();
		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'iconSet' => 'does-not-exist' ) );
		$this->assertSame( 400, $res->get_status() );
		$this->assertSame( 'odd_invalid_icon_set', $res->get_data()['code'] );
	}

	public function test_post_accepts_partial_update_without_touching_other_keys() {
		$this->login_as();

		update_user_meta( $this->admin_id, 'odd_wallpaper', 'flux' );
		update_user_meta( $this->admin_id, 'odd_audio_reactive', 1 );

		$res = $this->dispatch_json(
			'POST',
			'/odd/v1/prefs',
			array( 'audioReactive' => false )
		);
		$this->assertSame( 200, $res->get_status() );
		$this->assertFalse( $res->get_data()['audioReactive'] );
		$this->assertSame( 'flux', get_user_meta( $this->admin_id, 'odd_wallpaper', true ) );
	}

	public function test_post_requires_login() {
		$this->log_out();
		$res = $this->dispatch_json( 'POST', '/odd/v1/prefs', array( 'wallpaper' => 'flux' ) );
		$this->assertSame( 401, $res->get_status() );
	}
}
