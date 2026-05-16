import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SRC = resolve( __dirname, '../../odd/src/shell/odd-dock-rail.js' );

function execRail() {
	const src = readFileSync( SRC, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=odd-dock-rail.js` );
	fn.call( globalThis );
}

function seedOdd() {
	window.oddout = window.odd = {
		iconSet:  'oddlings',
		iconSets: [
			{
				slug:  'oddlings',
				icons: {
					'os-settings':   'https://example.test/icons/os-settings.webp',
					import:          'https://example.test/icons/import.webp',
					plugins:         'https://example.test/icons/plugins.webp',
					'classic-admin': 'https://example.test/icons/classic-admin.webp',
				},
			},
		],
	};
}

function systemTile( id, label, icon ) {
	const tile = document.createElement( 'div' );
	tile.className = 'desktop-mode-dock__item desktop-mode-dock__item--system';
	tile.setAttribute( 'data-system-id', id );
	tile.innerHTML = '<button class="desktop-mode-dock__item-primary" type="button" aria-label="' + label + '"><span class="dashicons ' + icon + '" aria-hidden="true"></span></button>';
	return tile;
}

describe( 'ODD dock rail system icon skinning', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		seedOdd();
	} );

	it( 'replaces default Desktop Mode system rail dashicons with active icon-set rasters', async () => {
		const tiles = [
			{ id: 'desktop-mode-os-settings', title: 'OS Settings', icon: 'dashicons-desktop' },
			{ id: 'desktop-mode-pwa-install', title: 'Install My WordPress Website as an app', icon: 'dashicons-download' },
			{ id: 'desktop-mode-bug-report', title: 'Report a bug', icon: 'dashicons-buddicons-replies' },
			{ id: 'desktop-mode-exit', title: 'Exit Desktop Mode', icon: 'dashicons-exit' },
		];
		const nav = document.createElement( 'nav' );
		tiles.forEach( ( tile ) => nav.appendChild( systemTile( tile.id, tile.title, tile.icon ) ) );
		document.body.appendChild( nav );

		window.wp = {
			i18n:  { __: ( text ) => text },
			hooks: { addAction: vi.fn() },
			desktop: {
				HOOKS:                    { DOCK_ITEM_APPENDED: 'wp-desktop.dock.item-appended' },
				ready:                    ( cb ) => cb(),
				registerDockRailRenderer: vi.fn(),
				listSystemTiles:          () => tiles,
				getSystemTile:            ( id ) => tiles.find( ( tile ) => tile.id === id ),
			},
		};

		execRail();
		await new Promise( ( resolvePromise ) => setTimeout( resolvePromise, 20 ) );

		expect( tiles.map( ( tile ) => tile.icon ) ).toEqual( [
			'https://example.test/icons/os-settings.webp',
			'https://example.test/icons/import.webp',
			'https://example.test/icons/plugins.webp',
			'https://example.test/icons/classic-admin.webp',
		] );

		const imgs = Array.from( document.querySelectorAll( '.desktop-mode-dock__item--system img' ) );
		expect( imgs.map( ( img ) => img.getAttribute( 'data-odd-icon-key' ) ) ).toEqual( [
			'os-settings',
			'import',
			'plugins',
			'classic-admin',
		] );
		expect( imgs.every( ( img ) => img.className === 'desktop-mode-dock__item-img' ) ).toBe( true );
		expect( document.querySelectorAll( '.desktop-mode-dock__item--system .dashicons' ) ).toHaveLength( 0 );
	} );

	it( 'uses the bug glyph for bug-report tiles in the custom ODD compact rail', () => {
		window.wp = {
			i18n:  { __: ( text ) => text },
			hooks: { addAction: vi.fn() },
			desktop: {
				ready:                    ( cb ) => cb(),
				registerDockRailRenderer: vi.fn(),
			},
		};

		execRail();

		const renderer = window.wp.desktop.registerDockRailRenderer.mock.calls[0][0];
		const container = document.createElement( 'div' );
		const mounted = renderer.mount( {
			container,
			items:       [],
			orientation: 'left',
		} );
		mounted.appendSystemItem( {
			id:    'desktop-mode-bug-report',
			title: 'Report a bug',
			icon:  'dashicons-buddicons-replies',
		} );

		const img = container.querySelector( '.odd-dock-rail-mount__tile--system img' );
		expect( img ).toBeTruthy();
		expect( img.src ).toBe( 'https://example.test/icons/plugins.webp' );
	} );
} );
