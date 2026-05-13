<?php
/**
 * ODD — extension API.
 *
 * Public surface for plugins that want to extend ODD without forking it.
 * Each helper is a thin `add_filter()` on the corresponding registry
 * filter, so registrations run in normal WP priority order and late
 * registrations win over earlier ones.
 *
 * Registry filters (PHP):
 *   - oddout_scene_registry            (odd/includes/wallpaper/registry.php)
 *   - oddout_icon_set_registry         (odd/includes/icons/registry.php)
 *   - oddout_muse_registry             (this file)
 *   - oddout_command_registry          (this file)
 *   - oddout_widget_registry           (this file)
 *   - oddout_ritual_registry           (this file)
 *   - oddout_motion_primitive_registry (this file)
 *   - oddout_app_registry              (odd/includes/apps/registry.php)
 *
 * Helper registration functions:
 *   - oddout_register_scene( $scene )
 *   - oddout_register_icon_set( $set )
 *   - oddout_register_muse( $muse )
 *   - oddout_register_command( $command )
 *   - oddout_register_widget( $widget )
 *   - oddout_register_ritual( $ritual )
 *   - oddout_register_motion_primitive( $primitive )
 *   - oddout_register_app( $app )
 *
 * Each accepts an associative array with at least a `slug`. The
 * collector function `oddout_extensions_collect( 'muses' )` returns the
 * filtered list for that registry — used by the enqueue to seed the
 * JS side of the store.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Insert `$entry` into `$registry` unless an entry with the same
 * slug already exists. Callers can override by adding a filter at
 * a higher priority.
 */
function oddout_extensions_upsert( $registry, $entry ) {
	if ( ! is_array( $registry ) ) {
		$registry = array();
	}
	if ( ! is_array( $entry ) || empty( $entry['slug'] ) ) {
		return $registry;
	}
	$slug = sanitize_key( (string) $entry['slug'] );
	if ( '' === $slug ) {
		return $registry;
	}
	$entry['slug'] = $slug;

	// Dedupe: skip when the same slug is already registered. Callers
	// that want to *replace* an entry can remove_filter() + re-add at
	// priority > 10.
	foreach ( $registry as $existing ) {
		if ( is_array( $existing ) && isset( $existing['slug'] ) && $existing['slug'] === $slug ) {
			return $registry;
		}
	}

	$registry[] = $entry;
	return $registry;
}

/**
 * Run the registry filter with an empty seed. Used by the enqueue
 * layer to hydrate JS-side registries (muses, commands, widgets,
 * rituals, motion primitives) that don't have an on-disk canonical
 * source yet.
 */
function oddout_extensions_collect( $name ) {
	$name = (string) $name;
	switch ( $name ) {
		case 'muses':
			$list = apply_filters( 'oddout_muse_registry', array() );
			break;
		case 'commands':
			$list = apply_filters( 'oddout_command_registry', array() );
			break;
		case 'widgets':
			$list = apply_filters( 'oddout_widget_registry', array() );
			break;
		case 'rituals':
			$list = apply_filters( 'oddout_ritual_registry', array() );
			break;
		case 'motionPrimitives':
			$list = apply_filters( 'oddout_motion_primitive_registry', array() );
			break;
		case 'apps':
			$list = apply_filters( 'oddout_app_registry', array() );
			break;
		default:
			return array();
	}
	return is_array( $list ) ? array_values( $list ) : array();
}

function oddout_register_scene( $scene ) {
	if ( ! is_array( $scene ) || empty( $scene['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_scene_registry',
		function ( $registry ) use ( $scene ) {
			return oddout_extensions_upsert( $registry, $scene );
		}
	);
	return true;
}

function oddout_register_icon_set( $set ) {
	if ( ! is_array( $set ) || empty( $set['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_icon_set_registry',
		function ( $registry ) use ( $set ) {
			$slug = sanitize_key( (string) $set['slug'] );
			if ( '' === $slug ) {
				return $registry;
			}
			if ( is_array( $registry ) && isset( $registry[ $slug ] ) ) {
				return $registry;
			}
			if ( ! is_array( $registry ) ) {
				$registry = array();
			}
			$registry[ $slug ] = array_merge( array( 'slug' => $slug ), $set );
			return $registry;
		}
	);
	return true;
}

function oddout_register_muse( $muse ) {
	if ( ! is_array( $muse ) || empty( $muse['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_muse_registry',
		function ( $registry ) use ( $muse ) {
			return oddout_extensions_upsert( $registry, $muse );
		}
	);
	return true;
}

function oddout_register_command( $command ) {
	if ( ! is_array( $command ) || empty( $command['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_command_registry',
		function ( $registry ) use ( $command ) {
			return oddout_extensions_upsert( $registry, $command );
		}
	);
	return true;
}

function oddout_register_widget( $widget ) {
	if ( ! is_array( $widget ) || empty( $widget['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_widget_registry',
		function ( $registry ) use ( $widget ) {
			return oddout_extensions_upsert( $registry, $widget );
		}
	);
	return true;
}

function oddout_register_ritual( $ritual ) {
	if ( ! is_array( $ritual ) || empty( $ritual['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_ritual_registry',
		function ( $registry ) use ( $ritual ) {
			return oddout_extensions_upsert( $registry, $ritual );
		}
	);
	return true;
}

function oddout_register_motion_primitive( $primitive ) {
	if ( ! is_array( $primitive ) || empty( $primitive['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_motion_primitive_registry',
		function ( $registry ) use ( $primitive ) {
			return oddout_extensions_upsert( $registry, $primitive );
		}
	);
	return true;
}

function oddout_register_app( $app ) {
	if ( ! is_array( $app ) || empty( $app['slug'] ) ) {
		return false;
	}
	add_filter(
		'oddout_app_registry',
		function ( $registry ) use ( $app ) {
			return oddout_extensions_upsert( $registry, $app );
		}
	);
	return true;
}
