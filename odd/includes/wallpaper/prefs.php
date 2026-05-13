<?php
/**
 * ODD wallpaper — per-user prefs reader/writer helpers.
 *
 * Reads/writes these user_meta keys:
 *   - oddout_wallpaper         current scene slug
 *   - oddout_favorites         slug[]
 *   - oddout_recents           slug[] (most-recent first, capped)
 *   - oddout_shuffle           { enabled: bool, minutes: int 1..240 }
 *   - oddout_audio_reactive    bool
 *   - oddout_screensaver       { enabled: bool, minutes: int 1..120, scene: string }
 *                             scene = '' | 'current' | 'random' | <slug>
 */

defined( 'ABSPATH' ) || exit;

function oddout_wallpaper_get_user_scene( $uid ) {
	$scene = get_user_meta( $uid, 'oddout_wallpaper', true );
	$slugs = oddout_wallpaper_scene_slugs();
	if ( $scene && in_array( $scene, $slugs, true ) ) {
		return $scene;
	}
	return oddout_wallpaper_default_scene();
}

function oddout_wallpaper_get_user_slug_list( $uid, $key ) {
	$value = get_user_meta( $uid, $key, true );
	if ( ! is_array( $value ) ) {
		return array();
	}
	$valid = oddout_wallpaper_scene_slugs();
	$out   = array();
	foreach ( $value as $item ) {
		if ( is_string( $item ) && in_array( $item, $valid, true ) ) {
			$out[] = $item;
		}
	}
	return $out;
}

/**
 * Normalize an incoming shuffle preference into { enabled, minutes }.
 * Accepts booleans (legacy) or an object from the picker toolbar.
 * Minutes are clamped to a sane 1..240 range.
 */
function oddout_wallpaper_sanitize_shuffle( $raw ) {
	if ( is_bool( $raw ) ) {
		return array(
			'enabled' => $raw,
			'minutes' => 15,
		);
	}
	if ( ! is_array( $raw ) ) {
		return array(
			'enabled' => false,
			'minutes' => 15,
		);
	}
	$enabled = ! empty( $raw['enabled'] );
	$minutes = isset( $raw['minutes'] ) ? (int) $raw['minutes'] : 15;
	if ( $minutes < 1 ) {
		$minutes = 1;
	}
	if ( $minutes > 240 ) {
		$minutes = 240;
	}
	return array(
		'enabled' => $enabled,
		'minutes' => $minutes,
	);
}

function oddout_wallpaper_get_user_shuffle( $uid ) {
	$raw = get_user_meta( $uid, 'oddout_shuffle', true );
	return oddout_wallpaper_sanitize_shuffle( $raw );
}

function oddout_wallpaper_get_user_audio_reactive( $uid ) {
	return (bool) get_user_meta( $uid, 'oddout_audio_reactive', true );
}

/**
 * Normalize an incoming screensaver preference.
 *
 * - `enabled` is a plain bool.
 * - `minutes` clamps to 1..120 (we intentionally cap lower than shuffle;
 *   screensavers that hide the whole shell for 240 minutes are griefy).
 * - `scene` accepts:
 *     '' or 'current' → play whatever the active scene is
 *     'random'        → pick a new scene every time the screensaver fires
 *     <slug>          → validated against oddout_wallpaper_scene_slugs()
 *   Unknown slugs coerce back to 'current' rather than erroring.
 */
function oddout_wallpaper_sanitize_screensaver( $raw ) {
	$default = array(
		'enabled' => false,
		'minutes' => 5,
		'scene'   => 'current',
	);

	if ( ! is_array( $raw ) ) {
		return $default;
	}

	$enabled = ! empty( $raw['enabled'] );
	$minutes = isset( $raw['minutes'] ) ? (int) $raw['minutes'] : 5;
	if ( $minutes < 1 ) {
		$minutes = 1;
	}
	if ( $minutes > 120 ) {
		$minutes = 120;
	}

	$scene_raw = isset( $raw['scene'] ) ? $raw['scene'] : 'current';
	$scene     = is_string( $scene_raw ) ? sanitize_key( $scene_raw ) : 'current';
	if ( 'current' === $scene || 'random' === $scene || '' === $scene ) {
		$scene = '' === $scene ? 'current' : $scene;
	} else {
		$slugs = oddout_wallpaper_scene_slugs();
		if ( ! in_array( $scene, $slugs, true ) ) {
			$scene = 'current';
		}
	}

	return array(
		'enabled' => $enabled,
		'minutes' => $minutes,
		'scene'   => $scene,
	);
}

function oddout_wallpaper_get_user_screensaver( $uid ) {
	$raw = get_user_meta( $uid, 'oddout_screensaver', true );
	return oddout_wallpaper_sanitize_screensaver( $raw );
}
