<?php
/**
 * Tests for the monotonic starter-pack state machine.
 *
 * Covers the pure helpers introduced for per-slug tracking:
 *
 *   - oddout_starter_merge_slug_results() never downgrades a 'done' slug.
 *   - oddout_starter_compute_status() derives the top-level status
 *     from the per-slug map as `installed`, `partial`, `failed`, or
 *     `pending`.
 *
 * The installer itself (oddout_starter_install_now) is exercised by
 * install-smoke.yml against the fixture catalog; this PHPUnit layer
 * pins the state-transition rules so partial-install reliability
 * is testable without real network I/O.
 */

class Test_Starter_State extends WP_UnitTestCase {

	public function tear_down() {
		if ( function_exists( 'oddout_starter_reset' ) ) {
			oddout_starter_reset();
		}
		wp_set_current_user( 0 );
		remove_all_filters( 'pre_http_request' );
		global $wp_rest_server;
		$wp_rest_server = null;
		parent::tear_down();
	}

	private function dispatch_starter_get() {
		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'GET', '/odd/v1/starter' );
		return $wp_rest_server->dispatch( $request );
	}

	public function test_initial_state_is_pending_and_has_slug_map() {
		$state = oddout_starter_get_state();
		$this->assertSame( 'pending', $state['status'] );
		$this->assertSame( 0, $state['attempts'] );
		$this->assertIsArray( $state['slugs'] );
		$this->assertSame( array(), $state['slugs'] );
	}

	public function test_starter_rest_get_requires_login() {
		wp_set_current_user( 0 );

		$response = $this->dispatch_starter_get();

		$this->assertSame( 401, $response->get_status() );
	}

	public function test_starter_rest_get_allows_subscribers_with_read_capability() {
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode(
						array(
							'version'      => 1,
							'starter_pack' => array(),
							'bundles'      => array(),
						)
					),
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
				);
			}
		);
		$user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $user_id );

		$response = $this->dispatch_starter_get();

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_shell_config_uses_large_dock_when_odd_wallpaper_is_active() {
		$config = array(
			'osSettings' => array(
				'wallpaper' => 'odd',
				'dockSize'  => 'default',
			),
		);

		$after = apply_filters( 'desktop_mode_shell_config', $config );

		$this->assertSame( 'large', $after['osSettings']['dockSize'] );
	}

	public function test_shell_config_leaves_dock_size_alone_for_other_wallpapers() {
		$config = array(
			'osSettings' => array(
				'wallpaper' => 'dark',
				'dockSize'  => 'compact',
			),
		);

		$after = apply_filters( 'desktop_mode_shell_config', $config );

		$this->assertSame( 'compact', $after['osSettings']['dockSize'] );
	}

	public function test_merge_slug_results_marks_new_done_entries() {
		$state = oddout_starter_get_state();
		$state = oddout_starter_merge_slug_results(
			$state,
			array(
				'alpha' => array( 'status' => 'done' ),
				'beta'  => array(
					'status' => 'failed',
					'error'  => 'boom',
				),
			)
		);
		$this->assertSame( 'done', $state['slugs']['alpha']['status'] );
		$this->assertSame( 'failed', $state['slugs']['beta']['status'] );
		$this->assertSame( 'boom', $state['slugs']['beta']['error'] );
	}

	public function test_merge_slug_results_is_monotonic_for_done() {
		$state = oddout_starter_get_state();
		$state = oddout_starter_merge_slug_results(
			$state,
			array( 'alpha' => array( 'status' => 'done' ) )
		);
		$state = oddout_starter_merge_slug_results(
			$state,
			array(
				'alpha' => array(
					'status' => 'failed',
					'error'  => 'should-not-appear',
				),
			)
		);
		$this->assertSame( 'done', $state['slugs']['alpha']['status'], 'Done slugs must never be downgraded to failed.' );
		$this->assertSame( '', $state['slugs']['alpha']['error'] );
	}

	public function test_merge_slug_results_allows_failed_to_done_upgrade() {
		$state = oddout_starter_get_state();
		$state = oddout_starter_merge_slug_results(
			$state,
			array(
				'alpha' => array(
					'status' => 'failed',
					'error'  => 'first try',
				),
			)
		);
		$state = oddout_starter_merge_slug_results(
			$state,
			array( 'alpha' => array( 'status' => 'done' ) )
		);
		$this->assertSame( 'done', $state['slugs']['alpha']['status'] );
	}

	public function test_compute_status_when_all_done_is_installed() {
		$state = array(
			'slugs' => array(
				'a' => array( 'status' => 'done' ),
				'b' => array( 'status' => 'done' ),
			),
		);
		$this->assertSame( 'installed', oddout_starter_compute_status( $state, array( 'a', 'b' ) ) );
	}

	public function test_compute_status_partial_when_some_done_and_some_failed() {
		$state = array(
			'slugs' => array(
				'a' => array( 'status' => 'done' ),
				'b' => array( 'status' => 'failed' ),
			),
		);
		$this->assertSame( 'partial', oddout_starter_compute_status( $state, array( 'a', 'b' ) ) );
	}

	public function test_compute_status_partial_when_some_done_and_some_pending() {
		$state = array(
			'slugs' => array(
				'a' => array( 'status' => 'done' ),
			),
		);
		$this->assertSame( 'partial', oddout_starter_compute_status( $state, array( 'a', 'b' ) ) );
	}

	public function test_compute_status_failed_when_no_successes() {
		$state = array(
			'slugs' => array(
				'a' => array( 'status' => 'failed' ),
				'b' => array( 'status' => 'failed' ),
			),
		);
		$this->assertSame( 'failed', oddout_starter_compute_status( $state, array( 'a', 'b' ) ) );
	}

	public function test_compute_status_pending_when_nothing_attempted() {
		$state = array( 'slugs' => array() );
		$this->assertSame( 'pending', oddout_starter_compute_status( $state, array( 'a' ) ) );
	}
}
