import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHooks } from '@wordpress/hooks';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SRC = resolve( __dirname, '../../odd/src/shell/odd-dock-rail.js' );

function execRail() {
	const src = readFileSync( SRC, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=odd-dock-rail.js` );
	fn.call( globalThis );
}

function seedOdd() {
	window.oddout = window.odd = {
		iconSet:  'filament',
		iconSets: [
				{
					slug:  'filament',
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

describe( 'ODD dock rail default icon contract', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		delete window.__odd;
		seedOdd();
	} );

	it( 'leaves Desktop Mode system tile data and host dock DOM on default icons', () => {
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
			hooks: createHooks(),
			desktop: {
				HOOKS:                    { DOCK_ITEM_APPENDED: 'desktop-mode.dock.item-appended' },
				ready:                    ( cb ) => cb(),
				registerDockRailRenderer: vi.fn(),
				listSystemTiles:          () => tiles,
				getSystemTile:            ( id ) => tiles.find( ( tile ) => tile.id === id ),
			},
		};

		execRail();

		expect( tiles.map( ( tile ) => tile.icon ) ).toEqual( [
			'dashicons-desktop',
			'dashicons-download',
			'dashicons-buddicons-replies',
			'dashicons-exit',
		] );

		expect( document.querySelectorAll( '.desktop-mode-dock__item--system img.desktop-mode-dock__item-img' ) ).toHaveLength( 0 );
		expect( Array.from( document.querySelectorAll( '.desktop-mode-dock__item-primary.odd-system-icon-skinned' ) ) ).toHaveLength( 0 );
		expect( document.querySelectorAll( '.desktop-mode-dock__item--system .dashicons' ) ).toHaveLength( 4 );

		tiles[ 0 ].icon = 'dashicons-desktop';
		window.wp.hooks.doAction( 'desktop-mode.dock.item-appended', {
			id:        'desktop-mode-os-settings',
			placement: 'dock',
		} );
		expect( tiles[ 0 ].icon ).toBe( 'dashicons-desktop' );
		expect( document.querySelector( '[data-system-id="desktop-mode-os-settings"] img' ) ).toBeNull();
	} );

	it( 'uses the host bug glyph for bug-report tiles in the custom ODD compact rail', () => {
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

		const glyph = container.querySelector( '.odd-dock-rail-mount__tile--system .dashicons-buddicons-replies' );
		expect( glyph ).toBeTruthy();
		expect( container.querySelector( '.odd-dock-rail-mount__tile--system img' ) ).toBeNull();
	} );

	it( 'forwards right-clicks on ODD compact rail launchers to the ODD dock menu bridge', () => {
		const openDockTileMenu = vi.fn();
		window.__odd = {
			desktopHooks: {
				openDockTileMenu,
			},
		};
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
			id:     'odd',
			title:  'ODD Shop',
			icon:   'https://example.test/odd.svg',
			onOpen: vi.fn(),
		} );

		const tile = container.querySelector( '.odd-dock-rail-mount__tile--system' );
		const canceled = ! tile.dispatchEvent( new MouseEvent( 'contextmenu', {
			bubbles:    true,
			cancelable: true,
			clientX:    30,
			clientY:    40,
		} ) );

		expect( canceled ).toBe( true );
		expect( openDockTileMenu ).toHaveBeenCalledWith( expect.objectContaining( {
			x:      30,
			y:      40,
			source: 'desktop-mode.dock-rail.context-menu',
		} ) );
		expect( openDockTileMenu.mock.calls[0][0].item.id ).toBe( 'odd' );
	} );

	it( 'implements Desktop Mode badge and attention methods in the compact rail', () => {
		vi.useFakeTimers();
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
			items: [
				{ id: 'odd-app-demo', slug: 'odd-app-demo', title: 'ODD Demo', icon: 'https://example.test/demo.svg' },
			],
			orientation: 'bottom',
		} );
		expect( window.__odd.dockRails ).toContain( mounted );

		mounted.setBadge( 'odd-app-demo', 7 );
		let menuTile = container.querySelector( '[data-odd-ref="odd-app-demo"]' );
		expect( menuTile.querySelector( '.desktop-mode-dock__badge' ).textContent ).toBe( '7' );

		mounted.replaceItems( [
			{ id: 'odd-app-demo', slug: 'odd-app-demo', title: 'ODD Demo', icon: 'https://example.test/demo.svg' },
		] );
		menuTile = container.querySelector( '[data-odd-ref="odd-app-demo"]' );
		expect( menuTile.querySelector( '.desktop-mode-dock__badge' ).textContent ).toBe( '7' );

		mounted.appendSystemItem( {
			id:    'odd',
			title: 'ODD Shop',
			icon:  'https://example.test/odd.svg',
		} );
		mounted.setBadge( 'odd', 124 );
		const systemTile = container.querySelector( '[data-odd-system-id="odd"]' );
		const badge = systemTile.querySelector( '.desktop-mode-dock__badge' );
		expect( badge.textContent ).toBe( '99+' );
		expect( badge.getAttribute( 'aria-label' ) ).toBe( '124 notifications' );

		mounted.setAttention( 'odd', 'shake', { intensity: 'strong', durationMs: 40 } );
		expect( systemTile.classList.contains( 'odd-dock-rail-mount__tile--attention-shake' ) ).toBe( true );
		expect( systemTile.classList.contains( 'odd-dock-rail-mount__tile--intensity-strong' ) ).toBe( true );

		vi.advanceTimersByTime( 40 );
		expect( systemTile.classList.contains( 'odd-dock-rail-mount__tile--attention-shake' ) ).toBe( false );
		expect( systemTile.classList.contains( 'odd-dock-rail-mount__tile--intensity-strong' ) ).toBe( false );

		mounted.setBadge( 'odd', 0 );
		expect( systemTile.querySelector( '.desktop-mode-dock__badge' ) ).toBeNull();
		mounted.destroy();
		expect( window.__odd.dockRails ).not.toContain( mounted );
		vi.useRealTimers();
	} );
} );
