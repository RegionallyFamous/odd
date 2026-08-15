<?php
/**
 * REST API for the ODD Notes.
 *
 * @package ODDNotes
 */

defined( 'ABSPATH' ) || exit;

/**
 * Authenticated, per-user Notes app routes.
 */
class ODDOUT_Notes_REST_Controller {

	const REST_NAMESPACE = 'odd-notes/v1';

	/**
	 * Storage service.
	 *
	 * @var ODDOUT_Notes_Service
	 */
	private $service;

	/**
	 * Store the service.
	 *
	 * @param ODDOUT_Notes_Service $service Storage service.
	 */
	public function __construct( ODDOUT_Notes_Service $service ) {
		$this->service = $service;
	}

	/**
	 * Register the WordPress hook.
	 */
	public function boot() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register app routes.
	 */
	public function register_routes() {
		$permission = array( $this, 'check_permission' );

		register_rest_route(
			self::REST_NAMESPACE,
			'/notes',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'list_notes' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_note' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/notes/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_note' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_note' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/notes/(?P<id>\d+)/revisions',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'list_revisions' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/notes/(?P<id>\d+)/revisions/(?P<revision_id>\d+)/restore',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'restore_revision' ),
				'permission_callback' => $permission,
			)
		);
	}

	/**
	 * Require a logged-in OpenStation user with read access.
	 *
	 * @return true|WP_Error
	 */
	public function check_permission() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'oddout_notes_unauthenticated', __( 'You must be logged in.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'read' ) ) {
			return new WP_Error( 'oddout_notes_forbidden', __( 'You do not have permission to use ODD Notes.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 403 ) );
		}
		if ( ! function_exists( 'oddout_notes_enabled' ) || ! oddout_notes_enabled() ) {
			return new WP_Error( 'oddout_notes_not_installed', __( 'ODD Notes is not installed or enabled.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
		}
		if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled( get_current_user_id() ) ) {
			return new WP_Error( 'oddout_notes_disabled', __( 'OpenStation is not enabled for this user.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Return visible notes and the tag index.
	 *
	 * @return WP_REST_Response
	 */
	public function list_notes() {
		return rest_ensure_response( $this->service->get_library( get_current_user_id() ) );
	}

	/**
	 * Create a note.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_note( WP_REST_Request $request ) {
		$input = $this->json_input( $request );
		return rest_ensure_response( $this->service->create_note( get_current_user_id(), $input ) );
	}

	/**
	 * Update a note.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_note( WP_REST_Request $request ) {
		$input = $this->json_input( $request );
		return rest_ensure_response( $this->service->update_note( get_current_user_id(), (int) $request['id'], $input ) );
	}

	/**
	 * Soft-delete a note into WordPress Trash.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_note( WP_REST_Request $request ) {
		return rest_ensure_response( $this->service->delete_note( get_current_user_id(), (int) $request['id'] ) );
	}

	/**
	 * Return revision history.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function list_revisions( WP_REST_Request $request ) {
		return rest_ensure_response( $this->service->get_revisions( get_current_user_id(), (int) $request['id'] ) );
	}

	/**
	 * Restore a revision.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function restore_revision( WP_REST_Request $request ) {
		return rest_ensure_response(
			$this->service->restore_revision(
				get_current_user_id(),
				(int) $request['id'],
				(int) $request['revision_id']
			)
		);
	}

	/**
	 * Read a JSON object without trusting non-array inputs.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	private function json_input( WP_REST_Request $request ) {
		$input = $request->get_json_params();
		return is_array( $input ) ? $input : array();
	}
}
