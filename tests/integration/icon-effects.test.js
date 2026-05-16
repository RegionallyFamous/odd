import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const EFFECTS_CSS = resolve( __dirname, '../../odd/src/icons/effects.css' );
const ENQUEUE_PHP = resolve( __dirname, '../../odd/includes/enqueue.php' );

describe( 'ODD icon effects', () => {
	it( 'keeps Desktop Mode icon images in the native DOM', () => {
		const enqueue = readFileSync( ENQUEUE_PHP, 'utf8' );
		const css = readFileSync( EFFECTS_CSS, 'utf8' );

		expect( enqueue ).toContain( "'odd-icon-effects'," );
		expect( enqueue ).toContain( "ODDOUT_URL . '/src/icons/effects.css'" );
		expect( enqueue ).not.toContain( "ODDOUT_URL . '/src/icons/effects.js'" );
		expect( css ).not.toContain( '.odd-icon-fx' );
		expect( css ).not.toContain( 'background-image: var(--odd-icon-fx-src)' );
	} );

	it( 'targets existing raster icon surfaces directly', () => {
		const css = readFileSync( EFFECTS_CSS, 'utf8' );

		expect( css ).toContain( 'img.desktop-mode-dock__item-img[src*="/assets/icons/"]' );
		expect( css ).toContain( 'img.desktop-mode-dock__item-img[data-odd-skinned-system-icon]' );
		expect( css ).toContain( '.desktop-mode-dock__item-primary.odd-system-icon-skinned' );
		expect( css ).toContain( 'padding: 0;' );
		expect( css ).toContain( 'inline-size: calc(100% - 8px);' );
		expect( css ).toContain( 'block-size: calc(100% - 8px);' );
		expect( css ).toContain( '@keyframes odd-icon-outline-drift' );
		expect( css ).toContain( '--odd-icon-pack-motion: odd-icon-outline-drift;' );
		expect( css ).toContain( 'animation-name: var(--odd-icon-pack-motion);' );
		expect( css ).toContain( 'animation-duration: var(--odd-icon-pack-duration);' );
		expect( css ).toContain( '.odd-dock-rail-mount__tile:hover img[src*="/assets/icons/"]' );
		expect( css ).toContain( '.odd-panel .odd-shop__card:hover .odd-shop__card-quartet > img' );
		expect( css ).toContain( '.odd-panel .odd-shop__card--icon-set .odd-shop__card-art::after' );
	} );

	it( 'gives non-default packs distinct motion recipes beyond color swaps', () => {
		const css = readFileSync( EFFECTS_CSS, 'utf8' );

		expect( css ).toContain( '@keyframes odd-icon-coin-roll' );
		expect( css ).toContain( '@keyframes odd-icon-frost-shiver' );
		expect( css ).toContain( '@keyframes odd-icon-blueprint-scan' );
		expect( css ).toContain( '@keyframes odd-icon-circuit-blip' );
		expect( css ).toContain( '@keyframes odd-icon-clay-wobble' );
		expect( css ).toContain( '@keyframes odd-icon-blink' );
		expect( css ).toContain( '@keyframes odd-icon-misprint-jitter' );
		expect( css ).toContain( 'img[data-odd-icon-set="arcade-tokens"]' );
		expect( css ).toContain( 'img[data-odd-fun-layer="coin-spark"]' );
		expect( css ).toContain( '--odd-icon-pack-motion: odd-icon-coin-roll;' );
		expect( css ).toContain( '--odd-icon-pack-motion: odd-icon-stitch-tug;' );
		expect( css ).toContain( '--odd-icon-pack-motion: odd-icon-carved-glint;' );
		expect( css ).toContain( '.odd-panel .odd-shop__card-art[data-odd-fun-layer="hologram-scan"] .odd-shop__card-quartet > img' );
	} );

	it( 'keeps the hover treatment motion-safe and image-readable', () => {
		const css = readFileSync( EFFECTS_CSS, 'utf8' );

		expect( css ).toContain( '@keyframes odd-icon-outline-spark' );
		expect( css ).toContain( '--odd-icon-pack-hover-motion: odd-icon-outline-spark;' );
		expect( css ).toContain( 'animation-name: var(--odd-icon-pack-hover-motion);' );
		expect( css ).toContain( 'drop-shadow(-1.2px 0 0 var(--odd-icon-fx-cyan))' );
		expect( css ).toContain( 'drop-shadow(1.2px 0.2px 0 var(--odd-icon-fx-pink))' );
		expect( css ).toContain( 'transform: var(--odd-icon-pack-hover-transform);' );
		expect( css ).toContain( '@media (prefers-reduced-motion: reduce)' );
		expect( css ).toContain( 'animation: none !important;' );
		expect( css ).toContain( 'transform: none !important;' );
		expect( css ).not.toContain( 'clip-path:' );
	} );
} );
