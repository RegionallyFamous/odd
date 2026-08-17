<?php
/**
 * ODD Apps — registry + install/uninstall API.
 *
 * Public procedural surface:
 *
 *   oddout_apps_install( $tmp_path, $filename )  → manifest | WP_Error
 *   oddout_apps_uninstall( $slug )               → true | WP_Error
 *   oddout_apps_set_enabled( $slug, $bool )      → true | WP_Error
 *   oddout_apps_set_surfaces( $slug, $arr )      → true | WP_Error
 *   oddout_apps_row_surfaces( $row )             → { desktop: bool, taskbar: bool }
 *   oddout_apps_list()                           → array of index rows
 *   oddout_apps_get( $slug )                     → full manifest or array()
 *
 * Registry filter (PHP-side, seeds the JS `registries.apps` slice):
 *
 *   apply_filters( 'oddout_app_registry', [] ) → [ { slug, name, ...} ]
 *
 * The filter is populated from the on-disk index every request, so
 * installed apps "just appear" — no re-registration hook needed. The
 * same filter is open to third parties that want to register a
 * purely-in-memory app (future use).
 */

defined( 'ABSPATH' ) || exit;

/**
 * Minimum capability an installed app can require by default.
 *
 * App bundles are trusted code once installed, but their manifests must
 * not be able to broaden access to all logged-in users by declaring
 * `capability: "read"`. Hosts that intentionally run lower-privilege
 * internal apps can opt in via filters.
 *
 * @return string
 */
function oddout_apps_capability_floor() {
	$floor = (string) apply_filters( 'oddout_app_capability_floor', 'manage_options' );
	$floor = sanitize_key( $floor );
	return '' === $floor ? 'manage_options' : $floor;
}

/**
 * Normalize an app manifest/index capability against the capability floor.
 *
 * @param string $capability Manifest-supplied capability.
 * @param string $slug       App slug.
 * @return string Capability safe to pass to current_user_can().
 */
function oddout_apps_normalize_capability( $capability, $slug = '' ) {
	if ( 'odd-notes' === sanitize_key( (string) $slug ) ) {
		return 'read';
	}

	$floor     = oddout_apps_capability_floor();
	$requested = sanitize_key( (string) $capability );
	if ( '' === $requested ) {
		$requested = $floor;
	}

	$allowed = apply_filters( 'oddout_app_allowed_capabilities', array( $floor ), $floor );
	if ( ! is_array( $allowed ) ) {
		$allowed = array( $floor );
	}
	$allowed = array_values(
		array_unique(
			array_filter(
				array_map(
					static function ( $cap ) {
						return sanitize_key( (string) $cap );
					},
					$allowed
				)
			)
		)
	);
	if ( ! in_array( $floor, $allowed, true ) ) {
		$allowed[] = $floor;
	}

	return in_array( $requested, $allowed, true ) ? $requested : $floor;
}

/**
 * Install and activate an app archive.
 *
 * @return array|WP_Error The parsed manifest on success.
 */
