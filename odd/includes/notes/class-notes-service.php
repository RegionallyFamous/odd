<?php
/**
 * WordPress-backed note storage for the ODD Notes.
 *
 * @package ODDNotes
 */

defined( 'ABSPATH' ) || exit;

/**
 * Own-note library built on OpenStation's existing `wpd_note` content type.
 */
class ODDOUT_Notes_Service {

	const POST_TYPE     = 'wpd_note';
	const META_TAGS     = '_oddout_notes_tags';
	const META_FAVORITE = '_oddout_notes_favorite';
	const META_ARCHIVED = '_oddout_notes_archived';
	const META_VERSION  = '_oddout_notes_version';

	/**
	 * Wire WordPress hooks.
	 */
	public function boot() {
		add_action( 'init', array( $this, 'register_supports_and_meta' ), 30 );
	}

	/**
	 * Add revisions and app metadata after OpenStation registers the post type.
	 */
	public function register_supports_and_meta() {
		if ( ! post_type_exists( self::POST_TYPE ) ) {
			return;
		}

		add_post_type_support( self::POST_TYPE, 'revisions' );

		register_post_meta(
			self::POST_TYPE,
			self::META_TAGS,
			array(
				'type'              => 'array',
				'single'            => true,
				'default'           => array(),
				'sanitize_callback' => array( $this, 'sanitize_tags' ),
			)
		);
		register_post_meta(
			self::POST_TYPE,
			self::META_FAVORITE,
			array(
				'type'              => 'boolean',
				'single'            => true,
				'default'           => false,
				'sanitize_callback' => 'rest_sanitize_boolean',
			)
		);
		register_post_meta(
			self::POST_TYPE,
			self::META_ARCHIVED,
			array(
				'type'              => 'boolean',
				'single'            => true,
				'default'           => false,
				'sanitize_callback' => 'rest_sanitize_boolean',
			)
		);
		register_post_meta(
			self::POST_TYPE,
			self::META_VERSION,
			array(
				'type'              => 'integer',
				'single'            => true,
				'default'           => 1,
				'sanitize_callback' => 'absint',
			)
		);
	}

	/**
	 * Keep tags short, distinct, and predictable on the wire.
	 *
	 * @param mixed $tags Raw tags.
	 * @return string[]
	 */
	public function sanitize_tags( $tags ) {
		if ( ! is_array( $tags ) ) {
			return array();
		}

		$clean = array();
		foreach ( $tags as $tag ) {
			if ( ! is_scalar( $tag ) ) {
				continue;
			}
			$tag = trim( sanitize_text_field( (string) $tag ) );
			if ( '' === $tag ) {
				continue;
			}
			$tag = mb_substr( $tag, 0, 28 );
			$key = mb_strtolower( $tag );
			if ( ! isset( $clean[ $key ] ) ) {
				$clean[ $key ] = $tag;
			}
			if ( count( $clean ) >= 12 ) {
				break;
			}
		}

		return array_values( $clean );
	}

	/**
	 * Return notes the current viewer is allowed to see in the app.
	 *
	 * @param int $user_id Viewer id.
	 * @return array
	 */
	public function get_library( $user_id ) {
		$own = new WP_Query(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => array( 'draft', 'private', 'publish' ),
				'author'         => (int) $user_id,
				'posts_per_page' => 500,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);

		$shared = new WP_Query(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'publish',
				'author__not_in' => array( (int) $user_id ),
				'posts_per_page' => 200,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);

		$notes = array();
		foreach ( array_merge( (array) $own->posts, (array) $shared->posts ) as $post ) {
			$notes[] = $this->prepare_note( $post, $user_id );
		}
		wp_reset_postdata();

		return array(
			'notes' => $notes,
			'tags'  => $this->collect_tags( $notes ),
		);
	}

