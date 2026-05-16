<?php
/**
 * ODD — widget bundle installer.
 *
 * Installs `.wp` bundles that declare `"type": "widget"`. A widget
 * bundle is:
 *
 *   manifest.json          slug / name / version / type / entry
 *   widget.js              exposes window.desktopModeWidgets[ id ]
 *   widget.css             (optional) companion stylesheet; enqueue list in manifest `"css"`
 *   assets/*               (optional) static files referenced by widget.css / widget.js
 *   preview.webp           (optional) 640×360, shown on Shop cards
 *
 * Installed widgets live at `uploads/odd/widgets/<slug>/`. Each
 * `widget.js` is registered as the script handle passed to
 * `desktop_mode_register_widget()`. Desktop Mode loads that handle,
 * reads `window.desktopModeWidgets[ id ]`, and owns widget registry,
 * persistence, dragging, resizing, max/min dimensions, and mount
 * lifecycle hooks. Declared `"css"` files are linked on the shell page
 * and returned to the Shop upload response for hot-loaded installs.
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

	$min_width      = isset( $manifest['minWidth'] ) ? max( 120, min( 720, (int) $manifest['minWidth'] ) ) : 180;
	$min_height     = isset( $manifest['minHeight'] ) ? max( 80, min( 720, (int) $manifest['minHeight'] ) ) : 120;
	$max_width      = isset( $manifest['maxWidth'] ) && (int) $manifest['maxWidth'] > 0 ? max( $min_width, min( 1440, (int) $manifest['maxWidth'] ) ) : 0;
	$max_height     = isset( $manifest['maxHeight'] ) && (int) $manifest['maxHeight'] > 0 ? max( $min_height, min( 1440, (int) $manifest['maxHeight'] ) ) : 0;
	$default_width  = isset( $manifest['defaultWidth'] ) ? max( 120, min( 960, (int) $manifest['defaultWidth'] ) ) : 280;
	$default_height = isset( $manifest['defaultHeight'] ) ? max( 80, min( 960, (int) $manifest['defaultHeight'] ) ) : 180;
	$default_width  = max( $min_width, $default_width );
	$default_height = max( $min_height, $default_height );
	if ( $max_width > 0 ) {
		$default_width = min( $default_width, $max_width );
	}
	if ( $max_height > 0 ) {
		$default_height = min( $default_height, $max_height );
	}

	$capabilities = array();
	if ( isset( $manifest['capabilities'] ) ) {
		$raw_caps = is_array( $manifest['capabilities'] ) ? $manifest['capabilities'] : array( $manifest['capabilities'] );
		foreach ( $raw_caps as $cap ) {
			$cap = sanitize_key( (string) $cap );
			if ( '' !== $cap && ! in_array( $cap, $capabilities, true ) ) {
				$capabilities[] = $cap;
			}
		}
	}

	return array(
		'slug'          => $header['slug'],
		'id'            => 'odd/' . $header['slug'],
		'name'          => $header['name'],
		'label'         => isset( $manifest['label'] ) ? sanitize_text_field( (string) $manifest['label'] ) : $header['name'],
		'version'       => $header['version'],
		'type'          => 'widget',
		'author'        => $header['author'],
		'description'   => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : $header['description'],
		'category'      => isset( $manifest['category'] ) ? sanitize_text_field( (string) $manifest['category'] ) : 'Community',
		'entry'         => $entry,
		'preview'       => $preview,
		'css'           => $css_paths,
		'icon'          => isset( $manifest['icon'] ) && is_string( $manifest['icon'] ) && 0 === strpos( $manifest['icon'], 'dashicons-' )
			? sanitize_html_class( $manifest['icon'] )
			: 'dashicons-screenoptions',
		'movable'       => array_key_exists( 'movable', $manifest ) ? (bool) $manifest['movable'] : true,
		'resizable'     => array_key_exists( 'resizable', $manifest ) ? (bool) $manifest['resizable'] : true,
		'minWidth'      => $min_width,
		'minHeight'     => $min_height,
		'maxWidth'      => $max_width,
		'maxHeight'     => $max_height,
		'defaultWidth'  => $default_width,
		'defaultHeight' => $default_height,
		'capabilities'  => $capabilities,
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
		'slug'          => $slug,
		'id'            => isset( $manifest['id'] ) ? $manifest['id'] : 'odd/' . $slug,
		'name'          => $manifest['name'],
		'label'         => $manifest['label'],
		'version'       => $manifest['version'],
		'category'      => $manifest['category'],
		'description'   => isset( $manifest['description'] ) ? $manifest['description'] : '',
		'icon'          => isset( $manifest['icon'] ) ? $manifest['icon'] : 'dashicons-screenoptions',
		'entry'         => $manifest['entry'],
		'preview'       => $manifest['preview'],
		'css'           => $css_for_index,
		'movable'       => isset( $manifest['movable'] ) ? (bool) $manifest['movable'] : true,
		'resizable'     => isset( $manifest['resizable'] ) ? (bool) $manifest['resizable'] : true,
		'minWidth'      => isset( $manifest['minWidth'] ) ? (int) $manifest['minWidth'] : 180,
		'minHeight'     => isset( $manifest['minHeight'] ) ? (int) $manifest['minHeight'] : 120,
		'maxWidth'      => isset( $manifest['maxWidth'] ) ? (int) $manifest['maxWidth'] : 0,
		'maxHeight'     => isset( $manifest['maxHeight'] ) ? (int) $manifest['maxHeight'] : 0,
		'defaultWidth'  => isset( $manifest['defaultWidth'] ) ? (int) $manifest['defaultWidth'] : 280,
		'defaultHeight' => isset( $manifest['defaultHeight'] ) ? (int) $manifest['defaultHeight'] : 180,
		'capabilities'  => isset( $manifest['capabilities'] ) && is_array( $manifest['capabilities'] ) ? $manifest['capabilities'] : array(),
		'installed'     => time(),
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
 * Declared widget.css paths for an installed slug. Bundles must declare
 * CSS in the manifest so Desktop Mode's lazy script path can receive a
 * matching stylesheet URL.
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

function oddout_widget_script_handle( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : 'odd-widget-' . $slug;
}

function oddout_widget_url_for_relative( $slug, $rel ) {
	$base = oddout_widgets_url_for( $slug );
	if ( '' === $base ) {
		return '';
	}
	return function_exists( 'oddout_content_url_for_relative' )
		? oddout_content_url_for_relative( $base, $rel )
		: $base . rawurlencode( (string) $rel );
}

function oddout_widget_stylesheet_urls_for( $slug, array $row ) {
	$out = array();
	foreach ( oddout_widget_stylesheet_paths_for( $slug, $row ) as $rel ) {
		$url = oddout_widget_url_for_relative( $slug, $rel );
		if ( '' !== $url ) {
			$out[] = $url;
		}
	}
	return $out;
}

function oddout_widget_stylesheet_loader_script( $slug, array $row ) {
	$urls = oddout_widget_stylesheet_urls_for( $slug, $row );
	if ( empty( $urls ) ) {
		return '';
	}
	$json = wp_json_encode( array_values( $urls ) );
	if ( ! is_string( $json ) || '' === $json ) {
		return '';
	}
	return '(function(){var urls=' . $json . ';var attr="data-odd-widget-style-url";function has(href){var links=document.querySelectorAll("link[rel~=\\"stylesheet\\"]");for(var i=0;i<links.length;i++){if(links[i].getAttribute(attr)===href||links[i].href===href)return true;}return false;}for(var j=0;j<urls.length;j++){var href=urls[j];if(typeof href!=="string"||!href||has(href))continue;var link=document.createElement("link");link.rel="stylesheet";link.href=href;link.setAttribute(attr,href);document.head.appendChild(link);}})();';
}

function oddout_widget_row_int( array $row, $key, $fallback, $min, $max ) {
	$value = isset( $row[ $key ] ) ? (int) $row[ $key ] : (int) $fallback;
	return max( (int) $min, min( (int) $max, $value ) );
}

function oddout_widget_register_script_handle( $slug, array $row ) {
	static $decorated_handles = array();

	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return '';
	}
	$entry = isset( $row['entry'] ) ? oddout_content_sanitize_relative_path( (string) $row['entry'] ) : 'widget.js';
	if ( '' === $entry ) {
		$entry = 'widget.js';
	}
	$handle = oddout_widget_script_handle( $slug );
	$ver    = isset( $row['version'] ) ? (string) $row['version'] : ODDOUT_VERSION;
	wp_register_script(
		$handle,
		oddout_widget_url_for_relative( $slug, $entry ),
		array( 'desktop-mode', 'odd-api' ),
		$ver,
		true
	);
	if ( empty( $decorated_handles[ $handle ] ) ) {
		$style_loader = oddout_widget_stylesheet_loader_script( $slug, $row );
		if ( '' !== $style_loader ) {
			wp_add_inline_script( $handle, $style_loader, 'before' );
		}
		$decorated_handles[ $handle ] = true;
	}
	return $handle;
}

function oddout_widget_desktop_mode_args( $slug, array $row ) {
	$handle = oddout_widget_register_script_handle( $slug, $row );
	if ( '' === $handle ) {
		return array();
	}
	$label = isset( $row['label'] ) ? sanitize_text_field( (string) $row['label'] ) : sanitize_key( (string) $slug );
	$desc  = isset( $row['description'] ) ? sanitize_text_field( (string) $row['description'] ) : '';
	if ( '' === $desc && isset( $row['name'] ) ) {
		$desc = sanitize_text_field( (string) $row['name'] );
	}
	$icon = isset( $row['icon'] ) && is_string( $row['icon'] ) && 0 === strpos( $row['icon'], 'dashicons-' )
		? sanitize_html_class( $row['icon'] )
		: 'dashicons-screenoptions';
	return array(
		'label'          => $label,
		'description'    => $desc,
		'icon'           => $icon,
		'script'         => $handle,
		'movable'        => array_key_exists( 'movable', $row ) ? (bool) $row['movable'] : true,
		'resizable'      => array_key_exists( 'resizable', $row ) ? (bool) $row['resizable'] : true,
		'min_width'      => oddout_widget_row_int( $row, 'minWidth', 180, 120, 720 ),
		'min_height'     => oddout_widget_row_int( $row, 'minHeight', 120, 80, 720 ),
		'max_width'      => isset( $row['maxWidth'] ) && (int) $row['maxWidth'] > 0 ? oddout_widget_row_int( $row, 'maxWidth', 0, 120, 1440 ) : 0,
		'max_height'     => isset( $row['maxHeight'] ) && (int) $row['maxHeight'] > 0 ? oddout_widget_row_int( $row, 'maxHeight', 0, 80, 1440 ) : 0,
		'default_width'  => oddout_widget_row_int( $row, 'defaultWidth', 280, 120, 960 ),
		'default_height' => oddout_widget_row_int( $row, 'defaultHeight', 180, 80, 960 ),
		'capabilities'   => isset( $row['capabilities'] ) && is_array( $row['capabilities'] ) ? $row['capabilities'] : array(),
	);
}

add_action(
	'init',
	function () {
		if ( ! function_exists( 'oddout_desktop_mode_supports' ) || ! oddout_desktop_mode_supports( 'host_widgets' ) || ! function_exists( 'desktop_mode_register_widget' ) ) {
			return;
		}
		$index = oddout_widgets_index_load();
		foreach ( $index as $slug => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$args = oddout_widget_desktop_mode_args( $slug, $row );
			if ( empty( $args ) ) {
				continue;
			}
			desktop_mode_register_widget( 'odd/' . sanitize_key( (string) $slug ), $args );
		}
	},
	20
);

/**
 * Enqueue installed widget assets on admin_enqueue_scripts. Desktop
 * Mode's server registry owns shell hydration; this eager enqueue keeps
 * enabled widgets available on shell boot while the handle payload still
 * supports lazy sync.
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
				$css_url    = oddout_widget_url_for_relative( $slug, $css_rel );
				wp_enqueue_style(
					$css_handle,
					$css_url,
					array(),
					$ver,
					'all'
				);
			}
			$handle = oddout_widget_register_script_handle( $slug, $row );
			if ( '' !== $handle ) {
				wp_enqueue_script( $handle );
			}
		}
	},
	20
);
