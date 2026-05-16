<?php
/**
 * ODD wallpaper — scene registry.
 *
 * The plugin no longer ships scenes. The registry is fully
 * filter-driven; installed scene bundles add descriptors via the
 * `oddout_scene_registry` filter (see includes/content/scenes.php). On
 * a brand-new site with zero bundles this returns an empty list and
 * the wallpaper runtime falls back to its built-in "pending" scene
 * until the starter pack installer finishes.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Return the active scene registry.
 *
 * Result is memoised per request, so filter callbacks should be
 * idempotent — they run once per process.
 *
 * @return array<int, array<string, mixed>>
 */
/**
 * Reset the per-request memoisation caches in this file. Exposed so
 * tests (and any extension that mutates `oddout_scene_registry` filters
 * mid-request) can force a fresh rebuild.
 *
 * @since 1.0.0
 *
 * @return void
 */
function oddout_wallpaper_scenes_reset() {
	oddout_wallpaper_scenes( true );
	oddout_wallpaper_scene_slugs( true );
}

function oddout_wallpaper_scenes( $reset = false ) {
	static $cache = null;
	if ( $reset ) {
		$cache = null;
	}
	if ( null === $cache ) {
		/**
		 * Filter the ODD scene registry.
		 *
		 * @since 0.14.0
		 * @since 1.0.0 no longer seeded from a bundled scenes.json —
		 *              installed scene bundles populate this list
		 *              through includes/content/scenes.php.
		 *
		 * @param array $registry List of scene descriptors. Each descriptor
		 *                        must have at least a `slug`; ODD also reads
		 *                        `label`, `category`, `tags`, `fallbackColor`,
		 *                        `previewUrl`, `wallpaperUrl`.
		 */
		$cache = apply_filters( 'oddout_scene_registry', array() );
		if ( ! is_array( $cache ) ) {
			$cache = array();
		}
	}
	return $cache;
}

function oddout_wallpaper_scene_slugs( $reset = false ) {
	static $slugs = null;
	if ( $reset ) {
		$slugs = null;
	}
	if ( null !== $slugs ) {
		return $slugs;
	}
	$slugs = array();
	foreach ( oddout_wallpaper_scenes() as $scene ) {
		if ( isset( $scene['slug'] ) ) {
			$slugs[] = $scene['slug'];
		}
	}
	return $slugs;
}

function oddout_wallpaper_default_scene() {
	$slugs = oddout_wallpaper_scene_slugs();
	// Prefer the starter pack's first scene (oddling-desktop by
	// default) so users hitting a mid-install admin load still get a
	// sensible default. Falls back to the first installed scene
	// otherwise.
	if ( function_exists( 'oddout_catalog_starter_pack' ) ) {
		$starter = oddout_catalog_starter_pack();
		if ( ! empty( $starter['scenes'] ) ) {
			foreach ( (array) $starter['scenes'] as $slug ) {
				if ( in_array( $slug, $slugs, true ) ) {
					return (string) $slug;
				}
			}
		}
	}
	foreach ( array( 'oddling-desktop', 'flux' ) as $fallback ) {
		if ( in_array( $fallback, $slugs, true ) ) {
			return $fallback;
		}
	}
	return $slugs ? $slugs[0] : '';
}

function oddout_wallpaper_sanitize_slug_list( $value, $cap ) {
	if ( ! is_array( $value ) ) {
		return array();
	}
	$valid = oddout_wallpaper_scene_slugs();
	$out   = array();
	foreach ( $value as $item ) {
		$slug = is_string( $item ) ? sanitize_key( $item ) : '';
		if ( $slug && in_array( $slug, $valid, true ) && ! in_array( $slug, $out, true ) ) {
			$out[] = $slug;
		}
		if ( count( $out ) >= (int) $cap ) {
			break;
		}
	}
	return $out;
}
