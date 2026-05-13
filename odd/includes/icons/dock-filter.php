<?php
/**
 * ODD icons — dock item + desktop icon overrides.
 *
 * Hooks into WP Desktop Mode's singular `desktop_mode_dock_item` filter
 * (fires once per tile inside `desktop_mode_build_dock_items()` with
 * the real admin menu slug — `edit.php`, `upload.php`,
 * `options-general.php`… — as the 2nd argument) and replaces each
 * item's `icon` field with a URL pointing at the active icon set's
 * SVG when a mapping exists for that menu slug. Desktop icons are
 * themed through the matching `desktop_mode_icons` filter.
 *
 * Why slug-based: dock items ship keyed by their admin menu file and
 * sets declare icons under those same keys in `manifest.json#icons`,
 * so the mapping is a single hash lookup with no per-set PHP.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Canonical menu-slug → icon-set-key normalization. Lets sets use
 * short, friendly keys (`posts`, `pages`, `media`) instead of the
 * raw `edit.php` / `upload.php` / `edit.php?post_type=page` strings.
 */
function oddout_icons_slug_to_key( $slug ) {
	$slug = (string) $slug;
	$map  = array(
		'index.php'                => 'dashboard',
		'edit.php'                 => 'posts',
		'edit.php?post_type=page'  => 'pages',
		'upload.php'               => 'media',
		'edit-comments.php'        => 'comments',
		'themes.php'               => 'appearance',
		'plugins.php'              => 'plugins',
		'users.php'                => 'users',
		'tools.php'                => 'tools',
		'options-general.php'      => 'settings',
		'profile.php'              => 'profile',
		'link-manager.php'         => 'links',
		'desktop-mode-recycle-bin' => 'recycle-bin',
	);
	if ( isset( $map[ $slug ] ) ) {
		return $map[ $slug ];
	}
	// Heuristic: any `edit.php?post_type=X` falls under 'posts' unless
	// the set ships an override for the CPT explicitly.
	if ( 0 === strpos( $slug, 'edit.php?post_type=' ) ) {
		return 'posts';
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

add_filter(
	'desktop_mode_dock_item',
	function ( $item, $menu_slug ) {
		if ( ! is_array( $item ) ) {
			return $item;
		}
		$slug = oddout_icons_get_active_slug();
		if ( '' === $slug ) {
			return $item;
		}
		$set = oddout_icons_get_set( $slug );
		if ( ! $set || empty( $set['icons'] ) ) {
			return $item;
		}

		$key = oddout_icons_slug_to_key( (string) $menu_slug );
		if ( '' !== $key && ! empty( $set['icons'][ $key ] ) ) {
			$item['icon'] = (string) $set['icons'][ $key ];
			return $item;
		}
		// Always-on fallback so every dock tile feels themed even when
		// a set ships no match for e.g. a third-party admin page.
		if ( ! empty( $set['icons']['fallback'] ) ) {
			$item['icon'] = (string) $set['icons']['fallback'];
		}
		return $item;
	},
	20,
	2
);

add_filter(
	'desktop_mode_icons',
	function ( $registry ) {
		if ( ! is_array( $registry ) || empty( $registry ) ) {
			return $registry;
		}
		$slug = oddout_icons_get_active_slug();
		if ( '' === $slug ) {
			return $registry;
		}
		$set = oddout_icons_get_set( $slug );
		if ( ! $set || empty( $set['icons'] ) ) {
			return $registry;
		}

		foreach ( $registry as $id => $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			// Skip ODD-owned native launchers — keep their app-specific art.
			$entry_id = isset( $entry['id'] ) ? (string) $entry['id'] : (string) $id;
			if ( 'odd' === $entry_id || 0 === strpos( $entry_id, 'odd-app-' ) ) {
				continue;
			}
			$window = isset( $entry['window'] ) ? (string) $entry['window'] : '';
			if ( 0 === strpos( $window, 'odd-app-' ) ) {
				continue;
			}
			$key = oddout_icons_slug_to_key( $window );
			if ( '' === $key ) {
				$key = oddout_icons_entry_recycle_key(
					$entry_id,
					$window,
					isset( $entry['title'] ) ? (string) $entry['title'] : ''
				);
			}
			if ( '' === $key ) {
				// Desktop icons can also target URLs — try matching by the
				// icon id as a last-ditch key.
				$key = sanitize_key( $entry_id );
			}
			if ( '' !== $key && ! empty( $set['icons'][ $key ] ) ) {
				$registry[ $id ]['icon'] = (string) $set['icons'][ $key ];
				continue;
			}
			if ( ! empty( $set['icons']['fallback'] ) ) {
				$registry[ $id ]['icon'] = (string) $set['icons']['fallback'];
			}
		}
		return $registry;
	},
	20
);

/**
 * Keep native-window taskbar icons aligned with themed desktop shortcuts.
 *
 * WP Desktop Mode can surface the same logical surface as both a wallpaper
 * shortcut (`desktopIcons[]`) and a dock/taskbar entry (`nativeWindows[]`).
 * After icon-set theming runs, the desktop entry carries the SVG URL while
 * the native window may still advertise a Dashicon name — copy the desktop
 * art onto the matching native window when their `id` values match.
 */
add_filter(
	'desktop_mode_shell_config',
	function ( $config ) {
		if ( ! is_array( $config ) ) {
			return $config;
		}
		if ( empty( $config['nativeWindows'] ) || ! is_array( $config['nativeWindows'] ) ) {
			return $config;
		}
		if ( empty( $config['desktopIcons'] ) || ! is_array( $config['desktopIcons'] ) ) {
			return $config;
		}

		$by_id = array();
		foreach ( $config['desktopIcons'] as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$id = isset( $entry['id'] ) ? (string) $entry['id'] : '';
			if ( '' === $id || ! isset( $entry['icon'] ) || '' === (string) $entry['icon'] ) {
				continue;
			}
			$by_id[ $id ] = (string) $entry['icon'];
		}
		if ( empty( $by_id ) ) {
			return $config;
		}

		foreach ( $config['nativeWindows'] as $i => $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}
			$wid = isset( $win['id'] ) ? (string) $win['id'] : '';
			if ( '' === $wid || ! isset( $by_id[ $wid ] ) ) {
				continue;
			}
			$config['nativeWindows'][ $i ]['icon'] = $by_id[ $wid ];
		}

		return $config;
	},
	18
);

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
	// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Desktop Mode owns this integration hook.
	$singleton = apply_filters( 'desktop_mode_icons', array( $ref => $registry_entry ) );
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
