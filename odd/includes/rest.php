<?php
/**
 * ODD — unified REST endpoint.
 *
 * Registers `odd/v1/prefs` with:
 *   - GET  returns the current user's wallpaper + icon/cursor prefs plus the
 *          full catalog of installed scenes, icon sets, and cursor sets so the panel
 *          can hydrate without re-fetching localized data.
 *   - POST accepts any subset of wallpaper/favorites/recents/shuffle/
 *          audioReactive/shopTaskbar/adminBarHidden/iconSet/cursorSet and writes each
 *          to its own user_meta key. Partial updates are fine.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		$slug_arg      = array(
			'type'              => 'string',
			'required'          => false,
			'sanitize_callback' => 'sanitize_key',
			'validate_callback' => static function ( $value ) {
				return null === $value || is_string( $value );
			},
		);
		$bool_arg      = array(
			'type'              => 'boolean',
			'required'          => false,
			'sanitize_callback' => 'rest_sanitize_boolean',
		);
		$slug_list_arg = array(
			'type'              => 'array',
			'required'          => false,
			'validate_callback' => static function ( $value ) {
				return is_array( $value ) && count( $value ) <= 500;
			},
		);
		$object_arg    = array(
			'type'              => 'object',
			'required'          => false,
			'validate_callback' => static function ( $value ) {
				return is_array( $value );
			},
		);
		register_rest_route(
			'odd/v1',
			'/prefs',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => function () {
						return current_user_can( 'read' );
					},
					'callback'            => 'oddout_rest_prefs_get',
				),
				array(
					'methods'             => 'POST',
					'permission_callback' => function () {
						return current_user_can( 'read' );
					},
					'callback'            => 'oddout_rest_prefs_post',
					'args'                => array(
						'wallpaper'      => $slug_arg,
						'scene'          => $slug_arg,
						'favorites'      => $slug_list_arg,
						'recents'        => $slug_list_arg,
						'shuffle'        => $object_arg,
						'screensaver'    => $object_arg,
						'audioReactive'  => $bool_arg,
						'shopTaskbar'    => $bool_arg,
						'shopDock'       => $bool_arg,
						'adminBarHidden' => $bool_arg,
						'initiated'      => $bool_arg,
						'mascotQuiet'    => $bool_arg,
						'winkUnlocked'   => $bool_arg,
						'appsPinned'     => $slug_list_arg,
						'iconSet'        => $slug_arg,
						'cursorSet'      => $slug_arg,
					),
				),
			)
		);
		register_rest_route(
			'odd/v1',
			'/site-summary',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'read' );
				},
				'callback'            => 'oddout_rest_site_summary_get',
			)
		);
	}
);

function oddout_rest_site_summary_get() {
	return rest_ensure_response(
		array(
			'generatedAt' => time(),
			'draft'       => oddout_rest_site_summary_draft(),
			'comments'    => oddout_rest_site_summary_comments(),
			'updates'     => oddout_rest_site_summary_plugin_updates(),
		)
	);
}

function oddout_rest_site_summary_draft() {
	$out = array(
		'available' => current_user_can( 'edit_posts' ),
		'count'     => 0,
		'id'        => 0,
		'title'     => '',
		'modified'  => '',
		'human'     => '',
		'editUrl'   => '',
	);
	if ( ! $out['available'] ) {
		return $out;
	}

	$args = array(
		'post_type'           => 'post',
		'post_status'         => 'draft',
		'posts_per_page'      => 1,
		'orderby'             => 'modified',
		'order'               => 'DESC',
		'ignore_sticky_posts' => true,
		'no_found_rows'       => false,
	);
	if ( ! current_user_can( 'edit_others_posts' ) ) {
		$args['author'] = get_current_user_id();
	}

	$query        = new WP_Query( $args );
	$out['count'] = isset( $query->found_posts ) ? (int) $query->found_posts : 0;
	$post         = ! empty( $query->posts ) && $query->posts[0] instanceof WP_Post ? $query->posts[0] : null;
	if ( $post && current_user_can( 'edit_post', $post->ID ) ) {
		$title           = get_the_title( $post );
		$modified        = get_post_modified_time( 'U', true, $post );
		$out['id']       = (int) $post->ID;
		$out['title']    = '' !== $title ? wp_strip_all_tags( $title ) : __( 'Untitled draft', 'odd-outlandish-desktop-decorator' );
		$out['modified'] = get_post_modified_time( DATE_RFC3339, true, $post );
		$out['human']    = $modified
			? sprintf(
				/* translators: %s: human-readable time difference. */
				__( '%s ago', 'odd-outlandish-desktop-decorator' ),
				human_time_diff( (int) $modified, time() )
			)
			: '';
		$edit_url       = get_edit_post_link( $post->ID, 'raw' );
		$out['editUrl'] = is_string( $edit_url ) ? $edit_url : '';
	}
	wp_reset_postdata();

	return $out;
}

