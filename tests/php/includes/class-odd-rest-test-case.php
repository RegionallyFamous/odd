<?php
/**
 * Shared REST test-case base. Sets up an authenticated admin user and
 * provides convenience helpers for dispatching JSON requests against
 * the WP REST server.
 */

abstract class ODDOUT_REST_Test_Case extends WP_UnitTestCase {
	/**
	 * @var int
	 */
	protected $admin_id;

	/**
	 * @var WP_REST_Server
	 */
	protected $rest_server;

	public function set_up() {
		parent::set_up();

		global $wp_rest_server;
		$wp_rest_server    = new WP_REST_Server();
		$this->rest_server = $wp_rest_server;
		do_action( 'rest_api_init' );

		$this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		global $wp_rest_server;
		$wp_rest_server = null;
		parent::tear_down();
	}

	/**
	 * Authenticate as the provided user id (defaults to the admin created in set_up).
	 */
	protected function login_as( $user_id = null ) {
		if ( null === $user_id ) {
			$user_id = $this->admin_id;
		}
		wp_set_current_user( $user_id );
		return $user_id;
	}

	/**
	 * Log out the current user.
	 */
	protected function log_out() {
		wp_set_current_user( 0 );
	}

	/**
	 * Dispatch a JSON request to the REST server and return the response.
	 *
	 * @param string $method  HTTP method.
	 * @param string $route   Route like `/odd/v1/prefs`.
	 * @param array  $body    Optional JSON body for POST/PUT.
	 * @param array  $query   Optional query args for GET.
	 * @return WP_REST_Response
	 */
	protected function dispatch_json( $method, $route, array $body = array(), array $query = array() ) {
		$request = new WP_REST_Request( $method, $route );
		$request->add_header( 'Content-Type', 'application/json' );
		if ( ! empty( $body ) ) {
			$request->set_body( wp_json_encode( $body ) );
		}
		if ( ! empty( $query ) ) {
			$request->set_query_params( $query );
		}
		return $this->rest_server->dispatch( $request );
	}
}