function oddout_apps_install( $tmp_path, $filename ) {
	$manifest = oddout_apps_validate_archive( $tmp_path, $filename );
	if ( is_wp_error( $manifest ) ) {
		return $manifest;
	}

	$slug = sanitize_key( $manifest['slug'] );
	if ( oddout_apps_exists( $slug ) ) {
		return new WP_Error(
			'slug_exists',
			sprintf( /* translators: %s app slug. */ __( 'App "%s" is already installed. Delete it before reinstalling.', 'odd-outlandish-desktop-decorator' ), $slug ),
			array( 'status' => 409 )
		);
	}

	// Atomic install lock: add_option returns false when the key
	// already exists, so concurrent installs of the same slug fail
	// the second caller fast. The value is a timestamp so a fatal
	// error cannot strand the lock forever.
	$lock_key = 'oddout_apps_install_lock_' . $slug;
	if ( ! add_option( $lock_key, (string) time(), '', false ) ) {
		$started = (int) get_option( $lock_key, 0 );
		if ( $started <= 0 || ( time() - $started ) <= 10 * MINUTE_IN_SECONDS ) {
			return new WP_Error(
				'install_in_progress',
				__( 'An installation of this app is already in progress.', 'odd-outlandish-desktop-decorator' ),
				array(
					'status'     => 409,
					'started_at' => $started,
				)
			);
		}
		update_option( $lock_key, (string) time(), false );
	}

	$extracted = oddout_apps_extract_archive( $tmp_path, $slug );
	delete_option( $lock_key );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	// Manifest authors can declare the default surfaces per app; users can
	// override them after install. Defaults favor a visible desktop launcher
	// and keep the dock quiet unless the manifest opts in.
	$surfaces = array(
		'desktop' => isset( $manifest['surfaces']['desktop'] ) ? (bool) $manifest['surfaces']['desktop'] : true,
		'taskbar' => isset( $manifest['surfaces']['taskbar'] ) ? (bool) $manifest['surfaces']['taskbar'] : false,
	);

	$index          = oddout_apps_index_load();
	$index[ $slug ] = array(
		'slug'        => $slug,
		'name'        => sanitize_text_field( $manifest['name'] ),
		'version'     => sanitize_text_field( $manifest['version'] ),
		'enabled'     => true,
		'icon'        => isset( $manifest['icon'] ) ? sanitize_text_field( (string) $manifest['icon'] ) : '',
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : '',
		'capability'  => oddout_apps_normalize_capability( isset( $manifest['capability'] ) ? (string) $manifest['capability'] : '', $slug ),
		'surfaces'    => $surfaces,
		'installed'   => time(),
	);
	oddout_apps_index_save( $index );

	$manifest['installed'] = $index[ $slug ]['installed'];
	$manifest['enabled']   = true;
	$manifest['surfaces']  = $surfaces;
	oddout_apps_manifest_save( $slug, $manifest );
	oddout_apps_seed_core_item_visibility( $slug, $surfaces );

	/**
	 * Fires after an app is successfully installed.
	 *
	 * @param string $slug
	 * @param array  $manifest
	 */
	do_action( 'oddout_app_installed', $slug, $manifest );

	return $manifest;
}

/**
 * Uninstall an app: removes its directory, per-slug option, and
 * index entry. Idempotent — returns true for missing apps.
 */
function oddout_apps_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$dir = oddout_apps_dir_for( $slug );
	if ( is_dir( $dir ) ) {
		oddout_apps_rrmdir( $dir );
	}
	oddout_apps_manifest_delete( $slug );
	$index = oddout_apps_index_load();
	if ( isset( $index[ $slug ] ) ) {
		unset( $index[ $slug ] );
		oddout_apps_index_save( $index );
	}
	oddout_apps_remove_core_item_visibility( $slug );
	do_action( 'oddout_app_uninstalled', $slug );
	return true;
}

