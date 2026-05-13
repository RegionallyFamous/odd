<?php
/**
 * ODD Apps — catalog-owned repair helpers.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'ODDOUT_APPS_REPAIR_META_OPTION' ) ) {
	define( 'ODDOUT_APPS_REPAIR_META_OPTION', 'oddout_apps_repair_meta' );
}
if ( ! defined( 'ODDOUT_APPS_REPAIR_LOCK_TTL' ) ) {
	define( 'ODDOUT_APPS_REPAIR_LOCK_TTL', 180 );
}

function oddout_apps_repair_meta_all() {
	$meta = get_option( ODDOUT_APPS_REPAIR_META_OPTION, array() );
	return is_array( $meta ) ? $meta : array();
}

function oddout_apps_repair_meta_for( $slug ) {
	$slug = sanitize_key( (string) $slug );
	$all  = oddout_apps_repair_meta_all();
	return isset( $all[ $slug ] ) && is_array( $all[ $slug ] ) ? $all[ $slug ] : array();
}

function oddout_apps_repair_record( $slug, array $row ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return array();
	}
	$all          = oddout_apps_repair_meta_all();
	$row['at']    = isset( $row['at'] ) ? (int) $row['at'] : time();
	$all[ $slug ] = wp_parse_args(
		$row,
		array(
			'status'         => 'unknown',
			'requested_path' => '',
			'catalog_owned'  => false,
			'catalog_source' => function_exists( 'oddout_catalog_meta' ) ? ( oddout_catalog_meta()['source'] ?? '' ) : '',
			'error_code'     => '',
			'error_message'  => '',
		)
	);
	update_option( ODDOUT_APPS_REPAIR_META_OPTION, $all, false );
	return $all[ $slug ];
}

function oddout_apps_repair_lock_key( $slug ) {
	return 'oddout_apps_repair_lock_' . sanitize_key( (string) $slug );
}

function oddout_apps_repair_lock_acquire( $slug ) {
	$key = oddout_apps_repair_lock_key( $slug );
	$now = time();
	if ( add_option( $key, (string) $now, '', false ) ) {
		return true;
	}
	$started = (int) get_option( $key, 0 );
	if ( $started > 0 && ( $now - $started ) > ODDOUT_APPS_REPAIR_LOCK_TTL ) {
		update_option( $key, (string) $now, false );
		return true;
	}
	return new WP_Error( 'repair_in_progress', __( 'An app repair is already in progress.', 'odd-outlandish-desktop-decorator' ) );
}

function oddout_apps_repair_lock_release( $slug ) {
	delete_option( oddout_apps_repair_lock_key( $slug ) );
}

function oddout_apps_catalog_app_row( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || ! function_exists( 'oddout_catalog_row_for' ) ) {
		return null;
	}
	$row = oddout_catalog_row_for( $slug );
	return is_array( $row ) && isset( $row['type'] ) && 'app' === $row['type'] ? $row : null;
}

function oddout_apps_icon_file_path( $slug, $manifest = null ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return '';
	}
	if ( null === $manifest ) {
		$manifest = oddout_apps_manifest_load( $slug );
	}
	$manifest = is_array( $manifest ) ? $manifest : array();
	$icon     = isset( $manifest['icon'] ) ? (string) $manifest['icon'] : '';
	if ( '' === $icon ) {
		return '';
	}
	if ( 0 === stripos( $icon, 'http://' ) || 0 === stripos( $icon, 'https://' ) ) {
		return '';
	}
	if (
		false !== strpos( $icon, '..' ) ||
		( strlen( $icon ) > 0 && '/' === $icon[0] ) ||
		false !== strpos( $icon, "\0" ) ||
		! preg_match( '#^[a-zA-Z0-9._/-]+$#', $icon )
	) {
		return '';
	}
	$ext = strtolower( pathinfo( $icon, PATHINFO_EXTENSION ) );
	if ( ! in_array( $ext, array( 'svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'ico' ), true ) ) {
		return '';
	}
	$base      = oddout_apps_dir_for( $slug );
	$real_base = realpath( $base );
	$full      = realpath( $base . $icon );
	if ( ! $real_base || ! $full || 0 !== strpos( $full, $real_base ) ) {
		return '';
	}
	return ( is_file( $full ) && is_readable( $full ) ) ? $full : '';
}

function oddout_apps_manifest_icon_health( $slug, $manifest = null ) {
	$slug = sanitize_key( (string) $slug );
	if ( null === $manifest ) {
		$manifest = oddout_apps_manifest_load( $slug );
	}
	$manifest = is_array( $manifest ) ? $manifest : array();
	$icon     = isset( $manifest['icon'] ) ? (string) $manifest['icon'] : '';
	$out      = array(
		'slug'          => $slug,
		'manifest_icon' => $icon,
		'status'        => 'missing_icon',
		'file_exists'   => false,
		'resolved_url'  => '',
		'fallback'      => true,
	);
	if ( '' === $slug || '' === $icon ) {
		return $out;
	}
	$file                = oddout_apps_icon_file_path( $slug, $manifest );
	$out['file_exists']  = is_string( $file ) && '' !== $file && is_file( $file ) && is_readable( $file );
	$out['resolved_url'] = oddout_apps_icon_url( $slug, $manifest );
	$out['fallback']     = '' === $out['resolved_url'] || ! $out['file_exists'];
	$out['status']       = $out['fallback'] ? 'missing_icon' : 'ok';
	return $out;
}

/**
 * Repair a catalog-owned app by re-extracting its verified catalog bundle.
 *
 * @return true|WP_Error
 */
