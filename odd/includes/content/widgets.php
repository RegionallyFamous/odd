<?php
/**
 * ODD — widget bundle installer.
 *
 * Installs `.wp` bundles that declare `"type": "widget"`. A widget
 * bundle is:
 *
 *   manifest.json          slug / name / version / type / entry
 *   widget.js              self-registers via wp.desktop.registerWidget
 *   widget.css             (optional) companion stylesheet; enqueue list in manifest `"css"`
 *   assets/*               (optional) static files referenced by widget.css / widget.js
 *   preview.webp           (optional) 640×360, shown on Shop cards
 *
 * Installed widgets live at `uploads/odd/widgets/<slug>/`. Each
 * `widget.js` is enqueued on `admin_enqueue_scripts` so it runs
 * after `desktop-mode` initialises, which is enough for
 * `wp.desktop.registerWidget()` to hook the widget into the desktop
 * right column. Declared `"css"` files are linked on the same hook so
 * widget markup can be styled — previously only `.js` was loaded and
 * catalog widgets that ship `widget.css` rendered unstyled.
 *
 * Security posture mirrors scenes: widget JS runs in the admin frame
 * with full privileges, so installation requires `manage_options`
 * plus the one-time JS-content confirmation toast.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_WIDGETS_DIR' ) ) {
	define( 'ODDOUT_WIDGETS_DIR', oddout_storage_dir( 'widgets' ) );
}
if ( ! defined( 'ODDOUT_WIDGETS_URL' ) ) {
	define( 'ODDOUT_WIDGETS_URL', oddout_storage_url( 'widgets' ) );
}
if ( ! defined( 'ODDOUT_WIDGETS_OPTION_INDEX' ) ) {
	define( 'ODDOUT_WIDGETS_OPTION_INDEX', 'oddout_widgets_index' );
}

function oddout_widgets_dir_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_WIDGETS_DIR . $slug . '/';
}

function oddout_widgets_url_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : ODDOUT_WIDGETS_URL . $slug . '/';
}

function oddout_widgets_ensure_storage() {
	if ( ! is_dir( ODDOUT_WIDGETS_DIR ) ) {
		wp_mkdir_p( ODDOUT_WIDGETS_DIR );
	}
}

function oddout_widgets_index_load() {
	$raw = get_option( ODDOUT_WIDGETS_OPTION_INDEX, array() );
	return is_array( $raw ) ? $raw : array();
}

function oddout_widgets_index_save( $index ) {
	update_option( ODDOUT_WIDGETS_OPTION_INDEX, is_array( $index ) ? $index : array(), false );
}

function oddout_widget_bundle_has( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = oddout_widgets_index_load();
	return isset( $index[ $slug ] );
}

function oddout_widget_bundle_validate( $tmp_path, $filename, ZipArchive $zip, array $manifest ) {
	$header = oddout_content_validate_header( $manifest );
	if ( is_wp_error( $header ) ) {
		return $header;
	}

	$entry = isset( $manifest['entry'] ) ? (string) $manifest['entry'] : 'widget.js';
	$entry = oddout_content_sanitize_relative_path( $entry );
	if ( '' === $entry || '.js' !== strtolower( substr( $entry, -3 ) ) ) {
		return new WP_Error( 'invalid_entry', __( 'Widget bundle entry must be a .js file.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( false === $zip->getFromName( $entry ) ) {
		return new WP_Error(
			'missing_entry',
			sprintf( /* translators: %s entry path */ __( 'Entry file "%s" not found in bundle.', 'odd-outlandish-desktop-decorator' ), $entry )
		);
	}

	$preview = '';
	if ( ! empty( $manifest['preview'] ) ) {
		$preview_rel = oddout_content_sanitize_relative_path( (string) $manifest['preview'] );
		if ( '' === $preview_rel || false === $zip->getFromName( $preview_rel ) ) {
			return new WP_Error( 'invalid_preview', __( 'Preview file is not present in the bundle.', 'odd-outlandish-desktop-decorator' ) );
		}
		$preview = $preview_rel;
	}

	// Optional companion stylesheets (Magic 8-Ball, Sticky Note, …).
	$css_decl = isset( $manifest['css'] ) ? $manifest['css'] : array();
	if ( is_string( $css_decl ) ) {
		$css_decl = array( $css_decl );
	}
	if ( ! is_array( $css_decl ) ) {
		$css_decl = array();
	}
	$css_paths = array();
	foreach ( $css_decl as $css_one ) {
		$css_rel = oddout_content_sanitize_relative_path( (string) $css_one );
		if ( '' === $css_rel || '.css' !== strtolower( substr( $css_rel, -4 ) ) ) {
			return new WP_Error(
				'invalid_css',
				__( 'Widget manifest lists an invalid CSS path.', 'odd-outlandish-desktop-decorator' ),
				array( 'status' => 400 )
			);
		}
		if ( false === $zip->getFromName( $css_rel ) ) {
			return new WP_Error(
				'missing_css',
				sprintf(
					/* translators: %s: relative path inside the .wp bundle */
					__( 'CSS file "%s" is not present in the bundle.', 'odd-outlandish-desktop-decorator' ),
					$css_rel
				),
				array( 'status' => 400 )
			);
		}
		$css_paths[] = $css_rel;
	}

	return array(
		'slug'        => $header['slug'],
		'name'        => $header['name'],
		'label'       => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'     => $header['version'],
		'type'        => 'widget',
		'author'      => $header['author'],
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'franchise'   => isset( $manifest['franchise'] ) ? sanitize_text_field( (string) $manifest['franchise'] ) : 'Community',
		'entry'       => $entry,
		'preview'     => $preview,
		'css'         => $css_paths,
	);
}

