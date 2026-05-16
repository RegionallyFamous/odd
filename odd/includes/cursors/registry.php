<?php
/**
 * ODD cursors — set registry + active preference.
 *
 * Cursor sets are now living-cursor effect packs. They keep the browser's
 * native cursor intact and provide metadata, preview art, and effect tokens
 * for the top-level cursor aura layer.
 */

defined( 'ABSPATH' ) || exit;

function oddout_cursors_resolve_set_path( $set_dir, $rel ) {
	$rel = (string) $rel;
	if ( '' === $rel || false !== strpos( $rel, "\0" ) || false !== strpos( $rel, '..' ) || false !== strpos( $rel, '\\' ) ) {
		return '';
	}
	$rel = ltrim( $rel, '/' );
	if ( '' === $rel || basename( $rel ) !== $rel ) {
		return '';
	}

	$abs      = $set_dir . '/' . $rel;
	$abs_real = realpath( $abs );
	$dir_real = realpath( $set_dir );
	if ( false === $abs_real || false === $dir_real || 0 !== strpos( $abs_real, $dir_real . DIRECTORY_SEPARATOR ) ) {
		return '';
	}
	return $abs_real;
}

function oddout_cursors_registry_transient_key() {
	return 'oddout_cursor_registry_v' . ( defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0' ) . '_effects1';
}

add_action(
	'oddout_cursors_invalidate_cache',
	function () {
		oddout_cursors_get_sets( true );
	}
);

function oddout_cursors_allowed_kinds() {
	return array( 'default', 'pointer', 'text', 'grab', 'grabbing', 'crosshair', 'not-allowed', 'wait', 'help', 'progress' );
}

function oddout_cursors_allowed_recipes() {
	return array( 'signal-bloom', 'gel-pop', 'paper-sparks', 'solar-orbit', 'moonlight-focus' );
}

function oddout_cursors_clean_effects( array $data ) {
	$effects = isset( $data['effects'] ) && is_array( $data['effects'] ) ? $data['effects'] : array();
	$accent  = isset( $effects['accent'] ) ? (string) $effects['accent'] : ( isset( $data['accent'] ) ? (string) $data['accent'] : '' );
	$recipe  = isset( $effects['recipe'] ) ? sanitize_key( (string) $effects['recipe'] ) : '';
	$out     = array(
		'accent' => '' !== $accent ? $accent : '#42d9d2',
		'spark'  => isset( $effects['spark'] ) ? (string) $effects['spark'] : '#ff4f8b',
		'warm'   => isset( $effects['warm'] ) ? (string) $effects['warm'] : '#f6b73c',
		'ink'    => isset( $effects['ink'] ) ? (string) $effects['ink'] : '#19091f',
		'recipe' => in_array( $recipe, oddout_cursors_allowed_recipes(), true ) ? $recipe : '',
	);
	$fallbacks = array(
		'accent' => '#42d9d2',
		'spark'  => '#ff4f8b',
		'warm'   => '#f6b73c',
		'ink'    => '#19091f',
	);
	foreach ( $out as $key => $value ) {
		if ( 'recipe' === $key ) {
			continue;
		}
		if ( ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $value ) ) {
			$out[ $key ] = $fallbacks[ $key ];
		}
	}
	return $out;
}