function oddout_apps_repair_from_catalog( $slug, $requested_path = '' ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! function_exists( 'oddout_catalog_download_entry_file' ) || ! function_exists( 'oddout_apps_extract_archive' ) ) {
		return new WP_Error( 'repair_unavailable', __( 'App repair is not available on this install.', 'odd-outlandish-desktop-decorator' ) );
	}

	$row = oddout_apps_catalog_app_row( $slug );
	if ( ! $row ) {
		oddout_apps_repair_record(
			$slug,
			array(
				'status'         => 'repair_unavailable',
				'requested_path' => (string) $requested_path,
				'catalog_owned'  => false,
				'error_code'     => 'not_catalog_owned',
				'error_message'  => __( 'Only catalog-owned apps can be repaired automatically.', 'odd-outlandish-desktop-decorator' ),
			)
		);
		return new WP_Error( 'repair_unavailable', __( 'Only catalog-owned apps can be repaired automatically.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( empty( $row['sha256'] ) ) {
		oddout_apps_repair_record(
			$slug,
			array(
				'status'         => 'failed',
				'requested_path' => (string) $requested_path,
				'catalog_owned'  => true,
				'error_code'     => 'missing_sha256',
				'error_message'  => __( 'Catalog row is missing sha256, so repair cannot verify the archive.', 'odd-outlandish-desktop-decorator' ),
			)
		);
		return new WP_Error( 'missing_sha256', __( 'Catalog row is missing sha256, so repair cannot verify the archive.', 'odd-outlandish-desktop-decorator' ) );
	}

	$lock = oddout_apps_repair_lock_acquire( $slug );
	if ( is_wp_error( $lock ) ) {
		return $lock;
	}

	$tmp = oddout_catalog_download_entry_file( $row, 'app_repair' );
	if ( is_wp_error( $tmp ) ) {
		oddout_apps_repair_lock_release( $slug );
		oddout_apps_repair_record(
			$slug,
			array(
				'status'         => 'failed',
				'requested_path' => (string) $requested_path,
				'catalog_owned'  => true,
				'error_code'     => $tmp->get_error_code(),
				'error_message'  => $tmp->get_error_message(),
			)
		);
		return $tmp;
	}

	$result = oddout_apps_extract_archive( $tmp, $slug );
	wp_delete_file( $tmp );
	oddout_apps_repair_lock_release( $slug );

	if ( is_wp_error( $result ) ) {
		oddout_apps_repair_record(
			$slug,
			array(
				'status'         => 'failed',
				'requested_path' => (string) $requested_path,
				'catalog_owned'  => true,
				'error_code'     => $result->get_error_code(),
				'error_message'  => $result->get_error_message(),
			)
		);
		return $result;
	}

	clearstatcache();
	oddout_apps_repair_record(
		$slug,
		array(
			'status'         => 'repaired',
			'requested_path' => (string) $requested_path,
			'catalog_owned'  => true,
			'error_code'     => '',
			'error_message'  => '',
		)
	);
	return true;
}
