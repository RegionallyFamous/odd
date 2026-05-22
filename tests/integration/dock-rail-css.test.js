import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const CONTRAST_CSS = resolve( __dirname, '../../odd/src/icons/contrast.css' );
const RAIL_CSS = resolve( __dirname, '../../odd/src/shell/odd-dock-rail.css' );

describe( 'Desktop Mode dock rail CSS contract', () => {
	it( 'keeps side docks vertical-only without visible native scrollbars', () => {
		const css = readFileSync( CONTRAST_CSS, 'utf8' );

		expect( css ).toContain( 'body.desktop-mode-active .desktop-mode-dock[ data-desktop-mode-dock-placement="right" ] {' );
		expect( css ).toContain( 'overflow-x: hidden;' );
		expect( css ).toContain( 'overflow-y: auto;' );
		expect( css ).toContain( 'overscroll-behavior-x: none;' );
		expect( css ).toContain( 'overscroll-behavior-y: contain;' );
		expect( css ).toContain( 'touch-action: pan-y;' );
		expect( css ).toContain( 'scrollbar-width: none;' );
		expect( css ).toContain( 'scrollbar-gutter: auto;' );
		expect( css ).toContain( 'body.desktop-mode-active .desktop-mode-dock[ data-desktop-mode-dock-placement="right" ]::-webkit-scrollbar {' );
		expect( css ).toContain( 'body.desktop-mode-active .desktop-mode-icon__image img {' );
		expect( css ).not.toContain( 'data-odd-skinned-system-icon' );
		expect( css ).not.toContain( '[src*="/odd/icon-sets/"]' );
		expect( css ).not.toContain( 'scrollbar-gutter: stable;' );
		expect( css ).not.toContain( '--odd-dock-tile-size' );
		expect( css ).not.toContain( 'drop-shadow' );
		expect( css ).not.toContain( ':has(' );
		expect( css ).not.toContain( 'backdrop-filter' );
		expect( css ).not.toContain( 'background: rgba( 4, 8, 18' );
	} );

	it( 'prevents the custom ODD dock rail mount from creating horizontal drift', () => {
		const css = readFileSync( RAIL_CSS, 'utf8' );

		expect( css ).toContain( 'max-width: 100%;' );
		expect( css ).toContain( 'overflow-x: hidden;' );
		expect( css ).toContain( 'overflow-y: hidden;' );
		expect( css ).toContain( '.odd-dock-rail-mount__menu {' );
		expect( css ).toContain( 'overflow-x: auto;' );
		expect( css ).toContain( 'overscroll-behavior-x: contain;' );
		expect( css ).toContain( '.odd-dock-rail-mount__system {' );
		expect( css ).toContain( 'flex: 0 0 auto;' );
		expect( css ).toContain( 'touch-action: pan-y;' );
		expect( css ).toContain( '.desktop-mode-dock.desktop-mode-shell__dock--orientation-left .odd-dock-rail-mount__menu,' );
		expect( css ).toContain( 'align-items: center;' );
		expect( css ).toContain( 'button.odd-dock-rail-mount__tile--attention-pulse {' );
		expect( css ).toContain( 'button.odd-dock-rail-mount__tile > .desktop-mode-dock__badge {' );
		expect( css ).toContain( 'button.odd-dock-rail-mount__tile img {' );
		expect( css ).toContain( 'width: calc(100% - 8px);' );
		expect( css ).toContain( 'height: calc(100% - 8px);' );
		expect( css ).not.toContain( 'transform: translateY' );
		expect( css ).not.toContain( 'box-shadow' );
		expect( css ).not.toContain( 'rgba(106, 92, 255' );
	} );
} );