function oddout_rest_site_summary_comments() {
	$out = array(
		'available'   => current_user_can( 'moderate_comments' ),
		'pending'     => 0,
		'moderateUrl' => '',
	);
	if ( ! $out['available'] ) {
		return $out;
	}
	$count              = wp_count_comments();
	$out['pending']     = isset( $count->moderated ) ? (int) $count->moderated : 0;
	$out['moderateUrl'] = admin_url( 'edit-comments.php?comment_status=moderated' );
	return $out;
}

function oddout_rest_site_summary_plugin_updates() {
	$out = array(
		'available'   => current_user_can( 'update_plugins' ),
		'plugins'     => 0,
		'lastChecked' => 0,
		'human'       => '',
		'updatesUrl'  => '',
	);
	if ( ! $out['available'] ) {
		return $out;
	}

	$updates            = get_site_transient( 'update_plugins' );
	$response           = is_object( $updates ) && isset( $updates->response ) && is_array( $updates->response ) ? $updates->response : array();
	$last_checked       = is_object( $updates ) && isset( $updates->last_checked ) ? (int) $updates->last_checked : 0;
	$out['plugins']     = count( $response );
	$out['lastChecked'] = $last_checked;
	$out['human']       = $last_checked
		? sprintf(
			/* translators: %s: human-readable time difference. */
			__( 'checked %s ago', 'odd-outlandish-desktop-decorator' ),
			human_time_diff( $last_checked, time() )
		)
		: __( 'not checked yet', 'odd-outlandish-desktop-decorator' );
	$out['updatesUrl'] = self_admin_url( 'plugins.php?plugin_status=upgrade' );

	return $out;
}

