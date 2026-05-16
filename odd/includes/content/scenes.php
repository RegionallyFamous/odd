<?php
/**
 * ODD — scene bundle installer.
 *
 * Installs `.wp` bundles that declare `"type": "scene"`. A scene
 * bundle is self-contained:
 *
 *   manifest.json          slug / name / version / type / entry /
 *                          preview / wallpaper / label / category /
 *                          tags[] / fallbackColor
 *   scene.js               self-registers into window.__odd.scenes
 *   preview.webp           640×360, shown on Shop cards
 *   wallpaper.webp         1920×1080, the painted backdrop
 *
 * Installed scenes live at `uploads/odd/scenes/<slug>/`. The
 * scene descriptor added to `oddout_scene_registry` carries
 * `previewUrl` + `wallpaperUrl` pointing at `content_url()` so the
 * static WebPs stream directly — no REST hop, no authenticated
 * serve endpoint. The scene `scene.js` gets enqueued on
 * `admin_enqueue_scripts` with a dependency on `odd` so it runs
 * immediately after the wallpaper engine initialises — the scene
 * self-registers into `window.__odd.scenes[slug]` before the engine
 * ever calls `loadScene()`, so the engine's lazy-load short-circuits.
 *
 * Security posture: scene JavaScript runs in the admin frame with
 * full wp.desktop privileges. Installation therefore requires
 * `manage_options`, and the universal installer's JS-content
 * confirmation toast fires before the upload hits REST.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_SCENES_DIR' ) ) {
	define( 'ODDOUT_SCENES_DIR', oddout_storage_dir( 'scenes' ) );
}
if ( ! defined( 'ODDOUT_SCENES_URL' ) ) {
	define( 'ODDOUT_SCENES_URL', oddout_storage_url( 'scenes' ) );
}
if ( ! defined( 'ODDOUT_SCENES_OPTION_INDEX' ) ) {
	define( 'ODDOUT_SCENES_OPTION_INDEX', 'oddout_scenes_index' );
}

function oddout_scenes_dir_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_SCENES_DIR . $slug . '/';
}

function oddout_scenes_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_SCENES_URL . $slug . '/';
}

function oddout_scenes_ensure_storage() {
	if ( ! is_dir( ODDOUT_SCENES_DIR ) ) {
		wp_mkdir_p( ODDOUT_SCENES_DIR );
	}
}

function oddout_scenes_index_load() {
	$raw = get_option( ODDOUT_SCENES_OPTION_INDEX, array() );
	return is_array( $raw ) ? $raw : array();
}

function oddout_scenes_index_save( $index ) {
	update_option( ODDOUT_SCENES_OPTION_INDEX, is_array( $index ) ? $index : array(), false );
}

function oddout_scene_bundle_has( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = oddout_scenes_index_load();
	return isset( $index[ $slug ] );
}

/**
 * Per-type validator. Called after archive-envelope checks pass and
 * the manifest is parsed. Returns the normalised manifest or a
 * WP_Error.
 */
function oddout_scene_bundle_validate( $tmp_path, $filename, ZipArchive $zip, array $manifest ) {
	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	$entry = isset( $manifest['entry'] ) ? (string) $manifest['entry'] : 'scene.js';
	$entry = oddout_content_sanitize_relative_path( $entry );
	if ( '' === $entry || '.js' !== strtolower( substr( $entry, -3 ) ) ) {
		return new WP_Error( 'invalid_entry', __( 'Scene bundle entry must be a .js file.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( false === $zip->getFromName( $entry ) ) {
		return new WP_Error(
			'missing_entry',
			sprintf( /* translators: %s entry path */ __( 'Entry file "%s" not found in bundle.', 'odd-outlandish-desktop-decorator' ), $entry )
		);
	}

	$preview = isset( $manifest['preview'] ) ? (string) $manifest['preview'] : 'preview.webp';
	$preview = oddout_content_sanitize_relative_path( $preview );
	if ( '' === $preview || false === $zip->getFromName( $preview ) ) {
		return new WP_Error( 'missing_preview', __( 'Scene bundle is missing preview.webp.', 'odd-outlandish-desktop-decorator' ) );
	}

	$wallpaper = isset( $manifest['wallpaper'] ) ? (string) $manifest['wallpaper'] : 'wallpaper.webp';
	$wallpaper = oddout_content_sanitize_relative_path( $wallpaper );
	if ( '' === $wallpaper || false === $zip->getFromName( $wallpaper ) ) {
		return new WP_Error( 'missing_wallpaper', __( 'Scene bundle is missing wallpaper.webp.', 'odd-outlandish-desktop-decorator' ) );
	}

	$tags = array();
	if ( isset( $manifest['tags'] ) && is_array( $manifest['tags'] ) ) {
		foreach ( $manifest['tags'] as $t ) {
			if ( is_string( $t ) && '' !== trim( $t ) ) {
				$tags[] = sanitize_text_field( $t );
			}
		}
	}

	$fallback = isset( $manifest['fallbackColor'] ) ? trim( (string) $manifest['fallbackColor'] ) : '';
	if ( '' !== $fallback && ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $fallback ) ) {
		return new WP_Error( 'invalid_fallback', __( 'fallbackColor must be a hex colour like #0a0a1f.', 'odd-outlandish-desktop-decorator' ) );
	}

	return array(
		'slug'          => $header['slug'],
		'name'          => $header['name'],
		'label'         => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'       => $header['version'],
		'type'          => 'scene',
		'author'        => $header['author'],
		'description'   => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'category'      => isset( $manifest['category'] ) ? sanitize_text_field( (string) $manifest['category'] ) : 'Community',
		'tags'          => $tags,
		'fallbackColor' => $fallback ? $fallback : '#111',
		'heroSafe'      => array_key_exists( 'heroSafe', $manifest ) ? (bool) $manifest['heroSafe'] : true,
		'entry'         => $entry,
		'preview'       => $preview,
		'wallpaper'     => $wallpaper,
	);
}

function oddout_scene_bundle_install( $tmp_path, array $manifest ) {
	oddout_scenes_ensure_storage();
	$slug = $manifest['slug'];

	$extracted = oddout_content_archive_extract( $tmp_path, ODDOUT_SCENES_DIR, $slug );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	$dir = oddout_scenes_dir_for( $slug );

	// Persist the normalised manifest alongside the author's source.
	$canonical = wp_json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
	if ( is_string( $canonical ) ) {
		oddout_write_file( $dir . 'manifest.json', $canonical );
	}

	$index          = oddout_scenes_index_load();
	$index[ $slug ] = array(
		'slug'          => $slug,
		'name'          => $manifest['name'],
		'label'         => $manifest['label'],
		'version'       => $manifest['version'],
		'category'      => $manifest['category'],
		'tags'          => $manifest['tags'],
		'fallbackColor' => $manifest['fallbackColor'],
		'heroSafe'      => isset( $manifest['heroSafe'] ) ? (bool) $manifest['heroSafe'] : true,
		'entry'         => $manifest['entry'],
		'preview'       => $manifest['preview'],
		'wallpaper'     => $manifest['wallpaper'],
		'installed'     => time(),
	);
	oddout_scenes_index_save( $index );

	// The scene registry memoises per request. A fresh page load
	// picks up the new scene via the filter below; the install
	// request itself doesn't need to see it.
	return true;
}

function oddout_scene_bundle_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index = oddout_scenes_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return new WP_Error( 'not_installed', __( 'Scene is not installed.', 'odd-outlandish-desktop-decorator' ) );
	}

	$dir = oddout_scenes_dir_for( $slug );
	if ( $dir && is_dir( $dir ) ) {
		oddout_content_rrmdir( rtrim( $dir, '/' ) );
	}

	unset( $index[ $slug ] );
	oddout_scenes_index_save( $index );

	return true;
}

