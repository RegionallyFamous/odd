<?php
/**
 * ODD icons — native Desktop Mode icon feeds.
 *
 * Icon sets theme Desktop Mode surfaces through Desktop Mode's own
 * server-side data filters. ODD swaps the icon values that Desktop Mode
 * asks plugins to provide; the rail script fills the same raster values
 * into host-rendered system tiles that are emitted as Dashicons only.
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
		'index.php'                   => 'dashboard',
		'edit.php'                    => 'posts',
		'edit.php?post_type=page'     => 'pages',
		'upload.php'                  => 'media',
		'edit-comments.php'           => 'comments',
		'themes.php'                  => 'appearance',
		'plugins.php'                 => 'plugins',
		'users.php'                   => 'users',
		'tools.php'                   => 'tools',
		'options-general.php'         => 'settings',
		'profile.php'                 => 'profile',
		'link-manager.php'            => 'links',
		'desktop-mode-recycle-bin'    => 'recycle-bin',
		'dashboard'                   => 'dashboard',
		'posts'                       => 'posts',
		'pages'                       => 'pages',
		'media'                       => 'media',
		'comments'                    => 'comments',
		'appearance'                  => 'appearance',
		'plugins'                     => 'plugins',
		'users'                       => 'users',
		'tools'                       => 'tools',
		'settings'                    => 'settings',
		'profile'                     => 'profile',
		'links'                       => 'links',
		'recycle-bin'                 => 'recycle-bin',
		'desktop-mode-os-settings'    => 'os-settings',
		'wp-desktop-os-settings'      => 'os-settings',
		'os-settings'                 => 'os-settings',
		'desktop-mode-pwa-install'    => 'import',
		'desktop-mode-import'         => 'import',
		'desktop-mode-download'       => 'import',
		'import'                      => 'import',
		'download'                    => 'import',
		'desktop-mode-bug-report'     => 'plugins',
		'bug-report'                  => 'plugins',
		'report-bug'                  => 'plugins',
		'desktop-mode-exit'           => 'classic-admin',
		'classic-admin'               => 'classic-admin',
		'exit-desktop-mode'           => 'classic-admin',
		'wp-desktop-classic'          => 'classic-admin',
		'dashicons-desktop'           => 'os-settings',
		'dashicons-admin-site'        => 'os-settings',
		'dashicons-download'          => 'import',
		'dashicons-upload'            => 'import',
		'dashicons-migrate'           => 'import',
		'dashicons-buddicons-replies' => 'plugins',
		'dashicons-admin-plugins'     => 'plugins',
		'dashicons-exit'              => 'classic-admin',
		'dashicons-exit-alt'          => 'classic-admin',
		'dashicons-arrow-left-alt'    => 'classic-admin',
		'dashicons-arrow-left-alt2'   => 'classic-admin',
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

function oddout_icons_title_to_key( $title ) {
	$title = strtolower( (string) $title );
	if ( '' === $title ) {
		return '';
	}
	if ( false !== strpos( $title, 'os settings' ) ) {
		return 'os-settings';
	}
	$install_wp = 'install my word' . 'press';
	if (
		false !== strpos( $title, $install_wp )
		|| false !== strpos( $title, ' as an app' )
		|| false !== strpos( $title, 'download' )
		|| false !== strpos( $title, 'import' )
	) {
		return 'import';
	}
	if ( false !== strpos( $title, 'report a bug' ) || false !== strpos( $title, 'bug report' ) ) {
		return 'plugins';
	}
	if (
		false !== strpos( $title, 'exit desktop' )
		|| false !== strpos( $title, 'classic' )
		|| false !== strpos( $title, 'logout' )
		|| false !== strpos( $title, 'log out' )
	) {
		return 'classic-admin';
	}
	return '';
}

function oddout_icons_entry_to_key( $entry_id, $window = '', $title = '', $icon = '' ) {
	foreach ( array( $window, $entry_id, $icon ) as $candidate ) {
		$key = oddout_icons_slug_to_key( (string) $candidate );
		if ( '' !== $key ) {
			return $key;
		}
	}

	$key = oddout_icons_entry_recycle_key( $entry_id, $window, $title );
	if ( '' !== $key ) {
		return $key;
	}

	$key = oddout_icons_title_to_key( $title );
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

function oddout_icons_filter_dock_item( $item, $menu_slug ) {
	if ( ! is_array( $item ) ) {
		return $item;
	}
	$set = oddout_icons_active_set_for_native_surfaces();
	if ( ! $set ) {
		return $item;
	}

	$url = oddout_icons_icon_url_for_key( $set, oddout_icons_slug_to_key( (string) $menu_slug ) );
	if ( '' !== $url ) {
		$item['icon'] = $url;
	}
	return $item;
}
add_filter( 'desktop_mode_dock_item', 'oddout_icons_filter_dock_item', 20, 2 );
add_filter( 'wp_desktop_dock_item', 'oddout_icons_filter_dock_item', 20, 2 );

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
		// Skip ODD-owned native launchers — keep their app-specific art.
		$entry_id = isset( $entry['id'] ) ? (string) $entry['id'] : (string) $id;
		if ( 'odd' === $entry_id || 0 === strpos( $entry_id, 'odd-app-' ) ) {
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
		$url = oddout_icons_icon_url_for_key( $set, $key );
		if ( '' !== $url ) {
			$registry[ $id ]['icon'] = $url;
		}
	}
	return $registry;
}
add_filter( 'desktop_mode_icons', 'oddout_icons_filter_desktop_icons_registry', 20 );
add_filter( 'wp_desktop_icons', 'oddout_icons_filter_desktop_icons_registry', 20 );

function oddout_icons_filter_shell_config_icon_payloads( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$set = oddout_icons_active_set_for_native_surfaces();
	if ( ! $set ) {
		return $config;
	}

	$groups = array(
		'nativeWindows' => 'id',
		'systemTiles'   => 'id',
		'dockItems'     => 'id',
		'taskbarItems'  => 'id',
	);
	foreach ( $groups as $group => $id_field ) {
		if ( empty( $config[ $group ] ) || ! is_array( $config[ $group ] ) ) {
			continue;
		}
		foreach ( $config[ $group ] as $i => $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$entry_id = isset( $entry[ $id_field ] ) ? (string) $entry[ $id_field ] : '';
			if ( 'odd' === $entry_id || 0 === strpos( $entry_id, 'odd-app-' ) ) {
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
				continue;
			}
			$url = oddout_icons_icon_url_for_key( $set, $key );
			if ( '' !== $url ) {
				$config[ $group ][ $i ]['icon'] = $url;
			}
		}
	}

	return $config;
}
add_filter( 'desktop_mode_shell_config', 'oddout_icons_filter_shell_config_icon_payloads', 17 );
add_filter( 'wp_desktop_shell_config', 'oddout_icons_filter_shell_config_icon_payloads', 17 );

function oddout_icons_align_native_window_icons_with_shortcuts( $config ) {
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
}
add_filter( 'desktop_mode_shell_config', 'oddout_icons_align_native_window_icons_with_shortcuts', 18 );
add_filter( 'wp_desktop_shell_config', 'oddout_icons_align_native_window_icons_with_shortcuts', 18 );

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
