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
		expect( css ).toContain( 'drop-shadow(-0.7px 0 0 rgba(58, 238, 255, 0.44))' );
		expect( css ).toContain( '.odd-dock-rail-mount__tile:hover img[src*="/assets/icons/"]' );
		expect( css ).toContain( '.odd-panel .odd-shop__card:hover .odd-shop__card-quartet > img' );
		expect( css ).toContain( '.odd-panel .odd-shop__card--icon-set .odd-shop__card-art::after' );
	} );

	it( 'keeps the hover treatment motion-safe and image-readable', () => {
		const css = readFileSync( EFFECTS_CSS, 'utf8' );

		expect( css ).toContain( 'drop-shadow(-1px 0 0 var(--odd-icon-fx-cyan))' );
		expect( css ).toContain( 'drop-shadow(1px 0 0 var(--odd-icon-fx-pink))' );
		expect( css ).toContain( 'transform: translate3d(0, -1px, 0) scale(1.045);' );
		expect( css ).toContain( '@media (prefers-reduced-motion: reduce)' );
		expect( css ).toContain( 'transform: none !important;' );
		expect( css ).not.toContain( 'clip-path:' );
	} );
} );
