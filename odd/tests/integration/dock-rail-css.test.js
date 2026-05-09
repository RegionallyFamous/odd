import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const CONTRAST_CSS = resolve( __dirname, '../../src/icons/contrast.css' );
const RAIL_CSS = resolve( __dirname, '../../src/shell/odd-dock-rail.css' );

describe( 'Desktop Mode dock rail CSS contract', () => {
	it( 'keeps side docks vertical-only without visible native scrollbars', () => {
		const css = readFileSync( CONTRAST_CSS, 'utf8' );

		expect( css ).toContain( 'body.desktop-mode-active .desktop-mode-dock[ data-desktop-mode-dock-placement="right" ] {' );
		expect( css ).toContain( '--odd-dock-tile-size: 43px;' );
		expect( css ).toContain( '--odd-dock-icon-size: 38px;' );
		expect( css ).toContain( 'padding: 6px;' );
		expect( css ).toContain( 'overflow-x: hidden;' );
		expect( css ).toContain( 'overflow-y: auto;' );
		expect( css ).toContain( 'overscroll-behavior-x: none;' );
		expect( css ).toContain( 'overscroll-behavior-y: contain;' );
		expect( css ).toContain( 'touch-action: pan-y;' );
		expect( css ).toContain( 'scrollbar-width: none;' );
		expect( css ).toContain( 'scrollbar-gutter: auto;' );
		expect( css ).toContain( 'body.desktop-mode-active .desktop-mode-dock[ data-desktop-mode-dock-placement="right" ]::-webkit-scrollbar {' );
		expect( css ).toContain( 'max-width: var( --odd-dock-tile-size );' );
		expect( css ).not.toContain( 'scrollbar-gutter: stable;' );
	} );

	it( 'prevents the custom ODD dock rail mount from creating horizontal drift', () => {
		const css = readFileSync( RAIL_CSS, 'utf8' );

		expect( css ).toContain( 'max-width: 100%;' );
		expect( css ).toContain( 'overflow-x: hidden;' );
		expect( css ).toContain( 'touch-action: pan-y;' );
		expect( css ).toContain( '.desktop-mode-dock.desktop-mode-shell__dock--orientation-left .odd-dock-rail-mount__menu,' );
		expect( css ).toContain( 'align-items: center;' );
	} );
} );