/**
 * Filter callback: merge installed scenes into the scene registry.
 *
 * The built-in wallpaper engine uses `cfg.scenes` as-is for card
 * rendering and `cfg.sceneMap[slug]` for descriptor lookups. By
 * adding `previewUrl` + `wallpaperUrl` on installed descriptors the
 * panel paints cards without a REST hop and installed `scene.js`
 * files can read `window.odd.sceneMap[slug].wallpaperUrl` for the
 * painted backdrop.
 */
add_filter(
	'oddout_scene_registry',
	function ( $registry ) {
		if ( ! is_array( $registry ) ) {
			$registry = array();
		}
		$index = oddout_scenes_index_load();
		if ( empty( $index ) ) {
			return $registry;
		}

		$seen = array();
		foreach ( $registry as $scene ) {
			if ( isset( $scene['slug'] ) ) {
				$seen[ $scene['slug'] ] = true;
			}
		}

		foreach ( $index as $slug => $row ) {
			if ( isset( $seen[ $slug ] ) ) {
				continue;
			}
			$registry[] = array(
				'slug'          => $slug,
				'label'         => isset( $row['label'] ) ? $row['label'] : $slug,
				'category'      => isset( $row['category'] ) ? $row['category'] : 'Community',
				'tags'          => isset( $row['tags'] ) && is_array( $row['tags'] ) ? $row['tags'] : array(),
				'fallbackColor' => isset( $row['fallbackColor'] ) ? $row['fallbackColor'] : '#111',
				'heroSafe'      => isset( $row['heroSafe'] ) ? (bool) $row['heroSafe'] : true,
				'added'         => '',
				'installed'     => true,
				'previewUrl'    => oddout_scenes_url_for( $slug ) . rawurlencode( isset( $row['preview'] ) ? $row['preview'] : 'preview.webp' ),
				'wallpaperUrl'  => oddout_scenes_url_for( $slug ) . rawurlencode( isset( $row['wallpaper'] ) ? $row['wallpaper'] : 'wallpaper.webp' ),
			);
		}
		return $registry;
	},
	20
);

/**
 * Enqueue installed scene JS on admin_enqueue_scripts. Each file
 * self-registers into `window.__odd.scenes[slug]`, so when the
 * wallpaper engine's `loadScene()` runs it short-circuits on the
 * pre-populated entry and never issues a network request.
 */
add_action(
	'admin_enqueue_scripts',
	function () {
		if ( ! oddout_desktop_mode_available() ) {
			return;
		}
		$index = oddout_scenes_index_load();
		if ( empty( $index ) ) {
			return;
		}
		foreach ( $index as $slug => $row ) {
			$entry = isset( $row['entry'] ) ? (string) $row['entry'] : 'scene.js';
			$url   = oddout_scenes_url_for( $slug ) . rawurlencode( $entry );
			$ver   = isset( $row['version'] ) ? $row['version'] : ODDOUT_VERSION;
			wp_enqueue_script(
				'odd-scene-' . $slug,
				$url,
				array( 'odd' ),
				$ver,
				true
			);
		}
	},
	20
);
