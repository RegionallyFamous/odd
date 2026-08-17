import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelSource = readFileSync( resolve( 'odd/src/panel/index.js' ), 'utf8' );
const panelStyles = readFileSync( resolve( 'odd/src/panel/styles.css' ), 'utf8' );
const registry = JSON.parse( readFileSync( resolve( 'site/catalog/v1/registry.json' ), 'utf8' ) );

describe( 'Apps-only ODD Shop', () => {
	let osSettings;

	beforeEach( () => {
		document.body.innerHTML = '<div data-odd-shop></div>';
		window.openStationNativeWindows = {};
		osSettings = { itemVisibility: {} };
		window.wp = {
			i18n: { __: ( value ) => value },
			os: {
				getWindowConfig: vi.fn( () => ( {
					canInstall: true,
					restNonce: 'nonce',
					rest: {
						apps: '/wp-json/odd/v1/apps',
						catalog: '/wp-json/odd/v1/bundles/catalog',
						install: '/wp-json/odd/v1/bundles/install-from-catalog',
						refresh: '/wp-json/odd/v1/bundles/refresh',
						bundles: '/wp-json/odd/v1/bundles/',
					},
					installedApps: [],
					catalogApps: registry.bundles,
				} ) ),
				fetch: vi.fn(),
				openWindow: vi.fn(),
				refreshMenu: vi.fn( () => Promise.resolve() ),
				getOsSettings: vi.fn( () => ( {
					itemVisibility: { ...osSettings.itemVisibility },
				} ) ),
				updateOsSettings: vi.fn( ( patch ) => {
					if ( patch && patch.itemVisibility ) {
						osSettings.itemVisibility = { ...patch.itemVisibility };
					}
				} ),
			},
		};
		window.eval( panelSource );
	} );

	function mountShop() {
		window.openStationNativeWindows.odd( document.body, {} );
		return document.querySelector( '[data-odd-shop]' ) || document.body;
	}

	function response( payload, ok = true ) {
		return Promise.resolve( {
			ok,
			status: ok ? 200 : 500,
			statusText: ok ? 'OK' : 'Error',
			json: () => Promise.resolve( payload ),
		} );
	}

	function catalogRow( slug ) {
		return registry.bundles.find( ( row ) => row.slug === slug );
	}

	it( 'publishes ODD Notes and ODD Workbench in the production catalog', () => {
		expect( registry.bundles.length ).toBeGreaterThanOrEqual( 2 );
		expect( registry.bundles ).toEqual( expect.arrayContaining( [
			expect.objectContaining( { type: 'app', slug: 'odd-notes', name: 'ODD Notes' } ),
			expect.objectContaining( { type: 'app', slug: 'workbench', name: 'ODD Workbench' } ),
		] ) );
	} );

	it( 'registers and renders through the OpenStation native window API', () => {
		const context = { markLoading: vi.fn(), markReady: vi.fn() };
		window.openStationNativeWindows.odd( document.body, context );
		expect( document.body.textContent ).toContain( 'Apps' );
		expect( document.body.textContent ).toContain( 'ODD Notes' );
		expect( document.body.textContent ).toContain( 'ODD Workbench' );
		expect( context.markLoading ).toHaveBeenCalledOnce();
		expect( context.markReady ).toHaveBeenCalledOnce();
	} );

	it( 'renders the apps as bounded, responsive features instead of stretching grid tiles', () => {
		window.openStationNativeWindows.odd( document.body, {} );
		const cards = document.querySelectorAll( '.odd-app-card' );
		const card = cards[ 0 ];

		expect( document.querySelector( '.odd-shop__main' ) ).not.toBeNull();
		expect( document.querySelector( '.odd-shop__intro h1' )?.textContent ).toBe( 'Small tools. Strange polish.' );
		expect( cards ).toHaveLength( registry.bundles.length );
		expect( card?.dataset.state ).toBe( 'available' );
		expect( card?.querySelector( '.odd-app-card__preview' )?.getAttribute( 'src' ) ).toBe( registry.bundles[ 0 ].card_url );
		expect( card?.querySelector( '.odd-app-card__button--primary' )?.textContent ).toContain( 'Install app' );
		expect( panelStyles ).toContain( 'width: min(100%, 1240px);' );
		expect( panelStyles ).toContain( '@container odd-shop (max-width: 840px)' );
	} );

	it( 'contains no retired wp.desktop integration calls', () => {
		expect( panelSource ).not.toContain( 'wp.desktop' );
		expect( panelSource ).not.toContain( 'desktopModeNativeWindows' );
		expect( panelSource ).toContain( 'openStationNativeWindows' );
	} );

	it( 'installs Notes into the live desktop without a page refresh', async () => {
		const notes = catalogRow( 'odd-notes' );
		const installed = {
			...notes,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( {
					installed: true,
					slug: 'odd-notes',
					row: installed,
					manifest: installed,
				} );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ notes ] } );
		} );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="odd-notes"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( '.odd-app-card[data-slug="odd-notes"]' )?.dataset.state ).toBe( 'installed' );
		} );
		expect( window.wp.os.updateOsSettings ).toHaveBeenCalledWith( {
			itemVisibility: { 'odd-app-odd-notes': 'desktop' },
		}, { windowId: 'odd' } );
		expect( window.wp.os.refreshMenu ).toHaveBeenCalledOnce();
		expect( shop.textContent ).toContain( 'Everything is up to date.' );
	} );

	it( 'preserves an existing hidden placement while reinstalling an app', async () => {
		const workbench = catalogRow( 'workbench' );
		const installed = {
			...workbench,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		osSettings.itemVisibility[ 'odd-app-workbench' ] = 'hidden';
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( { installed: true, slug: 'workbench', row: installed, manifest: installed } );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ workbench ] } );
		} );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( '.odd-app-card[data-slug="workbench"]' )?.dataset.state ).toBe( 'installed' );
		} );
		expect( window.wp.os.updateOsSettings ).not.toHaveBeenCalled();
		expect( osSettings.itemVisibility[ 'odd-app-workbench' ] ).toBe( 'hidden' );
	} );

	it( 'retries a missing Workbench registration before reporting launch success', async () => {
		const workbench = {
			...catalogRow( 'workbench' ),
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [ workbench ],
			catalogApps: [ workbench ],
		} );
		window.wp.os.openWindow.mockReturnValueOnce( false ).mockReturnValueOnce( true );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => expect( window.wp.os.openWindow ).toHaveBeenCalledTimes( 2 ) );
		expect( window.wp.os.openWindow ).toHaveBeenNthCalledWith( 1, 'odd-app-workbench', {
			source: 'odd/shop',
		} );
		expect( window.wp.os.openWindow ).toHaveBeenNthCalledWith( 2, 'odd-app-workbench', {
			source: 'odd/shop-retry',
		} );
		expect( window.wp.os.refreshMenu ).toHaveBeenCalledOnce();
		expect( shop.textContent ).not.toContain( 'could not open' );
	} );

	it( 'keeps a committed install visible when the live desktop refresh fails', async () => {
		const workbench = catalogRow( 'workbench' );
		const installed = {
			...workbench,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		window.wp.os.refreshMenu.mockRejectedValue( new Error( 'probe timed out' ) );
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( { installed: true, slug: 'workbench', row: installed, manifest: installed } );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ workbench ] } );
		} );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( '.odd-app-card[data-slug="workbench"]' )?.dataset.state ).toBe( 'installed' );
			expect( shop.textContent ).toContain( 'installed, but OpenStation could not refresh' );
		} );
		expect( shop.textContent ).toContain( 'Open app' );
		expect( shop.textContent ).not.toContain( 'Everything is up to date.' );
	} );
} );
