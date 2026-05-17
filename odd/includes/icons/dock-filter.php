<?php
/**
 * ODD icons — native Desktop Mode icon feeds.
 *
 * Icon sets theme Desktop Mode desktop shortcuts through Desktop Mode's
 * own server-side data filters. ODD leaves the rail, dock, and Desktop Mode
 * system tiles on the host's default icons, while the ODD Shop launcher itself
 * follows the active set's `odd` key.
 *
 * Why slug-based: Desktop Mode's default desktop shortcut entries ship with
 * stable ids/window ids. Sets declare icons under those same friendly keys in
 * `manifest.json#icons`, so the mapping is a single hash lookup with no
 * per-set PHP.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Canonical Desktop Mode id/window/title → icon-set-key normalization.
 */
function oddout_icons_slug_to_key( $slug ) {
	$slug = (string) $slug;
	$map  = array(
		'odd'                        => 'odd',
		'desktop-mode-my-wordpress'  => 'my-wordpress',
		'my-wordpress'               => 'my-wordpress',
		'desktop-mode-content-graph' => 'content-graph',
		'content-graph'              => 'content-graph',
		'desktop-mode-recycle-bin'   => 'recycle-bin',
		'recycle-bin'                => 'recycle-bin',
		'fallback'                   => 'fallback',
	);
	if ( isset( $map[ $slug ] ) ) {
		return $map[ $slug ];
	}
	return '';
}

function oddout_icons_entry_to_key( $entry_id, $window = '', $title = '', $icon = '' ) {
	$candidates = array( $window, $entry_id, $icon );
	if ( '' !== (string) $title ) {
		$candidates[] = sanitize_title( (string) $title );
	}
	foreach ( $candidates as $candidate ) {
		$key = oddout_icons_slug_to_key( (string) $candidate );
		if ( '' !== $key ) {
			return $key;
		}
	}

	$key = oddout_icons_entry_recycle_key( $entry_id, $window, $title );
	if ( '' !== $key ) {
		return $key;
	}

	// Desktop Mode native window ids often mirror the logical key with a
	// `desktop-mode-` prefix even when no admin-menu slug is present.
	$id = sanitize_key( (string) $entry_id );
	if ( 0 === strpos( $id, 'desktop-mode-' ) ) {
		$key = oddout_icons_slug_to_key( substr( $id, 13 ) );
		if ( '' !== $key ) {
			return $key;
		}
	}

	return '';
}

function oddout_icons_entry_recycle_key( $entry_id, $window, $title = '' ) {
	$needles = array(
		sanitize_key( (string) $entry_id ),
		sanitize_key( (string) $window ),
		sanitize_key( (string) $title ),
	);
	foreach ( $needles as $needle ) {
		if (
			'desktop-mode-recycle-bin' === $needle
			|| 'recycle-bin' === $needle
			|| 'trash' === $needle
		) {
			return 'recycle-bin';
		}
	}
	return '';
}

function oddout_icons_active_set_for_native_surfaces() {
	$slug = oddout_icons_get_active_slug();
	if ( '' === $slug ) {
		return null;
	}
	$set = oddout_icons_get_set( $slug );
	return ( $set && ! empty( $set['icons'] ) && is_array( $set['icons'] ) ) ? $set : null;
}

function oddout_icons_icon_url_for_key( array $set, $key ) {
	$icons = isset( $set['icons'] ) && is_array( $set['icons'] ) ? $set['icons'] : array();
	$key   = sanitize_key( (string) $key );
	if ( '' !== $key && ! empty( $icons[ $key ] ) ) {
		return (string) $icons[ $key ];
	}
	if ( ! empty( $icons['fallback'] ) ) {
		return (string) $icons['fallback'];
	}
	return '';
}

function oddout_icons_filter_desktop_icons_registry( $registry ) {
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return $registry;
	}
	$set = oddout_icons_active_set_for_native_surfaces();
	if ( ! $set ) {
		return $registry;
	}

	foreach ( $registry as $id => $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		// Skip ODD app launchers — keep their app-specific art. The ODD Shop
		// launcher itself is an icon-set key so active sets can recolor it.
		$entry_id = isset( $entry['id'] ) ? (string) $entry['id'] : (string) $id;
		if ( 0 === strpos( $entry_id, 'odd-app-' ) ) {
			continue;
		}
		$window = isset( $entry['window'] ) ? (string) $entry['window'] : '';
		if ( 0 === strpos( $window, 'odd-app-' ) ) {
			continue;
		}
		$key = oddout_icons_entry_to_key(
			$entry_id,
			$window,
			isset( $entry['title'] ) ? (string) $entry['title'] : '',
			isset( $entry['icon'] ) ? (string) $entry['icon'] : ''
		);
		if ( '' === $key ) {
			// Desktop icons can also target URLs — try matching by the
			// icon id as a last-ditch key.
			$key = sanitize_key( $entry_id );
		}
		if ( 'odd' === $key && empty( $set['icons']['odd'] ) ) {
			continue;
		}
		$url = oddout_icons_icon_url_for_key( $set, $key );
		if ( '' !== $url ) {
			$registry[ $id ]['icon'] = $url;
		}
	}
	return $registry;
}
add_filter( 'desktop_mode_icons', 'oddout_icons_filter_desktop_icons_registry', 20 );

function oddout_icons_entry_is_odd_shop_window( array $entry ) {
	$id      = isset( $entry['id'] ) ? sanitize_key( (string) $entry['id'] ) : '';
	$base_id = isset( $entry['baseId'] ) ? sanitize_key( (string) $entry['baseId'] ) : '';
	$window  = isset( $entry['window'] ) ? sanitize_key( (string) $entry['window'] ) : '';
	$url     = isset( $entry['url'] ) ? (string) $entry['url'] : '';
	return 'odd' === $id || 'odd' === $base_id || 'odd' === $window || '#odd' === $url;
}