function oddout_apps_set_enabled( $slug, $enabled ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index = oddout_apps_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return new WP_Error( 'not_installed', __( 'App is not installed.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index[ $slug ]['enabled'] = (bool) $enabled;
	oddout_apps_index_save( $index );

	$manifest = oddout_apps_manifest_load( $slug );
	if ( $manifest ) {
		$manifest['enabled'] = (bool) $enabled;
		oddout_apps_manifest_save( $slug, $manifest );
	}
	if ( $enabled ) {
		do_action( 'oddout_app_enabled', $slug );
	} else {
		do_action( 'oddout_app_disabled', $slug );
	}
	return true;
}

/**
 * Update the per-app `surfaces` preference.
 *
 * In current OpenStation, visible placement belongs to the host-owned
 * `itemVisibility` OS setting for the canonical `odd-app-{slug}` icon.
 * ODD still stores this normalized shape for install defaults, REST
 * compatibility, and older hosts that do not expose the OS-settings API.
 * Runtime registration always publishes the app window and launcher; it
 * does not use this row to add/remove OpenStation surfaces itself.
 *
 * @param string $slug
 * @param array  $surfaces { desktop?: bool, taskbar?: bool }
 * @return true|WP_Error
 */
function oddout_apps_set_surfaces( $slug, $surfaces ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index = oddout_apps_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return new WP_Error( 'not_installed', __( 'App is not installed.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! is_array( $surfaces ) ) {
		return new WP_Error( 'invalid_surfaces', __( 'Invalid surfaces payload.', 'odd-outlandish-desktop-decorator' ) );
	}

	// Merge onto the existing (or defaulted) surfaces so a partial
	// payload like { taskbar: true } leaves `desktop` untouched — the
	// Shop checkboxes are independent and shouldn't clobber each other.
	$current                    = oddout_apps_row_surfaces( $index[ $slug ] );
	$clean                      = array(
		'desktop' => isset( $surfaces['desktop'] ) ? ! empty( $surfaces['desktop'] ) : $current['desktop'],
		'taskbar' => isset( $surfaces['taskbar'] ) ? ! empty( $surfaces['taskbar'] ) : $current['taskbar'],
	);
	$index[ $slug ]['surfaces'] = $clean;
	oddout_apps_index_save( $index );

	$manifest = oddout_apps_manifest_load( $slug );
	if ( $manifest ) {
		$manifest['surfaces'] = $clean;
		oddout_apps_manifest_save( $slug, $manifest );
	}
	oddout_apps_seed_core_item_visibility( $slug, $clean, 0, true );

	/**
	 * Fires after an app's surface preferences change.
	 *
	 * @param string $slug
	 * @param array  $surfaces { desktop: bool, taskbar: bool }
	 */
	do_action( 'oddout_app_surfaces_changed', $slug, $clean );

	return true;
}

function oddout_apps_core_item_id( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : 'odd-app-' . $slug;
}

function oddout_apps_surfaces_to_core_placement( $surfaces ) {
	$clean = oddout_apps_row_surfaces(
		array(
			'surfaces' => is_array( $surfaces ) ? $surfaces : array(),
		)
	);
	if ( $clean['desktop'] && $clean['taskbar'] ) {
		return 'both';
	}
	if ( $clean['taskbar'] ) {
		return 'dock';
	}
	if ( $clean['desktop'] ) {
		return 'desktop';
	}
	return 'hidden';
}

/**
 * Seed OpenStation's native launcher placement for an app.
 *
 * The installed-app index stores ODD's fallback `{ desktop, taskbar }`
 * shape, but current OpenStation decides visibility from
 * `osSettings.itemVisibility[odd-app-{slug}]`. Without this server-side
 * seed, installs that happen outside the live panel JS path register a
 * window/icon but have no visible desktop launcher until a manual toggle.
 *
 * Existing host placement wins unless `$force` is true; this keeps app
 * updates and reinstalls from silently undoing a user's hidden/taskbar choice.
 *
 * @param string $slug     App slug.
 * @param array  $surfaces { desktop: bool, taskbar: bool }
 * @param int    $user_id  Optional user id. Defaults to current user.
 * @param bool   $force    Whether to overwrite an existing placement.
 * @return bool Whether a host settings write occurred.
 */
function oddout_apps_seed_core_item_visibility( $slug, $surfaces, $user_id = 0, $force = false ) {
	$item_id = oddout_apps_core_item_id( $slug );
	$user_id = (int) ( $user_id ?: get_current_user_id() );
	if (
		'' === $item_id ||
		$user_id <= 0 ||
		! oddout_openstation_supports( 'os_settings' )
	) {
		return false;
	}

	try {
		$settings = openstation_get_os_settings( $user_id );
		if ( ! is_array( $settings ) ) {
			$settings = openstation_default_os_settings();
		}
		if ( ! is_array( $settings ) ) {
			return false;
		}

		if ( empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
			$settings['itemVisibility'] = array();
		}
		if ( ! $force && array_key_exists( $item_id, $settings['itemVisibility'] ) ) {
			return false;
		}

		$settings['itemVisibility'][ $item_id ] = oddout_apps_surfaces_to_core_placement( $surfaces );
		return (bool) openstation_save_os_settings( $user_id, $settings );
	} catch ( Throwable $e ) {
		return false;
	}
}

function oddout_apps_remove_core_item_visibility( $slug, $user_id = 0 ) {
	$item_id = oddout_apps_core_item_id( $slug );
	$user_id = (int) ( $user_id ?: get_current_user_id() );
	if (
		'' === $item_id ||
		$user_id <= 0 ||
		! oddout_openstation_supports( 'os_settings' )
	) {
		return false;
	}

	try {
		$settings = openstation_get_os_settings( $user_id );
		if ( ! is_array( $settings ) || empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
			return false;
		}
		if ( ! array_key_exists( $item_id, $settings['itemVisibility'] ) ) {
			return false;
		}

		unset( $settings['itemVisibility'][ $item_id ] );
		return (bool) openstation_save_os_settings( $user_id, $settings );
	} catch ( Throwable $e ) {
		return false;
	}
}

/**
 * Normalize the `surfaces` field on an app index row. App manifests may omit
 * the field; the current v1 default is `{ desktop: true, taskbar: false }`.
 *
 * @param array $row
 * @return array { desktop: bool, taskbar: bool }
 */
function oddout_apps_row_surfaces( $row ) {
	$s = isset( $row['surfaces'] ) && is_array( $row['surfaces'] ) ? $row['surfaces'] : array();
	return array(
		'desktop' => isset( $s['desktop'] ) ? (bool) $s['desktop'] : true,
		'taskbar' => isset( $s['taskbar'] ) ? (bool) $s['taskbar'] : false,
	);
}

/**
 * Flat list of installed apps, sorted alphabetically by name. Each
 * entry is the row from the index. The enqueue layer ships this same
 * list to the JS store as `registries.apps`.
 */
function oddout_apps_list() {
	$index = oddout_apps_index_load();
	// Publish only approved first-party catalog apps. Preserve any other
	// installed app data on disk without exposing unapproved launchers.
	$allowed_slugs = function_exists( 'oddout_catalog_allowed_slugs' )
		? oddout_catalog_allowed_slugs()
		: array( 'odd-notes' );
	$rows          = array();
	foreach ( $allowed_slugs as $slug ) {
		$slug = sanitize_key( (string) $slug );
		if ( isset( $index[ $slug ] ) ) {
			$rows[] = $index[ $slug ];
		}
	}
	foreach ( $rows as &$row ) {
			// Keep the REST response and Shop store on a complete shape.
		$row['surfaces'] = oddout_apps_row_surfaces( $row );
	}
	unset( $row );
	usort(
		$rows,
		function ( $a, $b ) {
			$an = isset( $a['name'] ) ? (string) $a['name'] : '';
			$bn = isset( $b['name'] ) ? (string) $b['name'] : '';
			return strcmp( $an, $bn );
		}
	);
	return $rows;
}

function oddout_apps_get( $slug ) {
	return oddout_apps_manifest_load( $slug );
}

/**
 * Populate the oddout_app_registry filter with installed apps. Runs at
 * priority 5 so later filters can override or hide entries.
 */
add_filter(
	'oddout_app_registry',
	function ( $registry ) {
		if ( ! is_array( $registry ) ) {
			$registry = array();
		}
		$seen = array();
		foreach ( $registry as $e ) {
			if ( isset( $e['slug'] ) ) {
				$seen[ $e['slug'] ] = true;
			}
		}
		foreach ( oddout_apps_list() as $row ) {
			if ( isset( $seen[ $row['slug'] ] ) ) {
				continue;
			}
			$registry[] = $row;
		}
		return $registry;
	},
	5
);