function oddout_rest_prefs_get() {
	$uid = get_current_user_id();

	$sets = array();
	foreach ( oddout_icons_get_sets() as $set ) {
		$sets[] = array(
			'slug'        => $set['slug'],
			'label'       => $set['label'],
			'category'    => $set['category'],
			'accent'      => $set['accent'],
			'description' => $set['description'],
			'preview'     => $set['preview'],
			'icons'       => $set['icons'],
		);
	}

	$cursor_sets = array();
	foreach ( oddout_cursors_get_sets() as $set ) {
		$cursor_sets[] = array(
			'slug'        => $set['slug'],
			'label'       => $set['label'],
			'category'    => $set['category'],
			'accent'      => $set['accent'],
			'description' => $set['description'],
			'preview'     => $set['preview'],
			'effects'     => isset( $set['effects'] ) && is_array( $set['effects'] ) ? $set['effects'] : array(),
			'cursors'     => isset( $set['cursors'] ) && is_array( $set['cursors'] ) ? $set['cursors'] : array(),
		);
	}

	$apps_enabled = defined( 'ODDOUT_APPS_ENABLED' ) && ODDOUT_APPS_ENABLED;
	$apps_list    = ( $apps_enabled && function_exists( 'oddout_apps_list' ) ) ? oddout_apps_list() : array();

	return rest_ensure_response(
		array(
			'wallpaper'        => oddout_wallpaper_get_user_scene( $uid ),
			'favorites'        => oddout_wallpaper_get_user_slug_list( $uid, 'oddout_favorites' ),
			'recents'          => oddout_wallpaper_get_user_slug_list( $uid, 'oddout_recents' ),
			'shuffle'          => oddout_wallpaper_get_user_shuffle( $uid ),
			'screensaver'      => oddout_wallpaper_get_user_screensaver( $uid ),
			'audioReactive'    => oddout_wallpaper_get_user_audio_reactive( $uid ),
			'shopTaskbar'      => function_exists( 'oddout_shop_taskbar_enabled' ) ? oddout_shop_taskbar_enabled( $uid ) : false,
			'adminBarHidden'   => function_exists( 'oddout_admin_bar_hidden' ) ? oddout_admin_bar_hidden( $uid ) : false,
			'iconSet'          => oddout_icons_get_active_slug( $uid ),
			'cursorSet'        => oddout_cursors_get_active_slug( $uid ),
			'cursorStylesheet' => oddout_cursors_active_stylesheet_url(),
			'initiated'        => (bool) get_user_meta( $uid, 'oddout_initiated', true ),
			'mascotQuiet'      => (bool) get_user_meta( $uid, 'oddout_mascot_quiet', true ),
			'winkUnlocked'     => (bool) get_user_meta( $uid, 'oddout_wink_unlocked', true ),
			'scenes'           => oddout_wallpaper_scenes(),
			'sets'             => $sets,
			'cursorSets'       => $cursor_sets,
			'appsEnabled'      => $apps_enabled,
			'apps'             => $apps_list,
			'userApps'         => array(
				'installed' => wp_list_pluck( $apps_list, 'slug' ),
				'pinned'    => (array) get_user_meta( $uid, 'oddout_apps_pinned', true ),
			),
		)
	);
}

