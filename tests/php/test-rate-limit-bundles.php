<?php
/**
 * Bundle upload / catalog install rate limits (plan item 19).
 */
class Test_Odd_Rate_Limit_Bundles extends WP_UnitTestCase {

	/**
	 * @var int
	 */
	private $admin_id;

	public function setUp(): void {
		parent::setUp();
		$this->admin_id = $this->factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );
		require_once ODDOUT_DIR . 'includes/content/rate-limit.php';
	}

	public function test_rate_limit_allows_first_requests_in_bucket() {
		delete_transient( 'oddout_rl_v2_bundle_upload_' . $this->admin_id . '_' . (int) floor( time() / 60 ) );
		for ( $i = 0; $i < 5; $i++ ) {
			$r = oddout_bundle_rate_limit_check( 'bundle_upload' );
			$this->assertNotInstanceOf( WP_Error::class, $r );
		}
	}

	public function test_rate_limit_hits_429_over_cap() {
		$bucket = (int) floor( time() / 60 );
		delete_transient( 'oddout_rl_v2_bundle_upload_' . $this->admin_id . '_' . $bucket );
		$max   = 10;
		$round = 0;
		$err   = null;
		for ( $i = 0; $i < $max + 3; $i++ ) {
			$r = oddout_bundle_rate_limit_check( 'bundle_upload' );
			if ( is_wp_error( $r ) ) {
				$err = $r;
				break;
			}
			++$round;
		}
		$this->assertInstanceOf( WP_Error::class, $err, 'expected 429 after ' . ( $max + 1 ) . ' attempts' );
		$this->assertSame( 'rest_too_many_requests', $err->get_error_code() );
		$data = $err->get_error_data();
		$this->assertSame( 429, $data['status'] );
		$this->assertGreaterThanOrEqual( 1, $data['retry_after'] );
	}

	public function test_rate_limit_covers_refresh_and_starter_retry_actions() {
		foreach ( array( 'bundle_catalog_refresh', 'starter_retry' ) as $action ) {
			$bucket = (int) floor( time() / 60 );
			delete_transient( 'oddout_rl_v2_' . $action . '_' . $this->admin_id . '_' . $bucket );
			add_filter(
				'oddout_bundle_rate_limit_max',
				static function ( $max, $seen_action ) use ( $action ) {
					return $seen_action === $action ? 1 : $max;
				},
				10,
				2
			);
			$this->assertTrue( oddout_bundle_rate_limit_check( $action ) );
			$this->assertWPError( oddout_bundle_rate_limit_check( $action ) );
			remove_all_filters( 'oddout_bundle_rate_limit_max' );
		}
	}
}