function oddout_widget_bundle_install( $tmp_path, array $manifest ) {
	oddout_widgets_ensure_storage();
	$slug = $manifest['slug'];

	$extracted = oddout_content_archive_extract( $tmp_path, ODDOUT_WIDGETS_DIR, $slug );
	if ( is_wp_error( $extracted ) ) {
		return $extracted;
	}

	$dir = oddout_widgets_dir_for( $slug );

	$canonical = wp_json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
	if ( is_string( $canonical ) ) {
		oddout_write_file( $dir . 'manifest.json', $canonical );
	}

	$index          = oddout_widgets_index_load();
	$css_for_index  = isset( $manifest['css'] ) && is_array( $manifest['css'] ) ? $manifest['css'] : array();
	$index[ $slug ] = array(
		'slug'      => $slug,
		'name'      => $manifest['name'],
		'label'     => $manifest['label'],
		'version'   => $manifest['version'],
		'franchise' => $manifest['franchise'],
		'entry'     => $manifest['entry'],
		'preview'   => $manifest['preview'],
		'css'       => $css_for_index,
		'installed' => time(),
	);
	oddout_widgets_index_save( $index );

	return true;
}

function oddout_widget_bundle_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$index = oddout_widgets_index_load();
	if ( ! isset( $index[ $slug ] ) ) {
		return new WP_Error( 'not_installed', __( 'Widget is not installed.', 'odd-outlandish-desktop-decorator' ) );
	}

	$dir = oddout_widgets_dir_for( $slug );
	if ( $dir && is_dir( $dir ) ) {
		oddout_content_rrmdir( rtrim( $dir, '/' ) );
	}

	unset( $index[ $slug ] );
	oddout_widgets_index_save( $index );

	return true;
}

/**
 * Declared widget.css paths for an installed slug.
 *
 * Prefers the index row (new installs). Falls back to manifest.json on
 * disk so upgrades that added stylesheet enqueue still work for rows
 * written before `css` was persisted.
 *
 * @param string $slug Sanitized slug.
 * @param array  $row  Index row.
 * @return string[]    Sanitized relative paths that exist under the widget dir.
 */
function oddout_widget_stylesheet_paths_for( $slug, array $row ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return array();
	}

	$paths = isset( $row['css'] ) && is_array( $row['css'] ) ? $row['css'] : array();

	if ( empty( $paths ) ) {
		$dir           = oddout_widgets_dir_for( $slug );
		$manifest_path = $dir . 'manifest.json';
		if ( $dir && is_readable( $manifest_path ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local manifest beside oddout_widgets_dir_for().
			$raw = file_get_contents( $manifest_path );
			if ( is_string( $raw ) ) {
				$manifest = json_decode( $raw, true );
				if ( is_array( $manifest ) && ! empty( $manifest['css'] ) ) {
					if ( is_string( $manifest['css'] ) ) {
						$paths = array( $manifest['css'] );
					} elseif ( is_array( $manifest['css'] ) ) {
						$paths = $manifest['css'];
					}
				}
			}
		}
	}

	$dir   = oddout_widgets_dir_for( $slug );
	$out   = array();
	$paths = is_array( $paths ) ? $paths : array();
	foreach ( $paths as $rel ) {
		$rel = oddout_content_sanitize_relative_path( (string) $rel );
		if ( '' === $rel ) {
			continue;
		}
		$full = $dir . $rel;
		if ( $dir && is_readable( $full ) ) {
			$out[] = $rel;
		}
	}

	return $out;
}

/**
 * Enqueue installed widget JS on admin_enqueue_scripts. Each file
 * calls wp.desktop.registerWidget() at load time, so the widget
 * appears in the desktop right column without any extra wiring.
 */
add_action(
	'admin_enqueue_scripts',
	function () {
		if ( ! oddout_desktop_mode_available() ) {
			return;
		}
		$index = oddout_widgets_index_load();
		if ( empty( $index ) ) {
			return;
		}
		foreach ( $index as $slug => $row ) {
			$ver = isset( $row['version'] ) ? $row['version'] : ODDOUT_VERSION;
			foreach ( oddout_widget_stylesheet_paths_for( $slug, $row ) as $idx => $css_rel ) {
				$css_handle = 'odd-widget-' . $slug . '-style-' . (int) $idx;
				$css_url    = oddout_widgets_url_for( $slug ) . rawurlencode( $css_rel );
				wp_enqueue_style(
					$css_handle,
					$css_url,
					array( 'desktop-mode' ),
					$ver,
					'all'
				);
			}
			$entry = isset( $row['entry'] ) ? (string) $row['entry'] : 'widget.js';
			$url   = oddout_widgets_url_for( $slug ) . rawurlencode( $entry );
			wp_enqueue_script(
				'odd-widget-' . $slug,
				$url,
				array( 'desktop-mode', 'odd-api' ),
				$ver,
				true
			);
		}
	},
	20
);