function oddout_rest_prefs_post( WP_REST_Request $request ) {
	$uid    = get_current_user_id();
	$params = $request->get_json_params();
	if ( ! is_array( $params ) ) {
		$params = $request->get_body_params();
	}
	$params = is_array( $params ) ? $params : array();

	$slugs = oddout_wallpaper_scene_slugs();
	$out   = array();

	if ( array_key_exists( 'wallpaper', $params ) || array_key_exists( 'scene', $params ) ) {
		$raw   = array_key_exists( 'wallpaper', $params ) ? $params['wallpaper'] : $params['scene'];
		$scene = is_string( $raw ) ? sanitize_key( $raw ) : '';
		if ( $scene === '' || in_array( $scene, $slugs, true ) ) {
			update_user_meta( $uid, 'oddout_wallpaper', $scene );
			$out['wallpaper'] = $scene;
			if ( function_exists( 'oddout_wallpaper_ensure_host_engine_selected' ) ) {
				oddout_wallpaper_ensure_host_engine_selected( $uid );
			}
		} else {
			return new WP_Error(
				'oddout_invalid_wallpaper',
				__( 'Unknown wallpaper slug.', 'odd-outlandish-desktop-decorator' ),
				array( 'status' => 400 )
			);
		}
	}

	if ( array_key_exists( 'favorites', $params ) ) {
		$favs = oddout_wallpaper_sanitize_slug_list( $params['favorites'], 50 );
		update_user_meta( $uid, 'oddout_favorites', $favs );
		$out['favorites'] = $favs;
	}

	if ( array_key_exists( 'recents', $params ) ) {
		$recs = oddout_wallpaper_sanitize_slug_list( $params['recents'], 12 );
		update_user_meta( $uid, 'oddout_recents', $recs );
		$out['recents'] = $recs;
	}

	if ( array_key_exists( 'shuffle', $params ) ) {
		$sh = oddout_wallpaper_sanitize_shuffle( $params['shuffle'] );
		update_user_meta( $uid, 'oddout_shuffle', $sh );
		$out['shuffle'] = $sh;
	}

	if ( array_key_exists( 'screensaver', $params ) ) {
		$ss = oddout_wallpaper_sanitize_screensaver( $params['screensaver'] );
		update_user_meta( $uid, 'oddout_screensaver', $ss );
		$out['screensaver'] = $ss;
	}

	if ( array_key_exists( 'audioReactive', $params ) ) {
		$on = ! empty( $params['audioReactive'] );
		update_user_meta( $uid, 'oddout_audio_reactive', $on ? 1 : 0 );
		$out['audioReactive'] = $on;
	}

	if ( array_key_exists( 'shopTaskbar', $params ) || array_key_exists( 'shopDock', $params ) ) {
		$on = array_key_exists( 'shopTaskbar', $params ) ? ! empty( $params['shopTaskbar'] ) : ! empty( $params['shopDock'] );
		if ( function_exists( 'oddout_shop_set_taskbar_enabled' ) ) {
			$out['shopTaskbar'] = oddout_shop_set_taskbar_enabled( $uid, $on );
		} else {
			update_user_meta( $uid, 'oddout_shop_taskbar', $on ? 1 : 0 );
			$out['shopTaskbar'] = $on;
		}
	}

	if ( array_key_exists( 'adminBarHidden', $params ) ) {
		$hidden = ! empty( $params['adminBarHidden'] );
		if ( function_exists( 'oddout_set_admin_bar_hidden' ) ) {
			$out['adminBarHidden'] = oddout_set_admin_bar_hidden( $uid, $hidden );
		} else {
			update_user_meta( $uid, 'oddout_admin_bar_hidden', $hidden ? 1 : 0 );
			$out['adminBarHidden'] = $hidden;
		}
	}

	// Iris personality slice (Cut 3). All three are booleans, stored
	// as 0/1 via the existing audioReactive pattern. Cast once here
	// so anything downstream (JS store, REST GET) sees a strict bool.
	foreach ( array(
		'initiated'    => 'oddout_initiated',
		'mascotQuiet'  => 'oddout_mascot_quiet',
		'winkUnlocked' => 'oddout_wink_unlocked',
	) as $key => $meta ) {
		if ( array_key_exists( $key, $params ) ) {
			$on = ! empty( $params[ $key ] );
			update_user_meta( $uid, $meta, $on ? 1 : 0 );
			$out[ $key ] = $on;
		}
	}

	if ( array_key_exists( 'appsPinned', $params ) ) {
		$pinned_raw = is_array( $params['appsPinned'] ) ? $params['appsPinned'] : array();
		$pinned     = array();
		foreach ( $pinned_raw as $slug ) {
			if ( is_string( $slug ) ) {
				$clean = sanitize_key( $slug );
				if ( '' !== $clean && ! in_array( $clean, $pinned, true ) ) {
					$pinned[] = $clean;
				}
			}
			if ( count( $pinned ) >= 50 ) {
				break;
			}
		}
		update_user_meta( $uid, 'oddout_apps_pinned', $pinned );
		$out['appsPinned'] = $pinned;
	}

	if ( array_key_exists( 'iconSet', $params ) ) {
		$raw = is_string( $params['iconSet'] ) ? $params['iconSet'] : '';
		$ok  = oddout_icons_set_active_slug( $raw );
		if ( ! $ok ) {
			return new WP_Error(
				'oddout_invalid_icon_set',
				__( 'Unknown icon set.', 'odd-outlandish-desktop-decorator' ),
				array( 'status' => 400 )
			);
		}
		$out['iconSet'] = oddout_icons_get_active_slug( $uid );
	}

	if ( array_key_exists( 'cursorSet', $params ) ) {
		$raw = is_string( $params['cursorSet'] ) ? $params['cursorSet'] : '';
		$ok  = oddout_cursors_set_active_slug( $raw, $uid );
		if ( ! $ok ) {
			return new WP_Error(
				'oddout_invalid_cursor_set',
				__( 'Unknown cursor set.', 'odd-outlandish-desktop-decorator' ),
				array( 'status' => 400 )
			);
		}
		$out['cursorSet']        = oddout_cursors_get_active_slug( $uid );
		$out['cursorStylesheet'] = oddout_cursors_active_stylesheet_url();
	}

	return rest_ensure_response( $out );
}