function oddout_cursors_get_sets( $reset = false ) {
	static $cache = null;
	if ( $reset ) {
		$cache = null;
		if ( function_exists( 'delete_transient' ) ) {
			delete_transient( oddout_cursors_registry_transient_key() );
		}
	}
	if ( null !== $cache ) {
		return $cache;
	}

	$transient_key = oddout_cursors_registry_transient_key();
	$persisted     = get_transient( $transient_key );
	if ( is_array( $persisted ) ) {
		$filtered = apply_filters( 'oddout_cursor_set_registry', $persisted );
		$cache    = is_array( $filtered ) ? $filtered : $persisted;
		return $cache;
	}

	$sources = array();
	$root    = ODDOUT_DIR . 'assets/cursors';
	if ( is_dir( $root ) ) {
		$dirs = glob( $root . '/*', GLOB_ONLYDIR );
		if ( is_array( $dirs ) ) {
			foreach ( $dirs as $dir ) {
				$slug = basename( $dir );
				if ( '' === $slug || '.' === $slug[0] ) {
					continue;
				}
				$manifest_path = $dir . '/manifest.json';
				if ( ! is_readable( $manifest_path ) ) {
					continue;
				}
				$raw  = file_get_contents( $manifest_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
				$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
				if ( ! is_array( $data ) ) {
					if ( function_exists( 'oddout_registry_report_bad_manifest' ) ) {
						oddout_registry_report_bad_manifest( $manifest_path, json_last_error_msg() );
					}
					continue;
				}
				$sources[ $slug ] = array(
					'data'     => $data,
					'base_dir' => $dir,
					'base_url' => ODDOUT_URL . '/assets/cursors/' . rawurlencode( $slug ),
					'source'   => 'plugin',
				);
			}
		}
	}

	if ( function_exists( 'oddout_cursorsets_scan_installed' ) ) {
		foreach ( oddout_cursorsets_scan_installed() as $slug => $entry ) {
			$sources[ $slug ] = $entry;
		}
	}

	$cache = array();
	foreach ( $sources as $slug => $entry ) {
		$data     = $entry['data'];
		$base_dir = $entry['base_dir'];
		$base_url = $entry['base_url'];
		$source   = isset( $entry['source'] ) ? (string) $entry['source'] : '';
		$effects  = oddout_cursors_clean_effects( $data );
		$preview = '';
		if ( ! empty( $data['preview'] ) ) {
			$preview_abs = oddout_cursors_resolve_set_path( $base_dir, (string) $data['preview'] );
			if ( '' !== $preview_abs && is_readable( $preview_abs ) ) {
				$preview = $base_url . '/' . rawurlencode( basename( $preview_abs ) );
				if ( 'installed' === $source && function_exists( 'oddout_cursorsets_asset_url' ) ) {
					$preview = oddout_cursorsets_asset_url( $slug, (string) $data['preview'] );
				}
			}
		}
		$cache[ $slug ] = array(
			'slug'        => $slug,
			'label'       => isset( $data['label'] ) ? (string) $data['label'] : $slug,
			'category'    => isset( $data['category'] ) ? (string) $data['category'] : '',
			'accent'      => isset( $data['accent'] ) ? (string) $data['accent'] : '#38e8ff',
			'description' => isset( $data['description'] ) ? (string) $data['description'] : '',
			'version'     => isset( $data['version'] ) ? (string) $data['version'] : '',
			'preview'     => $preview,
			'effects'     => $effects,
			'cursors'     => array(),
			'source'      => $entry['source'],
		);
	}

	set_transient( $transient_key, $cache, DAY_IN_SECONDS );

	$filtered = apply_filters( 'oddout_cursor_set_registry', $cache );
	if ( is_array( $filtered ) ) {
		$cache = $filtered;
	}
	return $cache;
}

function oddout_cursors_get_set( $slug ) {
	$sets = oddout_cursors_get_sets();
	return isset( $sets[ $slug ] ) ? $sets[ $slug ] : null;
}

function oddout_cursors_get_active_slug( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	if ( $user_id > 0 ) {
		$saved = get_user_meta( $user_id, 'oddout_cursor_set', true );
		if ( is_string( $saved ) && '' !== $saved ) {
			if ( 'none' === $saved ) {
				return '';
			}
			if ( oddout_cursors_get_set( $saved ) ) {
				return $saved;
			}
		}
	}

	$default = (string) apply_filters( 'oddout_cursors_default_slug', '' );
	return ( '' !== $default && oddout_cursors_get_set( $default ) ) ? $default : '';
}

function oddout_cursors_set_active_slug( $slug, $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	if ( $user_id <= 0 ) {
		return false;
	}
	$slug = (string) $slug;
	if ( 'none' === $slug || '' === $slug ) {
		return (bool) update_user_meta( $user_id, 'oddout_cursor_set', 'none' );
	}
	if ( ! oddout_cursors_get_set( $slug ) ) {
		return false;
	}
	return (bool) update_user_meta( $user_id, 'oddout_cursor_set', $slug );
}

function oddout_cursors_request_uses_https() {
	return function_exists( 'oddout_request_uses_https' ) ? oddout_request_uses_https() : is_ssl();
}

function oddout_cursors_url_current_scheme( $url ) {
	return function_exists( 'oddout_url_current_scheme' ) ? oddout_url_current_scheme( $url ) : $url;
}

function oddout_cursors_active_stylesheet_url( $slug = null ) {
	$slug = null === $slug ? oddout_cursors_get_active_slug() : sanitize_key( (string) $slug );
	$args = array(
		'v' => oddout_cursors_stylesheet_version( $slug ),
	);
	if ( '' !== $slug ) {
		$args['set'] = $slug;
	}
	return esc_url_raw( oddout_cursors_url_current_scheme( add_query_arg( $args, oddout_https_rest_url( 'odd/v1/cursors/active.css' ) ) ) );
}

function oddout_cursors_stylesheet_version( $slug = null ) {
	$slug = null === $slug ? oddout_cursors_get_active_slug() : sanitize_key( (string) $slug );
	$set  = '' === $slug ? null : oddout_cursors_get_set( $slug );
	if ( ! $set ) {
		return ( defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0' ) . '-living-effects1-none';
	}

	$parts = array(
		defined( 'ODDOUT_VERSION' ) ? ODDOUT_VERSION : '0',
		'living-effects1',
		$slug,
		isset( $set['version'] ) ? (string) $set['version'] : '',
	);
	if ( isset( $set['effects'] ) && is_array( $set['effects'] ) ) {
		foreach ( array( 'accent', 'spark', 'warm', 'ink', 'recipe' ) as $key ) {
			$parts[] = $key . ':' . ( isset( $set['effects'][ $key ] ) ? (string) $set['effects'][ $key ] : '' );
		}
	}
	return substr( md5( implode( '|', $parts ) ), 0, 16 );
}

function oddout_cursors_token_map( $slug = null ) {
	$slug = null === $slug ? oddout_cursors_get_active_slug() : sanitize_key( (string) $slug );
	$set  = '' === $slug ? null : oddout_cursors_get_set( $slug );
	if ( ! $set ) {
		return array();
	}

	return isset( $set['effects'] ) && is_array( $set['effects'] ) ? $set['effects'] : oddout_cursors_clean_effects( $set );
}

function oddout_cursors_shell_contract( $slug = null ) {
	$slug = null === $slug ? oddout_cursors_get_active_slug() : sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return array(
			'slug'       => '',
			'stylesheet' => '',
			'version'    => oddout_cursors_stylesheet_version( '' ),
			'tokens'     => array(),
		);
	}

	return array(
		'slug'       => $slug,
		'stylesheet' => oddout_cursors_active_stylesheet_url( $slug ),
		'version'    => oddout_cursors_stylesheet_version( $slug ),
		'tokens'     => oddout_cursors_token_map( $slug ),
	);
}
