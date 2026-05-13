<?php
/**
 * ODD × WP Desktop Mode — Copilot AI (server-side tools).
 *
 * Desktop Mode exposes `desktop_mode_register_ai_tool()` for PHP-dispatched
 * tools during `/ai/search` agent loops. Slash commands registered in JS remain
 * the primary client-side hooks; this path is intentionally small — a factual
 * read of installed catalog content so Copilot stops hallucinating inventories.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Return installed ODD slugs + active wallpaper for the given user — AI tool payload.
 *
 * @param array $args Unused.
 * @param int   $user_id WordPress user ID.
 * @return array<string,mixed>
 */
function oddout_dm_ai_installed_bundles_summary( array $args, int $user_id ) {
	unset( $args );
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}

	$scene_slugs = function_exists( 'oddout_wallpaper_scene_slugs' ) ? oddout_wallpaper_scene_slugs() : array();

	$icon_slugs = array();
	if ( function_exists( 'oddout_icons_get_sets' ) ) {
		foreach ( oddout_icons_get_sets() as $set ) {
			if ( empty( $set['slug'] ) ) {
				continue;
			}
			$icon_slugs[] = (string) $set['slug'];
		}
	}

	$widget_slugs = array();
	if ( function_exists( 'oddout_widgets_index_load' ) ) {
		foreach ( array_keys( oddout_widgets_index_load() ) as $wslug ) {
			$widget_slugs[] = (string) $wslug;
		}
		sort( $widget_slugs );
	}

	$app_slugs = array();
	if ( function_exists( 'oddout_apps_list' ) ) {
		foreach ( oddout_apps_list() as $row ) {
			if ( empty( $row['slug'] ) ) {
				continue;
			}
			$app_slugs[] = (string) $row['slug'];
		}
	}

	$cursors_slugs = array();
	if ( function_exists( 'oddout_cursors_get_sets' ) ) {
		foreach ( oddout_cursors_get_sets() as $row ) {
			if ( empty( $row['slug'] ) ) {
				continue;
			}
			$cursors_slugs[] = (string) $row['slug'];
		}
		sort( $cursors_slugs );
	}

	$active_scene = '';
	if ( function_exists( 'oddout_wallpaper_get_user_scene' ) ) {
		$active_scene = (string) oddout_wallpaper_get_user_scene( $user_id );
	}

	return array(
		'active_wallpaper_scene'     => $active_scene,
		'installed_scene_slugs'      => array_values( array_filter( array_map( 'strval', $scene_slugs ) ) ),
		'installed_icon_set_slugs'   => $icon_slugs,
		'installed_widget_slugs'     => $widget_slugs,
		'installed_app_slugs'        => $app_slugs,
		'installed_cursor_set_slugs' => $cursors_slugs,
	);
}

add_action(
	'init',
	static function () {
		if ( ! function_exists( 'oddout_desktop_mode_supports' ) || ! oddout_desktop_mode_supports( 'ai' ) ) {
			return;
		}
		if ( ! function_exists( 'desktop_mode_register_ai_tool' ) ) {
			return;
		}
		desktop_mode_register_ai_tool(
			array(
				'name'             => 'oddout_installed_bundles_summary',
				'description'      => __( 'Lists ODD-installed content: active wallpaper scene slug plus installed scene, icon set, widget, app, and cursor-set slugs for the requesting user.', 'odd-outlandish-desktop-decorator' ),
				'parameters'       => array(
					'type'       => 'object',
					'properties' => array(),
				),
				'handler'          => 'oddout_dm_ai_installed_bundles_summary',
				'capability'       => 'read',
				'progress_message' => __( 'Reading ODD catalog state…', 'odd-outlandish-desktop-decorator' ),
			)
		);
	},
	20
);