function oddout_icons_entry_shell_key( array $entry ) {
	$key = oddout_icons_entry_to_key(
		isset( $entry['id'] ) ? (string) $entry['id'] : '',
		isset( $entry['window'] ) ? (string) $entry['window'] : '',
		isset( $entry['title'] ) ? (string) $entry['title'] : '',
		isset( $entry['icon'] ) ? (string) $entry['icon'] : ''
	);
	if ( '' !== $key ) {
		return $key;
	}

	foreach ( array( 'baseId', 'base_id', 'url' ) as $field ) {
		if ( ! isset( $entry[ $field ] ) ) {
			continue;
		}
		$key = oddout_icons_slug_to_key( (string) $entry[ $field ] );
		if ( '' !== $key ) {
			return $key;
		}
	}
	return '';
}

function oddout_icons_filter_native_window_icons( $config ) {
	if ( ! is_array( $config ) || empty( $config['nativeWindows'] ) || ! is_array( $config['nativeWindows'] ) ) {
		return $config;
	}

	$set = oddout_icons_active_set_for_native_surfaces();
	if ( ! $set ) {
		return $config;
	}

	foreach ( $config['nativeWindows'] as $i => $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		$key = oddout_icons_entry_is_odd_shop_window( $entry ) ? 'odd' : oddout_icons_entry_shell_key( $entry );
		if ( ! in_array( $key, array( 'odd', 'recycle-bin' ), true ) ) {
			continue;
		}
		$url = oddout_icons_icon_url_for_key( $set, $key );
		if ( '' !== $url ) {
			$config['nativeWindows'][ $i ]['icon'] = $url;
		}
	}

	return $config;
}
add_filter( 'desktop_mode_shell_config', 'oddout_icons_filter_native_window_icons', 25 );

/**
 * Re-run {@see desktop_mode_icons} against a single static-registry entry so
 * the files-layer serialization path matches themed `desktopIcons[]`.
 * Desktop Mode snapshots shortcut tiles from {@see desktop_mode_desktop_icon_registry()}
 * icons (often dashicons-*), bypassing {@see desktop_mode_build_desktop_icons_payload()}.
 *
 * @param array<string,string|bool|int>       $shape          Serialized shortcut shape (`ref` holds registry id).
 * @param array<string,string|bool|int|mixed> $registry_entry Stored icon registration row (`id`, `icon`, …).
 *
 * @return array<string,string|bool|int>
 */
function oddout_icons_overlay_desktop_icons_on_shortcut_shape( array $shape, array $registry_entry ) {
	$ref = isset( $shape['ref'] ) ? (string) $shape['ref'] : '';
	if ( '' === $ref ) {
		return $shape;
	}

	/** @var array<string, mixed> */
	$singleton = oddout_icons_filter_desktop_icons_registry( array( $ref => $registry_entry ) );
	if (
		is_array( $singleton )
		&& isset( $singleton[ $ref ] )
		&& is_array( $singleton[ $ref ] )
		&& isset( $singleton[ $ref ]['icon'] )
	) {
		$shape['icon'] = (string) $singleton[ $ref ]['icon'];
	}
	return $shape;
}

/**
 * File-layer `buildTile()` only emits an img tag when previewUrl is set;
 * HTTPS icons copied from `desktop_mode_icons` must land there too.
 *
 * @param array<string,string|bool|int> $shape Serialized shortcut/file shape from Desktop Mode file types.
 *
 * @return array<string,string|bool|int>
 */
function oddout_icons_mirror_https_shortcut_icon_into_preview_if_needed( array $shape ) {
	$icon = isset( $shape['icon'] ) ? (string) $shape['icon'] : '';
	if ( '' === $icon || ! preg_match( '#\Ahttps?://#i', $icon ) ) {
		return $shape;
	}

	$preview = isset( $shape['previewUrl'] ) ? (string) $shape['previewUrl'] : '';
	if ( '' !== $preview ) {
		return $shape;
	}

	$shape['previewUrl'] = $icon;
	$shape['icon']       = 'dashicons-media-default';
	return $shape;
}

/**
 * Files-layer placements run through {@see Desktop_Mode_File::serialize()}.
 * Map registry shortcuts to the themed icon URL + preview semantics above.
 *
 * @param mixed $shape Shape from Desktop Mode serialize (any file type).
 *
 * @return mixed
 */
function oddout_normalize_desktop_file_shape_for_dm_files_layer( $shape ) {
	if ( ! is_array( $shape ) ) {
		return $shape;
	}
	if ( ! isset( $shape['type'] ) || 'shortcut' !== $shape['type'] ) {
		return $shape;
	}

	if ( function_exists( 'desktop_mode_desktop_icon_registry' ) ) {
		$ref = isset( $shape['ref'] ) ? (string) $shape['ref'] : '';
		if ( '' !== $ref ) {
			$entry = desktop_mode_desktop_icon_registry( $ref );
			if ( is_array( $entry ) ) {
				$shape = oddout_icons_overlay_desktop_icons_on_shortcut_shape( $shape, $entry );
			}
		}
	}

	return oddout_icons_mirror_https_shortcut_icon_into_preview_if_needed( $shape );
}

add_filter(
	'desktop_mode_file_serialize',
	static function ( $shape, $_file = null ) {
		unset( $_file );
		return oddout_normalize_desktop_file_shape_for_dm_files_layer( $shape );
	},
	10,
	2
);