	/**
	 * Create a library-only note. Pinning it changes the status later.
	 *
	 * @param int   $user_id Author id.
	 * @param array $input   Request data.
	 * @return array|WP_Error
	 */
	public function create_note( $user_id, array $input ) {
		$title = $this->sanitize_title( isset( $input['title'] ) ? $input['title'] : '' );
		$body  = $this->sanitize_body( isset( $input['body'] ) ? $input['body'] : '' );
		$text  = $this->compose_text( $title, $body );

		$on_desktop = ! empty( $input['onDesktop'] );
		$is_public  = $on_desktop && ! empty( $input['public'] );
		$status     = $on_desktop ? ( $is_public ? 'publish' : 'private' ) : 'draft';

		$post_id = wp_insert_post(
			array(
				'post_type'    => self::POST_TYPE,
				'post_status'  => $status,
				'post_author'  => (int) $user_id,
				'post_title'   => $title,
				'post_content' => $text,
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			$post_id->add_data( array( 'status' => 500 ) );
			return $post_id;
		}

		$this->update_app_meta( $post_id, $input );
		update_post_meta( $post_id, self::META_ARCHIVED, false );
		update_post_meta( $post_id, self::META_VERSION, 1 );
		$this->ensure_desktop_meta( $post_id, $text, $input );

		return $this->prepare_note( get_post( $post_id ), $user_id );
	}

	/**
	 * Update an owned note with optimistic concurrency.
	 *
	 * @param int   $user_id Viewer id.
	 * @param int   $note_id Note id.
	 * @param array $input   Request data.
	 * @return array|WP_Error
	 */
	public function update_note( $user_id, $note_id, array $input ) {
		$post = $this->get_note( $note_id, true );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$owner = $this->require_owner( $post, $user_id );
		if ( is_wp_error( $owner ) ) {
			return $owner;
		}

		$current_version     = max( 1, (int) get_post_meta( $post->ID, self::META_VERSION, true ) );
		$current_modified_ms = (int) get_post_modified_time( 'U', true, $post ) * 1000;
		$version_conflict    = isset( $input['version'] ) && (int) $input['version'] !== $current_version;
		$modified_conflict   = isset( $input['updatedAtMs'] ) && (int) $input['updatedAtMs'] !== $current_modified_ms;
		if ( $version_conflict || $modified_conflict ) {
			$current = $this->prepare_note( $post, $user_id );
			if ( $this->input_matches_note( $input, $current ) ) {
				return $current;
			}
			return new WP_Error(
				'oddout_notes_conflict',
				__( 'This note changed in another window.', 'odd-outlandish-desktop-decorator' ),
				array(
					'status'  => 409,
					'current' => $current,
				)
			);
		}

		list( $current_title, $current_body ) = $this->split_text( (string) get_post_field( 'post_content', $post, 'raw' ) );
		$title                                = array_key_exists( 'title', $input ) ? $this->sanitize_title( $input['title'] ) : $current_title;
		$body                                 = array_key_exists( 'body', $input ) ? $this->sanitize_body( $input['body'] ) : $current_body;

		$archived   = array_key_exists( 'archived', $input ) ? rest_sanitize_boolean( $input['archived'] ) : (bool) get_post_meta( $post->ID, self::META_ARCHIVED, true );
		$on_desktop = array_key_exists( 'onDesktop', $input ) ? rest_sanitize_boolean( $input['onDesktop'] ) : in_array( $post->post_status, array( 'private', 'publish' ), true );
		$is_public  = array_key_exists( 'public', $input ) ? rest_sanitize_boolean( $input['public'] ) : 'publish' === $post->post_status;

		if ( $archived ) {
			$on_desktop = false;
			$is_public  = false;
		}
		$status = $on_desktop ? ( $is_public ? 'publish' : 'private' ) : 'draft';

		$result = wp_update_post(
			array(
				'ID'           => $post->ID,
				'post_title'   => $title,
				'post_content' => $this->compose_text( $title, $body ),
				'post_status'  => $status,
			),
			true
		);
		if ( is_wp_error( $result ) ) {
			$result->add_data( array( 'status' => 500 ) );
			return $result;
		}

		$this->update_app_meta( $post->ID, $input );
		update_post_meta( $post->ID, self::META_ARCHIVED, $archived );
		update_post_meta( $post->ID, self::META_VERSION, $current_version + 1 );

		return $this->prepare_note( get_post( $post->ID ), $user_id );
	}

	/**
	 * Move an owned note to WordPress Trash.
	 *
	 * @param int $user_id Viewer id.
	 * @param int $note_id Note id.
	 * @return array|WP_Error
	 */
	public function delete_note( $user_id, $note_id ) {
		$post = $this->get_note( $note_id, true );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$owner = $this->require_owner( $post, $user_id );
		if ( is_wp_error( $owner ) ) {
			return $owner;
		}
		if ( ! wp_trash_post( $post->ID ) ) {
			return new WP_Error( 'oddout_notes_trash_failed', __( 'The note could not be moved to Trash.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 500 ) );
		}
		return array(
			'deleted' => true,
			'id'      => (int) $post->ID,
		);
	}

	/**
	 * Return revision history for an owned note.
	 *
	 * @param int $user_id Viewer id.
	 * @param int $note_id Note id.
	 * @return array|WP_Error
	 */
	public function get_revisions( $user_id, $note_id ) {
		$post = $this->get_note( $note_id, true );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$owner = $this->require_owner( $post, $user_id );
		if ( is_wp_error( $owner ) ) {
			return $owner;
		}

		$revisions = array();
		foreach ( wp_get_post_revisions( $post->ID, array( 'posts_per_page' => 30 ) ) as $revision ) {
			list( $title, $body ) = $this->split_text( (string) $revision->post_content );
			$revisions[]          = array(
				'id'        => (int) $revision->ID,
				'title'     => $title,
				'body'      => $body,
				'createdAt' => $this->post_date_rfc3339( $revision, 'date' ),
			);
		}

		return array( 'revisions' => $revisions );
	}

	/**
	 * Restore a revision after validating its parent and owner.
	 *
	 * @param int $user_id    Viewer id.
	 * @param int $note_id    Note id.
	 * @param int $revision_id Revision id.
	 * @return array|WP_Error
	 */
	public function restore_revision( $user_id, $note_id, $revision_id ) {
		$post = $this->get_note( $note_id, true );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$owner = $this->require_owner( $post, $user_id );
		if ( is_wp_error( $owner ) ) {
			return $owner;
		}

		$revision = wp_get_post_revision( $revision_id );
		if ( ! $revision instanceof WP_Post || (int) $revision->post_parent !== (int) $post->ID ) {
			return new WP_Error( 'oddout_notes_revision_not_found', __( 'Revision not found.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
		}
		if ( ! wp_restore_post_revision( $revision->ID ) ) {
			return new WP_Error( 'oddout_notes_restore_failed', __( 'The revision could not be restored.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 500 ) );
		}

		$current_version = max( 1, (int) get_post_meta( $post->ID, self::META_VERSION, true ) );
		update_post_meta( $post->ID, self::META_VERSION, $current_version + 1 );

		return $this->prepare_note( get_post( $post->ID ), $user_id );
	}

	/**
	 * Fetch a live library note.
	 *
	 * @param int  $note_id    Note id.
	 * @param bool $allow_draft Whether draft library notes are allowed.
	 * @return WP_Post|WP_Error
	 */
	private function get_note( $note_id, $allow_draft = false ) {
		$post     = get_post( (int) $note_id );
		$statuses = $allow_draft ? array( 'draft', 'private', 'publish' ) : array( 'private', 'publish' );
		if ( ! $post instanceof WP_Post || self::POST_TYPE !== $post->post_type || ! in_array( $post->post_status, $statuses, true ) ) {
			return new WP_Error( 'oddout_notes_not_found', __( 'Note not found.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 404 ) );
		}
		return $post;
	}

	/**
	 * Require exact ownership, including for administrators.
	 *
	 * @param WP_Post $post    Note.
	 * @param int     $user_id Viewer id.
	 * @return true|WP_Error
	 */
	private function require_owner( $post, $user_id ) {
		if ( (int) $post->post_author !== (int) $user_id ) {
			return new WP_Error( 'oddout_notes_forbidden', __( 'Only the note owner can change it.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Prepare one note for the client.
	 *
	 * @param WP_Post $post      Note.
	 * @param int     $viewer_id Viewer id.
	 * @return array
	 */
	private function prepare_note( $post, $viewer_id ) {
		list( $title, $body ) = $this->split_text( (string) get_post_field( 'post_content', $post, 'raw' ) );
		$owner                = get_userdata( (int) $post->post_author );
		$tags                 = $this->sanitize_tags( get_post_meta( $post->ID, self::META_TAGS, true ) );

		return array(
			'id'          => (int) $post->ID,
			'title'       => $title,
			'body'        => $body,
			'excerpt'     => mb_substr( preg_replace( '/\s+/', ' ', trim( $body ) ), 0, 150 ),
			'color'       => $this->sanitize_color( get_post_meta( $post->ID, '_wpd_note_color', true ) ),
			'tags'        => $tags,
			'favorite'    => (bool) get_post_meta( $post->ID, self::META_FAVORITE, true ),
			'archived'    => (bool) get_post_meta( $post->ID, self::META_ARCHIVED, true ),
			'onDesktop'   => in_array( $post->post_status, array( 'private', 'publish' ), true ),
			'public'      => 'publish' === $post->post_status,
			'ownerId'     => (int) $post->post_author,
			'ownerName'   => $owner instanceof WP_User ? (string) $owner->display_name : '',
			'ownerAvatar' => (string) get_avatar_url( (int) $post->post_author, array( 'size' => 48 ) ),
			'canEdit'     => (int) $post->post_author === (int) $viewer_id,
			'createdAt'   => $this->post_date_rfc3339( $post, 'date' ),
			'updatedAt'   => $this->post_date_rfc3339( $post, 'modified' ),
			'updatedAtMs' => (int) get_post_modified_time( 'U', true, $post ) * 1000,
			'version'     => max( 1, (int) get_post_meta( $post->ID, self::META_VERSION, true ) ),
			'wordCount'   => str_word_count( wp_strip_all_tags( $body ) ),
		);
	}

	/**
	 * Whether a stale mutation is already represented by the current note.
	 *
	 * Idempotent retries can arrive after WordPress saved the first request but
	 * before the browser received its response. Returning the current note avoids
	 * presenting that harmless retry as an edit conflict.
	 *
	 * @param array $input Mutation input.
	 * @param array $note  Prepared current note.
	 * @return bool
	 */
	private function input_matches_note( array $input, array $note ) {
		$candidate = array(
			'title'     => (string) $note['title'],
			'body'      => (string) $note['body'],
			'color'     => (string) $note['color'],
			'tags'      => (array) $note['tags'],
			'favorite'  => (bool) $note['favorite'],
			'archived'  => (bool) $note['archived'],
			'onDesktop' => (bool) $note['onDesktop'],
			'public'    => (bool) $note['public'],
		);

		if ( array_key_exists( 'title', $input ) ) {
			$candidate['title'] = $this->sanitize_title( $input['title'] );
		}
		if ( array_key_exists( 'body', $input ) ) {
			$candidate['body'] = $this->sanitize_body( $input['body'] );
		}
		if ( array_key_exists( 'color', $input ) ) {
			$candidate['color'] = $this->sanitize_color( $input['color'] );
		}
		if ( array_key_exists( 'tags', $input ) ) {
			$candidate['tags'] = $this->sanitize_tags( $input['tags'] );
		}
		foreach ( array( 'favorite', 'archived', 'onDesktop', 'public' ) as $field ) {
			if ( array_key_exists( $field, $input ) ) {
				$candidate[ $field ] = rest_sanitize_boolean( $input[ $field ] );
			}
		}
		if ( $candidate['archived'] ) {
			$candidate['onDesktop'] = false;
			$candidate['public']    = false;
		}

		foreach ( $candidate as $field => $value ) {
			if ( $value !== $note[ $field ] ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Update fields stored as post meta.
	 *
	 * @param int   $post_id Note id.
	 * @param array $input   Request data.
	 */
	private function update_app_meta( $post_id, array $input ) {
		if ( array_key_exists( 'tags', $input ) ) {
			update_post_meta( $post_id, self::META_TAGS, $this->sanitize_tags( $input['tags'] ) );
		}
		if ( array_key_exists( 'favorite', $input ) ) {
			update_post_meta( $post_id, self::META_FAVORITE, rest_sanitize_boolean( $input['favorite'] ) );
		}
		if ( array_key_exists( 'color', $input ) ) {
			update_post_meta( $post_id, '_wpd_note_color', $this->sanitize_color( $input['color'] ) );
		}
	}

	/**
	 * Fill the positioning values OpenStation's desktop note renderer expects.
	 *
	 * @param int    $post_id Note id.
	 * @param string $text    Full text.
	 * @param array  $input   Request data.
	 */
	private function ensure_desktop_meta( $post_id, $text, array $input ) {
		$index = (int) $post_id % 7;
		update_post_meta( $post_id, '_wpd_note_x', 0.08 + ( $index * 0.055 ) );
		update_post_meta( $post_id, '_wpd_note_y', 0.10 + ( ( $index % 3 ) * 0.08 ) );
		$z = function_exists( 'openstation_notes_next_z' ) ? openstation_notes_next_z() : (int) $post_id;
		update_post_meta( $post_id, '_wpd_note_z', $z );
		$seed = absint( crc32( $text ) ) % 2147483647;
		update_post_meta( $post_id, '_wpd_note_seed', $seed > 0 ? $seed : 1 );
		if ( ! array_key_exists( 'color', $input ) ) {
			update_post_meta( $post_id, '_wpd_note_color', 'butter' );
		}
	}

	/**
	 * Split the interoperable pinned-note text into title and body.
	 *
	 * @param string $text Stored note text.
	 * @return array{0:string,1:string}
	 */
	private function split_text( $text ) {
		$text  = str_replace( array( "\r\n", "\r" ), "\n", $text );
		$lines = explode( "\n", $text );
		while ( $lines && '' === trim( $lines[0] ) ) {
			array_shift( $lines );
		}
		$title = $lines ? trim( (string) array_shift( $lines ) ) : __( 'Untitled note', 'odd-outlandish-desktop-decorator' );
		while ( $lines && '' === trim( $lines[0] ) ) {
			array_shift( $lines );
		}
		return array( $this->sanitize_title( $title ), implode( "\n", $lines ) );
	}

	/**
	 * Compose text that remains readable in the existing sticky-note UI.
	 *
	 * @param string $title Title.
	 * @param string $body  Body.
	 * @return string
	 */
	private function compose_text( $title, $body ) {
		$title = $this->sanitize_title( $title );
		$body  = $this->sanitize_body( $body );
		return '' === trim( $body ) ? $title : $title . "\n\n" . $body;
	}

	/**
	 * Sanitize a title without allowing a blank storage title.
	 *
	 * @param mixed $title Raw title.
	 * @return string
	 */
	private function sanitize_title( $title ) {
		$title = mb_substr( trim( sanitize_text_field( is_scalar( $title ) ? (string) $title : '' ) ), 0, 120 );
		return '' !== $title ? $title : __( 'Untitled note', 'odd-outlandish-desktop-decorator' );
	}

	/**
	 * Sanitize plain-text note content.
	 *
	 * @param mixed $body Raw body.
	 * @return string
	 */
	private function sanitize_body( $body ) {
		return mb_substr( sanitize_textarea_field( is_scalar( $body ) ? (string) $body : '' ), 0, 100000 );
	}

	/**
	 * Reuse OpenStation's color whitelist when available.
	 *
	 * @param mixed $color Raw color.
	 * @return string
	 */
	private function sanitize_color( $color ) {
		if ( function_exists( 'openstation_notes_sanitize_color' ) ) {
			return openstation_notes_sanitize_color( $color );
		}
		$allowed = array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' );
		$color   = sanitize_key( is_scalar( $color ) ? (string) $color : '' );
		return in_array( $color, $allowed, true ) ? $color : 'butter';
	}

	/**
	 * Format a post date with an explicit timezone for JavaScript clients.
	 *
	 * Draft posts can retain WordPress's zero GMT creation date, so fall
	 * back to the site-local field in that one case. Both paths include an
	 * offset; a timezone-less MySQL string would parse as the browser's local
	 * time and make an otherwise fresh note appear hours into the future.
	 *
	 * @param WP_Post $post  Post or revision.
	 * @param string  $field `date` or `modified`.
	 * @return string
	 */
	private function post_date_rfc3339( $post, $field ) {
		$date = get_post_datetime( $post, $field, 'gmt' );
		if ( ! $date ) {
			$date = get_post_datetime( $post, $field, 'site' );
		}
		return $date ? $date->format( DATE_RFC3339 ) : '';
	}

	/**
	 * Produce a sorted tag index with counts.
	 *
	 * @param array $notes Prepared notes.
	 * @return array
	 */
	private function collect_tags( array $notes ) {
		$counts = array();
		foreach ( $notes as $note ) {
			if ( empty( $note['canEdit'] ) || ! empty( $note['archived'] ) ) {
				continue;
			}
			foreach ( $note['tags'] as $tag ) {
				$key = mb_strtolower( $tag );
				if ( ! isset( $counts[ $key ] ) ) {
					$counts[ $key ] = array(
						'label' => $tag,
						'count' => 0,
					);
				}
				++$counts[ $key ]['count'];
			}
		}
		uasort(
			$counts,
			static function ( $a, $b ) {
				return strcasecmp( $a['label'], $b['label'] );
			}
		);
		return array_values( $counts );
	}
}
